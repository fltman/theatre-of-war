// Sändningen: tar redaktionens reportage (src/press/newsdesk.js) och visar dem på bordet.
// Tidning: snurrar in med ett halvtonsfoto som är en rendering av striden.
// Journalfilm: kameran åker till tv:n, rutan värms upp, kort + direktsänd bild från fronten, berättarrader.
// Radio: kameran åker till radion, skalan tänds, nålen letar upp stationen, fjärrskrivarremsan.
// Småinslag på radio visas bara som remsa (spelet fortsätter).
import * as THREE from 'three';
import { Newsdesk } from './press/newsdesk.js';
import { showNewspaper } from './press/newspaper.js';
import { showScrapbook, scrapbookEntry } from './press/scrapbook.js';
import { drawReelCard } from './press/reel.js';
import { showSubtitle, hideSubtitle, subtitleDuration } from './press/subtitles.js';
import { WORLD_SERVICE, RADIO_SHOTS, screenShot } from './props.js';
import { speed } from './anim.js';

const sleep = (ms, signal) => new Promise((res) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

export class Broadcast {
  constructor({ world, board, rig, props, hud, data, audio = null, music = null }) {
    Object.assign(this, { world, board, rig, props, hud, data, audio, music });
    this.desk = null;
    this.scrapbook = [];
    this.enabled = { paper: true, tv: true, radio: true };
    this.abort = null;
  }

  // perspective: spelarindex vars tidning vi läser (propaganda), null = neutral (bara generalerna spelar).
  reset(state, seed = 1952) {
    this.desk = new Newsdesk({ players: state.players, seed, perspective: this.perspective ?? null });
    this.scrapbook = [];
  }

  newWar(perspective = null) {
    this.perspective = perspective;
    this.desk = null;
    this.scrapbook = [];
  }

  // Journalfilmsklipp (Google Flow, public/reel/clips.json) och röster (ElevenLabs, public/audio/voice/manifest.json).
  // Båda är valfria: saknas de används direktbilden från bordet respektive det syntetiska mumlet.
  async load() {
    const get = (u) => fetch(new URL(u, document.baseURI)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [clips, voices] = await Promise.all([get('reel/clips.json'), get('audio/voice/manifest.json')]);
    this.clips = Array.isArray(clips) ? clips : [];
    this.voices = voices ?? {};
    this.clipBag = [];
  }

  // Ett klipp som passar etiketterna, utan upprepning tills alla passande har visats.
  pickClip(tags = []) {
    if (!this.clips?.length) return null;
    // poäng: första etiketten (terrängen) väger tyngst, sedan övriga träffar; bara de bäst passande är kandidater
    const score = (c) => tags.reduce((s, t, i) => s + (c.tags?.includes(t) ? (i === 0 ? 10 : 1) : 0), 0);
    const best = Math.max(0, ...this.clips.map(score));
    const fits = best > 0 ? this.clips.filter((c) => score(c) === best || (best >= 10 && score(c) >= 10)) : [];
    const pool = fits.length ? fits : this.clips;
    const unseen = pool.filter((c) => !this.clipBag.includes(c.id));
    const pick = (unseen.length ? unseen : pool)[Math.floor(Math.random() * (unseen.length || pool.length))];
    if (!unseen.length) this.clipBag = this.clipBag.filter((id) => !pool.some((c) => c.id === id));
    this.clipBag.push(pick.id);
    return pick;
  }

  async video(clip) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
    v.src = new URL(clip.file ?? `reel/${clip.id}.mp4`, document.baseURI).href;   // file är relativ till public/
    await new Promise((res) => { v.oncanplay = res; v.onerror = res; setTimeout(res, 2500); });
    try { await v.play(); } catch { /* utan ljud ska det gå */ }
    return v.readyState >= 2 ? v : null;
  }

  skip() { this.abort?.abort(); }

  // Anropas av regin efter varje drag.
  async after(events, state, director) {
    if (!this.desk) this.reset(state);
    let stories = this.desk.feed(events, state) ?? [];
    if (state.phase === 'over') stories = stories.concat(this.desk.flush(state) ?? []);
    stories.sort((a, b) => b.priority - a.priority);
    for (const s of stories) await this.present(s, state, director);
  }

  async present(story, state, director) {
    const m = story.medium;
    if (!this.enabled[m]) return;
    // Radion: inga småinslag, och minst 45 s mellan sändningar (utom riktigt stora händelser och månadsöversikten).
    if (m === 'radio') {
      const now = performance.now();
      const major = story.priority >= 85 || story.kind === 'monthly';
      if (story.priority < 50 && !major) return;
      if (!major && now - (this.lastAir ?? -1e9) < 45000) return;
    }
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const big = m !== 'radio' || story.priority >= 50 || director.paceName === 'film' || story.kind === 'monthly';
    if (big) this.music?.duck(true);
    try {
      if (m === 'paper') await this.paper(story, signal);
      else if (m === 'tv') await this.tv(story, signal);
      else if (m === 'radio') {
        await this.radio(story, signal);
      }
    } finally {
      if (m === 'radio' || m === 'tv') this.lastAir = performance.now();
      this.abort = null;
      this.audio?.stop('static');          // inget brus får ligga kvar efter en sändning, hur den än slutade
      this.audio?.stop('projector');
      if (big) this.music?.duck(false);
    }
  }

  // ------------------------------------------------------------ tidning

  // Pressfoto: lågt, nära figurerna, som en fotograf vid fronten.
  photo(story) {
    const [t, from] = story.focus?.territories ?? [];
    if (!t) return null;
    const P = this.board.anchor(t);
    const F = from ? this.board.anchor(from) : P.clone().add(new THREE.Vector3(0, 0, 1));
    const dir = P.clone().sub(F).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const cam = new THREE.PerspectiveCamera(34, 4 / 3, 0.02, 60);
    cam.position.copy(P).addScaledVector(dir, -0.75).addScaledVector(side, 0.45).add(new THREE.Vector3(0, 0.32, 0));
    cam.lookAt(P.x, 0.08, P.z);
    return this.world.snapshot(cam, 960, 720);
  }

  async paper(story, signal) {
    this.audio?.play('paper');
    const hold = speed.factor >= 50 ? 5200 : 4600;
    const photo = this.photo(story);
    try { this.scrapbook.push(scrapbookEntry(story, photo)); } catch { /* klippboken får klara sig utan */ }
    await showNewspaper(story, { photo, world: this.data, hold, signal });
  }

  // Krigets alla förstasidor som klippbok.
  showScrapbook(container, title) {
    return showScrapbook(this.scrapbook ?? [], { container, world: this.data, title });
  }

  // ------------------------------------------------------------ journalfilm

  async tv(story, signal) {
    const P = this.props;
    if (!P.tv || !story.tv) return;
    const back = { pos: this.world.camera.position.clone(), target: this.world.controls.target.clone() };
    const [t, from] = story.focus?.territories ?? [];
    // in snett mot rutan, sedan en långsam inåkning under hela journalfilmen
    const S = screenShot(P.tv, P.screen ?? P.tv);
    await this.rig.fly(S.from, S.target, 1.5, { fov: 30 });
    const total = story.tv.cards.reduce((n, c) => n + (c.duration ?? 3), 0) + 2;
    this.rig.cut(S.from, S.target, { p1: S.to, sec: total, fade: false, focus: 0.4 });
    if (t) P.tvLive(this.board.anchor(t), from ? this.board.anchor(from) : null);
    // filmklipp ur biblioteket: första delen av bildkortet är klippet, sedan direktbilden från bordet
    const clip = this.pickClip(story.tv.clipTags ?? []);
    const vid = clip ? await this.video(clip) : null;
    let card = null, t0 = 0;
    P.tvCard((ctx, w, h, time) => {
      if (!card) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); return; }
      const lt = time - t0;
      const useClip = vid && card.kind === 'footage' && lt < (card.duration ?? 6) * 0.55;
      drawReelCard(ctx, card, lt, { world: this.data, footage: useClip ? vid : P.footCanvas });
    });
    await P.tvPower(true);
    this.music?.fanfare();
    this.audio?.play('projector');
    const narr = story.tv.narration ?? [];
    let ni = 0;
    for (const c of story.tv.cards) {
      if (signal.aborted) break;
      let dur = c.duration ?? 3;
      // kortets egen replik (äldre reportage: berättelsen i ordning)
      const line = c.kind === 'countdown' ? null : c.line ?? narr[ni++];
      const v = line && typeof line === 'object' && line.id && this.voices[line.id];
      if (v) dur = Math.max(dur, v.seconds + 0.7);
      card = { ...c, duration: dur };
      t0 = this.world.timer.getElapsed();
      if (line) {
        showSubtitle(typeof line === 'string' ? line : line.text, { style: 'tv', duration: dur * 1000 });
        if (v) this.audio?.speak(v.file, { radio: false });
      }
      await sleep(dur * 1000, signal);
    }
    hideSubtitle();
    vid?.pause();
    this.audio?.stop('projector');
    await P.tvPower(false);
    P.tvStop();
    await this.rig.cut(back.pos, back.target, { fade: true, focus: 0 });
    this.world.controls.enabled = true;
  }

  // ------------------------------------------------------------ radio

  // Radion som filmscen: etableringsbild med röken framför, närbild på skalan medan nålen letar, och medan
  // hallåmannen läser nyheten klipper kameran ut till kartan (rösten fortsätter som speakertext över bilderna);
  // avslutningen tillbaka vid radion.
  async radio(story, signal) {
    const P = this.props;
    const lines = story.radio?.lines ?? [];
    if (!lines.length) return;
    const back = { pos: this.world.camera.position.clone(), target: this.world.controls.target.clone() };
    const R = P.radio;
    const shot = (name, sec) => {
      const [a, b, t] = RADIO_SHOTS[name];
      const w = (v) => R.localToWorld(new THREE.Vector3(...v));
      return this.rig.cut(w(a), w(t), { p1: w(b), sec, fov: name === 'dial' ? 26 : 30, focus: 0.7 });
    };
    const [focusT, focusFrom] = story.focus?.territories ?? [];
    const mapShot = (sec) => {
      const T = this.board.anchor(focusT);
      const F = focusFrom ? this.board.anchor(focusFrom) : T.clone().add(new THREE.Vector3(-1, 0, 1));
      const dir = T.clone().sub(F).setY(0); if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1); dir.normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x); if (side.z < 0) side.negate();
      const p0 = T.clone().addScaledVector(dir, -1.6).addScaledVector(side, 1.2).add(new THREE.Vector3(0, 1.05, 0));
      const p1 = T.clone().addScaledVector(dir, -1.0).addScaledVector(side, 0.7).add(new THREE.Vector3(0, 0.8, 0));
      return this.rig.cut(p0, T.clone().add(new THREE.Vector3(0, 0.08, 0)), { p1, sec, fov: 32, focus: 1 });
    };
    // Klipp bara när innehållet byter karaktär: öppning/avslutning vid radion, nyheterna över kartan.
    // Repliker i rad med samma sorts bild delar EN åkning (ingen klipp från kartan till samma karta).
    const kindOf = (l) => (/^(open|close|station|interval)/.test(l.id ?? '') || !focusT ? 'radio' : 'map');
    const durOf = (l) => { const c = l.id && this.voices[l.id]; const ms = subtitleDuration(l.text); return c ? Math.max(ms * 0.6, c.seconds * 1000 + 300) : ms; };
    const groups = [];
    for (const l of lines) { const k = kindOf(l); if (groups.at(-1)?.kind === k) groups.at(-1).lines.push(l); else groups.push({ kind: k, lines: [l] }); }
    if (R) {
      // en enda glidande inzoomning mot radion medan nålen letar och pausignalen spelas
      const [a, , t] = RADIO_SHOTS.establish;
      await this.rig.fly(R.localToWorld(new THREE.Vector3(...a)), R.localToWorld(new THREE.Vector3(...t)), 1.4);
      const lead = groups[0]?.kind === 'radio' ? groups[0].lines.reduce((s2, l) => s2 + durOf(l) + 250, 0) / 1000 : 0;
      const [, b2] = RADIO_SHOTS.establish, [, , dt] = RADIO_SHOTS.dial;
      const pushEnd = R.localToWorld(new THREE.Vector3(...b2).lerp(new THREE.Vector3(...RADIO_SHOTS.dial[1]), 0.45));
      this.rig.cut(R.localToWorld(new THREE.Vector3(...a)), R.localToWorld(new THREE.Vector3(...t).lerp(new THREE.Vector3(...dt), 0.4)), { p1: pushEnd, sec: 4.2 + lead, fade: false, focus: 0.7 });
      this.audio?.play('static');
      await sleep(400, signal);
      await P.radioOn(true, WORLD_SERVICE);
      this.audio?.stop('static');
      this.audio?.play('interval');
      await sleep(1300, signal);
    }
    let first = true;
    for (const g of groups) {
      if (signal.aborted) break;
      const sec = g.lines.reduce((s2, l) => s2 + durOf(l) + 250, 0) / 1000;
      // första radiogruppen fortsätter inzoomningen; senare grupper får en ny tagning
      if (R && (!first || g.kind === 'map')) {
        if (g.kind === 'map') mapShot(sec + 0.6);
        else shot('close', sec + 1.5);
      }
      first = false;
      for (const l of g.lines) {
        if (signal.aborted) break;
        const dur = durOf(l);
        const clip = l.id && this.voices[l.id];
        showSubtitle(l.text, { speaker: l.speaker, style: 'radio', station: story.radio.station, duration: dur });
        if (clip) this.audio?.speak(clip.file, { radio: true });
        else this.audio?.voice?.(l, subtitleDuration(l.text));
        await sleep(dur + 250, signal);
      }
    }
    hideSubtitle();
    if (R) {
      await P.radioOn(false);
      await this.rig.cut(back.pos, back.target, { fade: true, focus: 0 });
      this.world.controls.enabled = true;
    }
  }

  // Kort radioinslag utan kameraåkning: remsan skrivs ut medan kriget fortsätter.
  strip(story) {
    const l = story.radio?.lines?.[0];
    if (!l) return;
    showSubtitle(l.text, { speaker: l.speaker, style: 'radio', station: story.radio.station });
    this.props.radioOn?.(true, WORLD_SERVICE).then(() => setTimeout(() => this.props.radioOn(false), subtitleDuration(l.text)));
  }
}
