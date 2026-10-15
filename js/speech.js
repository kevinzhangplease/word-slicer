// Thin wrapper over the browser's speech synthesis. Voice quality depends on the device;
// isolated syllables can sound a little odd, whole words are usually fine.
class Speech {
  constructor() {
    this.available = 'speechSynthesis' in window;
    this.muted = false;
    this.voice = null;
    this.token = 0;
    if (this.available) {
      this.pick();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this.pick());
    }
  }

  pick() {
    const voices = window.speechSynthesis.getVoices();
    this.voice = voices.find((v) => /^en[-_]CA/i.test(v.lang))
      || voices.find((v) => /^en[-_]US/i.test(v.lang))
      || voices.find((v) => /^en/i.test(v.lang))
      || null;
  }

  // Speak items one after another. onItem(i) fires as each one starts, so the game can highlight the piece
  // being read. With no voice available (or sound off) it still steps through on a timer, so the read-along
  // highlight works silently too. A per-item safety timer covers browsers that never fire "end".
  sequence(items, { rate = 0.85, gap = 160, onItem = null, onDone = null } = {}) {
    if (!items.length) return;
    const token = ++this.token;
    const silent = !this.available || this.muted;
    if (this.available) window.speechSynthesis.cancel();
    const est = (t) => 380 + 85 * t.length / rate;
    let i = 0;
    const next = () => {
      if (token !== this.token) return;
      if (i >= items.length) { if (onDone) onDone(); return; }
      const idx = i++;
      const text = items[idx];
      if (onItem) onItem(idx, est(text));
      if (silent) { setTimeout(next, est(text) + gap); return; }
      let done = false;
      const finish = () => { if (done) return; done = true; setTimeout(next, gap); };
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice ? this.voice.lang : 'en-US';
      u.rate = rate;
      u.pitch = 1.05;
      u.onend = finish;
      u.onerror = finish;
      setTimeout(finish, est(text) * 2.5 + 1200);
      window.speechSynthesis.speak(u);
    };
    next();
  }

  say(text) { this.sequence([text]); }

  stop() {
    this.token++;
    if (this.available) window.speechSynthesis.cancel();
  }
}

export const speech = new Speech();
