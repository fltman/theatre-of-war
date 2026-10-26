// Kartbordet: den tryckta kartan, territoriernas lavering i ägarens färg (shader som multipliceras över papperet,
// så att bläck och skuggor syns igenom) och garnisonerna (tennfigurer + flagga med antal) på varje territorium.
import * as THREE from 'three';
import { TERRITORIES, TERRITORY } from '../shared/map.js';
import { FACTION } from '../shared/factions.js';
import { drawMap, MARGIN } from './mapcanvas.js';
import { makePiece, node } from './units.js';
import { tween, ease } from './anim.js';
import { tier } from './quality.js';

const Y_WASH = 0.0025;

export class Board {
  constructor(world, data) {
    this.world = world;
    this.data = data;
    this.W = data.width; this.H = data.height;
    this.group = new THREE.Group();
    world.scene.add(this.group);
    this.meshes = {};          // territorium -> laveringsmesh (också träffyta)
    this.stacks = {};
    this.owner = {};
  }

  build() {
    this.buildPaper();
    this.buildWash();
    for (const t of TERRITORIES) this.stacks[t.id] = new Stack(this, t.id);
  }

  buildPaper() {
    const canvas = (this.mapCanvas = drawMap(this.data, tier.map));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.world.renderer.capabilities.getMaxAnisotropy();
    const w = this.W + MARGIN * 2, h = this.H + MARGIN * 2;
    const geo = new THREE.PlaneGeometry(w, h, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0, envMapIntensity: 0.4 });
    const paper = (this.paper = new THREE.Mesh(geo, mat));
    paper.receiveShadow = true;
    this.group.add(paper);
    // papperets tjocklek och en svag skugga under kanten
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, h), new THREE.MeshStandardMaterial({ color: 0xd9ccaa, roughness: 0.9 }));
    edge.position.y = -0.009;            // överkant 4 mm under papperet (annars z-fighting på avstånd)
    edge.receiveShadow = true;
    this.group.add(edge);
  }

  // Kanttextur: närhet till gränser och kust (för laveringens mörkare kanter, som akvarell som torkat).
  edgeTexture() {
    const cw = 2048, ch = Math.round((cw * this.H) / this.W);
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    const S = cw / this.W;
    const X = (x) => (x + this.W / 2) * S, Y = (y) => (y + this.H / 2) * S;
    const path = (lists) => {
      g.beginPath();
      for (const l of lists) { g.moveTo(X(l[0]), Y(l[1])); for (let i = 2; i < l.length; i += 2) g.lineTo(X(l[i]), Y(l[i + 1])); }
    };
    g.lineJoin = 'round'; g.lineCap = 'round';
    const all = [...this.data.coast, ...this.data.borders, ...this.data.continentBorders];
    for (const [w, a] of [[26, 0.08], [18, 0.1], [12, 0.14], [7, 0.2], [3, 0.35]]) {
      path(all); g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }

  buildWash() {
    const edge = this.edgeTexture();
    for (const t of TERRITORIES) {
      const shapes = this.data.territories[t.id].polys.map((p) => {
        const s = new THREE.Shape(ptsOf(p[0]));
        for (const hole of p.slice(1)) s.holes.push(new THREE.Path(ptsOf(hole)));
        return s;
      });
      const geo = new THREE.ShapeGeometry(shapes, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = washMaterial(edge, this.W, this.H);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = Y_WASH;
      m.renderOrder = 1;
      m.userData.territory = t.id;
      this.meshes[t.id] = m;
      this.group.add(m);
    }
    this.world.addUpdater((dt, time) => {
      for (const m of Object.values(this.meshes)) m.material.uniforms.uTime.value = time;
      // flaggorna växer med kameraavståndet så att siffrorna går att läsa i översiktsbilden
      const cam = this.world.camera.position;
      for (const st of Object.values(this.stacks)) {
        if (!st.flag) continue;
        const P = st.group.position;
        const d = cam.distanceTo(P);
        st.flag.scale.setScalar(THREE.MathUtils.clamp(d / 11, 1, 2.6));
        // nålen vrids mot kameran och lutar bakåt när kameran står högt (annars kantställd duk uppifrån)
        const dx = cam.x - P.x, dz = cam.z - P.z;
        const elev = Math.atan2(cam.y - P.y, Math.hypot(dx, dz));
        st.flag.rotation.order = 'YXZ';
        st.flag.rotation.y = Math.atan2(dx, dz);
        st.flag.rotation.x = -THREE.MathUtils.clamp((elev - 0.75) * 0.9, 0, 0.75);
      }
    });
  }

  anchor(id, y = 0) {
    const a = this.data.territories[id].anchor;
    return new THREE.Vector3(a[0], y, a[1]);
  }

  // Ägare: lavering i fraktionens färg. Med animate flyter den nya färgen ut från origin (där anfallet kom in).
  setOwner(id, faction, { origin = null, animate = false, sec = 1.4 } = {}) {
    const u = this.meshes[id].material.uniforms;
    const col = new THREE.Color(FACTION[faction].wash);
    const prev = this.owner[id];
    this.owner[id] = faction;
    if (!animate || !prev) {
      u.uOld.value.copy(col); u.uNew.value.copy(col); u.uProgress.value = 1;
      return Promise.resolve();
    }
    u.uOld.value.copy(u.uNew.value);
    u.uNew.value.copy(col);
    const o = origin ?? this.anchor(id);
    u.uOrigin.value.set(o.x, o.z);
    u.uReach.value = farthest(this.data.territories[id], o) + 0.3;
    u.uProgress.value = 0;
    return tween(sec, (k) => { u.uProgress.value = k; }, ease.out);
  }

  // Markeringar: 'source' (valt utgångsläge), 'target' (möjligt mål), 'hover'.
  mark(id, kind, on = true) {
    const u = this.meshes[id].material.uniforms;
    if (kind === 'source') u.uHatch.value = on ? 1 : 0;
    if (kind === 'target') u.uTarget.value = on ? 1 : 0;
    if (kind === 'hover') u.uLift.value = on ? 1 : 0;
    if (kind === 'deploy') u.uDeploy.value = on ? 1 : 0;
  }
  clearMarks() { for (const id in this.meshes) { const u = this.meshes[id].material.uniforms; u.uHatch.value = 0; u.uTarget.value = 0; u.uLift.value = 0; u.uDeploy.value = 0; } }

  pick(raycaster) {
    const hits = raycaster.intersectObjects(Object.values(this.meshes), false);
    return hits[0]?.object.userData.territory ?? null;
  }

  // Väg för trupper från a till b: arméplats -> gräns (eller kust, hav, kust) -> arméplats.
  route(a, b) {
    const key = [a, b].sort().join('|');
    const c = this.data.crossings[key];
    const A = this.anchor(a), B = this.anchor(b);
    const v = (p) => new THREE.Vector3(p[0], 0, p[1]);
    if (!c) return { kind: 'land', pts: [A, B] };
    if (c.kind === 'land') return { kind: 'land', pts: [A, v(c.at), B] };
    const [pa, pb] = a < b ? [c.a, c.b] : [c.b, c.a];
    if (c.kind === 'wrap') {
      // ut över kartkanten och in från andra sidan
      const ea = v(pa), eb = v(pb);
      const outA = new THREE.Vector3(Math.sign(ea.x) * (this.W / 2 + 0.6), 0, ea.z);
      const outB = new THREE.Vector3(Math.sign(eb.x) * (this.W / 2 + 0.6), 0, eb.z);
      return { kind: 'wrap', pts: [A, ea, outA], pts2: [outB, eb, B] };
    }
    return { kind: 'sea', pts: [A, v(pa)], sea: [v(pa), v(pb)], pts2: [v(pb), B] };
  }
}

const ptsOf = (r) => { const a = []; for (let i = 0; i < r.length; i += 2) a.push(new THREE.Vector2(r[i], -r[i + 1])); return a; };

function farthest(T, o) {
  let d = 0;
  for (const p of T.polys) { const r = p[0]; for (let i = 0; i < r.length; i += 2) d = Math.max(d, Math.hypot(r[i] - o.x, r[i + 1] - o.z)); }
  return d;
}

function washMaterial(edge, W, H) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOld: { value: new THREE.Color(1, 1, 1) }, uNew: { value: new THREE.Color(1, 1, 1) },
      uOrigin: { value: new THREE.Vector2() }, uProgress: { value: 1 }, uReach: { value: 1 },
      uEdge: { value: edge }, uSize: { value: new THREE.Vector2(W, H) },
      uHatch: { value: 0 }, uTarget: { value: 0 }, uLift: { value: 0 }, uDeploy: { value: 0 }, uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vXZ;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vXZ = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uOld, uNew;
      uniform vec2 uOrigin, uSize;
      uniform float uProgress, uReach, uHatch, uTarget, uLift, uDeploy, uTime;
      uniform sampler2D uEdge;
      varying vec2 vXZ;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec2 uv = vec2((vXZ.x + uSize.x * 0.5) / uSize.x, (uSize.y * 0.5 - vXZ.y) / uSize.y);
        float edge = texture2D(uEdge, uv).r;
        // erövring: ny färg flyter ut från anfallspunkten med en fuktig, mörkare front
        float d = distance(vXZ, uOrigin) + (fbm(vXZ * 3.0) - 0.5) * 0.35;
        float front = uProgress * uReach;
        float k = 1.0 - smoothstep(front - 0.1, front, d);
        if (uProgress >= 0.999) k = 1.0;
        vec3 col = mix(uOld, uNew, k);
        float wet = (uProgress < 0.999) ? smoothstep(0.14, 0.0, abs(d - front + 0.04)) : 0.0;
        // akvarell: pigmentet samlas i papperets fibrer och vid kanterna
        float gran = fbm(vXZ * 9.0) * 0.6 + fbm(vXZ * 40.0) * 0.4;
        float density = 0.72 + (gran - 0.5) * 0.35 + edge * 0.5 + wet * 0.5;
        density *= 1.0 - uLift * 0.35;
        // utplacering: egna territorier andas (ljusare/mörkare) och får glesa guldstreck
        density *= 1.0 - uDeploy * (0.18 + 0.14 * sin(uTime * 3.5));
        vec3 wash = mix(vec3(1.0), col, clamp(density, 0.0, 1.0));
        // valt utgångsläge: täta blyertsstreck; mål: glesa röda korsstreck som pulserar
        float s1 = abs(fract((vXZ.x + vXZ.y) * 22.0) - 0.5);
        float hatch = smoothstep(0.12, 0.04, s1) * uHatch;
        float s2 = abs(fract((vXZ.x - vXZ.y) * 12.0) - 0.5);
        float s3 = abs(fract((vXZ.x + vXZ.y) * 12.0) - 0.5);
        float cross = max(smoothstep(0.09, 0.03, s2), smoothstep(0.09, 0.03, s3)) * uTarget * (0.65 + 0.35 * sin(uTime * 5.0));
        wash *= 1.0 - hatch * 0.45;
        wash = mix(wash, wash * vec3(0.75, 0.25, 0.2), cross * 0.8);
        float s4 = abs(fract((vXZ.x - vXZ.y * 0.3) * 9.0 - uTime * 0.6) - 0.5);
        wash = mix(wash, wash * vec3(1.0, 0.86, 0.55), smoothstep(0.06, 0.02, s4) * uDeploy * 0.7);
        gl_FragColor = vec4(wash, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// ------------------------------------------------------------------ garnisoner

// n arméer -> figurer: artilleri = 10, stridsvagn = 5, infanteri = 1 (som i originalet)
export function composition(n) {
  return { artillery: Math.floor(n / 10), tank: Math.floor((n % 10) / 5), infantry: n % 5 };
}

const FOOT = { artillery: 0.24, tank: 0.22, infantry: 0.085 };

class Stack {
  constructor(board, id) {
    this.board = board;
    this.id = id;
    this.n = 0;
    this.faction = null;
    this.pieces = { artillery: [], tank: [], infantry: [] };
    this.group = new THREE.Group();
    this.group.position.copy(board.anchor(id));
    board.group.add(this.group);
    this.flag = null;
    this.room = board.data.territories[id].room;
  }

  // Ställ in garnisonen. animate: nya figurer faller ned, överflödiga sjunker undan.
  async set(n, faction, { animate = false } = {}) {
    const changedFaction = faction !== this.faction;
    if (changedFaction) {
      for (const k in this.pieces) { for (const p of this.pieces[k]) this.group.remove(p); this.pieces[k] = []; }
      if (this.flag) this.group.remove(this.flag);
      this.flag = makePiece('flag', faction);
      this.flagTex = flagTexture(faction);
      this.flagTex.tex.flipY = !this.flag.userData.gltf;
      const cloth = node(this.flag, 'flag');
      if (cloth) cloth.material = new THREE.MeshStandardMaterial({ map: this.flagTex.tex, roughness: 0.85, side: THREE.DoubleSide });
      this.group.add(this.flag);
      this.faction = faction;
    }
    this.n = n;
    this.flagTex.draw(n);
    this.flag.visible = n > 0;
    const want = composition(n);
    const jobs = [];
    for (const k of ['artillery', 'tank', 'infantry']) {
      while (this.pieces[k].length > want[k]) {
        const p = this.pieces[k].pop();
        // stupade figurer faller omkull och sjunker ned i kartan
        if (animate) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          jobs.push(tween(0.35, (t) => { p.rotation.z = dir * t * 1.45; p.position.y = 0.02 * Math.sin(t * Math.PI); }, ease.in)
            .then(() => tween(0.5, (t) => { p.position.y = -t * 0.06; p.scale.setScalar(1 - t * 0.6); }))
            .then(() => this.group.remove(p)));
        }
        else this.group.remove(p);
      }
      while (this.pieces[k].length < want[k]) {
        const p = makePiece(k, faction);
        p.userData.fresh = animate;
        this.pieces[k].push(p);
        this.group.add(p);
      }
    }
    const slots = this.layout();
    let i = 0;
    for (const { p, x, z, ry } of slots) {
      if (p.userData.fresh) {
        p.userData.fresh = false;
        p.position.set(x, 1.2, z); p.rotation.y = ry;
        const delay = i++ * 0.06;
        jobs.push(tween(0.55 + delay, (t) => { const k = Math.max(0, (t * (0.55 + delay) - delay) / 0.55); p.position.y = 1.2 * (1 - ease.bounce(k)); }, ease.linear));
      } else if (animate) {
        const from = p.position.clone();
        jobs.push(tween(0.4, (t) => { p.position.set(from.x + (x - from.x) * t, 0, from.z + (z - from.z) * t); }));
        p.rotation.y = ry;
      } else { p.position.set(x, 0, z); p.rotation.y = ry; }
    }
    await Promise.all(jobs);
  }

  // Uppställning: artilleri längst bak, stridsvagnar i mitten, infanteri främst; flaggan bakom till vänster.
  layout() {
    const rows = [];
    const art = this.pieces.artillery;
    for (let i = 0; i < art.length; i += 3) rows.push({ kind: 'artillery', list: art.slice(i, i + 3) });
    if (this.pieces.tank.length) rows.push({ kind: 'tank', list: this.pieces.tank });
    if (this.pieces.infantry.length) rows.push({ kind: 'infantry', list: this.pieces.infantry });
    const depth = { artillery: 0.2, tank: 0.2, infantry: 0.12 };
    const total = rows.reduce((s, r) => s + depth[r.kind], 0);
    let z = -total / 2;
    const out = [];
    let maxW = 0;
    rows.forEach((r, ri) => {
      const w = r.list.length * FOOT[r.kind];
      maxW = Math.max(maxW, w);
      r.list.forEach((p, i) => {
        const jitter = Math.sin((i + 1) * 12.9898 + ri * 78.233 + this.id.length) * 0.12;
        out.push({ p, x: -w / 2 + FOOT[r.kind] * (i + 0.5), z: z + depth[r.kind] / 2, ry: jitter });
      });
      z += depth[r.kind];
    });
    if (this.flag) this.flag.position.set(-maxW / 2 - 0.05, 0, -total / 2 - 0.02);
    return out;
  }

  // Figurer som lämnar garnisonen (för en marsch). Returnerar världspositionerna där de stod.
  worldPos(p) { return p.getWorldPosition(new THREE.Vector3()); }
}

// Flaggduken: fraktionens färg, antal i schablonsiffror, tunn kant.
function flagTexture(faction) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 180;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const col = new THREE.Color(FACTION[faction].paint);
  const lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
  const draw = (n) => {
    g.fillStyle = FACTION[faction].paint;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = lum > 0.35 ? 'rgba(30,20,10,0.6)' : 'rgba(255,245,225,0.55)';
    g.lineWidth = 8; g.strokeRect(10, 10, c.width - 20, c.height - 20);
    g.fillStyle = lum > 0.35 ? '#1d140c' : '#f4ead2';
    g.font = `700 ${n >= 100 ? 96 : 128}px Oswald, Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), c.width / 2, c.height / 2 + 6);
    tex.needsUpdate = true;
  };
  return { tex, draw };
}
