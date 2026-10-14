import { THEMES, applyThemeCSS } from './themes.js';
import * as Words from './words.js';
import { Physics } from './physics.js';
import { Input } from './input.js';
import { FX } from './fx.js';
import { Renderer } from './render.js';
import { audio } from './audio.js';
import { speech } from './speech.js';
import { clamp } from './lighting.js';

const STORE = 'wordslicer.v1';
const $ = (s) => document.querySelector(s);

function loadSettings() {
  const d = { level: 'medium', theme: 'wood', tasks: 'both', muted: false, score: 0 };
  try { return { ...d, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch (_) { return d; }
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = loadSettings();
    if (!THEMES[this.settings.theme]) this.settings.theme = 'wood';
    this.theme = THEMES[this.settings.theme];
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.tool = 'knife';
    this.entry = null;
    this.letters = [];
    this.cuts = new Set();
    this.history = [];
    this.cutMarks = [];
    this.hoverGap = null;
    this.recent = [];
    this.hitStop = 0;
    this.last = performance.now();
    this.lastPaintSfx = 0;
    this.L = { W: 800, H: 600, T: 70, TH: 60, BT: 70, floorY: 380, boardLeft: 20, boardRight: 780, left: 30, right: 770 };

    this.physics = new Physics((ev) => this.onImpact(ev));
    this.fx = new FX();
    this.input = new Input(canvas, this);
    this.renderer = new Renderer(canvas, this);

    audio.muted = speech.muted = this.settings.muted;
    applyThemeCSS(this.theme);
    this.bindUI();
    this.layout();
    this.newWord();
    window.addEventListener('resize', () => this.onResize());
    if (window.ResizeObserver) new ResizeObserver(() => this.onResize()).observe(document.body);
    requestAnimationFrame((t) => this.frame(t));
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch (_) { /* private mode */ } }

  unlockAudio() { audio.unlock(); }

  // ---------- layout ----------
  layout() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const topH = ($('#topbar') || { offsetHeight: 56 }).offsetHeight;
    const botH = ($('#toolbar') || { offsetHeight: 90 }).offsetHeight;
    const pad = Math.max(10, W * 0.025);
    const L = this.L;
    L.W = W;
    L.H = H;
    L.boardLeft = pad;
    L.boardRight = W - pad;
    L.left = pad + 10;
    L.right = W - pad - 10;
    L.BT = clamp(H * 0.11, 46, 84); // board scale, independent of the current word
    const mid = (topH + (H - botH)) / 2;
    L.floorY = Math.round(mid + L.BT * 0.5);
    this.tileFor(this.entry ? this.entry.word.length : 8);
    this.physics.setup(L);
    this.renderer.resize();
  }

  tileFor(n) {
    const L = this.L;
    const avail = L.right - L.left - 8;
    L.T = clamp(Math.floor(avail / n), 22, Math.min(84, Math.round(L.H * 0.14)));
    L.TH = Math.round(L.T * 0.86);
  }

  onResize() {
    if (Math.abs(window.innerWidth - this.L.W) < 1 && Math.abs(window.innerHeight - this.L.H) < 1) return;
    this.layout();
    if (this.entry) this.relayoutPieces();
  }

  maxLetters() { return Math.max(6, Math.floor((this.L.right - this.L.left - 8) / 30)); }

  // Put the pieces back in a tidy row on the board (used after a resize).
  relayoutPieces() {
    const L = this.L;
    const bounds = [0, ...[...this.cuts].sort((a, b) => a - b), this.entry.word.length];
    this.physics.clear();
    const total = L.T * this.entry.word.length;
    const gap = clamp((L.right - L.left - total) / bounds.length, 0, 16);
    let x = (L.left + L.right) / 2 - (total + gap * (bounds.length - 2)) / 2;
    for (let i = 0; i < bounds.length - 1; i++) {
      const len = bounds[i + 1] - bounds[i];
      const w = len * L.T;
      this.physics.addPiece(bounds[i], bounds[i + 1], x + w / 2, L.floorY - L.TH / 2 - 1, 0);
      x += w + gap;
    }
  }

  // ---------- words ----------
  newWord() {
    const entry = Words.pickWord(this.settings.level, this.maxLetters(), this.recent);
    this.recent.push(entry.word);
    if (this.recent.length > 12) this.recent.shift();
    this.setEntry(entry);
  }

  setEntry(entry) {
    speech.stop();
    for (const b of this.physics.pieces()) this.fx.dust(b.position.x, b.position.y, 3);
    this.physics.clear();
    this.fx.reset();
    this.entry = entry;
    this.letters = entry.word.split('').map((ch, i) => ({
      ch, i, paint: null, paintT: 1, mark: null, markAt: 0, vowel: Words.isVowel(entry, i),
    }));
    this.cuts = new Set();
    this.history = [];
    this.cutMarks = [];
    this.hoverGap = null;
    this.tileFor(entry.word.length);
    this.physics.setup(this.L);
    this.renderer.rebuild();
    const b = this.physics.addPiece(0, entry.word.length, this.L.W / 2, -this.L.TH * 1.5, (Math.random() - 0.5) * 0.25);
    b.angularVelocity = 0;
    this.hideResult();
    this.setHint();
  }

  setHint() {
    const t = this.settings.tasks;
    const msg = t === 'paint' ? 'Paint the vowels and consonants.'
      : t === 'slice' ? 'Hold and drag to slice the word into syllables.'
        : 'Slice the word into syllables, then paint the vowels and consonants.';
    $('#hint').textContent = msg;
  }

  // ---------- tools ----------
  setTool(tool) {
    this.tool = tool;
    document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    this.hoverGap = null;
  }

  pieceAt(x, y, pad = 0) {
    for (const b of this.physics.pieces()) {
      const l = this.physics.toLocal(b, x, y);
      const w = b.piece.len * this.L.T;
      if (Math.abs(l.x) <= w / 2 + pad && Math.abs(l.y) <= this.L.TH / 2 + pad) return { body: b, lx: l.x, ly: l.y };
    }
    return null;
  }

  paintAt(x, y) {
    const hit = this.pieceAt(x, y);
    if (!hit) return;
    const p = hit.body.piece;
    const i = clamp(Math.floor((hit.lx + (p.len * this.L.T) / 2) / this.L.T), 0, p.len - 1);
    const letter = this.letters[p.start + i];
    const want = this.tool === 'vowel' ? 'v' : this.tool === 'consonant' ? 'c' : null;
    if (letter.paint === want) return;
    letter.paint = want;
    letter.paintT = want ? 0 : 1;
    this.clearMarks();
    if (want) {
      audio.paint();
      this.fx.splash(x, y, want === 'v' ? this.theme.vowel : this.theme.consonant);
    }
  }

  tapAt(x, y) {
    const hit = this.pieceAt(x, y, 6);
    if (!hit) return;
    const p = hit.body.piece;
    speech.say(this.entry.word.slice(p.start, p.end));
    p.sq = Math.max(p.sq, 0.12);
  }

  // ---------- slicing ----------
  onBlade(x0, y0, x1, y1, vx, vy, speed) {
    if (this.tool !== 'knife') return;
    if (speed > 500) audio.swoosh(speed);
    if (speed < 120) return;
    const now = performance.now();
    const T = this.L.T;
    for (const body of this.physics.pieces()) {
      const p = body.piece;
      if (now < p.noCutUntil) continue;
      const a = this.physics.toLocal(body, x0, y0);
      const b = this.physics.toLocal(body, x1, y1);
      if (a.y * b.y > 0 || a.y === b.y) continue; // did not cross the block's middle line
      const t = a.y / (a.y - b.y);
      const lx = a.x + t * (b.x - a.x);
      const w = p.len * T;
      if (Math.abs(lx) > w / 2 + 6) continue;
      const c = Math.cos(body.angle);
      const s = Math.sin(body.angle);
      const dly = -vx * s + vy * c;
      if (Math.abs(dly) / (Math.hypot(vx, vy) || 1) < 0.45) continue; // dragged along the word, not across it
      if (p.len < 2) { this.clank(body, vx, vy); continue; }
      const k = clamp(Math.round((lx + w / 2) / T), 1, p.len - 1); // snap to the nearest letter gap
      this.doCut(body, k, { vx, vy, speed });
    }
  }

  clank(body, vx, vy) {
    const p = body.piece;
    p.noCutUntil = performance.now() + 300;
    p.sq = 0.1;
    audio.thunk(0.35);
    this.fx.dust(body.position.x, body.position.y + this.L.TH / 2, 2);
    window.Matter.Body.setVelocity(body, { x: clamp(vx / 60, -3, 3) * 0.2, y: -2.5 });
  }

  doCut(body, k, sw) {
    const L = this.L;
    const p = body.piece;
    const gap = p.start + k;
    const w = p.len * L.T;
    const c = this.physics.toWorld(body, -w / 2 + k * L.T, 0);
    const ang = body.angle + Math.PI / 2;
    const { left, right } = this.physics.splitPiece(body, k, sw, performance.now());
    this.cuts.add(gap);
    this.history.push(gap);
    this.clearMarks();

    const power = clamp(sw.speed / 1400, 0.5, 1.6);
    this.fx.flash(c.x, c.y, ang, L.TH * 1.7);
    this.fx.slice(c.x, c.y, Math.cos(ang), Math.sin(ang), L.TH * 0.9, this.theme.chips, power);
    if (!this.reduced) {
      this.fx.addShake(clamp(sw.speed / 380, 1.5, 6));
      this.hitStop = 0.07;
    }
    audio.cut(sw.speed);
    const word = this.entry.word;
    speech.sequence([word.slice(left.piece.start, left.piece.end), word.slice(right.piece.start, right.piece.end)], { rate: 0.9, gap: 90 });
    this.setHint();
  }

  undo() {
    if (!this.history.length) return;
    const gap = this.history.pop();
    this.cuts.delete(gap);
    const ps = this.physics.pieces();
    const a = ps.find((b) => b.piece.end === gap);
    const b = ps.find((q) => q.piece.start === gap);
    this.clearMarks();
    if (a && b) {
      const m = this.physics.mergePieces(a, b, performance.now());
      this.fx.dust(m.position.x, m.position.y, 4);
      audio.thunk(0.3);
    }
  }

  // ---------- checking ----------
  clearMarks() {
    this.cutMarks = [];
    for (const l of this.letters) l.mark = null;
  }

  check() {
    const tasks = this.settings.tasks;
    const now = performance.now();
    this.clearMarks();
    const res = {};

    if (tasks !== 'paint') {
      let best = null;
      let bestD = Infinity;
      for (const s of Words.allowedSplits(this.entry)) {
        const d = [...s].filter((g) => !this.cuts.has(g)).length + [...this.cuts].filter((g) => !s.has(g)).length;
        if (d < bestD) { best = s; bestD = d; }
      }
      const bad = [...this.cuts].filter((g) => !best.has(g));
      const missing = [...best].filter((g) => !this.cuts.has(g));
      const good = [...this.cuts].filter((g) => best.has(g));
      res.slice = { ok: bestD === 0, bad, missing, good, parts: this.partsFor(best) };
      good.forEach((g) => this.cutMarks.push({ gap: g, type: 'ok' }));
      bad.forEach((g) => this.cutMarks.push({ gap: g, type: 'bad' }));
      missing.forEach((g) => this.cutMarks.push({ gap: g, type: 'missing' }));
    }

    if (tasks !== 'slice') {
      const wrong = [];
      const unpainted = [];
      this.letters.forEach((l, i) => {
        if (!l.paint) { unpainted.push(i); l.mark = 'missing'; l.markAt = now; return; }
        if ((l.paint === 'v') !== l.vowel) { wrong.push(i); l.mark = 'bad'; l.markAt = now; return; }
        l.mark = 'ok';
        l.markAt = now;
      });
      res.paint = { ok: !wrong.length && !unpainted.length, wrong, unpainted };
    }

    const ok = (!res.slice || res.slice.ok) && (!res.paint || res.paint.ok);
    this.showResult(res, ok);
    if (ok) this.celebrate();
    else audio.bad();
  }

  partsFor(gaps) {
    const sorted = [...gaps].sort((a, b) => a - b);
    const bounds = [0, ...sorted, this.entry.word.length];
    const out = [];
    for (let i = 0; i < bounds.length - 1; i++) out.push(this.entry.word.slice(bounds[i], bounds[i + 1]));
    return out;
  }

  celebrate() {
    this.settings.score += 1;
    this.save();
    $('#score').textContent = String(this.settings.score);
    audio.good();
    this.fx.confetti(this.L.W, [...this.theme.chips, this.theme.vowel, this.theme.consonant]);
    const ps = this.physics.pieces().sort((a, b) => a.piece.start - b.piece.start);
    ps.forEach((b, i) => setTimeout(() => {
      if (!b.piece) return;
      window.Matter.Body.setVelocity(b, { x: 0, y: -620 / 60 });
      window.Matter.Body.setAngularVelocity(b, (i % 2 ? 1 : -1) * 0.012);
    }, 180 + i * 140));
    const items = this.cuts.size ? [...this.partsFor(this.cuts), this.entry.word] : [this.entry.word];
    speech.sequence(items, { rate: 0.8, gap: 220 });
  }

  hear() {
    const ps = this.physics.pieces().sort((a, b) => a.piece.start - b.piece.start);
    const word = this.entry.word;
    speech.sequence([word, ...(ps.length > 1 ? ps.map((b) => word.slice(b.piece.start, b.piece.end)) : [])], { rate: 0.8, gap: 200 });
    ps.forEach((b, i) => setTimeout(() => { if (b.piece) b.piece.sq = Math.max(b.piece.sq, 0.14); }, 700 + i * 650));
  }

  // ---------- result card ----------
  showResult(res, ok) {
    const card = $('#result');
    const rows = [];
    if (res.slice) {
      const s = res.slice;
      const bits = [];
      if (s.bad.length) bits.push(`${s.bad.length} wrong cut${s.bad.length > 1 ? 's' : ''}`);
      if (s.missing.length) bits.push(`${s.missing.length} cut${s.missing.length > 1 ? 's' : ''} missing`);
      rows.push(`<li class="${s.ok ? 'good' : 'bad'}"><b>Slicing</b> ${s.ok ? '✓ Perfect!' : '✗ ' + bits.join(', ')}</li>`);
    }
    if (res.paint) {
      const p = res.paint;
      const bits = [];
      if (p.wrong.length) bits.push(`${p.wrong.length} wrong colour${p.wrong.length > 1 ? 's' : ''}`);
      if (p.unpainted.length) bits.push(`${p.unpainted.length} not painted`);
      rows.push(`<li class="${p.ok ? 'good' : 'bad'}"><b>Colours</b> ${p.ok ? '✓ Perfect!' : '✗ ' + bits.join(', ')}</li>`);
    }
    const answer = res.slice && !res.slice.ok ? `<p class="answer">Answer: <b>${res.slice.parts.join(' · ')}</b></p>` : '';
    $('#result-title').textContent = ok ? 'Great job! 🎉' : 'Almost there!';
    $('#result-body').innerHTML = `<ul>${rows.join('')}</ul>${answer}`;
    $('#result-keep').hidden = ok;
    card.classList.toggle('win', ok);
    card.hidden = false;
    const bar = $('#toolbar').offsetHeight;
    card.style.bottom = `${bar + 16}px`;
    (ok ? $('#result-next') : $('#result-keep')).focus({ preventScroll: true });
  }

  hideResult() { $('#result').hidden = true; }

  // ---------- UI wiring ----------
  bindUI() {
    const s = this.settings;
    const level = $('#level');
    const tasks = $('#tasks');
    const theme = $('#theme');
    level.value = s.level;
    tasks.value = s.tasks;
    for (const [k, t] of Object.entries(THEMES)) theme.add(new Option(t.name, k));
    theme.value = s.theme;
    $('#score').textContent = String(s.score);
    this.syncMute();

    level.addEventListener('change', () => { s.level = level.value; this.save(); this.newWord(); });
    tasks.addEventListener('change', () => { s.tasks = tasks.value; this.save(); this.clearMarks(); this.hideResult(); this.setHint(); });
    theme.addEventListener('change', () => {
      s.theme = theme.value;
      this.theme = THEMES[s.theme];
      applyThemeCSS(this.theme);
      this.save();
      this.renderer.rebuild();
      this.layout();
    });
    $('#mute').addEventListener('click', () => {
      s.muted = !s.muted;
      audio.muted = speech.muted = s.muted;
      if (s.muted) speech.stop();
      this.save();
      this.syncMute();
    });
    document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    $('#btn-check').addEventListener('click', () => { this.unlockAudio(); this.check(); });
    $('#btn-undo').addEventListener('click', () => this.undo());
    $('#btn-hear').addEventListener('click', () => { this.unlockAudio(); this.hear(); });
    $('#btn-next').addEventListener('click', () => this.newWord());
    $('#result-next').addEventListener('click', () => this.newWord());
    $('#result-keep').addEventListener('click', () => { this.hideResult(); });

    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('select, input, textarea')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const tools = { 1: 'knife', 2: 'vowel', 3: 'consonant', 4: 'eraser' };
      if (tools[k]) this.setTool(tools[k]);
      else if (k === 'enter' && document.activeElement === document.body) this.check();
      else if (k === 'z') this.undo();
      else if (k === 'n') this.newWord();
      else if (k === 'h') this.hear();
    });
    this.setTool('knife');
  }

  syncMute() {
    const m = $('#mute');
    m.setAttribute('aria-pressed', String(this.settings.muted));
    m.textContent = this.settings.muted ? '🔇' : '🔊';
    m.setAttribute('aria-label', this.settings.muted ? 'Sound off' : 'Sound on');
  }

  // ---------- loop ----------
  onImpact({ body, impact, x, y, ground }) {
    const p = body.piece;
    const T = this.L.T;
    p.sq = Math.max(p.sq, clamp(impact / (T * 50), 0, 0.26));
    audio.thunk(clamp(impact / 1800, 0.08, 1) * (ground ? 1 : 0.6));
    if (ground && impact > 900) this.fx.dust(x, this.L.floorY, impact > 1600 ? 4 : 2);
  }

  frame(t) {
    const dt = Math.min(0.05, Math.max(0.001, (t - this.last) / 1000));
    this.last = t;
    this.update(dt, t);
    this.renderer.draw(t);
    requestAnimationFrame((n) => this.frame(n));
  }

  update(dt, now) {
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.physics.timeScale = 0.12;
    } else {
      // brief ease out of the hit-stop; after ~80 ms the simulation runs at true real-time speed
      this.physics.timeScale = Math.min(1, this.physics.timeScale + dt * 14);
    }
    this.physics.step(dt * 1000);
    this.physics.assistUpright(now);
    this.fx.update(dt * this.physics.timeScale, this.L.floorY, this.physics.gravityPx);

    for (const b of this.physics.pieces()) {
      const p = b.piece;
      p.sqV += (-300 * p.sq - 15 * p.sqV) * dt; // damped spring for squash-and-stretch
      p.sq += p.sqV * dt;
    }
    for (const l of this.letters) if (l.paintT < 1) l.paintT = Math.min(1, l.paintT + dt * 4.5);

    // nearest gap under the knife, shown as a snap guide
    this.hoverGap = null;
    if (this.tool === 'knife' && this.input.inside) {
      const hit = this.pieceAt(this.input.x, this.input.y, 10);
      if (hit && hit.body.piece.len > 1) {
        const w = hit.body.piece.len * this.L.T;
        const k = clamp(Math.round((hit.lx + w / 2) / this.L.T), 1, hit.body.piece.len - 1);
        this.hoverGap = { body: hit.body, k };
      }
    }
  }
}
