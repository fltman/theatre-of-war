// Musiken (Suno, nedladdad via officiella UI:t efter användarens ja per spår): public/audio/music/<id>.mp3.
// title = meny, warroom = spänningsbädd under kriget, newsreel = fanfar när journalfilmen börjar,
// radio_* = dansmusik som radion på bordet spelar lågt mellan sändningarna, victory = vapenstilleståndet.
// Spår som saknas hoppas tyst över.

const TRACKS = ['title', 'warroom', 'newsreel', 'victory', 'radio_swing_1', 'radio_swing_2', 'radio_dance'];
const RADIO = ['radio_swing_1', 'radio_swing_2', 'radio_dance'];

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.buffers = {};
    this.playing = {};          // namn -> { src, gain }
    this.radioIdx = 0;
  }

  get ctx() { return this.audio.ctx; }

  async load(name) {
    if (name in this.buffers) return this.buffers[name];
    this.buffers[name] = null;
    try {
      const r = await fetch(new URL(`audio/music/${name}.mp3`, document.baseURI));
      if (!r.ok) return null;
      this.audio.init();
      this.buffers[name] = await this.ctx.decodeAudioData(await r.arrayBuffer());
    } catch { this.buffers[name] = null; }
    return this.buffers[name];
  }

  preload() { return Promise.all(TRACKS.map((t) => this.load(t))); }

  // Spela ett spår på musikbussen. Bara ETT stycke åt gången: ett nytt tonar ut det som spelas (exclusive).
  // radio: genom radioapparatens filter (smalt band).
  async play(name, { volume = 0.5, loop = false, fade = 1.2, radio = false, offset = 0, exclusive = true } = {}) {
    const buf = await this.load(name);
    if (!buf || !this.ctx || this.ctx.state !== 'running') return null;
    if (exclusive) this.stopAll(Math.max(0.6, fade));
    else this.stop(name, 0.05);
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = loop;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + fade);
    let node = src;
    if (radio) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 280;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
      node = src.connect(hp).connect(lp);
    }
    node.connect(gain).connect(this.audio.mus);
    src.start(0, offset % buf.duration);
    this.playing[name] = { src, gain, volume };
    src.onended = () => { if (this.playing[name]?.src === src) delete this.playing[name]; };
    return src;
  }

  stop(name, fade = 1.0) {
    const p = this.playing[name];
    if (!p || !this.ctx) return;
    delete this.playing[name];
    const t = this.ctx.currentTime;
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(p.gain.gain.value, t);
    p.gain.gain.linearRampToValueAtTime(0, t + fade);
    p.src.stop(t + fade + 0.05);
  }

  stopAll(fade = 1) { for (const n of Object.keys(this.playing)) this.stop(n, fade); }

  // Lägen: 'menu', 'war', 'victory'. Under kriget en spellista: radions dansmusik och krigsrummets spänningsbädd
  // turas om (aldrig samtidigt).
  mode(m) {
    this.current = m;
    this.listGen = (this.listGen ?? 0) + 1;
    if (m === 'menu') this.play('title', { volume: 0.55, loop: true, fade: 1.5 });
    if (m === 'war') { this.listIdx = 0; this.next(this.listGen, 2.5); }
    if (m === 'victory') this.play('victory', { volume: 0.6, fade: 1.5 });
  }

  async next(gen, fade = 2) {
    if (gen !== this.listGen || this.current !== 'war' || this.paused) return;
    const LIST = ['radio_swing_1', 'warroom', 'radio_swing_2', 'warroom', 'radio_dance', 'warroom'];
    const name = LIST[this.listIdx++ % LIST.length];
    const radio = name.startsWith('radio');
    const src = await this.play(name, { volume: radio ? 0.1 : 0.16, radio, fade });
    if (!src) { if (this.buffers[name] === null) setTimeout(() => this.next(gen), 50); return; }
    src.addEventListener('ended', () => setTimeout(() => this.next(gen), 1500));
  }

  // Under en sändning tystnar musiken; efteråt fortsätter spellistan.
  duck(on) {
    this.paused = on;
    if (on) this.stopAll(0.8);
    else if (this.current === 'war') { this.listGen++; const g = this.listGen; setTimeout(() => this.next(g, 3), 2500); }
  }

  fanfare() { return this.play('newsreel', { volume: 0.5, fade: 0.05 }); }
}
