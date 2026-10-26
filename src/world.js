// Renderare, rum, ljus, bord och efterbehandling. Krigsrummet: mörkt, en varm taklampa över kartan,
// svalt fönsterljus från sidan, tiltshift-skärpa när kameran går nära (tennsoldaterna ska kännas små).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset,
  VignetteEffect, DepthOfFieldEffect, BrightnessContrastEffect, HueSaturationEffect, NoiseEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { tier } from './quality.js';

export const TABLE = { w: 40, d: 27, top: -0.012 };
// Översiktsbilden: hela kartan, lätt snett uppifrån.
export const OVERVIEW = { pos: new THREE.Vector3(0, 25.5, 16.5), target: new THREE.Vector3(0, 0, 0.7) };

// Persienner: ljusa ränder med mjuka kanter (spotlightens projicerade textur).
function blinds() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14; i++) {
    const y = 20 + i * 34;
    const gr = g.createLinearGradient(0, y, 0, y + 22);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.25, '#fff'); gr.addColorStop(0.75, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(40, y, 432, 22);
  }
  // fönsterposten
  g.fillStyle = '#000'; g.fillRect(250, 0, 12, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }));
    this.dpr = Math.min(window.devicePixelRatio, tier.dprMax);
    r.setPixelRatio(this.dpr);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0907);
    this.scene.fog = new THREE.Fog(0x0b0907, 38, 70);
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    this.camera.position.copy(OVERVIEW.pos);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(OVERVIEW.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 34;
    this.controls.maxPolarAngle = 1.25;
    this.controls.screenSpacePanning = false;

    this.timer = new THREE.Timer();
    this.updaters = new Set();
    this.timeScale = 1;
    this.shake = 0;

    this.setupLights();
    this.setupTable();
    this.setupDust();
    this.setupPost();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setupLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x4a5260, 0x140e08, 0.12));
    // taklampan: varm, bred kon, mjuka skuggor över hela kartan
    const key = (this.key = new THREE.SpotLight(0xffd29a, 1900, 0, 0.42, 0.9, 2));
    key.position.set(-2.0, 30, 7);
    key.target.position.set(0, 0, 0.5);
    key.castShadow = true;
    key.shadow.mapSize.set(tier.shadow, tier.shadow);
    key.shadow.camera.near = 18;
    key.shadow.camera.far = 45;
    key.shadow.bias = -0.00006;
    key.shadow.normalBias = 0.012;
    key.shadow.radius = 3;
    s.add(key, key.target);
    // fönstret: svalt sidoljus genom persienner (projicerad ränd-textur), låg vinkel så att figurerna får kanter
    const win = (this.window = new THREE.SpotLight(0xb7c8e6, 260, 0, 0.42, 0.35, 1.6));
    win.position.set(30, 13, -6);
    win.target.position.set(4, 0, 0.5);
    win.map = blinds();
    win.castShadow = true;
    win.shadow.mapSize.set(1024, 1024);
    win.shadow.bias = -0.0002;
    s.add(win, win.target);
    // lågt varmt motljus som lyfter silhuetterna
    const rim = new THREE.DirectionalLight(0xffb070, 0.35);
    rim.position.set(-14, 5, -16);
    s.add(rim);
  }

  // Dammkorn som svävar i taklampans ljus.
  setupDust() {
    const n = 420;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 22; pos[i * 3 + 1] = 0.5 + Math.random() * 5; pos[i * 3 + 2] = (Math.random() - 0.5) * 14; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,240,215,1)'); gr.addColorStop(1, 'rgba(255,240,215,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    const mat = new THREE.PointsMaterial({ size: 0.028, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd9a8 });
    const dust = new THREE.Points(geo, mat);
    this.scene.add(dust);
    this.addUpdater((dt, t) => {
      const a = geo.attributes.position.array;
      for (let i = 0; i < n; i++) {
        a[i * 3] += Math.sin(t * 0.21 + i) * dt * 0.05;
        a[i * 3 + 1] += (Math.sin(t * 0.13 + i * 1.7) * 0.03 - 0.008) * dt;
        a[i * 3 + 2] += Math.cos(t * 0.17 + i * 0.7) * dt * 0.05;
        if (a[i * 3 + 1] < 0.3) a[i * 3 + 1] = 5.5;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }

  setupTable() {
    // Mörkt valnötsbord med träådring ritad på canvas (Poly Haven-trä kan bytas in senare).
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#3a2416';
    g.fillRect(0, 0, c.width, c.height);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      const y = rnd() * c.height, a = 0.03 + rnd() * 0.07, w = 1 + rnd() * 3;
      g.strokeStyle = rnd() < 0.5 ? `rgba(20,10,4,${a})` : `rgba(120,70,35,${a * 0.8})`;
      g.lineWidth = w;
      g.beginPath();
      const f = 0.002 + rnd() * 0.004, ph = rnd() * 6, amp = 2 + rnd() * 10;
      for (let x = 0; x <= c.width; x += 16) g.lineTo(x, y + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.3);
      g.stroke();
    }
    // plankfogar
    for (let k = 1; k < 4; k++) { g.fillStyle = 'rgba(8,4,2,0.55)'; g.fillRect(0, (k * c.height) / 4 - 1, c.width, 3); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.4, 1.4);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0, envMapIntensity: 0.6 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.w, 0.8, TABLE.d), mat);
    top.position.y = TABLE.top - 0.4;
    top.receiveShadow = true;
    this.scene.add(top);
    // golv långt under, så att mörkret har något att landa på
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x120d09, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -8;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  setupPost() {
    const r = this.renderer;
    const composer = (this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    composer.addPass(new RenderPass(this.scene, this.camera));
    const ao = (this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1));
    ao.configuration.aoRadius = 0.35;
    ao.configuration.distanceFalloff = 0.6;
    ao.configuration.intensity = 2.2;
    ao.configuration.color = new THREE.Color(0x0b0806);
    ao.setQualityMode(tier.ao);
    ao.configuration.halfRes = tier.aoHalf;
    composer.addPass(ao);
    this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 20, focusRange: 8, bokehScale: 0, resolutionScale: 0.5 });
    this.dof.target = new THREE.Vector3();
    this.dofPass = new EffectPass(this.camera, this.dof);
    composer.addPass(this.dofPass);
    this.bloom = new BloomEffect({ intensity: 0.7, luminanceThreshold: 0.95, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.7 });
    this.vignette = new VignetteEffect({ offset: 0.18, darkness: 0.72 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new HueSaturationEffect({ saturation: -0.08 });
    const bc = new BrightnessContrastEffect({ contrast: 0.14, brightness: -0.02 });
    this.grain = new NoiseEffect({ blendFunction: BlendFunction.SOFT_LIGHT, premultiply: false });
    this.grain.blendMode.opacity.value = 0.16;
    composer.addPass(new EffectPass(this.camera, this.bloom, tone, this.grade, bc, this.vignette, this.grain));
    composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset[tier.smaa] })));
    this.dofAmount = 0;
    this.dofGoal = 0;
  }

  // Taklampan flimrar (tungt nedslag): några snabba fall i intensitet.
  flicker() {
    const base = this.key.userData.base ?? (this.key.userData.base = this.key.intensity);
    let t = 0;
    const off = this.addUpdater((dt) => {
      t += dt;
      const k = t < 0.5 ? (Math.sin(t * 70) > 0.3 ? 0.55 : 1) * (0.8 + Math.random() * 0.2) : 1;
      this.key.intensity = base * k;
      if (t >= 0.5) { this.key.intensity = base; off(); }
    });
  }

  setFocus(point, amount = 1) {
    if (point) this.dof.target.copy(point);
    this.dofGoal = amount;
  }

  adaptResolution(now) {
    const a = (this.frameStats ||= { t0: now, n: 0 });
    a.n++;
    if (now - a.t0 < 1500) return;
    const ms = (now - a.t0) / a.n;
    a.t0 = now; a.n = 0;
    if (document.hidden) return;
    let d = this.dpr;
    if (ms > 24 && d > tier.dprMin) d = Math.max(tier.dprMin, d - 0.25);
    else if (ms < 13 && d < Math.min(window.devicePixelRatio, tier.dprMax)) d = Math.min(tier.dprMax, d + 0.25);
    if (d !== this.dpr) { this.dpr = d; this.renderer.setPixelRatio(d); this.resize(); }
  }

  addUpdater(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  // Rendera en bild till en canvas (tidningsfoto, tv-bild).
  snapshot(camera, w = 960, h = 720) {
    const rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
    const old = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, camera ?? this.camera);
    const px = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    this.renderer.setRenderTarget(old);
    rt.dispose();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const img = c.getContext('2d').createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }

  start() {
    const loop = () => {
      const now = performance.now();
      this.timer.update();
      const dt = Math.min(this.timer.getDelta(), 1 / 20) * this.timeScale;
      const t = this.timer.getElapsed();
      for (const fn of this.updaters) fn(dt, t);
      if (this.controls.enabled) this.controls.update();
      this.shakeOff ||= new THREE.Vector3();
      this.shakeAt ||= new THREE.Vector3(Infinity, 0, 0);
      if (this.camera.position.distanceToSquared(this.shakeAt) < 1e-12) this.camera.position.sub(this.shakeOff);
      this.shakeOff.set(0, 0, 0);
      if (this.shake > 0.001) {
        this.shakeOff.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, 0);
        this.camera.position.add(this.shakeOff);
        this.shake *= Math.pow(0.02, dt);
      }
      this.shakeAt.copy(this.camera.position);
      this.dofAmount += (this.dofGoal - this.dofAmount) * Math.min(1, dt * 3);
      this.dof.bokehScale = this.dofAmount * 1.6;      // återhållsamt: miniatyrkänsla, inte suddig spelplan
      this.dofPass.enabled = tier.dof && this.dofAmount > 0.02;
      this.adaptResolution(now);
      this.composer.render(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
