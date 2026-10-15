import { rgba, roundRectPath, clamp } from './lighting.js';
import { TILE } from './constants.js';

const FONT = '"Atkinson Hyperlegible", "Lexend", "Trebuchet MS", system-ui, sans-serif';

// The 2D layer drawn above the WebGL canvas: tool cursors, blade trail, snap guides, check marks,
// magnet field lines and particles. World positions go through scene.project().
export class Overlay {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.dpr = 1;
  }

  resize(W, H) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
  }

  draw(now) {
    const ctx = this.ctx;
    const { W, H } = this.game.scene.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.game.fx.draw(ctx, this.game.scene);
    this.magnetField(ctx, now);
    this.marks(ctx, now);
    this.hoverGap(ctx, now);
    this.trail(ctx, now);
    this.cursor(ctx, now);
  }

  pt(body, lx, ly, lz) {
    return this.game.scene.project(this.game.scene.faceToWorld(body, lx, ly, lz));
  }

  magnetField(ctx, now) {
    const { physics, scene, theme } = this.game;
    const act = physics.magnets.active;
    if (!act.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -now * 0.05;
    for (const m of act) {
      const a = scene.project(m.a);
      const b = scene.project(m.b);
      ctx.strokeStyle = rgba(theme.glow, 0.25 + 0.6 * m.s);
      ctx.lineWidth = 2 + 4 * m.s;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - 18 * m.s, b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  marks(ctx, now) {
    const game = this.game;
    const bodies = game.physics.pieces();
    for (const b of bodies) {
      const p = b.piece;
      const w = p.len * TILE.w;
      for (let i = 0; i < p.len; i++) {
        const letter = game.letters[p.start + i];
        if (!letter.mark) continue;
        const cx = -w / 2 + (i + 0.5) * TILE.w;
        const hw = TILE.w / 2;
        const hh = TILE.h / 2;
        let off = 0;
        if (letter.mark === 'bad' && now - letter.markAt < 700) off = Math.sin((now - letter.markAt) * 0.06) * 4 * (1 - (now - letter.markAt) / 700);
        const pts = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(([x, y]) => this.pt(b, cx + x * 0.97, y * 0.97, TILE.d / 2 + 0.002));
        ctx.save();
        ctx.translate(off, 0);
        const path = () => { ctx.beginPath(); pts.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); };
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
        const corner = this.pt(b, cx + hw - 0.02, hh - 0.015, TILE.d / 2 + 0.002);
        if (letter.mark === 'bad') {
          ctx.strokeStyle = '#e5242b'; ctx.lineWidth = 4; path(); ctx.stroke();
          this.badge(ctx, corner.x, corner.y, '✕', '#e5242b');
        } else if (letter.mark === 'missing') {
          ctx.setLineDash([7, 6]); ctx.strokeStyle = `rgba(255,150,0,${0.55 + pulse * 0.45})`; ctx.lineWidth = 3.5; path(); ctx.stroke();
        } else if (letter.mark === 'ok') {
          this.badge(ctx, corner.x, corner.y, '✓', '#1f9d55');
        }
        ctx.restore();
      }
    }
    for (const m of game.cutMarks) {
      if (m.type === 'missing') {
        const b = bodies.find((q) => q.piece.start < m.gap && q.piece.end > m.gap);
        if (!b) continue;
        const w = b.piece.len * TILE.w;
        const lx = -w / 2 + (m.gap - b.piece.start) * TILE.w;
        const a = this.pt(b, lx, -TILE.h / 2 - 0.02, TILE.d / 2 + 0.002);
        const c = this.pt(b, lx, TILE.h / 2 + 0.05, TILE.d / 2 + 0.002);
        ctx.save();
        ctx.setLineDash([6, 5]); ctx.strokeStyle = '#e5242b'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
        ctx.restore();
        this.badge(ctx, c.x, c.y - 16, '✂', '#e5242b');
      } else {
        const a = bodies.find((q) => q.piece.end === m.gap);
        const c = bodies.find((q) => q.piece.start === m.gap);
        if (!a || !c) continue;
        const pa = this.pt(a, (a.piece.len * TILE.w) / 2, TILE.h / 2, TILE.d / 2);
        const pc = this.pt(c, -(c.piece.len * TILE.w) / 2, TILE.h / 2, TILE.d / 2);
        this.badge(ctx, (pa.x + pc.x) / 2, Math.min(pa.y, pc.y) - 18, m.type === 'ok' ? '✓' : '✕', m.type === 'ok' ? '#1f9d55' : '#e5242b');
      }
    }
  }

  badge(ctx, x, y, glyph, color) {
    ctx.save();
    ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 11, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `700 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x, y + 0.5);
    ctx.restore();
  }

  hoverGap(ctx, now) {
    const h = this.game.hoverGap;
    if (!h || this.game.tool !== 'knife') return;
    const w = h.body.piece.len * TILE.w;
    const lx = -w / 2 + h.k * TILE.w;
    const a = this.pt(h.body, lx, -TILE.h / 2 - 0.02, TILE.d / 2 + 0.003);
    const b = this.pt(h.body, lx, TILE.h / 2 + 0.03, TILE.d / 2 + 0.003);
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -now * 0.02;
    ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.25 * Math.sin(now * 0.01)})`;
    ctx.shadowColor = this.game.theme.glow;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }

  trail(ctx, now) {
    const { input, theme, tool } = this.game;
    input.prune(performance.now());
    const tr = input.trail;
    if (tr.length < 2 || tool !== 'knife') return;
    const t = performance.now();
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1];
        const b = tr[i];
        const k = 1 - clamp((t - b.t) / 260, 0, 1);
        ctx.strokeStyle = pass === 0 ? rgba(theme.glow, 0.5 * k) : `rgba(255,255,255,${0.95 * k})`;
        ctx.lineWidth = (pass === 0 ? 20 : 6) * k * (0.35 + 0.65 * (i / tr.length));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- cursor sprites ----
  cursor() {
    const { input, tool, theme, held } = this.game;
    const ctx = this.ctx;
    if (!input.inside && !input.down) return;
    if (input.pointerType === 'touch' && !input.down) return;
    ctx.save();
    ctx.translate(input.x, input.y);
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 6;
    if (tool === 'knife') { ctx.rotate(input.angle); this.knife(ctx); }
    else if (tool === 'hand') this.hand(ctx, !!held);
    else {
      ctx.rotate(-0.6);
      this.brush(ctx, tool === 'vowel' ? theme.vowel : tool === 'consonant' ? theme.consonant : '#f6a6b8', tool === 'eraser');
    }
    ctx.restore();
  }

  knife(ctx) {
    let g = ctx.createLinearGradient(0, -14, 0, 12);
    g.addColorStop(0, '#f7fafd'); g.addColorStop(0.5, '#c9d2dc'); g.addColorStop(1, '#8793a1');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.quadraticCurveTo(-26, -4, -68, -13); ctx.lineTo(-70, -13); ctx.lineTo(-70, 9); ctx.quadraticCurveTo(-34, 12, 0, 0);
    ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-6, -2.5); ctx.quadraticCurveTo(-30, -6, -66, -11); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.moveTo(-6, 1.5); ctx.quadraticCurveTo(-34, 9, -68, 8); ctx.stroke();
    ctx.fillStyle = '#9aa4b0'; ctx.fillRect(-74, -13, 6, 22);
    g = ctx.createLinearGradient(0, -10, 0, 10);
    g.addColorStop(0, '#6b4a2f'); g.addColorStop(1, '#2f1f12');
    ctx.fillStyle = g; roundRectPath(ctx, -142, -9, 70, 19, 8); ctx.fill();
    ctx.fillStyle = '#d8d2c6';
    [-128, -108, -88].forEach((px) => { ctx.beginPath(); ctx.arc(px, 0.5, 2.3, 0, 6.283); ctx.fill(); });
  }

  brush(ctx, color, eraser) {
    if (eraser) {
      ctx.fillStyle = color; roundRectPath(ctx, -4, -4, 54, 30, 9); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(34, -4, 16, 30);
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5; roundRectPath(ctx, -4, -4, 54, 30, 9); ctx.stroke();
      return;
    }
    ctx.fillStyle = '#d7dde5'; roundRectPath(ctx, 14, -7, 26, 14, 3); ctx.fill();
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, '#d9a066'); g.addColorStop(1, '#8a5a2b');
    ctx.fillStyle = g; roundRectPath(ctx, 38, -6, 64, 12, 6); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(6, -11, 16, -8); ctx.lineTo(16, 8); ctx.quadraticCurveTo(6, 11, 0, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.ellipse(10, -4, 5, 2, 0, 0, 6.283); ctx.fill();
  }

  // Open palm when hovering, closed fist while holding a piece. Origin is the grab point.
  hand(ctx, closed) {
    const skin = '#ffd9b8';
    const edge = '#b07a52';
    ctx.lineWidth = 2;
    ctx.strokeStyle = edge;
    ctx.fillStyle = skin;
    if (!closed) {
      ctx.translate(0, -6);
      [[-15, 24], [-5, 30], [5, 28], [15, 22]].forEach(([x, h]) => { roundRectPath(ctx, x - 4.5, -h - 4, 9, h + 8, 4.5); ctx.fill(); ctx.stroke(); });
      roundRectPath(ctx, -20, -6, 40, 34, 13); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(-20, 12); ctx.rotate(-0.9);
      roundRectPath(ctx, -4.5, -24, 9, 28, 4.5); ctx.fill(); ctx.stroke();
      ctx.restore();
    } else {
      ctx.translate(0, 2);
      roundRectPath(ctx, -20, -14, 40, 34, 13); ctx.fill(); ctx.stroke();
      [-14.5, -5, 4.5, 14].forEach((x) => { roundRectPath(ctx, x - 5, -20, 10, 14, 5); ctx.fill(); ctx.stroke(); });
      ctx.save(); ctx.translate(-18, 6); ctx.rotate(0.5);
      roundRectPath(ctx, -4, -4, 24, 10, 5); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
}
