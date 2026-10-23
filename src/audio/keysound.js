// Synthesized keyboard sounds (Web Audio, no sound files). Sounds are built
// from two pieces: band-passed noise bursts (clicks, clacks) and short
// decaying tones (the key's body). Small random variation keeps repeats
// from sounding robotic.

export const SOUND_PROFILES = {
  blue: { label: 'Blue switch (clicky)', clicky: true },
  thock: { label: 'Thock (deep)', clickFreq: 1400, clickQ: 0.9, clickGain: 0.55, body: 150, bodyGain: 0.5, decay: 0.055 },
  click: { label: 'Click (bright)', clickFreq: 3600, clickQ: 1.4, clickGain: 0.75, body: 420, bodyGain: 0.22, decay: 0.035 },
  soft: { label: 'Soft (quiet)', clickFreq: 2200, clickQ: 0.7, clickGain: 0.3, body: 230, bodyGain: 0.3, decay: 0.045 },
};

const KIND = {
  key: { pitch: 1, gain: 1, length: 1 },
  space: { pitch: 0.7, gain: 1.15, length: 1.6 },
  enter: { pitch: 0.8, gain: 1.2, length: 1.4 },
  back: { pitch: 1.15, gain: 0.85, length: 0.85 },
};

function kindOf(e) {
  if (e.key === ' ') return 'space';
  if (e.key === 'Enter') return 'enter';
  if (e.key === 'Backspace' || e.key === 'Delete') return 'back';
  if (e.key.length === 1 || e.key === 'Tab') return 'key';
  return null; // arrows, shift, etc. stay silent
}

export class KeySound {
  constructor() {
    this.enabled = false;
    this.volume = 0.5;
    this.profile = 'thock';
    this.ctx = null;
    this.down = new Set(); // keys whose press made a sound, so release can too
  }

  _ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  /** Called with every editor keydown. */
  handleKey(e) {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const kind = kindOf(e);
    if (!kind) return;
    this.down.add(e.code);
    this.play(kind, e.repeat ? 0.5 : 1);
  }

  /** Called with every editor keyup: clicky switches click on release too. */
  handleKeyUp(e) {
    if (!this.down.delete(e.code) || !this.enabled) return;
    if (!SOUND_PROFILES[this.profile]?.clicky) return;
    this.playRelease(kindOf(e) || 'key');
  }

  play(kind = 'key', gainScale = 1) {
    if (!this._ensure()) return;
    const p = SOUND_PROFILES[this.profile] || SOUND_PROFILES.thock;
    const k = KIND[kind];
    const vary = 1 + (Math.random() - 0.5) * 0.16;
    const vol = this.volume * k.gain * gainScale * (0.85 + Math.random() * 0.3);
    const t = this.ctx.currentTime;
    if (p.clicky) return this._blueDown(t, k, vary, vol, kind);

    this._noise(t, { freq: p.clickFreq * k.pitch * vary, q: p.clickQ, gain: p.clickGain * vol, decay: p.decay * 0.6 * k.length });
    this._tone(t, { freq: p.body * k.pitch * vary, gain: p.bodyGain * vol, decay: p.decay * 1.3 * k.length });
  }

  playRelease(kind = 'key') {
    if (!this._ensure()) return;
    const k = KIND[kind];
    const vary = 1 + (Math.random() - 0.5) * 0.12;
    const vol = this.volume * k.gain * (0.8 + Math.random() * 0.3);
    const t = this.ctx.currentTime;
    // Upstroke: the click jacket snaps back, quieter and a bit higher.
    this._noise(t, { freq: 5200 * vary, q: 7, gain: 0.45 * vol, decay: 0.009 });
    this._noise(t, { freq: 7500 * vary, q: 2, gain: 0.18 * vol, decay: 0.005, type: 'highpass' });
    this._tone(t, { freq: 520 * k.pitch * vary, gain: 0.08 * vol, decay: 0.03 });
  }

  // Blue switch press: a sharp, metallic "click" when the switch actuates,
  // then the plastic "clack" of the key hitting bottom ~15 ms later.
  _blueDown(t, k, vary, vol, kind) {
    this._noise(t, { freq: 4300 * vary, q: 6, gain: 0.95 * vol, decay: 0.012 });
    this._noise(t, { freq: 6500 * vary, q: 1.5, gain: 0.35 * vol, decay: 0.006, type: 'highpass' });
    this._tone(t, { freq: 3100 * vary, gain: 0.06 * vol, decay: 0.008, type: 'square' });

    const tb = t + 0.013 + Math.random() * 0.005;
    this._noise(tb, { freq: 1700 * k.pitch * vary, q: 1.1, gain: 0.5 * vol, decay: 0.028 * k.length });
    this._tone(tb, { freq: 290 * k.pitch * vary, gain: 0.32 * vol, decay: 0.05 * k.length });
    if (kind === 'space' || kind === 'enter') {
      // Stabilizer bar rattle on the big keys.
      this._noise(tb + 0.007, { freq: 900, q: 1.5, gain: 0.25 * vol, decay: 0.05 });
    }
  }

  _noise(t, { freq, q, gain, decay, type = 'bandpass' }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.2, decay + 0.02);
  }

  _tone(t, { freq, gain, decay, type = 'triangle' }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }
}
