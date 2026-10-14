import * as CANNON from 'cannon-es';
import { TILE, G } from './constants.js';
import { Magnets, MAGNET_WINDOW } from './magnets.js';
import { clamp } from './lighting.js';

const STEP = 1 / 120;
const HAND_FORCE = 4000; // N: strong enough to carry a long cluster, finite so collisions can push back
const HAND_MAX_SPEED = 8; // m/s
const HAND_MAX_ACCEL = 120; // m/s^2 (~12 g): a real hand cannot change velocity instantly
const HAND_GRIP_TIME = 0.25; // s: accel cap ramps up after grabbing, so a jerky pickup is not a yank
const LIFT_MAX = 0.19; // carried pieces rise just over a tile height so they clear the others on the table
const LIFT_MIN = 0.02;
// Pulling stuck magnets apart takes two hands in real life; with one pointer it is a deliberate shake:
// this many direction reversals, each at least SHAKE_AMP metres, inside SHAKE_WINDOW ms.
const SHAKE_REVERSALS = 4;
const SHAKE_AMP = 0.12;
const SHAKE_WINDOW = 700;

// 3D rigid-body physics (cannon-es). A piece is one compound body: a box shape per letter tile.
// Pitching forward/back is locked (angularFactor) so letters always face the camera; pieces can still
// yaw, roll, tumble in the screen plane and slide in depth.
export class Physics {
  constructor(onImpact) {
    this.onImpact = onImpact;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -G, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = false;
    this.world.solver.iterations = 30;
    this.world.solver.tolerance = 1e-5;
    const m = this.world.defaultContactMaterial;
    m.friction = 0.5; // wood on wood
    m.restitution = 0.18;
    m.contactEquationStiffness = 1e7;
    m.contactEquationRelaxation = 3;
    this.timeScale = 1;
    this.acc = 0;
    this.statics = [];
    this.floor = null;
    this.bounds = { bx: 1.5, bz: 0.95 };
    this.hand = null;
    this.clock = () => performance.now(); // injectable so tests can run faster than real time
    this.magnets = new Magnets(this);
  }

  // Board is the rectangle [-bx,bx] x [-bz,bz] at y = 0; invisible walls keep pieces on it.
  setup({ bx, bz }) {
    this.bounds = { bx, bz };
    for (const b of this.statics) this.world.removeBody(b);
    const mk = (hx, hy, hz, x, y, z) => {
      const b = new CANNON.Body({ mass: 0 });
      b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
      b.position.set(x, y, z);
      this.world.addBody(b);
      return b;
    };
    this.floor = mk(bx + 3, 0.5, bz + 3, 0, -0.5, 0);
    this.statics = [
      this.floor,
      mk(0.5, 3, bz + 3, -bx - 0.5, 2.5, 0),
      mk(0.5, 3, bz + 3, bx + 0.5, 2.5, 0),
      mk(bx + 3, 3, 0.5, 0, 2.5, -bz - 0.5),
      mk(bx + 3, 3, 0.5, 0, 2.5, bz + 0.5),
    ];
  }

  pieces() { return this.world.bodies.filter((b) => b.piece); }

  addPiece(start, end, x, y, z, yaw = 0, now = performance.now()) {
    const len = end - start;
    const body = new CANNON.Body({
      mass: TILE.mass * len,
      angularFactor: new CANNON.Vec3(0, 1, 1),
      linearDamping: 0.02,
      angularDamping: 0.12,
    });
    const half = new CANNON.Vec3(TILE.w / 2 - 0.0004, TILE.h / 2, TILE.d / 2);
    for (let i = 0; i < len; i++) body.addShape(new CANNON.Box(half), new CANNON.Vec3(-(len * TILE.w) / 2 + (i + 0.5) * TILE.w, 0, 0));
    body.position.set(x, y, z);
    body.quaternion.setFromEuler(0, yaw, 0);
    body.piece = { start, end, len, born: now, noCutUntil: now + 220, sq: 0, sqV: 0, rightAt: 0, magnetUntil: 0 };
    body.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v < 0.5) return;
      const c = e.contact;
      const pt = c.bi.position.vadd(c.ri);
      this.onImpact({ body: e.target, other: e.body, impact: v, x: pt.x, y: pt.y, z: pt.z, ground: e.body === this.floor });
    });
    this.world.addBody(body);
    return body;
  }

  removePiece(body) {
    if (this.hand && this.hand.held === body) this.release();
    this.magnets.dropBonds(body);
    this.world.removeBody(body);
  }

  clear() {
    this.release();
    this.magnets.clear();
    for (const b of this.pieces()) this.world.removeBody(b);
  }

  // Cut `body` after its k-th tile. Each half keeps the parent's linear + angular velocity at its own
  // centre of mass, then is kicked apart, popped upward and spun. `sw`: {vx,vy,vz (m/s), f: 0..1 swipe speed}.
  splitPiece(body, k, sw, now) {
    const p = body.piece;
    const w = p.len * TILE.w;
    const q = body.quaternion.clone();
    const axis = q.vmult(new CANNON.Vec3(1, 0, 0));
    const make = (xloc, start, end, dir) => {
      const wp = body.pointToWorldFrame(new CANNON.Vec3(xloc, 0, 0));
      const nb = this.addPiece(start, end, wp.x, wp.y, wp.z, 0, now);
      nb.quaternion.copy(q);
      const v = body.getVelocityAtWorldPoint(wp, new CANNON.Vec3());
      const sep = TILE.w * (1.9 + sw.f * 1.6) + Math.random() * TILE.w * 0.4;
      const pop = TILE.w * (10.5 + sw.f * 4.5) + Math.random() * TILE.w * 0.8;
      v.x += axis.x * sep * dir + sw.vx * 0.08;
      v.y += axis.y * sep * dir + sw.vy * 0.08 + pop;
      v.z += axis.z * sep * dir + sw.vz * 0.08 + (Math.random() - 0.5) * 0.24;
      nb.velocity.copy(v);
      nb.angularVelocity.copy(body.angularVelocity);
      nb.angularVelocity.z += dir * (0.7 + sw.f * 0.8 + Math.random() * 0.25);
      nb.angularVelocity.y += (Math.random() - 0.5) * 0.6;
      return nb;
    };
    const left = make(-w / 2 + (k * TILE.w) / 2, p.start, p.start + k, -1);
    const right = make(-w / 2 + k * TILE.w + ((p.len - k) * TILE.w) / 2, p.start + k, p.end, 1);
    this.magnets.onSplit(body, left, right);
    this.removePiece(body);
    return { left, right };
  }

  mergePieces(a, b, now) {
    const pa = a.piece;
    const pb = b.piece;
    const x = (a.position.x * pa.len + b.position.x * pb.len) / (pa.len + pb.len);
    const z = (a.position.z * pa.len + b.position.z * pb.len) / (pa.len + pb.len);
    const y = Math.max(a.position.y, b.position.y) + TILE.h * 0.8;
    this.removePiece(a);
    this.removePiece(b);
    const nb = this.addPiece(Math.min(pa.start, pb.start), Math.max(pa.end, pb.end), x, y, z, 0, now);
    nb.velocity.set(0, 1.2, 0);
    return nb;
  }

  // ---- stepping ----
  step(dtMs) {
    this.acc += (Math.min(dtMs, 50) / 1000) * this.timeScale;
    let n = 0;
    const now = this.clock();
    while (this.acc >= STEP && n < 8) {
      this.driveHand(STEP);
      this.magnets.update(STEP, now);
      this.world.step(STEP);
      this.acc -= STEP;
      n++;
    }
    if (n === 8) this.acc = 0;
  }

  // ---- the hand ----
  // A kinematic body follows the pointer; a LockConstraint with a force cap joins it to the piece. So a
  // heavy cluster lags and swings, collisions can push it, and letting go keeps its momentum (a flick throws).
  grab(body, point) {
    this.release();
    const hb = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    hb.addShape(new CANNON.Sphere(0.01));
    hb.collisionFilterGroup = 0;
    hb.collisionFilterMask = 0;
    hb.position.set(point.x, point.y, point.z);
    hb.quaternion.copy(body.quaternion);
    this.world.addBody(hb);
    const con = new CANNON.LockConstraint(hb, body, { maxForce: HAND_FORCE });
    con.collideConnected = false;
    this.world.addConstraint(con);
    this.hand = { body: hb, con, held: body, target: new CANNON.Vec3(point.x, point.y, point.z), baseY: point.y, lift: 0, liftV: 0, age: 0, trail: [] };
  }

  dragTo(x, z) {
    if (!this.hand) return;
    const { bx, bz } = this.bounds;
    this.hand.target.x = clamp(x, -bx + 0.12, bx - 0.12);
    this.hand.target.z = clamp(z, -bz + 0.12, bz - 0.12);
    this.detectShake();
  }

  // Shaking a held piece pulls it off whatever it is stuck to. Returns true when a bond was broken.
  detectShake() {
    const h = this.hand;
    const now = this.clock();
    h.trail.push({ t: now, x: h.target.x, z: h.target.z });
    while (h.trail.length && now - h.trail[0].t > SHAKE_WINDOW) h.trail.shift();
    const mine = this.magnets.bonds.filter((b) => b.x === h.held || b.y === h.held);
    if (!mine.length) return false;
    const reversals = (axis) => {
      let dir = 0;
      let ext = h.trail[0][axis];
      let n = 0;
      for (const p of h.trail) {
        const v = p[axis];
        if (dir >= 0 && v < ext - SHAKE_AMP) { if (dir === 1) n++; dir = -1; ext = v; }
        else if (dir <= 0 && v > ext + SHAKE_AMP) { if (dir === -1) n++; dir = 1; ext = v; }
        else if (dir > 0) ext = Math.max(ext, v);
        else if (dir < 0) ext = Math.min(ext, v);
      }
      return n;
    };
    if (Math.max(reversals('x'), reversals('z')) < SHAKE_REVERSALS) return false;
    for (const b of mine) this.magnets.separate(b, now);
    h.trail.length = 0;
    return true;
  }

  release() {
    const h = this.hand;
    if (!h) return;
    const until = this.clock() + MAGNET_WINDOW;
    for (const b of this.magnets.cluster(h.held)) b.piece.magnetUntil = until;
    this.world.removeConstraint(h.con);
    this.world.removeBody(h.body);
    this.hand = null;
  }

  driveHand(dt) {
    const h = this.hand;
    if (!h) return;
    // Lift off the table to clear other pieces, then ease back down as an attracting face gets close
    // so the magnets can finish the job at table height.
    const d = this.magnets.nearestFaceDistance(h.held);
    const t = clamp((d - 0.25) / 0.45, 0, 1);
    const liftTarget = LIFT_MIN + (LIFT_MAX - LIFT_MIN) * t * t * (3 - 2 * t);
    const w = 14; // critically damped spring, so lifting starts gently instead of with a velocity jump
    h.liftV += (w * w * (liftTarget - h.lift) - 2 * w * h.liftV) * dt;
    h.lift += h.liftV * dt;
    const hb = h.body;
    const want = new CANNON.Vec3((h.target.x - hb.position.x) / dt, (h.baseY + h.lift - hb.position.y) / dt, (h.target.z - hb.position.z) / dt);
    const sp = want.length();
    if (sp > HAND_MAX_SPEED) want.scale(HAND_MAX_SPEED / sp, want);
    const dv = want.vsub(hb.velocity);
    h.age += dt;
    const g = Math.min(1, h.age / HAND_GRIP_TIME);
    const dvMax = (25 + (HAND_MAX_ACCEL - 25) * g * g * (3 - 2 * g)) * dt;
    if (dv.length() > dvMax) dv.scale(dvMax / dv.length(), dv);
    hb.velocity.vadd(dv, hb.velocity);
    // Slerp the held orientation toward upright (yaw 0, roll 0), by turning the hand body.
    const ident = new CANNON.Quaternion(0, 0, 0, 1);
    const next = new CANNON.Quaternion();
    hb.quaternion.slerp(ident, 1 - Math.exp(-dt * 2.5), next);
    const dq = next.mult(hb.quaternion.inverse());
    const [axis, ang] = dq.toAxisAngle(new CANNON.Vec3());
    const a = ang > Math.PI ? ang - 2 * Math.PI : ang;
    hb.angularVelocity.set((axis.x * a) / dt, (axis.y * a) / dt, (axis.z * a) / dt);
  }

  // A settled piece lying on its side, or turned well away from the camera, hops itself upright.
  assistUpright(now) {
    for (const b of this.pieces()) {
      const p = b.piece;
      if ((this.hand && this.magnets.cluster(this.hand.held).includes(b)) || this.magnets.hasBonds(b)) { p.rightAt = 0; continue; }
      const speed = b.velocity.length();
      const spin = b.angularVelocity.length();
      const xa = b.quaternion.vmult(new CANNON.Vec3(1, 0, 0));
      const roll = Math.atan2(xa.y, Math.hypot(xa.x, xa.z));
      const yaw = Math.atan2(-xa.z, xa.x);
      if (speed < 0.25 && spin < 0.4 && (Math.abs(roll) > 0.22 || Math.abs(yaw) > 0.5)) {
        if (!p.rightAt) p.rightAt = now + 450;
        else if (now >= p.rightAt) {
          const up = 2.4;
          const flight = (2 * up) / G;
          b.velocity.y = up;
          b.angularVelocity.set(0, clamp(-yaw / flight, -9, 9), clamp(-roll / flight, -9, 9));
          p.rightAt = 0;
        }
      } else {
        p.rightAt = 0;
      }
    }
  }
}
