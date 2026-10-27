// Fotoläge: fri kamera, HUD:en borta, frys tiden, klicka för skärpa, oskärpa-reglage, spara bilden (mobil: dela).
import * as THREE from 'three';

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export class PhotoMode {
  constructor({ world, rig, root }) {
    Object.assign(this, { world, rig, root });
    this.ray = new THREE.Raycaster();
  }

  start(onExit) {
    this.onExit = onExit;
    this.rig.job++;                       // ingen regi tar kameran
    this.world.controls.enabled = true;
    document.body.classList.add('photo');
    this.world.timeScale = 0;
    this.frozen = true;
    this.blur = 0.6;
    this.world.setFocus(this.world.controls.target.clone(), this.blur);
    this.bar = el(`<div class="photo-bar">
      <button data-a="freeze" class="on">❚❚ Frozen</button>
      <label>Blur <input type="range" min="0" max="1.5" step="0.05" value="${this.blur}"></label>
      <span class="hint">Click the scene to focus</span>
      <button data-a="save" class="primary">◉ Save photo</button>
      <button data-a="exit">✕ Done</button></div>`);
    this.root.append(this.bar);
    const q = (s) => this.bar.querySelector(s);
    q('[data-a=freeze]').onclick = (e) => { this.frozen = !this.frozen; this.world.timeScale = this.frozen ? 0 : 1; e.target.textContent = this.frozen ? '❚❚ Frozen' : '▶ Running'; e.target.classList.toggle('on', this.frozen); };
    q('input').oninput = (e) => { this.blur = +e.target.value; this.world.setFocus(null, this.blur); };
    q('[data-a=save]').onclick = () => this.save();
    q('[data-a=exit]').onclick = () => this.stop();
    this.onClick = (e) => {
      if (e.target !== this.world.canvas) return;
      const r = this.world.canvas.getBoundingClientRect();
      this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.world.camera);
      const hit = this.ray.intersectObjects(this.world.scene.children, true).find((h) => h.object.visible && !h.object.isSprite && !h.object.isPoints);
      if (hit) this.world.setFocus(hit.point, this.blur);
    };
    this.world.canvas.addEventListener('click', this.onClick);
  }

  async save() {
    this.bar.style.display = 'none';
    const blob = await new Promise((res) => requestAnimationFrame(() => { this.world.composer.render(0); this.world.canvas.toBlob(res, 'image/png'); }));
    this.bar.style.display = '';
    if (!blob) return;
    const name = `theatre-of-war-${Date.now()}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Theatre of War' }); return; } catch { /* avbrutet */ } }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  stop() {
    this.world.canvas.removeEventListener('click', this.onClick);
    this.bar?.remove();
    document.body.classList.remove('photo');
    this.world.timeScale = 1;
    this.world.setFocus(null, 0);
    this.onExit?.();
  }
}
