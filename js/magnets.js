import * as CANNON from 'cannon-es';
import { TILE, G } from './constants.js';

// Every piece has two magnetic faces on its centre line: right = north, left = south.
// Opposite poles attract, same poles repel. Each face has four pole points (its corners), and the
// attraction is applied *at those points* on both bodies, so the torque that flattens two faces
// against each other comes out of the physics instead of being faked. When two faces meet closely
// and slowly they snap flush and a LockConstraint welds the pieces into one cluster. Pulling hard
// enough (the constraint's own reaction force) breaks the bond again.
const RANGE = 0.4; // m, centre-to-centre reach of a face
const K0 = 1.2; // N*m^2 for two single tiles; scaled by reduced mass so big clusters pull harder
const EPS = 0.0025; // m^2, softening so the force stays finite at contact
const F_CAP = 420; // N per pole point
const SNAP_DIST = 0.02; // m, every corner pair must be this close
const SNAP_SPEED = 0.9; // m/s, relative speed of the two face centres
const SNAP_DOT = -0.96; // facing normals must be within ~16 degrees of exactly opposite
// A bond fails when the load it carries, measured in multiples of the far side's own weight, goes over
// BREAK_G. Holding a cluster still up by one end reads about 2 (weight + bending) and even a brisk drag
// stays well under 15, so this is only a safety valve for violent impacts (slamming a cluster into a
// wall). Normalising by the far side keeps a long chain as robust as a short one. Deliberately pulling
// pieces apart is the shake gesture in physics.js.
const BREAK_G = 40;
const AVG_TAU = 0.05; // s: the load is smoothed over ~50 ms so one-step solver spikes are ignored
const GRACE = 600; // ms after snapping during which the settling transient is ignored
const COOLDOWN = 0.8; // s before a just-separated pair may attract again
export const MAGNET_WINDOW = 5000; // ms a released piece stays magnetised

const _v = new CANNON.Vec3();
const POLES = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [a * TILE.h * 0.3, b * TILE.d * 0.3]);

export class Magnets {
  constructor(physics) {
    this.p = physics;
    this.bonds = [];
    this.cool = new Map();
    this.active = []; // {a, b, s} for the overlay: faces currently pulling on each other
    this.events = [];
  }

  face(body, side) {
    const w = body.piece.len * TILE.w;
    const sx = side === 'R' ? w / 2 : -w / 2;
    const c = body.pointToWorldFrame(new CANNON.Vec3(sx, 0, 0));
    const n = body.vectorToWorldFrame(new CANNON.Vec3(side === 'R' ? 1 : -1, 0, 0));
    const pts = POLES.map(([y, z]) => body.pointToWorldFrame(new CANNON.Vec3(sx, y, z)));
    return { c, n, pts };
  }

  key(a, b) { return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`; }

  occupied(body, side) {
    return this.bonds.some((k) => (side === 'R' ? k.x === body : k.y === body));
  }

  bondBetween(a, b) { return this.bonds.some((k) => (k.x === a && k.y === b) || (k.x === b && k.y === a)); }

  cluster(body) {
    const seen = new Set([body]);
    const stack = [body];
    while (stack.length) {
      const cur = stack.pop();
      for (const k of this.bonds) {
        const other = k.x === cur ? k.y : k.y === cur ? k.x : null;
        if (other && !seen.has(other)) { seen.add(other); stack.push(other); }
      }
    }
    return [...seen];
  }

  hasBonds(body) { return this.bonds.some((k) => k.x === body || k.y === body); }

  create(x, y) {
    const con = new CANNON.LockConstraint(x, y, { maxForce: 2e5 });
    con.collideConnected = false;
    this.p.world.addConstraint(con);
    const bond = { x, y, con, avg: 0, born: this.p.clock() };
    this.bonds.push(bond);
    return bond;
  }

  remove(bond, { kick = 0 } = {}) {
    this.p.world.removeConstraint(bond.con);
    const i = this.bonds.indexOf(bond);
    if (i >= 0) this.bonds.splice(i, 1);
    if (kick) {
      const dir = bond.y.position.vsub(bond.x.position);
      dir.normalize();
      bond.x.velocity.vsub(dir.scale(kick), bond.x.velocity);
      bond.y.velocity.vadd(dir.scale(kick), bond.y.velocity);
    }
  }

  dropBonds(body) {
    for (const k of this.bonds.filter((q) => q.x === body || q.y === body)) this.remove(k);
  }

  clear() { for (const k of [...this.bonds]) this.remove(k); this.cool.clear(); this.active.length = 0; }

  // A cut piece keeps its bonds on whichever half still owns that end.
  onSplit(old, left, right) {
    for (const k of [...this.bonds]) {
      if (k.x === old) this.create(right, k.y);
      else if (k.y === old) this.create(k.x, left);
    }
  }

  // Distance from a held cluster's open faces to the nearest open face it could attract.
  nearestFaceDistance(held) {
    const mine = new Set(this.cluster(held));
    let best = Infinity;
    const faces = (b) => ({ R: this.occupied(b, 'R') ? null : this.face(b, 'R').c, L: this.occupied(b, 'L') ? null : this.face(b, 'L').c });
    const others = this.p.pieces().filter((b) => !mine.has(b));
    for (const m of mine) {
      const fm = faces(m);
      for (const o of others) {
        const fo = faces(o);
        for (const [a, b] of [['R', 'L'], ['L', 'R']]) {
          if (!fm[a] || !fo[b]) continue;
          best = Math.min(best, fm[a].distanceTo(fo[b]));
        }
      }
    }
    return best;
  }

  update(dt, now) {
    this.checkBreaks(dt, now);
    this.active.length = 0;
    const ps = this.p.pieces();
    if (ps.length < 2) return;
    // Only pieces that were picked up are magnetised (while held and for a few seconds after release),
    // so freshly cut or resting pieces do not drag each other back together on their own.
    const held = this.p.hand ? new Set(this.cluster(this.p.hand.held)) : null;
    const live = (b) => (held && held.has(b)) || now < b.piece.magnetUntil;
    const faces = new Map(ps.map((b) => [b, { R: this.face(b, 'R'), L: this.face(b, 'L') }]));
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const A = ps[i];
        const B = ps[j];
        if (!live(A) && !live(B)) continue;
        if (this.bondBetween(A, B)) continue;
        const until = this.cool.get(this.key(A, B));
        if (until && now < until) continue;
        const red = (A.mass * B.mass) / (A.mass + B.mass);
        const k = (K0 * red) / TILE.mass;
        for (const sa of ['R', 'L']) {
          for (const sb of ['R', 'L']) {
            if (this.occupied(A, sa) || this.occupied(B, sb)) continue;
            const fa = faces.get(A)[sa];
            const fb = faces.get(B)[sb];
            const d = fb.c.vsub(fa.c);
            const dist = d.length();
            if (dist > RANGE) continue;
            const dots = fa.n.dot(fb.n);
            if (dots > -0.6) continue; // faces must roughly oppose each other
            if (d.dot(fa.n) < -0.03 || -d.dot(fb.n) < -0.03) continue; // and each must point toward the other
            if (sa !== sb) this.attract(A, B, fa, fb, k, dist, dots, sa, now);
            else this.repel(A, B, fa, fb, k, d, dist);
          }
        }
      }
    }
  }

  attract(A, B, fa, fb, k, dist, dots, sa, now) {
    let maxCorner = 0;
    for (let i = 0; i < 4; i++) {
      const pa = fa.pts[i];
      const pb = fb.pts[i];
      pb.vsub(pa, _v);
      const dd = _v.length();
      maxCorner = Math.max(maxCorner, dd);
      const F = Math.min(F_CAP, k / 4 / (dd * dd + EPS));
      const dir = dd > 1e-6 ? _v.scale(1 / dd) : new CANNON.Vec3(0, 0, 0);
      const f = dir.scale(F);
      A.applyForce(f, pa.vsub(A.position));
      B.applyForce(f.scale(-1), pb.vsub(B.position));
    }
    this.active.push({ a: fa.c, b: fb.c, s: Math.min(1, 0.15 / (dist + 0.05)) });
    if (maxCorner < SNAP_DIST && dots < SNAP_DOT) {
      const va = A.getVelocityAtWorldPoint(fa.c, new CANNON.Vec3());
      const vb = B.getVelocityAtWorldPoint(fb.c, new CANNON.Vec3());
      if (va.vsub(vb).length() < SNAP_SPEED) this.snap(sa === 'R' ? A : B, sa === 'R' ? B : A, now);
    }
  }

  repel(A, B, fa, fb, k, d, dist) {
    const dir = d.scale(1 / Math.max(dist, 1e-4));
    const F = Math.min(F_CAP * 0.4, (k * 0.5) / (dist * dist + EPS));
    A.applyForce(dir.scale(-F), fa.c.vsub(A.position));
    B.applyForce(dir.scale(F), fb.c.vsub(B.position));
  }

  // X.right meets Y.left: move one whole cluster so the faces are exactly flush, then weld.
  snap(X, Y, now) {
    const hand = this.p.hand;
    const heldCluster = hand ? this.cluster(hand.held) : [];
    const moveY = !heldCluster.includes(Y);
    const fixed = moveY ? X : Y;
    const mover = moveY ? Y : X;
    const wX = X.piece.len * TILE.w;
    const wY = Y.piece.len * TILE.w;
    // flush pose of the mover, derived from the fixed body
    let qNew;
    let pNew;
    if (moveY) {
      qNew = X.quaternion.clone();
      pNew = X.position.vadd(X.quaternion.vmult(new CANNON.Vec3((wX + wY) / 2, 0, 0)));
    } else {
      qNew = Y.quaternion.clone();
      pNew = Y.position.vsub(Y.quaternion.vmult(new CANNON.Vec3((wX + wY) / 2, 0, 0)));
    }
    const qInv = mover.quaternion.inverse();
    const dq = qNew.mult(qInv);
    for (const b of this.cluster(mover)) {
      const rel = b.position.vsub(mover.position);
      const rot = dq.vmult(rel);
      b.position.copy(pNew.vadd(rot));
      dq.mult(b.quaternion, b.quaternion);
      b.quaternion.normalize();
      b.velocity.copy(fixed.velocity); // inelastic clack
      b.angularVelocity.copy(fixed.angularVelocity);
      b.aabbNeedsUpdate = true;
    }
    this.create(X, Y);
    this.events.push({ type: 'snap', x: (X.position.x + Y.position.x) / 2, y: (X.position.y + Y.position.y) / 2, z: (X.position.z + Y.position.z) / 2 });
    this.snapped = now;
  }

  // Bodies reachable from `start` without crossing `bond`.
  side(start, bond) {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      for (const k of this.bonds) {
        if (k === bond) continue;
        const other = k.x === cur ? k.y : k.y === cur ? k.x : null;
        if (other && !seen.has(other)) { seen.add(other); stack.push(other); }
      }
    }
    let mass = 0;
    let tiles = 0;
    for (const b of seen) { mass += b.mass; tiles += b.piece.len; }
    return { set: seen, mass, tiles };
  }

  // Bond load as a multiple of the far side's weight. "Far" is the side away from the hand, or the
  // lighter side when nothing is held.
  load(bond) {
    const a = this.side(bond.x, bond);
    const b = this.side(bond.y, bond);
    const held = this.p.hand ? this.p.hand.held : null;
    let far;
    if (held && a.set.has(held)) far = b;
    else if (held && b.set.has(held)) far = a;
    else far = a.mass <= b.mass ? a : b;
    const e = bond.con.equations;
    const f = Math.hypot(e[0].multiplier, e[1].multiplier, e[2].multiplier);
    const t = Math.hypot(e[3].multiplier, e[4].multiplier, e[5].multiplier);
    const lever = Math.max(0.1, (far.tiles * TILE.w) / 2);
    return (f + t / lever) / (far.mass * G);
  }

  checkBreaks(dt, now) {
    const a = 1 - Math.exp(-dt / AVG_TAU);
    for (const bond of [...this.bonds]) {
      if (now - bond.born < GRACE) { bond.avg = 0; continue; }
      bond.avg += (this.load(bond) - bond.avg) * a;
      if (bond.avg > BREAK_G) {
        this.remove(bond, { kick: 0.5 });
        this.cool.set(this.key(bond.x, bond.y), now + COOLDOWN * 1000);
        const p = bond.x.position;
        const q = bond.y.position;
        this.events.push({ type: 'break', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2 });
      }
    }
  }

  // Pull a bond apart (shake gesture): kick the two sides away from each other and keep them from
  // re-snapping straight away.
  separate(bond, now) {
    const a = bond.x.position;
    const b = bond.y.position;
    this.remove(bond, { kick: 1.2 });
    this.cool.set(this.key(bond.x, bond.y), now + COOLDOWN * 1000);
    this.events.push({ type: 'break', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
