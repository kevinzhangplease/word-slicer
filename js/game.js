import * as THREE from 'three';
import { THEMES, applyThemeCSS } from './themes.js';
import * as Words from './words.js';
import { Physics } from './physics.js';
import { Input } from './input.js';
import { FX } from './fx.js';
import { Scene3D } from './scene.js';
import { Overlay } from './overlay.js';
import { audio } from './audio.js';
import { speech } from './speech.js';
import { clamp } from './lighting.js';
import { TILE } from './constants.js';

const STORE = 'wordslicer.v1';
const $ = (s) => document.querySelector(s);

function loadSettings() {
  const d = { level: 'medium', theme: 'wood', tasks: 'both', muted: false, score: 0 };
  try { return { ...d, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch (_) { return d; }
}

const HINTS = {
  hand: 'Drag letters around. Push the ends of pieces together and they stick like magnets. Shake a piece to pull it off.',
};

export class Game {
  constructor(stage, overlayCanvas) {
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
    this.pointerWorld = null;
    this.held = null;
    this.dragY = TILE.h / 2;
    this.recent = [];
    this.hitStop = 0;
    this.paused = false;
    this.last = performance.now();
    this.viewport = $('#viewport');

    this.physics = new Physics((ev) => this.onImpact(ev));
    this.fx = new FX();
    this.scene = new Scene3D(stage, this);
    this.overlay = new Overlay(overlayCanvas, this);
    this.input = new Input(stage, this);

    audio.muted = speech.muted = this.settings.muted;
    applyThemeCSS(this.theme);
    this.scene.setTheme(this.theme);
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
    const mx = Math.max(10, W * 0.025);
    this.scene.resize(W, H, { left: mx, right: mx, top: topH + 6, bottom: botH + 6 });
    this.overlay.resize(W, H);
    this.fitBoard();
  }

  fitBoard() {
    const { bx, bz } = this.scene.fit(this.entry ? this.entry.word.length : 8);
    this.physics.setup({ bx, bz });
  }

  onResize() {
    const { W, H } = this.scene.size;
    if (Math.abs(window.innerWidth - W) < 1 && Math.abs(window.innerHeight - H) < 1) return;
    this.layout();
    if (this.entry) this.relayoutPieces();
  }

  maxLetters() { return Math.max(6, Math.floor(this.scene.size.W / 38)); }

  // Put the pieces back in a tidy row on the board (used after a resize).
  relayoutPieces() {
    const bounds = [0, ...[...this.cuts].sort((a, b) => a - b), this.entry.word.length];
    this.physics.clear();
    this.held = null;
    const total = TILE.w * this.entry.word.length;
    const gap = clamp((2 * this.scene.bx - 0.3 - total) / bounds.length, 0, 0.06);
    let x = -(total + gap * (bounds.length - 2)) / 2;
    for (let i = 0; i < bounds.length - 1; i++) {
      const w = (bounds[i + 1] - bounds[i]) * TILE.w;
      this.physics.addPiece(bounds[i], bounds[i + 1], x + w / 2, TILE.h / 2 + 0.001, 0.1, 0);
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
    for (const b of this.physics.pieces()) this.fx.dust(b.position.x, 0, b.position.z, 3);
    this.physics.clear();
    this.held = null;
    this.fx.reset();
    this.entry = entry;
    this.letters = entry.word.split('').map((ch, i) => ({
      ch, i, paint: null, paintT: 1, mark: null, markAt: 0, vowel: Words.isVowel(entry, i),
    }));
    this.cuts = new Set();
    this.history = [];
    this.cutMarks = [];
    this.hoverGap = null;
    this.fitBoard();
    this.physics.addPiece(0, entry.word.length, 0, 1.5, 0.1, (Math.random() - 0.5) * 0.08);
    this.hideResult();
    this.setHint();
  }

  setHint() {
    const t = this.settings.tasks;
    const task = t === 'paint' ? 'Paint the vowels and consonants.'
      : t === 'slice' ? 'Hold and drag to slice the word into syllables.'
        : 'Slice the word into syllables, then paint the vowels and consonants.';
    $('#hint').textContent = HINTS[this.tool] || task;
  }

  // ---------- tools ----------
  setTool(tool) {
    if (this.tool === 'hand' && tool !== 'hand') this.release();
    this.tool = tool;
    document.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    this.hoverGap = null;
    if (this.entry) this.setHint();
  }

  paintAt(x, y) {
    const hit = this.scene.pick(x, y);
    if (!hit) return;
    const letter = this.letters[hit.body.piece.start + hit.index];
    const want = this.tool === 'vowel' ? 'v' : this.tool === 'consonant' ? 'c' : null;
    if (letter.paint === want) return;
    letter.paint = want;
    letter.paintT = want ? 0 : 1;
    this.clearMarks();
    if (want) {
      audio.paint();
      this.fx.splash(hit.point.x, hit.point.y, hit.point.z, want === 'v' ? this.theme.vowel : this.theme.consonant);
    }
  }

  tapAt(x, y) {
    const hit = this.scene.pick(x, y);
    if (!hit) return;
    const p = hit.body.piece;
    speech.say(this.entry.word.slice(p.start, p.end));
    p.sq = Math.max(p.sq, 0.1);
  }

  // ---------- the hand ----------
  grabAt(x, y) {
    const hit = this.scene.pick(x, y);
    if (!hit) return;
    this.release();
    this.physics.grab(hit.body, hit.point);
    this.held = hit.body;
    this.dragY = hit.point.y;
    hit.body.piece.sq = Math.max(hit.body.piece.sq, 0.07);
    audio.thunk(0.2);
    this.clearMarks();
  }

  dragTo(x, y) {
    if (!this.held) return;
    const pt = this.scene.planeHit(x, y, this.dragY);
    if (pt) this.physics.dragTo(pt.x, pt.z);
  }

  release() {
    if (!this.held) return;
    this.physics.release();
    this.held = null;
  }

  // ---------- slicing ----------
  // The stroke's two ends are ray-cast onto each piece's front-face plane; the v1 logic (did the blade
  // cross the block's middle line, mostly across rather than along, snap to the nearest gap) then runs
  // unchanged on those local coordinates.
  onBlade(x0, y0, x1, y1, vx, vy, speed) {
    if (this.tool !== 'knife') return;
    if (speed > 500) audio.swoosh(speed);
    if (speed < 50) return; // a stroke starts from rest, so the gate must be forgiving
    const now = performance.now();
    const back = 0.04;
    for (const body of this.physics.pieces()) {
      const p = body.piece;
      if (now < p.noCutUntil) continue;
      const a = this.scene.faceHit(body, x0, y0);
      const b = this.scene.faceHit(body, x1, y1);
      if (!a || !b) continue;
      if (a.ly * b.ly > 0 || a.ly === b.ly) continue; // did not cross the block's middle line
      const t = a.ly / (a.ly - b.ly);
      const lx = a.lx + t * (b.lx - a.lx);
      const w = p.len * TILE.w;
      if (Math.abs(lx) > w / 2 + 0.02) continue;
      const c = this.scene.faceHit(body, x1 - vx * back, y1 - vy * back); // where the blade was 40 ms ago
      if (!c) continue;
      const dx = b.lx - c.lx;
      const dy = b.ly - c.ly;
      if (Math.abs(dy) / (Math.hypot(dx, dy) || 1) < 0.45) continue; // dragged along the word, not across it
      if (p.len < 2) { this.clank(body); continue; }
      const k = clamp(Math.round((lx + w / 2) / TILE.w), 1, p.len - 1); // snap to the nearest letter gap
      const wa = this.scene.faceToWorld(body, c.lx, c.ly);
      const wb = this.scene.faceToWorld(body, b.lx, b.ly);
      const v = wb.sub(wa).multiplyScalar(1 / back);
      if (v.length() > 8) v.multiplyScalar(8 / v.length());
      this.doCut(body, k, { vx: v.x, vy: v.y, vz: v.z, f: clamp(v.length() / (TILE.w * 31), 0, 1) });
    }
  }

  clank(body) {
    const p = body.piece;
    p.noCutUntil = performance.now() + 300;
    p.sq = 0.1;
    audio.thunk(0.35);
    this.fx.dust(body.position.x, 0, body.position.z, 2);
    body.velocity.y = Math.max(body.velocity.y, 0.5);
  }

  doCut(body, k, sw) {
    const p = body.piece;
    const gap = p.start + k;
    const lx = -(p.len * TILE.w) / 2 + k * TILE.w;
    const a = this.scene.faceToWorld(body, lx, -TILE.h * 0.62);
    const b = this.scene.faceToWorld(body, lx, TILE.h * 0.62);
    if (this.held === body) this.release();
    const { left, right } = this.physics.splitPiece(body, k, sw, performance.now());
    this.cuts.add(gap);
    this.history.push(gap);
    this.clearMarks();

    const power = clamp(0.5 + sw.f * 1.1, 0.5, 1.6);
    this.fx.flash(a, b);
    this.fx.slice(a, b, this.theme.chips, power);
    if (!this.reduced) {
      this.fx.addShake(clamp(sw.f * 6, 1.5, 6));
      this.hitStop = 0.07;
    }
    audio.cut(sw.f * 2600);
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
      if (this.held === a || this.held === b) this.release();
      const m = this.physics.mergePieces(a, b, performance.now());
      this.fx.dust(m.position.x, 0, m.position.z, 4);
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
    this.fx.confetti(this.scene.size.W, [...this.theme.chips, this.theme.vowel, this.theme.consonant]);
    const ps = this.physics.pieces().sort((a, b) => a.piece.start - b.piece.start);
    ps.forEach((b, i) => setTimeout(() => {
      if (!this.physics.world.bodies.includes(b)) return;
      b.velocity.y = Math.max(b.velocity.y, 2.2);
      b.angularVelocity.z += (i % 2 ? 1 : -1) * 0.8;
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
    card.style.bottom = `${$('#toolbar').offsetHeight + 16}px`;
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
      this.scene.setTheme(this.theme);
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
      const tools = { 1: 'knife', 2: 'hand', 3: 'vowel', 4: 'consonant', 5: 'eraser' };
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
  onImpact({ body, impact, x, z, ground }) {
    const p = body.piece;
    if (!p) return;
    p.sq = Math.max(p.sq, clamp(impact * 0.05, 0, 0.2));
    audio.thunk(clamp(impact / 5, 0.08, 1) * (ground ? 1 : 0.6));
    if (ground && impact > 2.4) this.fx.dust(x, 0, z, impact > 4 ? 4 : 2);
  }

  frame(t) {
    const dt = Math.min(0.05, Math.max(0.001, (t - this.last) / 1000));
    this.last = t;
    if (!this.paused) {
      this.update(dt, t);
      this.renderOnce(t);
    }
    requestAnimationFrame((n) => this.frame(n));
  }

  renderOnce(t = performance.now()) {
    this.scene.sync(t);
    this.scene.render();
    this.overlay.draw(t);
    const sh = this.reduced ? { x: 0, y: 0 } : this.fx.shakeOffset();
    this.viewport.style.transform = sh.x || sh.y ? `translate(${sh.x.toFixed(1)}px, ${sh.y.toFixed(1)}px)` : '';
  }

  // Step the simulation without rendering (used by automated tests on machines with slow software WebGL).
  advance(seconds, step = 1 / 60) {
    for (let i = 0; i < seconds / step; i++) this.update(step, performance.now());
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
    this.fx.update(dt * this.physics.timeScale);
    if (this.held && !this.physics.hand) this.held = null;

    for (const b of this.physics.pieces()) {
      const p = b.piece;
      p.sqV += (-300 * p.sq - 15 * p.sqV) * dt; // damped spring for squash-and-stretch
      p.sq += p.sqV * dt;
    }
    for (const l of this.letters) if (l.paintT < 1) l.paintT = Math.min(1, l.paintT + dt * 4.5);

    for (const e of this.physics.magnets.drain()) {
      const at = new THREE.Vector3(e.x, e.y, e.z);
      if (e.type === 'snap') { audio.snap(); this.fx.sparks(at, 18, this.theme.glow, 1); }
      else { audio.pop(); this.fx.dust(e.x, Math.max(0, e.y - 0.08), e.z, 3); this.fx.sparks(at, 8, '#ffffff', 0.8); }
    }

    // pointer on the table (for wobble) and the gap the knife would cut (as a snap guide)
    const inp = this.input;
    this.pointerWorld = inp.inside ? this.scene.planeHit(inp.x, inp.y, TILE.h / 2) : null;
    this.hoverGap = null;
    if (this.tool === 'knife' && inp.inside) {
      for (const body of this.physics.pieces()) {
        const p = body.piece;
        if (p.len < 2) continue;
        const h = this.scene.faceHit(body, inp.x, inp.y);
        const w = p.len * TILE.w;
        if (h && Math.abs(h.lx) <= w / 2 + 0.02 && Math.abs(h.ly) <= TILE.h / 2 + 0.04) {
          this.hoverGap = { body, k: clamp(Math.round((h.lx + w / 2) / TILE.w), 1, p.len - 1) };
          break;
        }
      }
    }
  }

  // Screen position of a world point.
  screenAt(x, y, z) {
    return this.scene.project(new THREE.Vector3(x, y, z));
  }

  // Screen position of a point on a piece's front face (used by tests and tools).
  screenOf(body, lx, ly) {
    return this.scene.project(this.scene.faceToWorld(body, lx, ly));
  }
}
