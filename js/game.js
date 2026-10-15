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
  const d = { level: 'medium', theme: 'wood', tasks: 'both', muted: false, score: 0, custom: '' };
  try { return { ...d, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch (_) { return d; }
}

const HINTS = {
  hand: 'Slide pieces left and right. Their ends stick like magnets, which rejoins the word. Shake a piece, or slice the joint, to pull it apart.',
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

    // A shared link (?words=rab-bit,sun+set) plays that list for this visit without touching saved settings.
    this.level = this.settings.level;
    // (read raw: URLSearchParams would turn the compound "+" into a space)
    const m = window.location.search.match(/[?&]words=([^&]*)/);
    let shared = null;
    try { shared = m ? decodeURIComponent(m[1]) : null; } catch (_) { shared = null; }
    const fromLink = shared ? Words.parseList(shared).entries : [];
    if (fromLink.length) {
      Words.setCustom(fromLink);
      this.level = 'custom';
    } else {
      Words.setCustom(Words.parseList(this.settings.custom).entries);
      if (this.level === 'custom' && !Words.customWords().length) this.level = 'medium';
    }

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
      this.physics.addPiece(bounds[i], bounds[i + 1], x + w / 2, TILE.h / 2 + 0.001, 0, 0);
      x += w + gap;
    }
  }

  // ---------- words ----------
  newWord() {
    const entry = Words.pickWord(this.level, this.maxLetters(), this.recent);
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
    this.hintLevel = 0;
    this.speaking = null;
    this.blending = false;
    this.hideToast();
    this.fitBoard();
    this.physics.addPiece(0, entry.word.length, 0, 1.5, 0, 0);
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
    this.readAlong([{ start: p.start, end: p.end }]);
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
    if (pt) this.physics.dragTo(pt.x);
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
      // Cut candidates: every gap inside the piece, plus any stuck-together joint at either end.
      const mg = this.physics.magnets;
      const rJoint = mg.bondAt(body, 'R');
      const lJoint = mg.bondAt(body, 'L');
      if (lx < -w / 2 - (lJoint ? 0.1 : 0.02) || lx > w / 2 + (rJoint ? 0.1 : 0.02)) continue;
      const c = this.scene.faceHit(body, x1 - vx * back, y1 - vy * back); // where the blade was 40 ms ago
      if (!c) continue;
      const dx = b.lx - c.lx;
      const dy = b.ly - c.ly;
      if (Math.abs(dy) / (Math.hypot(dx, dy) || 1) < 0.45) continue; // dragged along the word, not across it
      const cands = [];
      for (let k = 1; k < p.len; k++) cands.push({ x: -w / 2 + k * TILE.w, k });
      if (rJoint) cands.push({ x: w / 2, joint: rJoint });
      if (lJoint) cands.push({ x: -w / 2, joint: lJoint });
      if (!cands.length) { this.clank(body); continue; }
      const best = cands.reduce((m, q) => (Math.abs(q.x - lx) < Math.abs(m.x - lx) ? q : m)); // nearest gap or joint
      const wa = this.scene.faceToWorld(body, c.lx, c.ly);
      const wb = this.scene.faceToWorld(body, b.lx, b.ly);
      const v = wb.sub(wa).multiplyScalar(1 / back);
      if (v.length() > 8) v.multiplyScalar(8 / v.length());
      const sw = { vx: v.x, vy: v.y, vz: 0, f: clamp(v.length() / (TILE.w * 31), 0, 1) };
      if (best.joint) this.cutJoint(body, best, sw);
      else this.doCut(body, best.k, sw);
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
    this.readAlong([{ start: left.piece.start, end: left.piece.end }, { start: right.piece.start, end: right.piece.end }], { rate: 0.9, gap: 90, hop: false });
    this.setHint();
  }

  // Slicing through a stuck-together joint pulls the two pieces apart again. Joining two pieces that were
  // neighbours in the word re-fuses that gap (see onMagnetEvent), so cutting it here puts the cut back.
  cutJoint(body, cand, sw) {
    const a = this.scene.faceToWorld(body, cand.x, -TILE.h * 0.62);
    const b = this.scene.faceToWorld(body, cand.x, TILE.h * 0.62);
    if (this.held && this.physics.magnets.cluster(this.held).includes(body)) this.release();
    const now = performance.now();
    this.physics.magnets.separate(cand.joint, now);
    for (const q of [cand.joint.x, cand.joint.y]) {
      q.velocity.y += TILE.w * (5 + sw.f * 2); // the same little pop a cut gives
      q.piece.noCutUntil = now + 300; // one stroke cuts one joint, not the neighbour's next gap too
      q.piece.magnetUntil = 0; // and they must not snap straight back together
    }
    const power = clamp(0.5 + sw.f * 1.1, 0.5, 1.6);
    this.fx.flash(a, b);
    this.fx.slice(a, b, this.theme.chips, power);
    if (!this.reduced) {
      this.fx.addShake(clamp(sw.f * 6, 1.5, 6));
      this.hitStop = 0.07;
    }
    audio.cut(sw.f * 2600);
  }

  // Keep the word's cuts in step with what is physically stuck together: pieces that are neighbours in the
  // word and snap together are un-cut at that gap; when they come apart (knife, shake, impact) it is a cut again.
  onMagnetEvent(e) {
    const x = e.a;
    const y = e.b;
    if (this.blending && e.type === 'snap' && x && x.piece) this.onBlendSnap(x);
    if (!x || !y || !x.piece || !y.piece || x.piece.end !== y.piece.start) return;
    const gap = x.piece.end;
    if (e.type === 'snap') {
      this.cuts.delete(gap);
      this.history = this.history.filter((g) => g !== gap);
      if (this.blending && !this.cuts.size) this.finishBlend();
    } else if (!this.cuts.has(gap)) {
      this.cuts.add(gap);
      this.history.push(gap);
    }
    this.clearMarks();
  }

  // ---------- slice, then blend ----------
  // After a correct slice the kid pushes the pieces back together with the Hand. Every in-order snap reads the
  // chunk built so far; an out-of-order snap reads what was built, so they hear that it is not the word.
  startBlend() {
    this.hideResult();
    this.clearMarks();
    this.blending = true;
    this.setTool('hand');
    const parts = this.piecesInOrder().map((r) => this.entry.word.slice(r.start, r.end));
    this.toast(`Now blend it! Push the pieces together in order: ${parts.join(' → ')}`, 14000);
  }

  onBlendSnap(body) {
    const cluster = this.physics.magnets.cluster(body).sort((a, b) => a.position.x - b.position.x);
    const ranges = cluster.map((b) => ({ start: b.piece.start, end: b.piece.end }));
    const inOrder = ranges.every((r, i) => !i || r.start === ranges[i - 1].end);
    const text = ranges.map((r) => this.entry.word.slice(r.start, r.end)).join('');
    if (inOrder) {
      if (ranges[ranges.length - 1].end - ranges[0].start < this.entry.word.length) {
        this.readAlong([{ start: ranges[0].start, end: ranges[ranges.length - 1].end }], { hop: false });
      }
    } else {
      speech.sequence([text], { rate: 0.85 });
      this.toast(`Hmm, "${text}" is not the word. Shake a piece off and try another order.`, 8000);
    }
  }

  finishBlend() {
    this.blending = false;
    this.settings.score += 1;
    this.save();
    $('#score').textContent = String(this.settings.score);
    audio.good();
    this.fx.confetti(this.scene.size.W, [...this.theme.chips, this.theme.vowel, this.theme.consonant]);
    const parts = this.partsFor(Words.gapsOf(this.entry.parts));
    setTimeout(() => this.readAlong([{ start: 0, end: this.entry.word.length }], { rate: 0.75 }), 450);
    this.hideToast();
    $('#result-title').textContent = 'You blended it! 🎉';
    $('#result-body').innerHTML = `<p class="answer"><b>${parts.join(' · ')}</b> → <b>${this.entry.word}</b></p>`;
    $('#result-keep').hidden = true;
    $('#result-blend').hidden = true;
    const card = $('#result');
    card.classList.add('win');
    card.hidden = false;
    card.style.bottom = `${$('#toolbar').offsetHeight + 16}px`;
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
      const { best, bad, missing, good } = this.bestSplit();
      res.slice = { ok: !bad.length && !missing.length, bad, missing, good, parts: this.partsFor(best), best };
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

  // The accepted split closest to what the kid has cut, and how the cuts compare with it.
  bestSplit() {
    let best = null;
    let bestD = Infinity;
    for (const sp of Words.allowedSplits(this.entry)) {
      const d = [...sp].filter((g) => !this.cuts.has(g)).length + [...this.cuts].filter((g) => !sp.has(g)).length;
      if (d < bestD) { best = sp; bestD = d; }
    }
    const sorted = (a) => a.sort((x, y) => x - y);
    return {
      best,
      bad: sorted([...this.cuts].filter((g) => !best.has(g))),
      missing: sorted([...best].filter((g) => !this.cuts.has(g))),
      good: sorted([...this.cuts].filter((g) => best.has(g))),
    };
  }

  // Rule text for a gap of the accepted split (falls back to the main split's rule list).
  ruleText(gap) {
    const r = Words.ruleFor(this.entry, gap);
    return r ? r.text : `Cut between "${this.entry.word[gap - 1]}" and "${this.entry.word[gap]}".`;
  }

  // ---------- hints ----------
  // Press 1: glow the vowels. Press 2: point at one gap and give the rule's tip (not the answer).
  // Press 3: make that cut and say the rule. Then it starts again for the next gap.
  hint() {
    const now = performance.now();
    if (this.blending) {
      const gap = [...this.cuts].sort((a, b) => a - b)[0];
      const w = this.entry.word;
      const before = [0, ...[...this.cuts].sort((a, b) => a - b)].filter((g) => g < gap).pop();
      const after = [...[...this.cuts].sort((a, b) => a - b), w.length].find((g) => g > gap);
      this.toast(`Push "${w.slice(before, gap)}" and "${w.slice(gap, after)}" together. Grab one and slide it to the other.`);
      return;
    }
    this.hintLevel += 1;
    if (this.hintLevel === 1) {
      this.letters.forEach((l) => { if (l.vowel) l.glowAt = now; });
      this.toast('Find the vowel sounds first. Every syllable has one.');
      return;
    }
    if (this.settings.tasks === 'paint') {
      this.toast('Vowels are a, e, i, o, u, and y when it sounds like a vowel. All the other letters are consonants.');
      this.hintLevel = 0;
      return;
    }
    const { bad, missing } = this.bestSplit();
    this.clearMarks();
    if (bad.length) {
      this.cutMarks = [{ gap: bad[0], type: 'bad' }];
      this.toast(`${Words.mistakeFor(this.entry, bad[0], this.cuts)} Undo it, or slice that joint again.`);
      this.hintLevel = 1;
      return;
    }
    if (!missing.length) {
      this.toast('Every cut is in the right place. Press Check!');
      this.hintLevel = 1;
      return;
    }
    const gap = missing[0];
    const rule = Words.ruleFor(this.entry, gap);
    if (this.hintLevel === 2) {
      this.cutMarks = [{ gap, type: 'hint' }];
      this.toast(rule ? rule.tip : 'Look for where one syllable ends and the next begins.');
      return;
    }
    const body = this.physics.pieces().find((b) => b.piece.start < gap && b.piece.end > gap);
    if (body) this.doCut(body, gap - body.piece.start, { vx: 0, vy: -2, vz: 0, f: 0.4 });
    this.toast(this.ruleText(gap));
    this.hintLevel = 1;
  }

  // Read pieces aloud with a highlight: each range [start, end) glows and its piece hops as it is spoken.
  readAlong(ranges, opts = {}) {
    const word = this.entry.word;
    speech.sequence(ranges.map((r) => word.slice(r.start, r.end)), {
      rate: opts.rate || 0.8,
      gap: opts.gap || 200,
      onDone: opts.onDone,
      onItem: (i, ms) => {
        const r = ranges[i];
        this.speaking = { start: r.start, end: r.end, at: performance.now(), dur: ms + 120 };
        for (const b of this.physics.pieces()) {
          const p = b.piece;
          if (p.start >= r.start && p.end <= r.end) {
            p.sq = Math.max(p.sq, 0.12);
            if (opts.hop !== false && Math.abs(b.velocity.y) < 0.05 && b !== this.held) b.velocity.y = 1.1;
          }
        }
      },
    });
  }

  piecesInOrder() {
    return this.physics.pieces().sort((a, b) => a.piece.start - b.piece.start).map((b) => ({ start: b.piece.start, end: b.piece.end }));
  }

  // Glow strength (0..1) for one letter: hint glows and the read-along highlight.
  glowFor(gi, now) {
    let g = 0;
    const l = this.letters[gi];
    if (l && l.glowAt) {
      const t = (now - l.glowAt) / 1000;
      if (t < 2.6) g = Math.max(g, (0.65 + 0.35 * Math.sin(t * 9)) * Math.min(1, (2.6 - t) / 0.4));
    }
    const sp = this.speaking;
    if (sp && gi >= sp.start && gi < sp.end && now - sp.at < sp.dur) g = Math.max(g, 0.85);
    return g;
  }

  toast(msg, ms = 7000) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    t.style.bottom = `${$('#toolbar').offsetHeight + 16}px`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hideToast(), ms);
  }

  hideToast() {
    clearTimeout(this.toastTimer);
    const t = $('#toast');
    if (t) t.hidden = true;
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
    // read each piece in order (each hops as it is read), then the whole word
    const whole = { start: 0, end: this.entry.word.length };
    this.readAlong(this.cuts.size ? [...this.piecesInOrder(), whole] : [whole], { rate: 0.8, gap: 220 });
  }

  hear() {
    const pieces = this.piecesInOrder();
    this.readAlong([{ start: 0, end: this.entry.word.length }, ...(pieces.length > 1 ? pieces : [])]);
  }

  // ---------- result card ----------
  showResult(res, ok) {
    this.hideToast();
    const card = $('#result');
    const rows = [];
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    // the "rab | bit" part of a rule sentence is shown in the block font
    const fmt = (t) => esc(t).replace(/: ([a-z| ]+)$/, ': <b>$1</b>');
    if (res.slice) {
      const s = res.slice;
      rows.push(`<li class="${s.ok ? 'good' : 'bad'}"><b>Slicing</b> ${s.ok ? '✓ Perfect!' : '✗ Not quite'}</li>`);
      for (const g of s.bad) rows.push(`<li class="why bad">✗ ${esc(Words.mistakeFor(this.entry, g, this.cuts))}</li>`);
      for (const g of s.missing) rows.push(`<li class="why bad">✗ A cut is missing. ${fmt(this.ruleText(g))}</li>`);
      if (s.ok) for (const g of [...s.best].sort((a, b) => a - b)) rows.push(`<li class="why">${fmt(this.ruleText(g))}</li>`);
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
    $('#result-blend').hidden = !(res.slice && res.slice.ok && this.cuts.size);
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
    level.value = this.level;
    tasks.value = s.tasks;
    for (const [k, t] of Object.entries(THEMES)) theme.add(new Option(t.name, k));
    theme.value = s.theme;
    $('#score').textContent = String(s.score);
    this.syncMute();

    level.addEventListener('change', () => {
      if (level.value === 'custom' && !Words.customWords().length) { level.value = this.level; this.openWords(); return; }
      this.level = s.level = level.value;
      this.save();
      this.newWord();
    });
    this.bindWordsDialog();
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
    $('#btn-hint').addEventListener('click', () => { this.unlockAudio(); this.hint(); });
    $('#btn-next').addEventListener('click', () => this.newWord());
    $('#result-next').addEventListener('click', () => this.newWord());
    $('#result-keep').addEventListener('click', () => { this.hideResult(); });
    $('#result-blend').addEventListener('click', () => this.startBlend());

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
      else if (k === 'i') this.hint();
    });
    this.setTool('knife');
  }

  // ---------- My words ----------
  openWords() {
    const dlg = $('#words-dialog');
    const list = Words.customWords();
    $('#words-text').value = list.length ? list.map((e) => this.lineFor(e)).join('\n') : this.settings.custom;
    $('#words-errors').innerHTML = '';
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    $('#words-text').focus();
  }

  // Write an entry back in list syntax: syllables with "-", compound joins with "+", alternatives after "|".
  lineFor(e) {
    let out = '';
    let n = 0;
    e.parts.forEach((p, i) => {
      if (i) out += e.compound && e.compound.has(n) ? '+' : '-';
      out += p;
      n += p.length;
    });
    return [out, ...e.alts.map((a) => a.join('-'))].join('|');
  }

  bindWordsDialog() {
    const dlg = $('#words-dialog');
    const close = () => (dlg.close ? dlg.close() : dlg.removeAttribute('open'));
    $('#words-btn').addEventListener('click', () => this.openWords());
    $('#words-cancel').addEventListener('click', close);
    $('#words-save').addEventListener('click', () => {
      const text = $('#words-text').value;
      const { entries, errors } = Words.parseList(text);
      const errBox = $('#words-errors');
      errBox.innerHTML = '';
      const show = (msgs) => msgs.forEach((m) => { const li = document.createElement('li'); li.textContent = m; errBox.append(li); });
      if (errors.length) { show(errors); return; }
      if (!entries.length) { show(['Type at least one word, with "-" between its syllables.']); return; }
      Words.setCustom(entries);
      this.settings.custom = entries.map((e) => this.lineFor(e)).join('\n');
      this.level = this.settings.level = 'custom';
      $('#level').value = 'custom';
      this.save();
      close();
      this.newWord();
    });
    $('#words-share').addEventListener('click', async () => {
      const { entries, errors } = Words.parseList($('#words-text').value);
      if (errors.length || !entries.length) { $('#words-save').click(); return; }
      const url = `${window.location.origin}${window.location.pathname}?words=${encodeURIComponent(entries.map((e) => this.lineFor(e)).join(','))}`;
      const btn = $('#words-share');
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Link copied!';
      } catch (_) {
        window.prompt('Copy this link:', url);
      }
      setTimeout(() => { btn.textContent = 'Copy share link'; }, 2000);
    });
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
    this.fx.update(dt * this.physics.timeScale);
    if (this.held && !this.physics.hand) this.held = null;

    for (const b of this.physics.pieces()) {
      const p = b.piece;
      p.sqV += (-300 * p.sq - 15 * p.sqV) * dt; // damped spring for squash-and-stretch
      p.sq += p.sqV * dt;
    }
    for (const l of this.letters) if (l.paintT < 1) l.paintT = Math.min(1, l.paintT + dt * 4.5);

    for (const e of this.physics.magnets.drain()) {
      this.onMagnetEvent(e);
      const at = new THREE.Vector3(e.x, e.y, e.z);
      if (e.type === 'snap') { audio.snap(); this.fx.sparks(at, 18, this.theme.glow, 1); }
      else { audio.pop(); this.fx.dust(e.x, Math.max(0, e.y - 0.08), e.z, 3); this.fx.sparks(at, 8, '#ffffff', 0.8); }
    }

    // pointer on the table and the gap the knife would cut (as a snap guide)
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
