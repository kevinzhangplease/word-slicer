// All sound effects are synthesised with Web Audio, so there are no audio files to load.
class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = false;
    this.last = {};
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  ok(name, gapMs = 0) {
    if (!this.ctx || this.muted) return false;
    const now = performance.now();
    if (gapMs && now - (this.last[name] || 0) < gapMs) return false;
    this.last[name] = now;
    return true;
  }

  burst(dur, type, f0, f1, q, gain, attack = 0.004) {
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  tone(type, f0, f1, dur, gain, delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  swoosh(speed) {
    if (!this.ok('swoosh', 140)) return;
    const v = Math.min(1, speed / 2200);
    this.burst(0.2, 'bandpass', 500 + v * 500, 2400, 0.9, 0.05 + v * 0.16, 0.05);
  }

  cut(speed) {
    if (!this.ok('cut')) return;
    const v = Math.min(1, speed / 2200);
    this.burst(0.13, 'highpass', 3200, 5200, 0.7, 0.3 + v * 0.15);
    this.tone('triangle', 2300, 700, 0.1, 0.1);
  }

  thunk(vol) {
    if (!this.ok('thunk', 45)) return;
    const v = Math.max(0.05, Math.min(1, vol));
    this.tone('sine', 190, 55, 0.13, 0.45 * v);
    this.burst(0.05, 'lowpass', 500, 0, 0.7, 0.2 * v);
  }

  paint() {
    if (!this.ok('paint', 70)) return;
    this.tone('sine', 520, 780, 0.08, 0.07);
  }

  good() {
    if (!this.ok('good')) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.14, i * 0.09));
  }

  bad() {
    if (!this.ok('bad')) return;
    this.tone('sawtooth', 240, 150, 0.28, 0.06);
  }
}

export const audio = new AudioFX();
