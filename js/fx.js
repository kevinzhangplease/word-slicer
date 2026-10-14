import * as THREE from 'three';
import { clamp } from './lighting.js';
import { G } from './constants.js';

const _v = new THREE.Vector3();

// Particles, slash flashes and screen shake. Chips, sparks and dust live in 3D world coordinates
// (metres, gravity, bouncing on the table at y = 0) and are projected to the overlay canvas to draw.
// Confetti is simulated in screen pixels. The physics bodies live in physics.js.
export class FX {
  constructor() {
    this.parts = [];
    this.flashes = [];
    this.shake = 0;
  }

  reset() {
    this.parts.length = 0;
    this.flashes.length = 0;
    this.shake = 0;
  }

  addShake(a) { this.shake = Math.min(9, Math.max(this.shake, a)); }

  shakeOffset() {
    if (this.shake < 0.15) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * 2 * this.shake, y: (Math.random() - 0.5) * 2 * this.shake };
  }

  // Wood chips and sparkles from a cut. `a`/`b` are the world-space ends of the cut line.
  slice(a, b, colors, power = 1) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    for (let i = 0; i < 18; i++) {
      const p = new THREE.Vector3().copy(a).addScaledVector(dir, Math.random() * len);
      const side = Math.random() < 0.5 ? -1 : 1;
      this.parts.push({
        type: 'chip', x: p.x, y: p.y, z: p.z,
        vx: side * (0.25 + Math.random() * 1.2) * power, vy: (0.4 + Math.random() * 1.8) * power, vz: (Math.random() - 0.3) * 1.0 * power,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18,
        size: 0.007 + Math.random() * 0.009, life: 0.9 + Math.random() * 0.6, max: 1.5,
        color: colors[(Math.random() * colors.length) | 0], gk: 1,
      });
    }
    this.sparks(new THREE.Vector3().lerpVectors(a, b, 0.5), 14, '#ffffff', power);
  }

  sparks(c, n, color, power = 1) {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI;
      const sp = (0.4 + Math.random() * 1.6) * power;
      this.parts.push({
        type: 'spark', x: c.x, y: c.y, z: c.z,
        vx: Math.sin(ph) * Math.cos(th) * sp, vy: Math.abs(Math.cos(ph)) * sp + 0.3, vz: Math.sin(ph) * Math.sin(th) * sp,
        size: 0.004 + Math.random() * 0.006, life: 0.35 + Math.random() * 0.4, max: 0.75, color, gk: 0.3,
      });
    }
  }

  dust(x, y, z, n = 5) {
    for (let i = 0; i < n; i++) {
      this.parts.push({
        type: 'dust', x: x + (Math.random() - 0.5) * 0.12, y: y + 0.01, z: z + (Math.random() - 0.5) * 0.12,
        vx: (Math.random() - 0.5) * 0.5, vy: 0.08 + Math.random() * 0.25, vz: (Math.random() - 0.5) * 0.5,
        size: 0.03 + Math.random() * 0.03, life: 0.5 + Math.random() * 0.3, max: 0.8, color: '#ffffff', gk: 0,
      });
    }
  }

  splash(x, y, z, color) { this.sparks(new THREE.Vector3(x, y, z), 6, color, 0.7); }

  confetti(w, colors) {
    for (let i = 0; i < 90; i++) {
      this.parts.push({
        type: 'confetti', sx: Math.random() * w, sy: -20 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 160, vy: 80 + Math.random() * 260,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
        size: 6 + Math.random() * 7, life: 2.4 + Math.random() * 1.4, max: 3.8,
        color: colors[(Math.random() * colors.length) | 0], ph: Math.random() * 6,
      });
    }
  }

  flash(a, b) { this.flashes.push({ a: a.clone(), b: b.clone(), life: 0.2, max: 0.2 }); }

  update(dt) {
    this.shake *= Math.pow(0.0008, dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life -= dt;
      if (this.flashes[i].life <= 0) this.flashes.splice(i, 1);
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      if (p.type === 'confetti') {
        p.vx *= Math.pow(0.4, dt);
        p.vy = Math.min(p.vy + 170 * 0.18 * dt, 190);
        p.sx += p.vx * dt;
        p.sy += p.vy * dt;
        p.rot += p.vr * dt;
        continue;
      }
      p.vy -= G * p.gk * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.rot !== undefined) p.rot += p.vr * dt;
      if (p.type === 'chip' && p.y < p.size * 0.4) {
        p.y = p.size * 0.4;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.vr *= 0.5;
        if (Math.abs(p.vy) < 0.15) { p.vy = 0; p.vr = 0; }
      }
    }
  }

  draw(ctx, scene) {
    ctx.save();
    for (const f of this.flashes) {
      const k = f.life / f.max;
      const a = scene.project(f.a);
      const b = scene.project(f.b);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.save();
      ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.rotate(ang);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${0.95 * k})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-len / 2, -2.5 - 7 * k, len, 5 + 14 * k);
      ctx.restore();
    }
    for (const p of this.parts) {
      const k = clamp(p.life / p.max, 0, 1);
      ctx.save();
      if (p.type === 'confetti') {
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.translate(p.sx, p.sy);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.sin(p.life * 7 + p.ph));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
        continue;
      }
      _v.set(p.x, p.y, p.z);
      const s = scene.project(_v);
      const px = scene.pxPerMeter(_v) * p.size;
      if (p.type === 'chip') {
        ctx.globalAlpha = Math.min(1, k * 2.2);
        ctx.translate(s.x, s.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-px, -px * 0.45, px * 2, px * 0.9);
      } else if (p.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(0.8, px * (0.4 + k * 0.6)), 0, 6.283);
        ctx.fill();
      } else if (p.type === 'dust') {
        const r = px * (2.2 - k);
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        g.addColorStop(0, `rgba(255,255,255,${0.34 * k})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
    ctx.restore();
  }
}
