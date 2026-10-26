// Rekvisitan runt kartan: tv:n och radion (som kameran åker fram till), bankirlampan, telefonen, askkoppen med
// rykande cigarr, kaffekoppen, bläckhornet och krupiärräfsan. Tv-rutan och radioskalan ritas av spelet.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { node } from './units.js';
import { tween, ease } from './anim.js';

// Placering på bordet (x, z, vridning kring y). Kartan täcker x ±12,6 och z ±6,5.
const PLACE = {
  tv: [-15.6, -8.6, 0.5], radio: [15.4, -9.4, -0.42],
  lamp: [-17.4, 1.2, 0.75], phone: [17.9, -5.9, -0.9], ashtray: [13.1, -7.3, 0.3], cup: [-15.8, 8.4, 0.2],
  inkwell: [-14.6, -2.6, 0.4], rake: [2.5, 9.6, 0.06],
};
const STATIONS = ['OSLO', 'HILVERSUM', 'PARIS', 'ROMA', 'WORLD SERVICE', 'PRAHA', 'WIEN', 'MOSKVA', 'STOCKHOLM'];

export class Props {
  constructor(world, fx) {
    this.world = world;
    this.fx = fx;
    this.group = new THREE.Group();
    world.scene.add(this.group);
    this.tv = null; this.radio = null;
  }

  async load() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const get = (n) => loader.loadAsync(new URL(`models/${n}.glb`, document.baseURI).href).then((g) => g.scene).catch(() => null);
    const [tv, radio, props] = await Promise.all([get('tv'), get('radio'), get('props')]);
    const place = (o, key) => {
      const [x, z, r] = PLACE[key];
      o.position.set(x, o.position.y, z);
      o.rotation.y = r;
      o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      this.group.add(o);
    };
    if (tv) { place(tv, 'tv'); this.tv = tv; this.setupTV(); }
    if (radio) { place(radio, 'radio'); this.radio = radio; this.setupRadio(); }
    if (props) {
      for (const key of ['lamp', 'phone', 'ashtray', 'cup', 'inkwell', 'rake']) {
        const o = props.getObjectByName(key);
        if (!o) continue;
        o.position.set(0, 0, 0);
        place(o, key);
        this[key] = o;
      }
      this.setupLamp();
      this.setupAshtray();
    }
  }

  setupLamp() {
    // skärmens opalglas lyser varmt inifrån
    this.lamp?.traverse((m) => {
      if (m.isMesh && /^Opal/.test(m.material?.name ?? '')) { m.material = m.material.clone(); m.material.emissive = new THREE.Color(0xfff0d0); m.material.emissiveIntensity = 1.4; }
    });
    const bulb = this.lamp && node(this.lamp, 'bulb');
    if (!bulb) return;
    const l = new THREE.PointLight(0xffc27a, 6, 9, 2);
    bulb.add(l);
  }

  // Cigarren ryker: en tunn, svajande slinga av täta, svaga puffar som vidgas uppåt; glöden pulserar.
  setupAshtray() {
    const smoke = this.ashtray && node(this.ashtray, 'smoke');
    if (!smoke) return;
    let ember = null, emberMesh = null;
    this.ashtray.traverse((m) => { if (m.isMesh && /Ember/i.test(m.material?.name ?? '')) { m.material = m.material.clone(); ember = m.material; emberMesh = m; } });
    if (ember) { ember.color = new THREE.Color(0x2a1a14); ember.emissive = new THREE.Color(0xff3d0a); ember.emissiveIntensity = 1.2; }
    // röken stiger från glöden (glödmeshens mitt), inte från noden
    const emberAt = () => {
      if (!emberMesh) return smoke.getWorldPosition(new THREE.Vector3());
      emberMesh.geometry.computeBoundingBox();
      return emberMesh.localToWorld(emberMesh.geometry.boundingBox.getCenter(new THREE.Vector3())).add(new THREE.Vector3(0, 0.02, 0));
    };
    let t = 0, acc = 0;
    this.world.addUpdater((dt) => {
      t += dt; acc += dt;
      if (ember) ember.emissiveIntensity = 1.0 + Math.sin(t * 0.9) * 0.45 + Math.sin(t * 5.3) * 0.12;
      if (acc < 0.045) return;
      acc = 0;
      const p = emberAt();
      const sway = Math.sin(t * 1.3) * 0.05 + Math.sin(t * 3.1) * 0.02;
      this.fx.emit('smoke', p, {
        size: 0.035, grow: 7, life: 5.5, spread: 0.004, opacity: 0.24, tint: 0xc4ccd6,
        vel: new THREE.Vector3(sway, 0.34, Math.cos(t * 1.1) * 0.03),
      });
    });
  }

  // ------------------------------------------------------------ tv

  setupTV() {
    const screen = (this.screen = node(this.tv, 'screen'));
    this.tvCam = node(this.tv, 'cam');
    this.card = document.createElement('canvas');
    this.card.width = 1024; this.card.height = 768;
    this.cardTex = new THREE.CanvasTexture(this.card);
    this.cardTex.colorSpace = THREE.SRGBColorSpace;
    this.cardTex.flipY = false;
    this.live = new THREE.WebGLRenderTarget(400, 300, { colorSpace: THREE.SRGBColorSpace });
    this.liveCam = new THREE.PerspectiveCamera(38, 4 / 3, 0.1, 100);
    this.screenMat = new THREE.ShaderMaterial({
      uniforms: {
        uCard: { value: this.cardTex }, uLive: { value: this.live.texture }, uMix: { value: 0 },
        uOn: { value: 0 }, uTime: { value: 0 }, uFlicker: { value: 1 },
      },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uCard, uLive; uniform float uMix, uOn, uTime, uFlicker;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;                                     // glTF: v nedåt, samma som canvasen
          vec2 c = uv - 0.5;
          uv = 0.5 + c * (1.0 + dot(c, c) * 0.12);           // välvt glas
          vec3 card = texture2D(uCard, uv).rgb;
          vec3 live = texture2D(uLive, vec2(uv.x, 1.0 - uv.y)).rgb;
          float lum = dot(mix(card, live, uMix), vec3(0.299, 0.587, 0.114));
          lum = pow(lum, 0.9) * 1.1;
          float scan = 0.88 + 0.12 * sin(uv.y * 900.0);
          float grain = (hash(uv * 800.0 + uTime) - 0.5) * 0.12;
          float flick = 1.0 - uFlicker * 0.05 * hash(vec2(floor(uTime * 24.0), 1.0));
          float vig = smoothstep(0.75, 0.25, length(c * vec2(1.0, 1.15)));
          // påslagning: en ljus prick som växer till en ruta
          float warm = smoothstep(0.0, 1.0, uOn);
          float dotMask = smoothstep(0.02 + warm * 0.9, warm * 0.85, length(c * vec2(1.0, 1.3 - warm * 0.3)));
          vec3 col = vec3(lum * scan * flick + grain) * vec3(0.92, 1.0, 1.04) * vig;
          col = mix(vec3(0.03, 0.035, 0.04), col, dotMask * min(1.0, uOn * 1.2));
          if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) col = vec3(0.02);
          gl_FragColor = vec4(col * (0.4 + 1.6 * uOn), 1.0);
        }`,
    });
    if (screen) screen.material = this.screenMat;
    this.world.addUpdater((dt, t) => { this.screenMat.uniforms.uTime.value = t; });
  }

  // Slå på/av tv:n (CRT-uppvärmning).
  tvPower(on) {
    const u = this.screenMat?.uniforms;
    if (!u) return Promise.resolve();
    return tween(on ? 0.8 : 0.35, (k) => { u.uOn.value = on ? k : 1 - k; }, on ? ease.out : ease.in);
  }

  // Ritfunktion för journalfilmskort: draw(ctx, w, h) anropas varje bild medan kortet visas.
  tvCard(draw) {
    this.cardDraw = draw;
    this.screenMat.uniforms.uMix.value = 0;
    if (!this.cardUpdater) {
      this.cardUpdater = this.world.addUpdater((dt, t) => {
        if (!this.cardDraw) return;
        this.cardDraw(this.card.getContext('2d'), this.card.width, this.card.height, t);
        this.cardTex.needsUpdate = true;
      });
    }
  }

  // Direktsändning: en långsam kameraåkning över slagfältet renderas till en liten bild (footCanvas, ~15 bilder/s)
  // som journalfilmskorten ritar svartvit med filmskador.
  tvLive(target, from) {
    const cam = this.liveCam;
    const dir = from ? target.clone().sub(from).setY(0).normalize() : new THREE.Vector3(0, 0, -1);
    if (dir.lengthSq() < 0.5) dir.set(0, 0, -1);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    if (side.z < 0) side.negate();
    const W = this.live.width, H = this.live.height;
    this.footCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = this.footCanvas.getContext('2d');
    const img = g.createImageData(W, H);
    const px = new Uint8Array(W * H * 4);
    let t = 0, acc = 1;
    this.liveOff?.();
    this.liveOff = this.world.addUpdater((dt) => {
      t += dt; acc += dt;
      if (acc < 1 / 15) return;
      acc = 0;
      const p = target.clone().addScaledVector(side, 1.25 - t * 0.07).addScaledVector(dir, -0.95).add(new THREE.Vector3(0, 0.62 + t * 0.015, 0));
      cam.position.copy(p);
      cam.lookAt(target.x + dir.x * 0.2, 0.06, target.z + dir.z * 0.2);
      const r = this.world.renderer, old = r.getRenderTarget();
      r.setRenderTarget(this.live);
      r.render(this.world.scene, cam);
      r.readRenderTargetPixels(this.live, 0, 0, W, H, px);
      r.setRenderTarget(old);
      for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      g.putImageData(img, 0, 0);
    });
  }

  tvStop() { this.liveOff?.(); this.liveOff = null; this.cardDraw = null; }

  // ------------------------------------------------------------ radio

  setupRadio() {
    const dial = node(this.radio, 'dial');
    this.needle = node(this.radio, 'needle');
    this.radioCam = node(this.radio, 'cam');
    const c = (this.dialCanvas = document.createElement('canvas'));
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#efe2bd'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#3a2a18'; g.lineWidth = 3; g.strokeRect(10, 10, c.width - 20, c.height - 20);
    for (let i = 0; i <= 100; i++) {
      const x = 40 + (i / 100) * (c.width - 80);
      g.beginPath(); g.moveTo(x, 200); g.lineTo(x, i % 10 ? 214 : 228); g.lineWidth = i % 10 ? 1.5 : 3; g.stroke();
    }
    g.font = '600 22px Oswald, sans-serif'; g.fillStyle = '#3a2a18'; g.textAlign = 'center';
    STATIONS.forEach((s, i) => {
      const x = 70 + (i / (STATIONS.length - 1)) * (c.width - 140);
      g.save(); g.translate(x, 110 + (i % 2) * 52); g.fillStyle = s === 'WORLD SERVICE' ? '#a3221b' : '#3a2a18'; g.fillText(s, 0, 0); g.restore();
    });
    g.font = 'italic 18px "Old Standard TT", serif'; g.fillStyle = '#5a4630';
    g.fillText('M E D I U M   W A V E', c.width / 2, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    this.dialMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffb35c), emissiveIntensity: 0.05, roughness: 0.25 });
    if (dial) dial.material = this.dialMat;
    // skalans varma sken på bordet framför radion (ljuset finns från början; intensiteten styrs)
    this.spill = new THREE.PointLight(0xffb060, 0, 4.5, 2);
    this.spill.position.set(0, 1.9, 1.6);
    this.radio.add(this.spill);
    this.world.addUpdater((dt, t) => {
      if (!this.radioLive) return;
      const lv = this.audio?.level() ?? 0;
      const flick = 1 + Math.sin(t * 31) * 0.02 + Math.sin(t * 7.3) * 0.03;
      this.dialMat.emissiveIntensity = (1.45 + lv * 0.7) * flick;
      if (this.eye) this.eye.emissiveIntensity = 1.6 + lv * 5;
      this.spill.intensity = (0.7 + lv * 1.6) * flick;
    });
    this.eye = null;
    this.radio.traverse((m) => { if (m.isMesh && m.material?.name === 'Eye') { m.material = m.material.clone(); this.eye = m.material; this.eye.emissive = new THREE.Color(0x40ff70); this.eye.emissiveIntensity = 0; } });
  }

  // Slå på radion: skalan glöder, nålen letar sig fram till stationen (0…1 längs skalan).
  async radioOn(on, station = 0.5) {
    if (!this.dialMat) return;
    this.radioLive = false;
    const from = this.dialMat.emissiveIntensity;
    await tween(on ? 0.6 : 0.4, (k) => {
      this.dialMat.emissiveIntensity = from + ((on ? 1.6 : 0.05) - from) * k;
      if (this.eye) this.eye.emissiveIntensity = on ? k * 2.5 : (1 - k) * 2.5;
    });
    if (!on && this.spill) this.spill.intensity = 0;
    if (on && this.needle) {
      const x0 = this.needle.position.x, x1 = -1.75 + station * 3.5;
      // nålen letar: förbi stationen, tillbaka, och fram till den
      await tween(1.6, (k) => { this.needle.position.x = x0 + (x1 - x0) * k + Math.sin(k * 11) * 0.22 * (1 - k); }, ease.out);
    }
    if (on) this.radioLive = true;
  }
}

// Radions tagningar i dess egna koordinater (framsidan = +Z, origo under mitten): [kamera från, kamera till, mål].
export const RADIO_SHOTS = {
  establish: [[-4.6, 2.7, 6.6], [-3.7, 2.35, 5.7], [0, 1.3, 0]],
  dial: [[0.9, 2.2, 2.9], [0.35, 2.1, 2.35], [0, 2.05, 0.9]],
  low: [[-2.4, 0.75, 6.0], [-1.7, 0.85, 5.2], [0, 1.5, 0]],
  close: [[3.9, 1.7, 4.6], [4.8, 2.3, 6.2], [0, 1.2, 0]],
};

// Var på skalan stationen ligger (världsstationen i rött).
export const WORLD_SERVICE = (STATIONS.indexOf('WORLD SERVICE')) / (STATIONS.length - 1);

// Tv-bilden: kameran ramar in BILDRUTAN (inte hela apparaten med antennen). fill = hur stor del av bildhöjden rutan tar.
export function screenShot(tv, screen, { fov = 30, fill = 0.72, side = 0.12 } = {}) {
  const box = new THREE.Box3().setFromObject(screen);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(tv.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const h = Math.max(size.y, Math.hypot(size.x, size.z) * 0.75);
  const d = (h / fill) / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const target = c.clone().add(new THREE.Vector3(0, -h * 0.06, 0));        // lite under mitten: rutan ovanför undertexten
  const at = (k, s2) => c.clone().addScaledVector(fwd, d * k).addScaledVector(right, d * s2).add(new THREE.Vector3(0, h * 0.04, 0));
  return { from: at(1.3, side * 1.6), to: at(1.0, side), target };
}
