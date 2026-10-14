import {
  LIGHT, lighten, darken, rgba, isLight, roundRectPath, mulberry32, clamp, easeOutBack,
} from './lighting.js';

const FONT = '"Lexend", "Andika", "Trebuchet MS", system-ui, sans-serif';

// Canvas renderer. 2.5D: flat sprites, but every highlight, bevel and shadow is computed from one
// fixed light direction in *world* space, so shading stays correct as blocks rotate.
export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.dpr = 1;
    this.bg = null;
    this.blockPattern = null;
  }

  resize() {
    const L = this.game.L;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(L.W * this.dpr);
    this.canvas.height = Math.round(L.H * this.dpr);
    this.canvas.style.width = L.W + 'px';
    this.canvas.style.height = L.H + 'px';
    this.rebuild();
  }

  rebuild() {
    this.buildPatterns();
    this.buildBackground();
  }

  grainTile(color, alphaMax, seed, size = 256, lines = 70) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const x = c.getContext('2d');
    const rnd = mulberry32(seed);
    x.lineCap = 'round';
    for (let i = 0; i < lines; i++) {
      const y = rnd() * size;
      const amp = 1 + rnd() * 5;
      const k = Math.round(1 + rnd() * 2); // whole periods so the tile repeats seamlessly
      const ph = rnd() * 6.28;
      x.strokeStyle = rgba(color, 0.03 + rnd() * alphaMax);
      x.lineWidth = 0.6 + rnd() * 2.2;
      x.beginPath();
      for (let px = 0; px <= size; px += 8) {
        const py = y + Math.sin((px / size) * Math.PI * 2 * k + ph) * amp;
        if (px === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
    }
    return c;
  }

  buildPatterns() {
    const t = this.game.theme;
    this.blockPattern = null;
    if (t.block.grainA) {
      const tile = this.grainTile(t.block.grain, 0.5, 11, 128, 34);
      this.blockPattern = this.ctx.createPattern(tile, 'repeat');
    }
    this.boardGrain = this.ctx.createPattern(this.grainTile(t.board.grain, 0.2, 5), 'repeat');
  }

  buildBackground() {
    const { L, theme: t } = this.game;
    const dpr = this.dpr;
    const c = document.createElement('canvas');
    c.width = Math.round(L.W * dpr);
    c.height = Math.round(L.H * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);

    let g = x.createLinearGradient(0, 0, 0, L.H);
    g.addColorStop(0, t.bgTop);
    g.addColorStop(1, t.bgBottom);
    x.fillStyle = g;
    x.fillRect(0, 0, L.W, L.H);

    const bx = L.boardLeft;
    const bw = L.boardRight - L.boardLeft;
    const top = L.floorY - L.BT * 1.4;
    const surfH = L.BT * 2.15;
    const edgeH = Math.max(16, L.BT * 0.3);

    // board, with a soft drop shadow onto the backdrop
    x.save();
    x.shadowColor = 'rgba(0,0,0,.4)';
    x.shadowBlur = 34;
    x.shadowOffsetY = 20;
    x.fillStyle = t.board.edge;
    roundRectPath(x, bx, top, bw, surfH + edgeH, 24);
    x.fill();
    x.restore();

    g = x.createLinearGradient(0, top + surfH - 12, 0, top + surfH + edgeH);
    g.addColorStop(0, lighten(t.board.edge, 0.12));
    g.addColorStop(1, darken(t.board.edge, 0.3));
    x.fillStyle = g;
    roundRectPath(x, bx, top + surfH - 14, bw, edgeH + 14, 20);
    x.fill();

    g = x.createLinearGradient(0, top, 0, top + surfH);
    g.addColorStop(0, t.board.top);
    g.addColorStop(1, t.board.bottom);
    x.fillStyle = g;
    roundRectPath(x, bx, top, bw, surfH, 24);
    x.fill();

    x.save();
    roundRectPath(x, bx, top, bw, surfH, 24);
    x.clip();
    x.fillStyle = this.boardGrain;
    x.fillRect(bx, top, bw, surfH);
    // knife scars
    const rnd = mulberry32(42);
    x.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const sx = bx + rnd() * bw;
      const sy = top + rnd() * surfH;
      const len = 20 + rnd() * 90;
      const a = (rnd() - 0.5) * 0.9;
      x.strokeStyle = rgba(t.board.grain, 0.1 + rnd() * 0.12);
      x.lineWidth = 0.8 + rnd() * 1.1;
      x.beginPath();
      x.moveTo(sx, sy);
      x.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
      x.stroke();
      x.strokeStyle = 'rgba(255,255,255,.14)';
      x.beginPath();
      x.moveTo(sx, sy + 1.4);
      x.lineTo(sx + Math.cos(a) * len, sy + 1.4 + Math.sin(a) * len);
      x.stroke();
    }
    x.restore();

    // bevel light on the board's top-left rim
    x.save();
    g = x.createLinearGradient(bx, top, bx + bw * 0.5, top + surfH);
    g.addColorStop(0, 'rgba(255,255,255,.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,.28)');
    x.strokeStyle = g;
    x.lineWidth = 3;
    roundRectPath(x, bx + 1.5, top + 1.5, bw - 3, surfH - 3, 23);
    x.stroke();
    x.restore();

    // key light pool + vignette
    const R = Math.max(L.W, L.H);
    g = x.createRadialGradient(L.W * 0.27, L.H * 0.1, 0, L.W * 0.27, L.H * 0.1, R * 0.85);
    g.addColorStop(0, 'rgba(255,255,255,.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, L.W, L.H);
    g = x.createRadialGradient(L.W / 2, L.H * 0.46, R * 0.2, L.W / 2, L.H * 0.46, R * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${t.vignette})`);
    x.fillStyle = g;
    x.fillRect(0, 0, L.W, L.H);

    this.bg = c;
  }

  // ---- frame ----
  draw(now) {
    const game = this.game;
    const { L, input, fx } = game;
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    const sh = game.reduced ? { x: 0, y: 0 } : fx.shakeOffset();
    ctx.setTransform(dpr, 0, 0, dpr, sh.x * dpr, sh.y * dpr);

    const bodies = game.physics.pieces().sort((a, b) => a.piece.start - b.piece.start);
    for (const b of bodies) this.drawShadow(ctx, b);
    for (const b of bodies) this.drawPiece(ctx, b, now);
    this.drawMarks(ctx, bodies, now);
    this.drawHoverGap(ctx, now);
    fx.draw(ctx);
    this.drawTrail(ctx, now);
    this.drawCursor(ctx, now);
  }

  drawShadow(ctx, body) {
    const { L, theme } = this.game;
    const dpr = this.dpr;
    const p = body.piece;
    const e = clamp(L.floorY - body.bounds.max.y, 0, 300);
    const bw = body.bounds.max.x - body.bounds.min.x;
    const cx = (body.bounds.min.x + body.bounds.max.x) / 2 - LIGHT.x * (8 + e * 0.35);
    const gy = L.floorY + L.TH * 0.1;
    const alpha = clamp(0.5 - e * 0.0013, 0.12, 0.5) * (theme.dark ? 1.2 : 1);
    const blur = 6 + e * 0.1;
    const OFF = 10000;
    ctx.save();
    ctx.shadowColor = `rgba(20,10,0,${alpha})`;
    ctx.shadowBlur = blur * dpr;
    ctx.shadowOffsetX = OFF * dpr;
    ctx.shadowOffsetY = 0;
    ctx.translate(cx - OFF, gy);
    ctx.scale(1 + e / 500, Math.max(0.12, 0.3 - e * 0.0005));
    ctx.fillStyle = '#000';
    roundRectPath(ctx, -bw / 2, -L.TH / 2, bw, L.TH, L.TH * 0.3);
    ctx.fill();
    ctx.restore();
    // soft attached shadow cast to the right/below, visible where blocks touch the board
    if (e < 6) {
      ctx.save();
      ctx.shadowColor = `rgba(20,10,0,${alpha * 0.55})`;
      ctx.shadowBlur = 8 * dpr;
      ctx.shadowOffsetX = (OFF - LIGHT.x * 7) * dpr;
      ctx.shadowOffsetY = -LIGHT.y * 4 * dpr;
      ctx.translate(body.position.x - OFF, body.position.y);
      ctx.rotate(body.angle);
      ctx.fillStyle = '#000';
      roundRectPath(ctx, -(p.len * L.T) / 2, -L.TH / 2, p.len * L.T, L.TH, L.T * 0.16);
      ctx.fill();
      ctx.restore();
    }
  }

  drawPiece(ctx, body, now) {
    const game = this.game;
    const { L, input } = game;
    const p = body.piece;
    const T = L.T;
    const TH = L.TH;
    const w = p.len * T;
    const speed = Math.hypot(body.velocity.x, body.velocity.y) * 60;
    const calm = speed < 25;

    let wob = 0;
    if (game.tool === 'knife' && input.inside && !game.reduced) {
      const d = Math.hypot(input.x - body.position.x, input.y - body.position.y);
      const prox = clamp(1 - d / (T * 2.6), 0, 1);
      wob = Math.sin(now * 0.03 + p.start) * 0.045 * prox * prox;
    }
    const ang = body.angle + wob;

    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(ang);
    ctx.translate(0, TH / 2);
    ctx.scale(1 + p.sq * 0.5, 1 - p.sq);
    ctx.translate(0, -TH / 2);

    for (let i = 0; i < p.len; i++) {
      const gi = p.start + i;
      const letter = game.letters[gi];
      const cx = -w / 2 + (i + 0.5) * T;
      ctx.save();
      if (calm && !game.reduced) {
        const s = 1 + 0.012 * Math.sin(now * 0.0022 + gi * 0.8);
        ctx.translate(0, TH / 2);
        ctx.scale(1 / s, s);
        ctx.translate(0, -TH / 2);
      }
      let shakeX = 0;
      if (letter.mark === 'bad' && now - letter.markAt < 700) shakeX = Math.sin((now - letter.markAt) * 0.06) * 4 * (1 - (now - letter.markAt) / 700);
      this.drawTile(ctx, cx + shakeX, T, TH, letter, ang, game.theme);
      ctx.restore();
    }
    ctx.restore();
  }

  drawTile(ctx, cx, T, TH, letter, ang, th) {
    const bl = th.block;
    const w = T - 1.5;
    const h = TH - 1.5;
    const r = Math.min(w, h) * 0.16;
    const x = cx - w / 2;
    const y = -h / 2;
    const ca = Math.cos(-ang);
    const sa = Math.sin(-ang);
    const lx = LIGHT.x * ca - LIGHT.y * sa; // light direction in this block's own frame
    const ly = LIGHT.x * sa + LIGHT.y * ca;
    const rr = Math.hypot(w, h) / 2;
    const base = bl.base;

    // bevel: bright on the lit edges, dark on the far ones
    let g = ctx.createLinearGradient(cx + lx * rr, ly * rr, cx - lx * rr, -ly * rr);
    g.addColorStop(0, lighten(base, 0.72));
    g.addColorStop(0.45, base);
    g.addColorStop(1, darken(base, 0.4));
    ctx.fillStyle = g;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();

    const ins = Math.max(3, T * 0.075);
    const fx = x + ins;
    const fy = y + ins;
    const fw = w - ins * 2;
    const fh = h - ins * 2;
    g = ctx.createLinearGradient(cx + lx * rr * 0.6, ly * rr * 0.6, cx - lx * rr * 0.6, -ly * rr * 0.6);
    g.addColorStop(0, lighten(base, 0.2));
    g.addColorStop(1, darken(base, 0.1));
    ctx.fillStyle = g;
    roundRectPath(ctx, fx, fy, fw, fh, r * 0.7);
    ctx.fill();

    ctx.save();
    roundRectPath(ctx, fx, fy, fw, fh, r * 0.7);
    ctx.clip();
    if (this.blockPattern) {
      ctx.globalAlpha = bl.grainA;
      ctx.fillStyle = this.blockPattern;
      ctx.fillRect(fx, fy, fw, fh);
      ctx.globalAlpha = 1;
    }
    let paintCol = null;
    if (letter.paint) {
      paintCol = letter.paint === 'v' ? th.vowel : th.consonant;
      const t = clamp(letter.paintT, 0, 1);
      const rad = easeOutBack(t) * Math.hypot(fw, fh) * 0.62;
      const pg = ctx.createLinearGradient(cx + lx * rr, ly * rr, cx - lx * rr, -ly * rr);
      pg.addColorStop(0, lighten(paintCol, 0.32));
      pg.addColorStop(0.55, paintCol);
      pg.addColorStop(1, darken(paintCol, 0.3));
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(cx, 0, Math.max(0, rad), 0, 6.283);
      ctx.fill();
    }
    const gloss = paintCol ? 0.5 : bl.gloss;
    if (gloss) {
      const gx = cx + lx * rr * 0.42;
      const gy = ly * rr * 0.42;
      const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr * 0.95);
      gg.addColorStop(0, `rgba(255,255,255,${gloss * 0.85})`);
      gg.addColorStop(0.5, `rgba(255,255,255,${gloss * 0.15})`);
      gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(fx, fy, fw, fh);
    }
    ctx.restore();

    // specular rim
    g = ctx.createLinearGradient(cx + lx * rr, ly * rr, cx - lx * rr, -ly * rr);
    g.addColorStop(0, 'rgba(255,255,255,.75)');
    g.addColorStop(0.4, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,.32)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.6;
    roundRectPath(ctx, x + 0.8, y + 0.8, w - 1.6, h - 1.6, r);
    ctx.stroke();

    if (th.neon) {
      ctx.save();
      ctx.shadowColor = th.glow;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = rgba(th.glow, 0.75);
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, x, y, w, h, r);
      ctx.stroke();
      ctx.restore();
    }
    if (bl.outline) {
      ctx.strokeStyle = bl.outline;
      ctx.lineWidth = 2.5;
      roundRectPath(ctx, x, y, w, h, r);
      ctx.stroke();
    }

    // letter
    const fs = Math.round(TH * 0.64);
    ctx.font = `700 ${fs}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ty = h * 0.04;
    if (paintCol) {
      const light = isLight(paintCol);
      ctx.fillStyle = light ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.38)';
      ctx.fillText(letter.ch, cx - lx * 2, ty - ly * 2);
      ctx.fillStyle = light ? '#1b1b1b' : '#ffffff';
      ctx.fillText(letter.ch, cx, ty);
    } else {
      ctx.fillStyle = th.dark ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.7)';
      ctx.fillText(letter.ch, cx - lx * 1.4, ty - ly * 1.4);
      ctx.fillStyle = bl.ink;
      ctx.fillText(letter.ch, cx, ty);
    }
  }

  // ---- check feedback ----
  drawMarks(ctx, bodies, now) {
    const game = this.game;
    const { L } = game;
    const T = L.T;
    const TH = L.TH;
    // per-letter badges
    for (const b of bodies) {
      const p = b.piece;
      const w = p.len * T;
      for (let i = 0; i < p.len; i++) {
        const letter = game.letters[p.start + i];
        if (!letter.mark) continue;
        const lx = -w / 2 + (i + 0.5) * T;
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        const x = lx - T / 2 + 1;
        const y = -TH / 2 + 1;
        if (letter.mark === 'bad') {
          ctx.strokeStyle = '#e5242b';
          ctx.lineWidth = 4;
          roundRectPath(ctx, x, y, T - 2, TH - 2, T * 0.16);
          ctx.stroke();
          this.badge(ctx, lx + T / 2 - 8, -TH / 2 + 6, '✕', '#e5242b');
        } else if (letter.mark === 'missing') {
          ctx.setLineDash([7, 6]);
          ctx.strokeStyle = `rgba(255,150,0,${0.55 + pulse * 0.45})`;
          ctx.lineWidth = 3.5;
          roundRectPath(ctx, x, y, T - 2, TH - 2, T * 0.16);
          ctx.stroke();
        } else if (letter.mark === 'ok') {
          this.badge(ctx, lx + T / 2 - 8, -TH / 2 + 6, '✓', '#1f9d55');
        }
        ctx.restore();
      }
    }
    // per-gap markers
    for (const m of game.cutMarks) {
      if (m.type === 'missing') {
        const b = bodies.find((q) => q.piece.start < m.gap && q.piece.end > m.gap);
        if (!b) continue;
        const w = b.piece.len * T;
        const lx = -w / 2 + (m.gap - b.piece.start) * T;
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = '#e5242b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx, -TH / 2 - 12);
        ctx.lineTo(lx, TH / 2 + 8);
        ctx.stroke();
        ctx.setLineDash([]);
        this.badge(ctx, lx, -TH / 2 - 20, '✂', '#e5242b');
        ctx.restore();
      } else {
        const a = bodies.find((q) => q.piece.end === m.gap);
        const c = bodies.find((q) => q.piece.start === m.gap);
        if (!a || !c) continue;
        const pa = game.physics.toWorld(a, (a.piece.len * T) / 2, -TH / 2);
        const pc = game.physics.toWorld(c, -(c.piece.len * T) / 2, -TH / 2);
        const mx = (pa.x + pc.x) / 2;
        const my = Math.min(pa.y, pc.y) - 18;
        this.badge(ctx, mx, my, m.type === 'ok' ? '✓' : '✕', m.type === 'ok' ? '#1f9d55' : '#e5242b');
      }
    }
  }

  badge(ctx, x, y, glyph, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, 6.283);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x, y + 0.5);
    ctx.restore();
  }

  drawHoverGap(ctx, now) {
    const h = this.game.hoverGap;
    if (!h || this.game.tool !== 'knife') return;
    const { L } = this.game;
    const b = h.body;
    const w = b.piece.len * L.T;
    const lx = -w / 2 + h.k * L.T;
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -now * 0.02;
    ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.25 * Math.sin(now * 0.01)})`;
    ctx.shadowColor = this.game.theme.glow;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lx, -L.TH / 2 - 8);
    ctx.lineTo(lx, L.TH / 2 + 4);
    ctx.stroke();
    ctx.restore();
  }

  drawTrail(ctx, now) {
    const { input, theme } = this.game;
    input.prune(now);
    const tr = input.trail;
    if (tr.length < 2 || this.game.tool !== 'knife') return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1];
        const b = tr[i];
        const age = clamp((now - b.t) / 260, 0, 1);
        const k = 1 - age;
        ctx.strokeStyle = pass === 0 ? rgba(theme.glow, 0.5 * k) : `rgba(255,255,255,${0.95 * k})`;
        ctx.lineWidth = (pass === 0 ? 20 : 6) * k * (0.35 + 0.65 * (i / tr.length));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- cursor sprites ----
  drawCursor(ctx, now) {
    const { input, tool, theme } = this.game;
    if (!input.inside && !input.down) return;
    if (input.pointerType === 'touch' && !input.down) return;
    ctx.save();
    ctx.translate(input.x, input.y);
    ctx.shadowColor = 'rgba(0,0,0,.4)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 6;
    if (tool === 'knife') {
      ctx.rotate(input.angle);
      this.knife(ctx);
    } else {
      ctx.rotate(-0.6);
      const col = tool === 'vowel' ? theme.vowel : tool === 'consonant' ? theme.consonant : '#f6a6b8';
      this.brush(ctx, col, tool === 'eraser');
    }
    ctx.restore();
  }

  knife(ctx) {
    // tip at the origin, pointing +x; blade and handle trail behind
    let g = ctx.createLinearGradient(0, -14, 0, 12);
    g.addColorStop(0, '#f7fafd');
    g.addColorStop(0.5, '#c9d2dc');
    g.addColorStop(1, '#8793a1');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-26, -4, -68, -13);
    ctx.lineTo(-70, -13);
    ctx.lineTo(-70, 9);
    ctx.quadraticCurveTo(-34, 12, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-6, -2.5);
    ctx.quadraticCurveTo(-30, -6, -66, -11);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.moveTo(-6, 1.5);
    ctx.quadraticCurveTo(-34, 9, -68, 8);
    ctx.stroke();
    ctx.fillStyle = '#9aa4b0';
    ctx.fillRect(-74, -13, 6, 22);
    g = ctx.createLinearGradient(0, -10, 0, 10);
    g.addColorStop(0, '#6b4a2f');
    g.addColorStop(1, '#2f1f12');
    ctx.fillStyle = g;
    roundRectPath(ctx, -142, -9, 70, 19, 8);
    ctx.fill();
    ctx.fillStyle = '#d8d2c6';
    [-128, -108, -88].forEach((px) => { ctx.beginPath(); ctx.arc(px, 0.5, 2.3, 0, 6.283); ctx.fill(); });
  }

  brush(ctx, color, eraser) {
    // tip at origin, handle going up/right after the -0.6 rad tilt
    if (eraser) {
      ctx.fillStyle = color;
      roundRectPath(ctx, -4, -4, 54, 30, 9);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(34, -4, 16, 30);
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, -4, -4, 54, 30, 9);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#d7dde5';
    roundRectPath(ctx, 14, -7, 26, 14, 3);
    ctx.fill();
    const g = ctx.createLinearGradient(0, -8, 0, 8);
    g.addColorStop(0, '#d9a066');
    g.addColorStop(1, '#8a5a2b');
    ctx.fillStyle = g;
    roundRectPath(ctx, 38, -6, 64, 12, 6);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(6, -11, 16, -8);
    ctx.lineTo(16, 8);
    ctx.quadraticCurveTo(6, 11, 0, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.ellipse(10, -4, 5, 2, 0, 0, 6.283);
    ctx.fill();
  }
}
