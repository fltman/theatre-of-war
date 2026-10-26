// Menyns liv: filmrutor med journalfilmsklipp som tonar in och ut runt dossiern, kameran glider långsamt över bordet
// och tv:n visar journalfilm. start() när menyn visas, stop() när kriget börjar.
import * as THREE from 'three';
import { drawReelCard } from './press/reel.js';

// Långsamma kameraåkningar över bordet: [från, till, mål] (enheter); varje åkning tar ~14 s.
const SHOTS = [
  [[-6, 7, 10], [4, 6.5, 9], [0, 0, -1]],
  [[-17, 6, -1], [-13, 5, 3], [-15.6, 2.2, -8.6]],          // tv:n
  [[8, 4, 6], [12, 4.5, 2], [6, 0, -2]],                    // Asien, lågt
  [[2, 9, 12], [-3, 10, 13], [0, 0, 0.5]],
  [[17, 5, -2], [13, 4.5, 1], [15.4, 1.4, -9.4]],          // radion
  [[-2, 3.2, 3.5], [1.5, 3.2, 3.2], [0.5, 0, -2.5]],        // Europa på nära håll
];

export class Attract {
  constructor({ world, rig, props, press, root }) {
    Object.assign(this, { world, rig, props, press, root });
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.layer = document.createElement('div');
    this.layer.className = 'reel-layer';
    this.root.prepend(this.layer);
    this.timers = [];
    this.shots();
    this.tv();
    this.spawn(600);
    this.spawn(3800);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.layer?.querySelectorAll('video').forEach((v) => v.pause());
    this.layer?.remove();
    this.tvVideo?.pause();
    this.props.tvStop();
    this.props.tvPower(false);
    this.world.controls.enabled = true;
    this.rig.job++;
  }

  clips() { return this.press.clips ?? []; }
  pick() {
    const c = this.clips();
    if (!c.length) return null;
    this.bag = (this.bag?.length ? this.bag : [...c].sort(() => Math.random() - 0.5));
    return this.bag.pop();
  }

  // Kameran: en åkning i taget, med jobbtoken (användaren eller kriget avbryter).
  async shots() {
    let i = Math.floor(Math.random() * SHOTS.length);
    while (this.running) {
      const [a, b, t] = SHOTS[i++ % SHOTS.length];
      const job = ++this.rig.job;
      const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), target = new THREE.Vector3(...t);
      this.world.controls.enabled = false;
      this.world.setFocus(target, 0.6);
      const sec = 14;
      let k = 0;
      await new Promise((res) => {
        const off = this.world.addUpdater((dt) => {
          if (!this.running || this.rig.job !== job) { off(); res(); return; }
          k = Math.min(1, k + dt / sec);
          const e = k * k * (3 - 2 * k);
          this.world.camera.position.lerpVectors(from, to, e);
          this.world.controls.target.copy(target);
          this.world.camera.lookAt(target);
          // tona mellan åkningarna med vinjetten
          if (k >= 1) { off(); res(); }
        });
      });
    }
  }

  // Tv:n på bordet visar klippen som journalfilm.
  async tv() {
    const P = this.props;
    if (!P.tv) return;
    await P.tvPower(true);
    const next = async () => {
      if (!this.running) return;
      const clip = this.pick();
      if (!clip) return;
      this.tvVideo?.pause();
      const v = await this.press.video(clip);
      if (!this.running) { v?.pause(); return; }
      this.tvVideo = v;
      const t0 = this.world.timer.getElapsed();
      const card = { kind: 'footage', text: '', duration: 9999 };
      P.tvCard((ctx, w, h, time) => drawReelCard(ctx, card, time - t0 + 1, { footage: v ?? undefined }));
      this.timers.push(setTimeout(next, 6500));
    };
    next();
  }

  // En filmruta som tonar in någonstans runt dossiern, spelar ett klipp och tonar ut.
  spawn(delay) {
    this.timers.push(setTimeout(async () => {
      if (!this.running) return;
      const clip = this.pick();
      if (!clip) return;
      const frame = document.createElement('div');
      frame.className = 'reel-frame';
      const narrow = innerWidth < 760;
      // vänster eller höger om dossiern (mobil: ovan eller under)
      const side = (this.side = !this.side);
      const w = narrow ? Math.min(innerWidth * 0.62, 300) : Math.min(innerWidth * 0.24, 380);
      const x = narrow ? (side ? 8 : innerWidth - w - 8) : side ? innerWidth * 0.04 + Math.random() * innerWidth * 0.06 : innerWidth * 0.96 - w - Math.random() * innerWidth * 0.06;
      const y = narrow ? (side ? 70 + Math.random() * 40 : innerHeight - w * 0.75 - 90) : innerHeight * (0.12 + Math.random() * 0.48);
      frame.style.cssText = `left:${x}px;top:${y}px;width:${w}px;--r:${(Math.random() - 0.5) * 8}deg`;
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.autoplay = true; v.loop = true;
      v.src = new URL(clip.file ?? `reel/${clip.id}.mp4`, document.baseURI).href;
      frame.append(v, Object.assign(document.createElement('i'), { className: 'grain' }));
      this.layer?.append(frame);
      v.play().catch(() => {});
      requestAnimationFrame(() => frame.classList.add('in'));
      const life = 5200 + Math.random() * 2000;
      this.timers.push(setTimeout(() => { frame.classList.remove('in'); frame.classList.add('out'); setTimeout(() => { v.pause(); frame.remove(); }, 1400); }, life));
      this.spawn(life - 1800 + Math.random() * 1200);
    }, delay));
  }
}
