import { clamp } from './lighting.js';

// Particles, slash flashes and screen shake. Purely visual; physics bodies live in physics.js.
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

  // Wood chips and sparkles sprayed from a cut line. (dx,dy) is the unit vector along the line.
  slice(x, y, dx, dy, len, colors, power = 1) {
    const px = -dy;
    const py = dx;
    for (let i = 0; i < 16; i++) {
      const t = (Math.random() - 0.5) * len;
      const side = Math.random() < 0.5 ? -1 : 1;
      const sp = (90 + Math.random() * 380) * power;
      this.parts.push({
        type: 'chip', x: x + dx * t, y: y + dy * t,
        vx: px * side * sp + (Math.random() - 0.5) * 120,
        vy: py * side * sp - (120 + Math.random() * 420) * power,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18,
        size: 3 + Math.random() * 5, life: 0.9 + Math.random() * 0.6, max: 1.5,
        color: colors[(Math.random() * colors.length) | 0], gk: 1, off: Math.random() * 14,
      });
    }
    for (let i = 0; i < 12; i++) {
      const t = (Math.random() - 0.5) * len;
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 330 * power;
      this.parts.push({
        type: 'spark', x: x + dx * t, y: y + dy * t,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        size: 2 + Math.random() * 3.5, life: 0.35 + Math.random() * 0.4, max: 0.75,
        color: '#ffffff', gk: 0.3,
      });
    }
  }

  dust(x, y, n = 5) {
    for (let i = 0; i < n; i++) {
      this.parts.push({
        type: 'dust', x: x + (Math.random() - 0.5) * 30, y,
        vx: (Math.random() - 0.5) * 140, vy: -20 - Math.random() * 60,
        size: 5 + Math.random() * 6, life: 0.5 + Math.random() * 0.3, max: 0.8, color: '#ffffff', gk: 0,
      });
    }
  }

  splash(x, y, color) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 160;
      this.parts.push({
        type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
        size: 2.5 + Math.random() * 3, life: 0.4 + Math.random() * 0.3, max: 0.7, color, gk: 0.8,
      });
    }
  }

  confetti(w, colors) {
    for (let i = 0; i < 90; i++) {
      this.parts.push({
        type: 'confetti', x: Math.random() * w, y: -20 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 160, vy: 80 + Math.random() * 260,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12,
        size: 6 + Math.random() * 7, life: 2.4 + Math.random() * 1.4, max: 3.8,
        color: colors[(Math.random() * colors.length) | 0], gk: 0.18, ph: Math.random() * 6,
      });
    }
  }

  flash(x, y, ang, len) { this.flashes.push({ x, y, ang, len, life: 0.2, max: 0.2 }); }

  update(dt, floorY, g) {
    this.shake *= Math.pow(0.0008, dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].life -= dt;
      if (this.flashes[i].life <= 0) this.flashes.splice(i, 1);
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy += g * p.gk * dt;
      if (p.type === 'confetti') { p.vx *= Math.pow(0.4, dt); p.vy = Math.min(p.vy, 190); }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vr) p.rot += p.vr * dt;
      if (p.type === 'chip') {
        const fy = floorY + p.off;
        if (p.y > fy) {
          p.y = fy;
          p.vy *= -0.32;
          p.vx *= 0.65;
          p.vr *= 0.5;
          if (Math.abs(p.vy) < 25) { p.vy = 0; p.vr = 0; }
        }
      }
    }
  }

  draw(ctx) {
    ctx.save();
    for (const f of this.flashes) {
      const k = f.life / f.max;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.ang);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(-f.len / 2, 0, f.len / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${0.95 * k})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-f.len / 2, -2.5 - 7 * k, f.len, 5 + 14 * k);
      ctx.restore();
    }
    for (const p of this.parts) {
      const k = clamp(p.life / p.max, 0, 1);
      ctx.save();
      if (p.type === 'chip') {
        ctx.globalAlpha = Math.min(1, k * 2.2);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9);
      } else if (p.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, 6.283);
        ctx.fill();
      } else if (p.type === 'dust') {
        const r = p.size * (2.2 - k);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(255,255,255,${0.34 * k})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      } else if (p.type === 'confetti') {
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.sin(p.life * 7 + p.ph));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    ctx.restore();
  }
}
