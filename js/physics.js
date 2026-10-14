import { clamp } from './lighting.js';

const M = window.Matter;

// Real rigid-body physics (Matter.js). Scale: a letter tile is treated as a ~20 cm toy block,
// so gravity is 9.8 m/s^2 * (tileWidth / 0.2 m) in pixel units. Velocities passed to Matter are
// per 1/60 s step, which is why impulses below are divided by 60.
const STEP = 1000 / 120;

export class Physics {
  constructor(onImpact) {
    this.engine = M.Engine.create({ positionIterations: 8, velocityIterations: 6 });
    this.world = this.engine.world;
    this.onImpact = onImpact;
    this.timeScale = 1;
    this.acc = 0;
    this.statics = [];
    this.T = 70;
    this.TH = 60;
    this.floorY = 400;
    M.Events.on(this.engine, 'collisionStart', (ev) => this.collisions(ev));
  }

  // L: { left, right, floorY, T, TH }
  setup(L) {
    this.T = L.T;
    this.TH = L.TH;
    this.floorY = L.floorY;
    this.statics.forEach((b) => M.Composite.remove(this.world, b));
    const th = 400;
    const floor = M.Bodies.rectangle((L.left + L.right) / 2, L.floorY + th / 2, L.right - L.left + th * 2, th,
      { isStatic: true, friction: 0.9, restitution: 0.25, label: 'floor' });
    const wall = (x) => M.Bodies.rectangle(x, L.floorY - 1500, th, 4000,
      { isStatic: true, friction: 0.05, restitution: 0.3, label: 'wall' });
    this.statics = [floor, wall(L.left - th / 2), wall(L.right + th / 2)];
    M.Composite.add(this.world, this.statics);
    this.engine.gravity.y = 0.049 * L.T;
  }

  get gravityPx() { return this.engine.gravity.y * 1000; }

  pieces() { return M.Composite.allBodies(this.world).filter((b) => b.piece); }

  addPiece(start, end, x, y, angle = 0, now = performance.now()) {
    const len = end - start;
    const body = M.Bodies.rectangle(x, y, len * this.T - 1, this.TH - 1, {
      chamfer: { radius: Math.min(10, this.TH * 0.12) },
      restitution: 0.28, friction: 0.65, frictionStatic: 1.2, frictionAir: 0.0015,
      density: 0.0016, slop: 0.03, label: 'piece',
    });
    body.piece = { start, end, len, born: now, noCutUntil: now + 220, sq: 0, sqV: 0, rightAt: 0, hop: 0 };
    M.Body.setAngle(body, angle);
    M.Composite.add(this.world, body);
    return body;
  }

  removePiece(body) { M.Composite.remove(this.world, body); }

  clear() { this.pieces().forEach((b) => this.removePiece(b)); }

  toLocal(body, x, y) {
    const dx = x - body.position.x;
    const dy = y - body.position.y;
    const c = Math.cos(body.angle);
    const s = Math.sin(body.angle);
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }

  toWorld(body, lx, ly) {
    const c = Math.cos(body.angle);
    const s = Math.sin(body.angle);
    return { x: body.position.x + lx * c - ly * s, y: body.position.y + lx * s + ly * c };
  }

  // Cut `body` after its k-th tile. Each half keeps the parent's linear + angular velocity at its own
  // centre of mass, then gets pushed apart, popped upward and spun by the swipe.
  splitPiece(body, k, sw, now) {
    const p = body.piece;
    const T = this.T;
    const w = p.len * T;
    const c = { x: body.position.x, y: body.position.y };
    const a = body.angle;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const vel = { x: body.velocity.x, y: body.velocity.y };
    const om = body.angularVelocity;
    const speed = Math.min(sw.speed, 2600);
    const make = (xloc, start, end, dir) => {
      const wx = c.x + cs * xloc;
      const wy = c.y + sn * xloc;
      const nb = this.addPiece(start, end, wx, wy, a, now);
      const rx = wx - c.x;
      const ry = wy - c.y;
      let vx = vel.x - om * ry;
      let vy = vel.y + om * rx;
      // Impulses scale with tile size (like gravity does), so a cut looks the same on any screen:
      // the pop lifts a piece roughly 1-2 tile heights, the sideways kick slides it about a tile.
      const f = speed / 2600;
      const sep = (T * (1.9 + f * 1.6) + Math.random() * T * 0.4) / 60;
      const pop = (T * (10.5 + f * 4.5) + Math.random() * T * 0.8) / 60;
      vx += cs * sep * dir + (sw.vx / 60) * 0.08;
      vy += sn * sep * dir + (sw.vy / 60) * 0.08 - pop;
      M.Body.setVelocity(nb, { x: vx, y: vy });
      M.Body.setAngularVelocity(nb, om + dir * (0.011 + speed * 0.000011 + Math.random() * 0.004));
      return nb;
    };
    const left = make(-w / 2 + (k * T) / 2, p.start, p.start + k, -1);
    const right = make(-w / 2 + k * T + ((p.len - k) * T) / 2, p.start + k, p.end, 1);
    this.removePiece(body);
    return { left, right };
  }

  mergePieces(a, b, now) {
    const pa = a.piece;
    const pb = b.piece;
    const wa = pa.len;
    const wb = pb.len;
    const x = (a.position.x * wa + b.position.x * wb) / (wa + wb);
    const y = Math.min(a.position.y, b.position.y) - this.TH * 0.3;
    this.removePiece(a);
    this.removePiece(b);
    const nb = this.addPiece(Math.min(pa.start, pb.start), Math.max(pa.end, pb.end), x, y, 0, now);
    M.Body.setVelocity(nb, { x: 0, y: -240 / 60 });
    return nb;
  }

  step(dtMs) {
    this.acc += Math.min(dtMs, 50) * this.timeScale;
    let n = 0;
    while (this.acc >= STEP && n < 8) {
      M.Engine.update(this.engine, STEP);
      this.acc -= STEP;
      n++;
    }
    if (n === 8) this.acc = 0;
  }

  // A tile that has settled on its side or upside down is unreadable. Real toys would just sit there;
  // here a settled, tilted piece hops and rotates itself upright so the word stays legible.
  assistUpright(now) {
    for (const b of this.pieces()) {
      const p = b.piece;
      const speed = Math.hypot(b.velocity.x, b.velocity.y) * 60;
      const spin = Math.abs(b.angularVelocity) * 60;
      let ang = ((b.angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      if (speed < 40 && spin < 0.4 && Math.abs(ang) > 0.22) {
        if (!p.rightAt) p.rightAt = now + 450;
        else if (now >= p.rightAt) {
          const up = 700;
          const flight = (2 * up) / this.gravityPx;
          M.Body.setVelocity(b, { x: b.velocity.x, y: -up / 60 });
          M.Body.setAngularVelocity(b, clamp((-ang / flight) / 60, -0.16, 0.16));
          p.rightAt = 0;
        }
      } else {
        p.rightAt = 0;
      }
    }
  }

  collisions(ev) {
    for (const pair of ev.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const piece = a.piece ? a : b.piece ? b : null;
      if (!piece) continue;
      const other = piece === a ? b : a;
      const rv = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y) * 60;
      if (rv < 160) continue;
      const sup = pair.collision.supports[0] || piece.position;
      this.onImpact({ body: piece, other, impact: rv, x: sup.x, y: sup.y, ground: other.label === 'floor' });
    }
  }
}
