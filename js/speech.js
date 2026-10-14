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

  sequence(items, { rate = 0.85, gap = 160 } = {}) {
    if (!this.available || this.muted || !items.length) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const token = ++this.token;
    let i = 0;
    const next = () => {
      if (token !== this.token || i >= items.length) return;
      const u = new SpeechSynthesisUtterance(items[i++]);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice ? this.voice.lang : 'en-US';
      u.rate = rate;
      u.pitch = 1.05;
      u.onend = () => setTimeout(next, gap);
      u.onerror = () => {};
      synth.speak(u);
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
