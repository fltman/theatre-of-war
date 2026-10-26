// Tennsoldaterna: laddar Blender-modellerna (public/models) och målar dem i fraktionens färg. Saknas en modell
// används en enkel ersättare med samma nodnamn, så att spelet går att köra innan modellerna är klara.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FACTION } from '../shared/factions.js';
import { tier } from './quality.js';

export const KINDS = ['infantry', 'tank', 'artillery', 'ship', 'flag'];
const templates = {};

const shared = {
  Metal: new THREE.MeshStandardMaterial({ color: 0x4a4d50, metalness: 0.75, roughness: 0.42 }),
  Brass: new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 0.9, roughness: 0.3 }),
  Skin: new THREE.MeshStandardMaterial({ color: 0xd9a483, roughness: 0.6 }),
  Leather: new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.65 }),
  Dark: new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.55, metalness: 0.2 }),
  Base: new THREE.MeshStandardMaterial({ color: 0x4a4a2c, roughness: 0.8 }),
  Tread: new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.7, metalness: 0.4 }),
  Wood: new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.6 }),
  Glass: new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.5 }),
  Pin: new THREE.MeshStandardMaterial({ color: 0xb8b2a6, metalness: 0.9, roughness: 0.25 }),
};
const paints = {};
export function paint(faction) {
  if (!paints[faction]) {
    // satinlack på metall: lite glans, lätt metallisk underton
    paints[faction] = new THREE.MeshStandardMaterial({ color: new THREE.Color(FACTION[faction].paint), roughness: 0.48, metalness: 0.12 });
  }
  return paints[faction];
}

export async function loadUnits() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(KINDS.map(async (k) => {
    try {
      const lo = tier.name === 'low' ? '_lo' : '';
      const g = await loader.loadAsync(new URL(`models/${k}${lo}.glb`, document.baseURI).href)
        .catch(() => loader.loadAsync(new URL(`models/${k}.glb`, document.baseURI).href));
      templates[k] = g.scene;
      g.scene.userData.gltf = true;     // glTF: UV-origo upptill -> CanvasTexture.flipY = false
    } catch { templates[k] = placeholder(k); }
  }));
  for (const k of KINDS) templates[k].traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
}

// Modellerna har bakad data i COLOR_0: R = AO, G = krökning (0,5 plant, 1 skarp konvex kant), B = kavitet.
// GLTFLoader tror att det är färg och slår på vertexColors – det stängs av, och en egen shaderbit läser kanalerna:
// mörk wash i fördjupningar, AO, och på `Paint` sliten färg där tennet skiner igenom på kanterna (som förhandsbilderna).
const PEWTER = new THREE.Color('#9b9c98');
const WASH = new THREE.Color('#1b130c');
const dataMats = new Map();

function dataMaterial(src, { paint = null } = {}) {
  const key = src.uuid + (paint ?? '');
  if (dataMats.has(key)) return dataMats.get(key);
  const m = src.clone();
  m.vertexColors = false;
  if (paint) { m.color = new THREE.Color(FACTION[paint].paint); m.roughness = 0.42; m.metalness = 0.0; m.map = null; }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPewter = { value: PEWTER };
    sh.uniforms.uWash = { value: WASH };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 color;\nvarying vec3 vData;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvData = color;\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vData; varying vec3 vObj;
        uniform vec3 uPewter; uniform vec3 uWash;
        float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wear = 0.0;
        #ifdef PAINT_WEAR
          float nz = n3(vObj * 160.0) * 0.55 + n3(vObj * 480.0) * 0.3 + n3(vObj * 1300.0) * 0.15;
          // bara skarpa kanter nöts (lindornas och kappans veck har måttlig krökning över stora ytor och ska inte flagna)
          wear = smoothstep(0.72, 0.92, vData.g) * smoothstep(0.4, 0.7, nz);
          wear = smoothstep(0.3, 0.5, wear) * 0.9;
          diffuseColor.rgb = mix(diffuseColor.rgb, uPewter, wear);
        #endif
        diffuseColor.rgb = mix(diffuseColor.rgb, uWash, clamp(vData.b * 0.75, 0.0, 1.0));
        diffuseColor.rgb *= vData.r;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32, wear);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, wear);');
  };
  if (paint) m.defines = { ...(m.defines ?? {}), PAINT_WEAR: '' };
  m.customProgramCacheKey = () => (paint ? 'unit-paint' : 'unit-data');
  dataMats.set(key, m);
  return m;
}

export function makePiece(kind, faction) {
  const o = (templates[kind] ?? placeholder(kind)).clone(true);
  o.traverse((m) => {
    if (!m.isMesh) return;
    const baked = !!m.geometry.attributes.color;
    const swap = (mat) => {
      const name = mat?.name ?? '';
      if (baked) return dataMaterial(mat, { paint: name.startsWith('Paint') ? faction : null });
      // ersättarna (ingen bakad data): spelets enkla material
      if (name.startsWith('Paint')) return paint(faction);
      return shared[name] ?? mat;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
  o.userData.kind = kind;
  o.userData.gltf = !!templates[kind]?.userData.gltf;
  // inte alla soldater har mustasch
  if (kind === 'infantry') { const m = node(o, 'moustache'); if (m) m.visible = Math.random() < 0.55; }
  return o;
}

export const node = (o, name) => { let r = null; o.traverse((c) => { if (!r && c.name.replace(/[^A-Za-z0-9]/g, '') === name) r = c; }); return r; };

// ------------------------------------------------------------------ ersättare (samma mått och nodnamn som kontraktet)

function mesh(geo, matName, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  m.material.name = matName;
  m.position.set(x, y, z);
  return m;
}

function placeholder(kind) {
  const g = new THREE.Group();
  if (kind === 'infantry') {
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.052, 0.014, 20), 'Base', 0, 0.007, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.07, 10), 'Paint', 0, 0.05, 0));       // ben
    g.add(mesh(new THREE.CapsuleGeometry(0.028, 0.06, 4, 12), 'Paint', 0, 0.13, 0));          // kropp
    g.add(mesh(new THREE.SphereGeometry(0.021, 12, 10), 'Skin', 0, 0.2, 0.004));
    g.add(mesh(new THREE.SphereGeometry(0.027, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 'Paint', 0, 0.207, 0));
    const r = mesh(new THREE.BoxGeometry(0.008, 0.16, 0.01), 'Wood', 0.03, 0.17, -0.01);
    r.rotation.x = -0.25;
    g.add(r);
  } else if (kind === 'tank') {
    const hull = mesh(new THREE.BoxGeometry(0.16, 0.06, 0.28), 'Paint', 0, 0.06, 0); hull.name = 'hull'; g.add(hull);
    const tracks = mesh(new THREE.BoxGeometry(0.18, 0.05, 0.3), 'Tread', 0, 0.03, 0); tracks.name = 'tracks'; g.add(tracks);
    const turret = mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.045, 16), 'Paint', 0, 0.112, -0.01); turret.name = 'turret'; g.add(turret);
    const barrel = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8), 'Metal', 0, 0, 0.07);
    barrel.rotation.x = Math.PI / 2;
    const bp = new THREE.Group(); bp.name = 'barrel'; bp.position.set(0, 0.0, 0.045); bp.add(barrel); turret.add(bp);
  } else if (kind === 'artillery') {
    const car = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.22), 'Paint', 0, 0.04, -0.06); car.name = 'carriage'; g.add(car);
    for (const s of [-1, 1]) { const w = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), 'Dark', s * 0.07, 0.045, 0.02); w.rotation.z = Math.PI / 2; g.add(w); }
    g.add(mesh(new THREE.BoxGeometry(0.14, 0.07, 0.008), 'Paint', 0, 0.09, 0.05));
    const b = mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.2, 10), 'Metal', 0, 0, 0.08); b.rotation.x = Math.PI / 2;
    const bp = new THREE.Group(); bp.name = 'barrel'; bp.position.set(0, 0.07, 0.0); bp.add(b); g.add(bp);
  } else if (kind === 'ship') {
    const shape = new THREE.Shape();
    shape.moveTo(-0.07, -0.33); shape.lineTo(0.07, -0.33); shape.lineTo(0.075, 0.2); shape.quadraticCurveTo(0.04, 0.33, 0, 0.36);
    shape.quadraticCurveTo(-0.04, 0.33, -0.075, 0.2); shape.closePath();
    const hg = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false }); hg.rotateX(Math.PI / 2); hg.translate(0, 0.06, 0);
    const hull = mesh(hg, 'Dark'); hull.name = 'hull'; g.add(hull);
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.05, 0.16), 'Wood', 0, 0.085, -0.05));
    const f = mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.08, 12), 'Paint', 0, 0.15, -0.06); f.name = 'funnel'; g.add(f);
    const sm = new THREE.Object3D(); sm.name = 'smoke'; sm.position.set(0, 0.2, -0.06); g.add(sm);
  } else if (kind === 'flag') {
    const pin = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 6), 'Pin', 0, 0.25, 0); pin.name = 'pin'; g.add(pin);
    g.add(mesh(new THREE.SphereGeometry(0.014, 10, 8), 'Brass', 0, 0.505, 0));
    const fg = new THREE.PlaneGeometry(0.3, 0.21); fg.translate(0.15, 0, 0);
    const flag = mesh(fg, 'FlagPaper', 0.004, 0.38, 0); flag.name = 'flag'; g.add(flag);
  }
  return g;
}
