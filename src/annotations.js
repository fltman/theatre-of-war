// Fettkritspilar på kartan: varje erövring ritas som en vaxig pil i angriparens färg, som i ett riktigt krigsrum.
// Äldre pilar bleknar; kartan blir krigets dagbok. Ett genomskinligt canvaslager strax ovanför laveringen.
import * as THREE from 'three';
import { FACTION } from '../shared/factions.js';
import { MARGIN } from './mapcanvas.js';

const MAX = 60;

export class Annotations {
  constructor(world, board, size = 4096) {
    this.board = board;
    this.W = board.W + MARGIN * 2;
    this.H = board.H + MARGIN * 2;
    this.c = document.createElement('canvas');
    this.c.width = size;
    this.c.height = Math.round((size * this.H) / this.W);
    this.g = this.c.getContext('2d');
    this.S = size / this.W;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(this.W, this.H);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.tex, transparent: true, depthWrite: false, roughness: 0.45, metalness: 0 }));
    mesh.position.y = 0.0045;
    mesh.renderOrder = 2;
    mesh.receiveShadow = true;
    board.group.add(mesh);
    this.arrows = [];
  }

  clear() { this.arrows = []; this.stains = []; this.soot = []; this.draw(); }

  // Sot där det brunnit (svagt, flera lager).
  scorch(pos) {
    (this.soot ??= []).push({ x: pos.x + (Math.random() - 0.5) * 0.2, z: pos.z + (Math.random() - 0.5) * 0.2, r: 0.12 + Math.random() * 0.1 });
    if (this.soot.length > 40) this.soot.shift();
    this.draw();
  }

  // Kaffering: kriget drar ut på tiden och muggarna ställs på kartan.
  stain() {
    (this.stains ??= []).push({ x: (Math.random() - 0.5) * this.W * 0.9, z: (Math.random() - 0.5) * this.H * 0.85, r: 0.35 + Math.random() * 0.25, seed: Math.random() * 100 });
    this.draw();
  }

  // Pil från a till b (Vector3 i världen), i fraktionens färg. dashed = misslyckat anfall.
  arrow(a, b, faction, { dashed = false } = {}) {
    const col = new THREE.Color(FACTION[faction].paint).multiplyScalar(0.78);
    this.arrows.push({ a: [a.x, a.z], b: [b.x, b.z], color: '#' + col.getHexString(), dashed, seed: Math.random() * 1000 });
    if (this.arrows.length > MAX) this.arrows.shift();
    this.draw();
  }

  draw() {
    const { g, c } = this;
    g.clearRect(0, 0, c.width, c.height);
    const X = (x) => (x + this.W / 2) * this.S, Y = (z) => (z + this.H / 2) * this.S;
    for (const st of this.stains ?? []) {
      const x = X(st.x), y = Y(st.z), R = st.r * this.S;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.ellipse(x + k * 3, y, R * (1 - k * 0.015), R * (0.96 - k * 0.012), st.seed, 0.4 + k, Math.PI * 2 - 0.5 + k * 0.4);
        g.strokeStyle = `rgba(110,64,24,${0.3 - k * 0.07})`; g.lineWidth = this.S * (0.03 - k * 0.007); g.stroke();
      }
      const gr = g.createRadialGradient(x, y, R * 0.2, x, y, R);
      gr.addColorStop(0, 'rgba(140,90,40,0.05)'); gr.addColorStop(1, 'rgba(140,90,40,0.14)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, R * 0.97, 0, Math.PI * 2); g.fill();
    }
    for (const so of this.soot ?? []) {
      const x = X(so.x), y = Y(so.z), R = so.r * this.S;
      for (let k = 0; k < 4; k++) {
        const ox = (Math.sin(k * 2.3 + so.x) * 0.3) * R, oy = (Math.cos(k * 1.7 + so.z) * 0.3) * R;
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, R * (0.6 + k * 0.15));
        gr.addColorStop(0, 'rgba(30,22,15,0.16)'); gr.addColorStop(1, 'rgba(30,22,15,0)');
        g.fillStyle = gr; g.fillRect(x + ox - R, y + oy - R, R * 2, R * 2);
      }
    }
    const n = this.arrows.length;
    this.arrows.forEach((ar, i) => {
      const age = n - 1 - i;
      const alpha = Math.max(0.12, 0.9 - age * 0.022);
      let s = ar.seed;
      const rnd = () => ((s = (s * 16807 + 11) % 2147483647) / 2147483647);
      const [ax, az] = ar.a, [bx, bz] = ar.b;
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.05) return;
      // börja och sluta en bit från arméplatserna, lätt båge
      const ux = dx / len, uz = dz / len;
      const p0 = [ax + ux * 0.22, az + uz * 0.22], p1 = [bx - ux * 0.18, bz - uz * 0.18];
      const bend = Math.min(0.5, len * 0.18) * (rnd() < 0.5 ? -1 : 1);
      const cx = (p0[0] + p1[0]) / 2 - uz * bend, cz = (p0[1] + p1[1]) / 2 + ux * bend;
      const pt = (t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * cx + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * cz + t * t * p1[1]];
      g.lineCap = 'round'; g.lineJoin = 'round';
      // vaxkrita: flera tunna, något förskjutna drag med ojämn täckning
      for (let pass = 0; pass < 3; pass++) {
        g.beginPath();
        const off = (rnd() - 0.5) * 0.012;
        const steps = Math.max(12, Math.floor(len * 30));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          if (ar.dashed && Math.floor(t * len * 9) % 2) { const [x, z] = pt(t); g.moveTo(X(x + off), Y(z + off)); continue; }
          const [x, z] = pt(t);
          const j = (rnd() - 0.5) * 0.006;
          k === 0 ? g.moveTo(X(x + off + j), Y(z + off + j)) : g.lineTo(X(x + off + j), Y(z + off + j));
        }
        g.strokeStyle = ar.color;
        g.globalAlpha = alpha * (0.55 + rnd() * 0.25);
        g.lineWidth = this.S * (0.075 - pass * 0.015);
        g.stroke();
      }
      // pilspets
      const [ex, ez] = pt(1), [qx, qz] = pt(0.9);
      const ang = Math.atan2(ez - qz, ex - qx);
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(X(ex), Y(ez));
        g.lineTo(X(ex - Math.cos(ang + side * 0.5) * 0.3), Y(ez - Math.sin(ang + side * 0.5) * 0.3));
        g.globalAlpha = alpha * 0.75;
        g.lineWidth = this.S * 0.07;
        g.stroke();
      }
      g.globalAlpha = 1;
    });
    this.tex.needsUpdate = true;
  }
}
