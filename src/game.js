// Lokalt parti: motorn i webbläsaren, AI-spelarna tänker här, människorna svarar via UI. Partiet sparas som
// frö + dragens logg i localStorage ("Continue" spelar upp loggen utan animation).
import { newGame, apply, actor } from '../shared/engine.js';
import { decide } from '../shared/ai.js';
import { wait, speed } from './anim.js';

// Generalerna tänker i en Web Worker; finns ingen (äldre webbläsare) tänker de i huvudtråden.
let worker = null, nextId = 1;
const waiting = new Map();
function think(state) {
  try {
    worker ??= new Worker(new URL('./aiworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const w = waiting.get(e.data.id); waiting.delete(e.data.id); e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.action); };
  } catch { return Promise.resolve(decide(state)); }
  const id = nextId++;
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ id, state, think: true }); })
    .catch(() => decide(state, { think: false }));
}

const KEY = 'tow.lastGame';

export class LocalGame {
  constructor({ director, ui, hud }) {
    Object.assign(this, { director, ui, hud });
    this.stopped = false;
  }

  start(config) {
    this.config = config;
    const seed = config.seed ?? (Math.random() * 2 ** 32) >>> 0;
    const r = newGame({ seed, players: config.players });
    this.state = r.state;
    this.log = { config: { ...config, seed }, actions: [] };
    this.director.setup(this.state);
    this.director.localSeats = null;          // lokalt: alla människor sitter vid den här skärmen
    this.save();
    return this.run(r.events);
  }

  resume(saved) {
    const r = newGame({ seed: saved.config.seed, players: saved.config.players });
    let st = r.state;
    for (const a of saved.actions) st = apply(st, a).state;
    this.state = st;
    this.config = saved.config;
    this.log = saved;
    this.director.setup(st);
    return this.run([]);
  }

  static saved() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); return s?.actions ? s : null; } catch { return null; }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.log)); } catch { /* privat läge: inget sparas */ }
  }

  async run(first) {
    if (first.length) await this.director.play(first, this.state);
    while (!this.stopped && this.state.phase !== 'over') {
      const p = this.state.players[actor(this.state)];
      let action;
      if (p.kind === 'ai') {
        const [a] = await Promise.all([think(this.state), speed.factor < 50 ? wait(0.12) : null]);
        action = a;
      } else {
        action = await this.ui.ask(this.state);
        if (!action || this.stopped) continue;
      }
      let r;
      try { r = apply(this.state, action); }
      catch (err) { this.ui.rejected?.(err.message); continue; }
      this.state = r.state;
      this.log.actions.push(action);
      this.save();
      await this.director.play(r.events, this.state);
    }
    if (this.state.phase === 'over') {
      try { localStorage.removeItem(KEY); } catch { /* */ }
      this.onEnd?.(this.state);
    }
  }

  stop() { this.stopped = true; this.ui.cancel?.(); }
}
