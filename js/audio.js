'use strict';
// Procedural audio (WebAudio, no samples). Starts after the first user gesture.
class Sound {
  constructor() { this.ctx = null; this.on = true; this.cam = [0, 0, 0]; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return; const c = this.ctx = new C();
      this.master = c.createGain(); this.master.gain.value = 0.7; this.master.connect(c.destination);
      const len = c.sampleRate * 3, nb = c.createBuffer(1, len, c.sampleRate), d = nb.getChannelData(0); let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      this.noise = nb;
      const mk = (freq, q, gain, type) => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = gain; s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { f, g }; };
      this.sea = mk(180, 0.7, 0.55, 'lowpass'); this.wind = mk(520, 2.2, 0.16, 'bandpass');
      const lfo = c.createOscillator(); lfo.frequency.value = 0.13; const lg = c.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(this.wind.f.frequency); lfo.start();
      const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.09; const lg2 = c.createGain(); lg2.gain.value = 0.07; lfo2.connect(lg2); lg2.connect(this.wind.g.gain); lfo2.start();
    } catch (e) { console.warn('audio kapalı', e); this.ctx = null; }
  }
  gainFor(dist) { return 1 / (1 + dist / 90); }
  later(dist, fn) { if (!this.ctx) return; const dl = Math.min(dist / 343, 4); fn(this.ctx.currentTime + dl); }
  burst(t0, dur, f0, f1, gain, type = 'lowpass') {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t0, Math.random() * 2); s.stop(t0 + dur + 0.1);
  }
  boom(dist, big = 1) {
    if (!this.ctx || !this.on) return; const gn = this.gainFor(dist) * big;
    this.later(dist, t => {
      this.burst(t, 0.9, 900, 70, 1.4 * gn); const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * gn, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.7);
    });
  }
  hit(dist, big = 1) { if (!this.ctx || !this.on) return; const gn = this.gainFor(dist) * big; this.later(dist, t => { this.burst(t, 0.35, 2600, 300, 0.8 * gn, 'bandpass'); this.burst(t, 0.5, 500, 90, 0.9 * gn); }); }
  splash(dist, p = 1) { if (!this.ctx || !this.on) return; const gn = this.gainFor(dist) * p; this.later(dist, t => this.burst(t, 0.6, 3200, 500, 0.35 * gn, 'bandpass')); }
  musket(dist) { if (!this.ctx || !this.on) return; const gn = this.gainFor(dist) * 0.5; this.later(dist, t => this.burst(t, 0.16, 5200, 900, 0.5 * gn, 'bandpass')); }
  clang(dist) { if (!this.ctx || !this.on) return; const gn = this.gainFor(dist) * 0.7; this.later(dist, t => { this.burst(t, 0.09, 6800, 2400, 0.5 * gn, 'bandpass'); }); }
  thunder(dist) { if (!this.ctx || !this.on) return; const gn = Math.min(1, 900 / (dist + 300)); this.later(dist * 1.0, t => { this.burst(t, 3.5, 300, 40, 2.2 * gn); this.burst(t + 0.6, 2.5, 200, 35, 1.4 * gn); }); }
  update(seaAmp, windSpeed) { if (!this.ctx) return; const t = this.ctx.currentTime; this.sea.g.gain.setTargetAtTime(0.35 + 0.35 * seaAmp, t, 0.5); }
}
