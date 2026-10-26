// Partiklar på kartbordet: eldklot, krutrök, rökpelare, splitter, spårljus, damm, och bränder som ligger kvar där
// det stridits (erövrade territorier brinner längre). Ljuskällorna ligger i en fast pool (nya ljus tvingar three att
// kompilera om alla shaders). Röken driver med en svag vind.
import * as THREE from 'three';

const WIND = new THREE.Vector3(0.05, 0, -0.025);

function softTexture(inner, outer, holes = 40) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.45, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < holes; i++) {
    g.beginPath(); g.arc(20 + Math.random() * 88, 20 + Math.random() * 88, 4 + Math.random() * 10, 0, 7); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Flamma: varm kärna, tunga uppåt, brusig kant.
function flameTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 18; i++) {
    const x = 64 + (Math.random() - 0.5) * 30, y = 70 + (Math.random() - 0.5) * 20, r = 18 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y - r * 0.3, r);
    gr.addColorStop(0, 'rgba(255,245,210,0.9)'); gr.addColorStop(0.3, 'rgba(255,170,60,0.55)'); gr.addColorStop(0.7, 'rgba(200,60,10,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.tex = {
      smoke: softTexture('rgba(215,210,200,0.9)', 'rgba(165,160,152,0.45)'),
      dark: softTexture('rgba(55,50,45,0.95)', 'rgba(35,32,28,0.55)'),
      fire: flameTexture(),
      flash: softTexture('rgba(255,250,230,1)', 'rgba(255,190,90,0.6)', 0),
      dust: softTexture('rgba(150,125,90,0.8)', 'rgba(120,100,70,0.35)'),
      spark: softTexture('rgba(255,230,160,1)', 'rgba(255,140,40,0.5)', 0),
    };
    this.live = [];
    this.pool = [];
    this.burns = [];
    this.lights = [0, 1, 2, 3].map(() => {
      const l = new THREE.PointLight(0xffa040, 0, 3.5, 2);
      this.scene.add(l);
      return { l, t: 0, dur: 0, peak: 0, flicker: false };
    });
    world.addUpdater((dt) => this.update(dt));
  }

  sprite(kind) {
    const s = this.pool.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }));
    s.material.map = this.tex[kind];
    s.material.blending = kind === 'fire' || kind === 'flash' || kind === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.needsUpdate = true;
    s.renderOrder = kind === 'dark' || kind === 'smoke' ? 5 : 6;
    this.scene.add(s);
    return s;
  }

  // Ett utsläpp av partiklar. gravity: splitter som faller; wind: röken driver.
  emit(kind, pos, { n = 1, size = 0.12, grow = 2.5, life = 1.4, rise = 0.25, spread = 0.05, vel = null, opacity = 0.85, tint = null, gravity = 0, wind = kind === 'smoke' || kind === 'dark', stretch = 1 } = {}) {
    if (this.live.length > 900) return;
    for (let i = 0; i < n; i++) {
      const s = this.sprite(kind);
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * spread * 0.5, (Math.random() - 0.5) * spread));
      s.material.color.set(tint ?? 0xffffff);
      s.material.rotation = Math.random() * 6.28;
      const v = vel ? vel.clone().multiplyScalar(0.6 + Math.random() * 0.8) : new THREE.Vector3((Math.random() - 0.5) * 0.08, rise * (0.6 + Math.random() * 0.8), (Math.random() - 0.5) * 0.08);
      this.live.push({ s, t: 0, life: life * (0.7 + Math.random() * 0.6), size: size * (0.7 + Math.random() * 0.6), grow, v, opacity, spin: (Math.random() - 0.5) * 0.8, gravity, wind, stretch });
    }
  }

  flash(pos, peak = 2.5, dur = 0.12, color = 0xffa040) {
    const L = this.lights.reduce((a, b) => (a.t / Math.max(a.dur, 1e-3) > b.t / Math.max(b.dur, 1e-3) ? a : b));
    L.l.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0));
    L.l.color.set(color);
    L.t = 0; L.dur = dur; L.peak = peak;
  }

  // Skott ur en pipa: flamma, tjock krutrök som ligger kvar och driver, ljusblixt.
  muzzle(pos, dir, big = false) {
    this.emit('flash', pos, { size: big ? 0.16 : 0.08, grow: 1.8, life: 0.1, rise: 0, opacity: 1 });
    this.emit('fire', pos.clone().addScaledVector(dir, 0.04), { n: big ? 3 : 1, size: big ? 0.12 : 0.06, grow: 2, life: 0.16, rise: 0, vel: dir.clone().multiplyScalar(0.6), opacity: 0.9 });
    this.emit('smoke', pos, { n: big ? 6 : 3, size: big ? 0.1 : 0.06, grow: 4, life: big ? 3.2 : 2.2, rise: 0.08, vel: dir.clone().multiplyScalar(big ? 0.35 : 0.22), opacity: 0.6, spread: 0.04 });
    this.flash(pos, big ? 3 : 1.6, big ? 0.14 : 0.08);
  }

  // Spårljus: en ljuspunkt som far från pipan mot målet.
  tracer(from, to) {
    const d = to.clone().sub(from);
    const len = d.length();
    this.emit('spark', from, { size: 0.025, grow: 1, life: Math.min(0.25, len / 6), rise: 0, vel: d.multiplyScalar(1 / Math.min(0.25, len / 6)), opacity: 1, spread: 0.01, stretch: 3 });
  }

  // Granatnedslag: eldklot i lager, splitter, dammring, rökpelare, blixt och skak.
  explosion(pos, big = 1) {
    const p = pos.clone().setY(0.03);
    this.emit('flash', p.clone().setY(0.08), { size: 0.22 * big, grow: 2.2, life: 0.12, rise: 0, opacity: 1 });
    this.emit('fire', p.clone().setY(0.06), { n: Math.round(7 * big), size: 0.17 * big, grow: 2.8, life: 0.65, rise: 0.45, spread: 0.12 * big, opacity: 0.95 });
    setTimeout(() => this.emit('fire', p.clone().setY(0.12), { n: Math.round(4 * big), size: 0.12 * big, grow: 3, life: 0.8, rise: 0.6, spread: 0.1 * big, opacity: 0.8 }), 90);
    this.emit('spark', p.clone().setY(0.05), { n: Math.round(10 * big), size: 0.02, grow: 0.6, life: 0.9, rise: 0, spread: 0.04, gravity: 2.4, vel: new THREE.Vector3(0, 1.1, 0), opacity: 1 });
    for (let i = 0; i < Math.round(6 * big); i++) {                           // splitter åt alla håll
      const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 0.8;
      this.emit('dark', p.clone().setY(0.05), { size: 0.018, grow: 1, life: 0.8, rise: 0, gravity: 3, vel: new THREE.Vector3(Math.cos(a) * sp, 0.8 + Math.random(), Math.sin(a) * sp), opacity: 0.95, wind: false });
    }
    for (let i = 0; i < 8; i++) {                                              // dammring längs marken
      const a = (i / 8) * Math.PI * 2;
      this.emit('dust', p, { size: 0.07 * big, grow: 3, life: 1.4, rise: 0.02, vel: new THREE.Vector3(Math.cos(a) * 0.35 * big, 0.03, Math.sin(a) * 0.35 * big), opacity: 0.5 });
    }
    this.emit('dark', p.clone().setY(0.1), { n: Math.round(8 * big), size: 0.14 * big, grow: 4.5, life: 5, rise: 0.36, spread: 0.12 * big, opacity: 0.72 });
    this.emit('smoke', p.clone().setY(0.25), { n: Math.round(4 * big), size: 0.16 * big, grow: 4, life: 6, rise: 0.3, spread: 0.15 * big, opacity: 0.45, tint: 0x9a948c });
    this.flash(p, 5 * big, 0.22, 0xff8a30);
    this.world.shake = Math.max(this.world.shake, 0.014 * big);
  }

  dust(pos, size = 0.06) {
    this.emit('dust', pos, { n: 2, size, grow: 2.4, life: 0.8, rise: 0.04, spread: 0.06, opacity: 0.45 });
  }

  // En brand som ligger kvar: flämtande lågor och en rökpelare under `sec` sekunder (spelets tid).
  burn(pos, { sec = 25, size = 1 } = {}) {
    if (this.burns.length > 26) this.burns.shift();
    this.burns.push({ p: pos.clone().setY(0.015), sec, size, t: 0, acc: 0, accS: 0 });
  }

  clearBurns() { this.burns = []; }

  // Svagt flämtande sken från en brand (använder ljuspoolen bara när ett ljus är ledigt).
  flicker(pos, peak) {
    const free = this.lights.find((L) => L.dur <= 0);
    if (!free) return;
    free.l.position.copy(pos).add(new THREE.Vector3(0, 0.2, 0));
    free.l.color.set(0xff7a28);
    free.t = 0; free.dur = 0.35; free.peak = peak;
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { this.scene.remove(p.s); this.pool.push(p.s); this.live.splice(i, 1); continue; }
      if (p.gravity) p.v.y -= p.gravity * dt;
      if (p.wind) p.v.addScaledVector(WIND, dt * 0.8);
      p.s.position.addScaledVector(p.v, dt);
      if (p.s.position.y < 0.005 && p.gravity) { p.s.position.y = 0.005; p.v.multiplyScalar(0.3); }
      if (!p.gravity) p.v.multiplyScalar(Math.pow(0.45, dt));
      const sc = p.size * (1 + (p.grow - 1) * Math.sqrt(k));
      p.s.scale.set(sc, sc * (p.stretch > 1 ? 1 : 1), 1);
      p.s.material.opacity = p.opacity * (1 - k) * Math.min(1, k * 8);
      p.s.material.rotation += p.spin * dt;
    }
    // bränder som ligger kvar
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i];
      b.t += dt;
      if (b.t >= b.sec) { this.burns.splice(i, 1); continue; }
      const fade = Math.min(1, (b.sec - b.t) / 4) * Math.min(1, b.t * 2);
      b.acc += dt; b.accS += dt;
      if (b.acc > 0.06) {
        b.acc = 0;
        // flera små härdar som flämtar
        for (let k = 0; k < 2; k++) {
          const off = new THREE.Vector3((Math.random() - 0.5) * 0.2 * b.size, 0, (Math.random() - 0.5) * 0.2 * b.size);
          this.emit('fire', b.p.clone().add(off), { size: 0.085 * b.size * fade, grow: 1.8, life: 0.55, rise: 0.18, spread: 0.02, opacity: 0.9 * fade });
        }
      }
      if (b.accS > 0.16) {
        b.accS = 0;
        // rökpelaren: svart nertill, grå högre upp
        this.emit('dark', b.p.clone().setY(0.1), { size: 0.1 * b.size, grow: 5.5, life: 6, rise: 0.3, spread: 0.05, opacity: 0.6 * fade });
        if (Math.random() < 0.5) this.emit('smoke', b.p.clone().setY(0.45 * b.size), { size: 0.14 * b.size, grow: 5, life: 7, rise: 0.25, spread: 0.08, opacity: 0.3 * fade, tint: 0x8f8a84 });
      }
      if (Math.random() < dt * 6) this.flicker(b.p, 0.6 * b.size * fade);
    }
    for (const L of this.lights) {
      if (L.dur <= 0) continue;
      L.t += dt;
      const k = L.t / L.dur;
      L.l.intensity = k >= 1 ? 0 : L.peak * (1 - k) * (0.8 + Math.random() * 0.4);
      if (k >= 1) L.dur = 0;
    }
  }
}
