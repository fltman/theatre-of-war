// Riktiga tärningar som kastas på kartan bredvid striden. Utfallet bestäms av spelmotorn (servern och klienterna
// ska vara överens), så kastet simuleras först med cannon-es; sedan vrids tärningens sidor så att rätt siffra
// hamnar uppåt (vridningen syns inte medan tärningen snurrar) och simuleringen spelas upp i realtid.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { tween, every, speed, ease } from './anim.js';

export const SIZE = 0.16;
// Sidornas nummer i tärningens lokala koordinater (motsatta sidor = 7).
const FACES = [
  [1, new THREE.Vector3(0, 1, 0)], [6, new THREE.Vector3(0, -1, 0)],
  [3, new THREE.Vector3(1, 0, 0)], [4, new THREE.Vector3(-1, 0, 0)],
  [2, new THREE.Vector3(0, 0, 1)], [5, new THREE.Vector3(0, 0, -1)],
];
const NORMAL = Object.fromEntries(FACES.map(([v, n]) => [v, n]));

const LOOK = {
  att: { body: 0xa8231b, pip: 0xf6ead6, transmission: 0.0 },
  def: { body: 0xece0c4, pip: 0x1b140d, transmission: 0.0 },
};

export class Dice {
  constructor(world, fx, audio = null) {
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.group = new THREE.Group();
    world.scene.add(this.group);
    this.mats = {};
    for (const k of ['att', 'def']) {
      this.mats[k] = {
        body: new THREE.MeshPhysicalMaterial({ color: LOOK[k].body, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.15, sheen: 0.2 }),
        pip: new THREE.MeshStandardMaterial({ color: LOOK[k].pip, roughness: 0.5 }),
      };
    }
    this.template = null;
  }

  async load() {
    try {
      const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(new URL('models/dice.glb', document.baseURI).href);
      this.template = g.scene;
    } catch { this.template = placeholderDie(); }
  }

  makeDie(kind) {
    const o = (this.template ?? placeholderDie()).clone(true);
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      const name = m.material?.name ?? '';
      if (name.startsWith('Pip')) m.material = this.mats[kind].pip;
      else if (name.startsWith('DiceBody') || !m.material?.map) m.material = this.mats[kind].body;
    });
    return o;
  }

  // Kasta: values.a (angriparens, röda) och values.d (försvararens, elfenben) landar vid `at`.
  // from: varifrån tärningarna kastas (kamerasidan). Löses när tärningarna ligger still.
  async roll({ a, d }, at, from, { radius = 0.85 } = {}) {
    const sim = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82 * 2.2, 0) });
    sim.allowSleep = true;
    const mat = new CANNON.Material('paper');
    const dieMat = new CANNON.Material('die');
    sim.addContactMaterial(new CANNON.ContactMaterial(mat, dieMat, { friction: 0.35, restitution: 0.32 }));
    sim.addContactMaterial(new CANNON.ContactMaterial(dieMat, dieMat, { friction: 0.2, restitution: 0.4 }));
    const ground = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    sim.addBody(ground);
    // osynliga väggar så att tärningarna stannar i bild
    const R = radius;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const w = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
      w.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(-nx, 0, -nz));
      w.position.set(at.x + nx * R, 0, at.z + nz * R);
      sim.addBody(w);
    }
    const toward = at.clone().sub(from).setY(0).normalize();
    const side = new THREE.Vector3(-toward.z, 0, toward.x);
    const dice = [];
    const add = (values, kind, offset) => values.forEach((v, i) => {
      const body = new CANNON.Body({ mass: 0.02, material: dieMat, shape: new CANNON.Box(new CANNON.Vec3(SIZE / 2, SIZE / 2, SIZE / 2)) });
      body.sleepSpeedLimit = 0.05; body.sleepTimeLimit = 0.25;
      body.linearDamping = 0.12; body.angularDamping = 0.18;
      const k = R / 0.85;
      const start = at.clone().addScaledVector(toward, -0.6 * k).addScaledVector(side, (offset + (i - (values.length - 1) / 2) * 0.2) * k);
      body.position.set(start.x, 0.55 + Math.random() * 0.15 + i * 0.05, start.z);
      body.quaternion.setFromEuler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3);
      const v0 = toward.clone().multiplyScalar((1.5 + Math.random() * 0.5) * k).addScaledVector(side, (Math.random() - 0.5) * 0.4 * k);
      body.velocity.set(v0.x, 0.6 + Math.random() * 0.5, v0.z);
      body.angularVelocity.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
      sim.addBody(body);
      dice.push({ body, value: v, kind, frames: [] });
    });
    add(a, 'att', -0.24);
    add(d, 'def', 0.24);
    // tak, så att inget studsar ut ur bild uppåt
    const roof = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
    roof.quaternion.setFromEuler(Math.PI / 2, 0, 0);
    roof.position.set(at.x, 1.15, at.z);
    sim.addBody(roof);

    // simulera i förväg och spela in
    const dt = 1 / 120;
    const hits = [];
    for (const D of dice) D.body.addEventListener('collide', (e) => {
      const s = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (s > 0.6) hits.push({ t: sim.time, s });
    });
    let steps = 0;
    while (steps++ < 120 * 4) {
      sim.step(dt);
      for (const D of dice) D.frames.push([D.body.position.x, D.body.position.y, D.body.position.z, D.body.quaternion.x, D.body.quaternion.y, D.body.quaternion.z, D.body.quaternion.w]);
      if (steps > 30 && dice.every((D) => D.body.sleepState === CANNON.Body.SLEEPING)) break;
    }

    // vilken sida hamnade uppåt? vrid tärningens innehåll så att motorns värde syns där
    for (const D of dice) {
      const f = D.frames.at(-1);
      const q = new THREE.Quaternion(f[3], f[4], f[5], f[6]);
      let top = 1, best = -2;
      for (const [v, n] of FACES) { const y = n.clone().applyQuaternion(q).y; if (y > best) { best = y; top = v; } }
      D.correction = new THREE.Quaternion().setFromUnitVectors(NORMAL[D.value], NORMAL[top]);
      const obj = this.makeDie(D.kind);
      const holder = new THREE.Group();
      obj.quaternion.copy(D.correction);
      holder.add(obj);
      const f0 = D.frames[0];
      holder.position.set(f0[0], f0[1], f0[2]);
      holder.quaternion.set(f0[3], f0[4], f0[5], f0[6]);
      this.group.add(holder);
      D.obj = holder;
    }

    // uppspelning
    this.rolling = true;
    const total = steps * dt;
    const played = new Set();
    await every((dtReal, t) => {
      const k = Math.min(steps - 1, Math.floor(t / dt));
      for (const D of dice) {
        const f = D.frames[Math.min(k, D.frames.length - 1)];
        D.obj.position.set(f[0], f[1], f[2]);
        D.obj.quaternion.set(f[3], f[4], f[5], f[6]);
      }
      hits.forEach((h, i) => { if (!played.has(i) && h.t <= t) { played.add(i); this.audio?.play('dieHit', { gain: Math.min(1, h.s / 3) }); } });
      return t >= total || speed.factor >= 50;
    });
    for (const D of dice) { const f = D.frames.at(-1); D.obj.position.set(f[0], f[1], f[2]); D.obj.quaternion.set(f[3], f[4], f[5], f[6]); }
    this.rolling = false;
    this.last = dice;
    return dice;
  }

  // Krupiärräfsan sveper bort tärningarna mot kameran (sista kastet i en filmstrid).
  async sweep(rake, cam) {
    const dice = this.last ?? [];
    this.last = null;
    if (!rake || !dice.length) { this.last = dice; return this.clear(); }
    const rest = { p: rake.position.clone(), q: rake.quaternion.clone() };
    const C = new THREE.Vector3();
    for (const D of dice) C.add(D.obj.position);
    C.multiplyScalar(1 / dice.length).setY(0);
    const f = cam.clone().sub(C).setY(0).normalize();             // svepets riktning (mot kameran)
    const size = new THREE.Box3().setFromObject(rake).getSize(new THREE.Vector3());
    const L = Math.max(size.x, size.z);
    // bladet sitter i +X-änden: vrid så att +X pekar bort från kameran
    const yaw = Math.atan2(f.z, -f.x);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const bladeAt = (s) => C.clone().addScaledVector(f, s);           // s: bladets läge längs svepet
    const originFor = (blade, y) => blade.clone().addScaledVector(f, L / 2).setY(y);
    const start = originFor(bladeAt(-0.55), 0.25);
    const p0 = rake.position.clone(), q0 = rake.quaternion.clone();
    await tween(0.55, (k) => { rake.position.lerpVectors(p0, start, k); rake.quaternion.slerpQuaternions(q0, q, k); }, ease.inOut);
    await tween(0.18, (k) => { rake.position.y = 0.25 - 0.23 * k; });
    const from = -0.55, to = 0.95;
    await tween(0.7, (k) => {
      const s = from + (to - from) * k;
      rake.position.copy(originFor(bladeAt(s), 0.02));
      for (const D of dice) {
        const along = D.obj.position.clone().sub(C).dot(f);
        if (along < s + 0.09) { D.obj.position.addScaledVector(f, s + 0.09 - along); D.obj.rotation.y += 0.02; }
      }
    }, ease.inOut);
    tween(0.4, (k) => { for (const D of dice) D.obj.scale.setScalar(1 - k * 0.98); }).then(() => { for (const D of dice) this.group.remove(D.obj); });
    const lift = rake.position.clone().setY(0.25);
    await tween(0.2, (k) => { rake.position.y = 0.02 + 0.23 * k; });
    await tween(0.6, (k) => { rake.position.lerpVectors(lift, rest.p, k); rake.quaternion.slerpQuaternions(q, rest.q, k); }, ease.inOut);
  }

  markLosers(losers = []) {
    for (const D of losers) D.obj.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.color?.multiplyScalar(0.55); } });
  }

  // Markera förlorarna (de mörknar lite) och ta bort tärningarna.
  async clear(losers = []) {
    const dice = this.last ?? [];
    this.last = null;
    for (const D of dice) if (losers.includes(D)) D.obj.traverse((m) => { if (m.isMesh) m.material = m.material.clone(), m.material.color?.multiplyScalar(0.55); });
    await tween(0.45, (k) => { for (const D of dice) { D.obj.scale.setScalar(1 - k * 0.98); D.obj.position.y -= 0.002; } });
    for (const D of dice) this.group.remove(D.obj);
  }
}

// Ersättare tills dice.glb finns: rundad kub med försänkta prickar.
function placeholderDie() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, SIZE * 0.16), new THREE.MeshStandardMaterial({ name: 'DiceBody' }));
  g.add(body);
  const pipGeo = new THREE.SphereGeometry(SIZE * 0.085, 12, 8);
  const pipMat = new THREE.MeshStandardMaterial({ name: 'Pip' });
  const L = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  for (const [v, n] of FACES) {
    const u = Math.abs(n.y) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const w = new THREE.Vector3().crossVectors(n, u);
    for (const [a, b] of L[v]) {
      const p = new THREE.Mesh(pipGeo, pipMat);
      p.position.copy(n).multiplyScalar(SIZE / 2 + SIZE * 0.035).addScaledVector(u, a * SIZE * 0.26).addScaledVector(w, b * SIZE * 0.26);
      p.scale.set(1, 1, 1).multiplyScalar(1);
      p.lookAt(p.position.clone().add(n));
      p.scale.z = 0.35;
      g.add(p);
    }
  }
  return g;
}
