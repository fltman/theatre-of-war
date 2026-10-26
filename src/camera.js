// Kamerarigg: flygningar med jobbtoken (en avbruten flygning får aldrig röra kameran igen), översikt, stridsbilder
// och tagningar av radion och tv:n. Spelaren kan alltid ta över med musen; regin tar tillbaka vid nästa händelse.
import * as THREE from 'three';
import { OVERVIEW } from './world.js';
import { ease, speed } from './anim.js';

export class CameraRig {
  constructor(world) {
    this.world = world;
    this.cam = world.camera;
    this.controls = world.controls;
    this.job = 0;
    this.flying = null;
    this.userHasControl = false;
    // användaren tar över: avbryt pågående flygning
    // användaren tar kameran: ingen skärpeoskärpa (skärpan ligger annars kvar på senaste striden)
    const grab = () => { this.job++; this.flying = null; this.userHasControl = true; this.controls.enabled = true; this.world.setFocus(null, 0); };
    world.canvas.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.button === 2) this.lastPointer = performance.now(); });
    this.controls.addEventListener('start', grab);
    world.addUpdater((dt) => this.update(dt));
  }

  get target() { return this.controls.target; }

  // Flyg till pos/target på sec sekunder. Returnerar ett löfte som löses när flygningen är klar eller avbruten.
  fly(pos, target, sec = 1.6, { fov = null, arc = 0.15 } = {}) {
    const job = ++this.job;
    this.userHasControl = false;
    sec = speed.factor >= 50 ? 0 : sec / Math.max(1, speed.factor * 0.6);
    const p0 = this.cam.position.clone(), t0 = this.controls.target.clone();
    const f0 = this.cam.fov, f1 = fov ?? f0;
    const lift = p0.distanceTo(pos) * arc;
    return new Promise((resolve) => {
      if (sec <= 0) {
        this.cam.position.copy(pos); this.controls.target.copy(target); this.cam.fov = f1; this.cam.updateProjectionMatrix();
        this.cam.lookAt(target);
        resolve(); return;
      }
      this.controls.enabled = false;
      this.flying = { job, t: 0, sec, p0, p1: pos.clone(), t0, t1: target.clone(), f0, f1, lift, resolve };
    });
  }

  update(dt) {
    const f = this.flying;
    if (!f) return;
    if (f.job !== this.job) { this.flying = null; f.resolve(); return; }
    f.t = Math.min(1, f.t + dt / f.sec);
    const k = ease.inOut(f.t);
    this.cam.position.lerpVectors(f.p0, f.p1, k);
    this.cam.position.y += Math.sin(Math.PI * k) * f.lift;
    this.controls.target.lerpVectors(f.t0, f.t1, k);
    this.cam.fov = f.f0 + (f.f1 - f.f0) * k;
    this.cam.updateProjectionMatrix();
    this.cam.lookAt(this.controls.target);
    if (f.t >= 1) { this.flying = null; this.controls.enabled = true; f.resolve(); }
  }

  // Översikten. Stående skärm (mobil): hela kartan blir för smal, så kameran ramar in `focus` (t.ex. den aktiva
  // fraktionens tyngdpunkt) med ungefär en tredjedel av världen i bredd.
  // Hårt klipp (med kort svarttoning) till en bild; drift = långsam åkning från p0 till p1 under sec sekunder.
  async cut(p0, target, { p1 = null, sec = 6, fov = 30, focus = 0.6, fade = true } = {}) {
    const job = ++this.job;
    this.flying = null;
    this.userHasControl = false;
    if (fade && speed.factor < 50) await blackout(true);
    if (job !== this.job) return;
    this.controls.enabled = false;
    this.cam.position.copy(p0);
    this.controls.target.copy(target);
    this.cam.fov = fov; this.cam.updateProjectionMatrix();
    this.cam.lookAt(target);
    this.world.setFocus(target, focus);
    if (fade && speed.factor < 50) blackout(false);
    if (!p1) return;
    let t = 0;
    const off = this.world.addUpdater((dt) => {
      if (job !== this.job) { off(); return; }
      t = Math.min(1, t + dt / sec);
      const k = t * t * (3 - 2 * t);
      this.cam.position.lerpVectors(p0, p1, k);
      this.cam.lookAt(target);
      if (t >= 1) off();
    });
  }

  overview(sec = 1.8, focus = null) {
    this.world.setFocus(null, 0);
    if (this.cam.aspect < 0.9) {
      const f = focus ?? this.controls.target;
      const x = THREE.MathUtils.clamp(f.x, -9.5, 9.5), z = THREE.MathUtils.clamp(f.z * 0.15, -0.6, 0.6);
      const target = new THREE.Vector3(x, 0, z);
      return this.fly(target.clone().add(new THREE.Vector3(0, 22, 4.5)), target, sec, { fov: 34 });
    }
    return this.fly(OVERVIEW.pos, OVERVIEW.target, sec, { fov: 30 });
  }

  // Strid: lågt från angriparens sida, snett, med båda garnisonerna i bild och tiltshift-skärpa på fronten.
  battle(A, B, at = null, sec = 1.4) {
    const mid = at ? at.clone() : A.clone().lerp(B, 0.5);
    const d = B.clone().sub(A); d.y = 0;
    const sep = Math.max(0.6, d.length());
    d.normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x);
    if (side.z < 0) side.negate();                          // hellre söderifrån (vi sitter vid bordets södra kant)
    const dist = THREE.MathUtils.clamp(sep * 1.5, 2.4, 6.5);
    const pos = mid.clone().addScaledVector(d, -dist * 0.45).addScaledVector(side, dist * 0.75).add(new THREE.Vector3(0, dist * 0.62, 0));
    const target = mid.clone().add(new THREE.Vector3(0, 0.08, 0));
    this.world.setFocus(target, 1);
    this.world.dof.cocMaterial.focusRange = dist * 0.55;
    return this.fly(pos, target, sec, { fov: 34 });
  }

  // Halvbild över ett stridsområde: snett uppifrån, så att båda garnisonerna och gränsen syns. Står kameran redan
  // ungefär där (flera strider i rad i samma område) flyttas den inte.
  region(A, B, at = null, sec = 0.9) {
    const mid = (at ?? A.clone().lerp(B, 0.5)).clone();
    const sep = A.distanceTo(B);
    const dist = THREE.MathUtils.clamp(sep * 2.2, 4.8, 8.5);
    const target = mid.clone().setY(0);
    const pos = target.clone().add(new THREE.Vector3(0, dist * 0.82, dist * 0.62));
    if (this.cam.aspect < 0.9) pos.add(new THREE.Vector3(0, dist * 0.35, -dist * 0.2));
    if (this.controls.target.distanceTo(target) < 1.2 && Math.abs(this.cam.position.distanceTo(target) - pos.distanceTo(target)) < 1.5) return Promise.resolve();
    this.world.setFocus(target, 0.35);
    this.world.dof.cocMaterial.focusRange = dist * 0.8;
    return this.fly(pos, target, sec, { fov: 32, arc: 0.08 });
  }

  // Närbild av ett territorium.
  look(P, dist = 3.2, sec = 1.2) {
    const pos = P.clone().add(new THREE.Vector3(0, dist * 0.75, dist * 0.7));
    this.world.setFocus(P, 0.6);
    return this.fly(pos, P.clone(), sec, { fov: 32 });
  }

  // Tagning av en rekvisita (radio, tv) från dess kameranod eller framifrån.
  prop(obj, camNode = null, sec = 1.6) {
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    let pos;
    if (camNode) pos = c.clone().lerp(camNode.getWorldPosition(new THREE.Vector3()), 1.55);   // lite längre bak än noden
    else {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()));
      pos = c.clone().addScaledVector(fwd, Math.max(size.x, size.y) * 1.25).add(new THREE.Vector3(0, size.y * 0.15, 0));
    }
    this.world.setFocus(c, 0.5);
    return this.fly(pos, c, sec, { fov: 30, arc: 0.25 });
  }
}

// Svarttoning mellan två tagningar (ett element i #overlay).
let veil = null;
function blackout(on) {
  veil ??= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'cut-veil' });
  veil.classList.toggle('on', on);
  return new Promise((r) => setTimeout(r, on ? 180 : 0));
}
