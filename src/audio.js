// Ljud, syntetiserat i WebAudio tills inspelade effekter och röster finns (ElevenLabs kostar – fråga först).
// Kedja: källor -> buss (effekter / miljö / röst) -> limiter -> högtalare. Rösten duckar effekter och miljö.
// play(namn, {gain}) spelar en effekt; loopar (static, projector, ambience) stoppas med stop(namn).

export class Audio {
  constructor() {
    this.ctx = null;
    this.loops = {};
    this.muted = (() => { try { return localStorage.getItem('tow.muted') === '1'; } catch { return false; } })();
    const unlock = () => { this.init(); this.ctx?.resume(); };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = (this.ctx = new C());
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(lim).connect(ctx.destination);
    this.bed = ctx.createGain(); this.bed.connect(this.master);        // effekter + miljö (duckas)
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.bed);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.35; this.amb.connect(this.bed);
    this.vox = ctx.createGain(); this.vox.connect(this.master);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512;
    this.vox.connect(this.analyser);
    this.levelBuf = new Float32Array(this.analyser.fftSize);
    this.smoothed = 0;
    this.noiseBuf = this.makeNoise(2);
    this.brownBuf = this.makeNoise(4, true);
    this.ambience();
  }

  // Röstens nivå 0…1 (utjämnad), för det magiska ögat och skalans sken.
  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let s = 0;
    for (let i = 0; i < this.levelBuf.length; i++) s += this.levelBuf[i] * this.levelBuf[i];
    const rms = Math.min(1, Math.sqrt(s / this.levelBuf.length) * 5);
    this.smoothed += (rms - this.smoothed) * (rms > this.smoothed ? 0.5 : 0.12);
    return this.smoothed;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('tow.muted', m ? '1' : '0'); } catch { /* */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  makeNoise(sec, brown = false) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  noise({ t = 0, dur = 0.2, type = 'bandpass', f = 1000, q = 1, gain = 0.5, attack = 0.002, decay = null, f2 = null, bus = this.sfx, brown = false }) {
    const ctx = this.ctx, t0 = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brownBuf : this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.setValueAtTime(f, t0); filt.Q.value = q;
    if (f2) filt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay ?? dur));
    src.connect(filt).connect(g).connect(bus);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + (decay ?? dur) + 0.05);
    return { src, g };
  }

  tone({ t = 0, f = 440, f2 = null, dur = 0.3, type = 'sine', gain = 0.3, attack = 0.005, bus = this.sfx, lp = null }) {
    const ctx = this.ctx, t0 = ctx.currentTime + t;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = o.connect(g);
    if (lp) { const f_ = ctx.createBiquadFilter(); f_.type = 'lowpass'; f_.frequency.value = lp; out = g.connect(f_); }
    out.connect(bus);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // Rumston + väggklocka.
  ambience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const g = ctx.createGain(); g.gain.value = 0.25;
    src.connect(f).connect(g).connect(this.amb);
    src.start();
    let n = 0;
    this.clock = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      this.noise({ dur: 0.03, f: n++ % 2 ? 3200 : 2600, q: 8, gain: 0.05, bus: this.amb });
    }, 1000);
  }

  play(name, opt = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const k = opt.gain ?? 1;
    switch (name) {
      case 'dieHit':
        this.noise({ dur: 0.025, f: 2400 + Math.random() * 1600, q: 3, gain: 0.35 * k });
        this.noise({ dur: 0.05, type: 'lowpass', f: 600, gain: 0.15 * k });
        break;
      case 'dice':
        for (let i = 0; i < 6; i++) this.noise({ t: i * 0.045 + Math.random() * 0.03, dur: 0.02, f: 2800 + Math.random() * 1500, q: 4, gain: 0.22 });
        break;
      case 'place':
        this.noise({ dur: 0.06, type: 'lowpass', f: 900, gain: 0.3 });
        this.noise({ t: 0.01, dur: 0.02, f: 3000, q: 5, gain: 0.08 });
        break;
      case 'march':
        // virveltrumma: tre slag och en kort virvel
        [0, 0.28, 0.56].forEach((t) => this.noise({ t, dur: 0.09, f: 1800, q: 0.9, gain: 0.25 }));
        for (let i = 0; i < 6; i++) this.noise({ t: 0.84 + i * 0.035, dur: 0.05, f: 2000, q: 0.9, gain: 0.12 + i * 0.02 });
        break;
      case 'rifles':
        for (let i = 0; i < 5; i++) {
          const t = Math.random() * 0.35;
          this.noise({ t, dur: 0.12, f: 1500, q: 0.7, gain: 0.35 });
          this.noise({ t, dur: 0.25, type: 'lowpass', f: 500, gain: 0.2, decay: 0.4 });
        }
        break;
      case 'cannon':
        this.tone({ f: 95, f2: 32, dur: 0.6, gain: 0.7, type: 'sine' });
        this.noise({ dur: 0.5, type: 'lowpass', f: 1400, f2: 180, gain: 0.55, decay: 0.9 });
        break;
      case 'explosion':
        this.tone({ t: 0.02, f: 70, f2: 28, dur: 0.9, gain: 0.6 });
        this.noise({ dur: 1.4, type: 'lowpass', f: 2200, f2: 120, gain: 0.6, decay: 1.6, brown: true });
        this.noise({ dur: 0.08, f: 3000, q: 0.5, gain: 0.25 });
        break;
      case 'conquer':
        // signalhorn: G C E G
        [392, 523.3, 659.3, 784].forEach((f, i) => this.bugle(f, i * 0.16, i === 3 ? 0.55 : 0.14));
        break;
      case 'turn':
        this.noise({ dur: 0.03, f: 2500, q: 2, gain: 0.18 });
        this.tone({ t: 0.05, f: 1760, dur: 0.6, gain: 0.08, type: 'triangle' });
        break;
      case 'cards':
        this.noise({ dur: 0.25, f: 3500, f2: 6000, q: 0.6, gain: 0.15, attack: 0.08 });
        break;
      case 'paper':
        this.noise({ dur: 1.1, f: 1200, f2: 4000, q: 0.6, gain: 0.18, attack: 0.3 });
        this.noise({ t: 1.0, dur: 0.15, type: 'lowpass', f: 700, gain: 0.25 });
        break;
      case 'interval':
        // pausignal: fem toner som en speldosa
        [659.3, 784, 587.3, 659.3, 523.3].forEach((f, i) => { this.tone({ t: i * 0.32, f, dur: 0.7, gain: 0.12, bus: this.sfx }); this.tone({ t: i * 0.32, f: f * 2, dur: 0.35, gain: 0.03 }); });
        break;
      case 'eliminated':
        this.tone({ f: 110, f2: 104, dur: 3.5, gain: 0.35, type: 'sine', attack: 0.01 });
        this.tone({ f: 220, f2: 210, dur: 2.5, gain: 0.12, type: 'triangle' });
        for (let i = 0; i < 16; i++) this.noise({ t: i * 0.05, dur: 0.06, f: 1800, q: 0.9, gain: 0.05 + i * 0.008 });
        break;
      case 'victory':
        [523.3, 659.3, 784, 1046.5, 784, 1046.5].forEach((f, i) => this.bugle(f, i * 0.2, i >= 4 ? 0.6 : 0.18));
        break;
      case 'static': this.loop('static', () => {
        const n = this.noise({ dur: 3600, f: 2200, q: 0.4, gain: 0.08, attack: 0.2 });
        return () => this.kill(n);
      }); break;
      case 'projector': this.loop('projector', () => {
        const id = setInterval(() => this.noise({ dur: 0.02, f: 1600, q: 3, gain: 0.05 }), 1000 / 18);
        const hum = this.ctx.createOscillator(); hum.frequency.value = 60; hum.type = 'sawtooth';
        const g = this.ctx.createGain(); g.gain.value = 0.012;
        hum.connect(g).connect(this.sfx); hum.start();
        return () => { clearInterval(id); hum.stop(); };
      }); break;
    }
  }

  bugle(f, t, dur) {
    const ctx = this.ctx, t0 = ctx.currentTime + t;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.98, t0); o.frequency.linearRampToValueAtTime(f, t0 + 0.04);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t0); lp.frequency.linearRampToValueAtTime(2600, t0 + 0.06); lp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.13, t0 + 0.03); g.gain.setValueAtTime(0.13, t0 + dur); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.25);
    o.connect(lp).connect(g).connect(this.sfx);
    o.start(t0); o.stop(t0 + dur + 0.3);
  }

  // Stoppa en källa ordentligt: rensa schemalagda ramper (en lång exponentiell uttoning annars tar över igen),
  // tona ned kort och stäng källan.
  kill({ src, g }, fade = 0.15) {
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fade);
    try { src.stop(t + fade + 0.02); } catch { /* redan stoppad */ }
  }

  loop(name, start) {
    if (this.loops[name]) return;
    this.loops[name] = start();
  }

  stop(name) { this.loops[name]?.(); delete this.loops[name]; }
  stopLoops() { for (const n of Object.keys(this.loops)) this.stop(n); }

  // Inspelad replik. radio: bandpass 300–3400 Hz, lätt distorsion och knaster (som ur högtalaren på bordet);
  // annars journalfilmens optiska ljudspår (smalare diskant, sus). Effekter och miljö duckas medan den hörs.
  async speak(file, { radio = true } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    this.voiceCache ??= new Map();
    let buf = this.voiceCache.get(file);
    if (!buf) {
      try {
        const r = await fetch(new URL(`audio/voice/${file}`, document.baseURI));
        buf = await ctx.decodeAudioData(await r.arrayBuffer());
        this.voiceCache.set(file, buf);
      } catch { return; }
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = radio ? 320 : 140;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = radio ? 3300 : 6500;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = radio ? 1600 : 2200; mid.gain.value = radio ? 5 : 2; mid.Q.value = 0.8;
    const sh = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    const drive = radio ? 2.2 : 1.3;
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
    sh.curve = curve;
    const g = ctx.createGain(); g.gain.value = radio ? 0.9 : 1.0;
    src.connect(hp).connect(mid).connect(lp).connect(sh).connect(g).connect(this.vox);
    const hiss = this.noise({ dur: buf.duration + 0.3, f: radio ? 2500 : 6000, q: 0.5, gain: radio ? 0.02 : 0.012, bus: this.vox, attack: 0.1 });
    this.bed.gain.setTargetAtTime(0.35, ctx.currentTime, 0.08);
    src.start();
    src.onended = () => { this.bed.gain.setTargetAtTime(1, ctx.currentTime, 0.4); hiss.src.stop(); };
  }

  // Reservröst för radion: ett mumlande, bandpassat "tal" i stavelser medan remsan skrivs ut (byts mot riktiga röster).
  voice(line, ms) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.bed.gain.setTargetAtTime(0.35, this.ctx.currentTime, 0.1);
    const syll = Math.floor(ms / 210);
    for (let i = 0; i < syll; i++) {
      if (Math.random() < 0.12) continue;
      const t = i * 0.21 + Math.random() * 0.04;
      this.noise({ t, dur: 0.14, f: 500 + Math.random() * 700, q: 6, gain: 0.07, bus: this.vox, attack: 0.03 });
      this.noise({ t, dur: 0.12, f: 1800 + Math.random() * 900, q: 9, gain: 0.03, bus: this.vox, attack: 0.03 });
    }
    setTimeout(() => this.bed.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3), ms);
  }
}
