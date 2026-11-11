// Fully synthesised audio (WebAudio): no sample files. Positional sounds use HRTF panners.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // courtyard reverb: decaying noise with a few discrete slap-back echoes off the brick walls
    const rl = Math.floor(ctx.sampleRate * 1.7);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const b = ir.getChannelData(c);
      for (let i = 0; i < rl; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2) * 0.5;
      for (const [t, g] of [[0.052, 0.7], [0.088, 0.5], [0.121, 0.36], [0.176, 0.22]]) {
        const at = Math.floor((t + c * 0.007) * ctx.sampleRate);
        for (let i = 0; i < 90; i++) b[at + i] += (Math.random() * 2 - 1) * g * (1 - i / 90);
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.34;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.startAmbience();
  }

  setMuted(m) { this.muted = m; if (this.ctx) this.master.gain.value = m ? 0 : 0.8; }

  setListener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }

  // output node for a one-shot: dry + reverb send, optionally spatialised
  out(pos, wet = 0.5, gain = 1) {
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.value = gain;
    let tail = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.1;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p); tail = p;
    }
    tail.connect(this.master);
    if (wet > 0) { const s = ctx.createGain(); s.gain.value = wet; tail.connect(s).connect(this.reverb); }
    return g;
  }

  noiseBurst(dest, { dur, type = 'lowpass', f0, f1, q = 0.7, gain = 1, attack = 0.001, rate = 1 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  tone(dest, { type = 'sine', f0, f1, dur, gain = 1, attack = 0.001 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------ game sounds
  gunshot() {
    if (!this.ctx) return;
    const o = this.out(null, 0.9, 1);
    this.noiseBurst(o, { dur: 0.05, type: 'highpass', f0: 2200, gain: 1.0 });            // crack
    this.noiseBurst(o, { dur: 0.22, f0: 5200, f1: 380, gain: 1.1 });                       // body
    this.tone(o, { f0: 165, f1: 42, dur: 0.16, gain: 1.3 });                               // thump
    this.noiseBurst(o, { dur: 0.03, type: 'bandpass', f0: 3400, q: 6, gain: 0.5 });        // action
  }
  dryFire() { if (this.ctx) this.noiseBurst(this.out(null, 0.1, 0.5), { dur: 0.025, type: 'bandpass', f0: 2600, q: 5, gain: 0.7 }); }
  click(freq = 1900, gain = 0.45, delay = 0) {
    if (!this.ctx) return;
    setTimeout(() => {
      const o = this.out(null, 0.12, gain);
      this.noiseBurst(o, { dur: 0.03, type: 'bandpass', f0: freq, q: 4, gain: 1 });
      this.tone(o, { type: 'square', f0: freq * 0.5, f1: freq * 0.3, dur: 0.02, gain: 0.12 });
    }, delay * 1000);
  }
  reload() {
    this.click(900, 0.5, 0.28);   // magazine out
    this.click(1300, 0.6, 0.95);  // magazine in
    this.click(2100, 0.7, 1.32);  // slide release
    this.click(700, 0.5, 1.34);
  }
  casing(pos, first) {
    if (!this.ctx) return;
    const o = this.out(pos, 0.25, first ? 0.22 : 0.1);
    const f = 3800 + Math.random() * 1800;
    this.tone(o, { f0: f, dur: 0.09, gain: 0.5 });
    this.tone(o, { f0: f * 1.47, dur: 0.06, gain: 0.3 });
  }
  impact(pos, surface) {
    if (!this.ctx) return;
    const o = this.out(pos, 0.3, 0.6);
    if (surface === 'metal') {
      this.tone(o, { type: 'triangle', f0: 1700 + Math.random() * 1400, f1: 900, dur: 0.16, gain: 0.5 });
      this.noiseBurst(o, { dur: 0.05, type: 'highpass', f0: 3000, gain: 0.7 });
    } else if (surface === 'glass') {
      this.noiseBurst(o, { dur: 0.18, type: 'highpass', f0: 5000, gain: 0.5 });
    } else {
      this.noiseBurst(o, { dur: 0.07, f0: surface === 'soft' ? 700 : 2600, f1: 300, gain: 0.9 });
    }
  }
  footstep(sprint) {
    if (!this.ctx) return;
    const o = this.out(null, 0.15, sprint ? 0.3 : 0.2);
    this.noiseBurst(o, { dur: 0.09, f0: 900 + Math.random() * 500, f1: 160, gain: 1, rate: 0.6 });
    this.noiseBurst(o, { dur: 0.04, type: 'bandpass', f0: 3200, q: 1.5, gain: 0.22 });
  }
  land() { if (this.ctx) this.noiseBurst(this.out(null, 0.2, 0.5), { dur: 0.16, f0: 600, f1: 90, gain: 1, rate: 0.5 }); }
  hitmarker(kill) {
    if (!this.ctx) return;
    const o = this.out(null, 0, 0.22);
    this.tone(o, { type: 'triangle', f0: kill ? 1250 : 1850, f1: kill ? 620 : 1500, dur: kill ? 0.16 : 0.05, gain: 0.8 });
  }
  hurt() {
    if (!this.ctx) return;
    const o = this.out(null, 0.2, 0.7);
    this.tone(o, { f0: 120, f1: 50, dur: 0.22, gain: 1 });
    this.noiseBurst(o, { dur: 0.12, f0: 1400, f1: 200, gain: 0.7 });
  }
  pickup() {
    if (!this.ctx) return;
    this.click(1500, 0.5); this.click(2300, 0.5, 0.09);
  }
  droneCharge(pos) {
    if (!this.ctx) return;
    this.tone(this.out(pos, 0.2, 0.35), { type: 'sawtooth', f0: 380, f1: 1500, dur: 0.45, gain: 0.3, attack: 0.3 });
  }
  droneShot(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 0.5, 0.75);
    this.tone(o, { type: 'sawtooth', f0: 1500, f1: 190, dur: 0.14, gain: 0.5 });
    this.noiseBurst(o, { dur: 0.1, type: 'bandpass', f0: 2400, f1: 600, q: 2, gain: 0.8 });
  }
  explosion(pos, big = 1) {
    if (!this.ctx) return;
    const o = this.out(pos, 1.0, 1.5 * big);
    this.noiseBurst(o, { dur: 1.1, f0: 3200, f1: 55, gain: 1.4, rate: 0.5 });
    this.tone(o, { f0: 95, f1: 26, dur: 0.75, gain: 1.6 });
    this.noiseBurst(o, { dur: 0.08, type: 'highpass', f0: 1800, gain: 1 });
  }
  announce(up) {
    if (!this.ctx) return;
    const o = this.out(null, 0.3, 0.25);
    const notes = up ? [392, 523, 659] : [330, 262, 196];
    notes.forEach((f, i) => setTimeout(() => this.tone(o, { type: 'triangle', f0: f, dur: 0.5, gain: 0.5, attack: 0.02 }), i * 130));
  }

  // per-drone rotor whine: two detuned saws through a band-pass, spatialised
  droneVoice() {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.rolloffFactor = 1.4;
    const g = ctx.createGain(); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 1.2;
    const base = 170 + Math.random() * 40;
    const oscs = [0, 7, -5].map((det, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.value = base * (i === 2 ? 2.01 : 1); o.detune.value = det * 4;
      o.connect(f); o.start();
      return o;
    });
    f.connect(g).connect(p).connect(this.master);
    const send = ctx.createGain(); send.gain.value = 0.2; p.connect(send).connect(this.reverb);
    return {
      set(pos, throttle, alive) {
        const t = ctx.currentTime;
        p.positionX.setTargetAtTime(pos.x, t, 0.03); p.positionY.setTargetAtTime(pos.y, t, 0.03); p.positionZ.setTargetAtTime(pos.z, t, 0.03);
        g.gain.setTargetAtTime(alive ? 0.2 : 0.3, t, 0.1);
        oscs.forEach((o, i) => o.frequency.setTargetAtTime(base * (i === 2 ? 2.01 : 1) * (0.85 + throttle * 0.5), t, 0.08));
      },
      stop() { g.gain.setTargetAtTime(0, ctx.currentTime, 0.03); setTimeout(() => { oscs.forEach((o) => o.stop()); p.disconnect(); }, 300); },
    };
  }

  startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.045;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lg = ctx.createGain(); lg.gain.value = 230;
    lfo.connect(lg).connect(f.frequency); lfo.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.13;
    const lg2 = ctx.createGain(); lg2.gain.value = 0.02;
    lfo2.connect(lg2).connect(g.gain); lfo2.start();
    src.connect(f).connect(g).connect(this.master);
    src.start();
    // distant city rumble
    const r = ctx.createBufferSource(); r.buffer = this.noise; r.loop = true; r.playbackRate.value = 0.35;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 110;
    const rg = ctx.createGain(); rg.gain.value = 0.11;
    r.connect(rf).connect(rg).connect(this.master); r.start();
  }
}
