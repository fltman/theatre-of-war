// Regin: gör om motorns händelser till scener på bordet. Håller ett eget "visat läge" (view) som följer
// händelserna steg för steg, så att räknare och färger ändras i takt med animationerna – inte när draget räknats ut.
import * as THREE from 'three';
import { TERRITORY, TERRITORIES } from '../shared/map.js';
import { visibleTo } from '../shared/engine.js';
import { reply, generalSays } from './diplomacy.js';
import { monthOf } from './hud.js';
import { FACTION } from '../shared/factions.js';
const cap = (s) => s[0].toUpperCase() + s.slice(1);
import { makePiece, node } from './units.js';
import { tween, wait, ease, speed } from './anim.js';

const FAMOUS = new Set(['germany', 'france', 'great_britain', 'japan', 'egypt', 'china', 'india', 'eastern_us', 'brazil', 'italy', 'ukraine', 'middle_east', 'western_us', 'scandinavia']);
const SEQ = new Set(['battle', 'conquer', 'continent', 'eliminated', 'occupy', 'victory']);

// Tempo: film = allt med kamera, brisk = kamera bara för stora slag, dispatch = inga kameraåkningar, headlines = direkt
// zoom: småstrider får en snabb halvbild över området (kartan zoomar in där det strider).
export const PACE = {
  film: { factor: 1, film: 0, zoom: true },
  brisk: { factor: 1.35, film: 16, zoom: true },
  dispatch: { factor: 2.6, film: Infinity, zoom: true },
  headlines: { factor: 100, film: Infinity, zoom: false },
};

export class Director {
  constructor({ world, board, rig, fx, hud, dice = null, audio = null, press = null, notes = null, props = null }) {
    Object.assign(this, { world, board, rig, fx, hud, dice, audio, press, notes, props });
    this.view = { owner: {}, armies: {} };
    this.pending = null;            // erövring som väntar på occupy-draget
    this.setPace('brisk');
    this.humanSeats = new Set();
  }

  setPace(name) {
    this.paceName = name;
    this.pace = PACE[name];
    if (!this.skipping) speed.factor = this.pace.factor;
  }

  // Hoppa över det som spelas nu (mellanslag/klick på "Skip").
  skip() {
    this.press?.skip();
    if (this.busy) { this.skipping = true; speed.factor = 60; }
  }

  faction(state, p) { return state.players[p].faction; }
  get instant() { return speed.factor >= 50; }

  setup(state) {
    this.lastState = state;
    this.lastBattle = null;
    this.notes?.clear();
    this.fx.clearBurns();
    this.stats = { battles: 0, rolls: 0, conquests: 0, biggest: null };
    for (const id in state.owner) {
      const f = this.faction(state, state.owner[id]);
      this.view.owner[id] = f;
      this.view.armies[id] = state.armies[id];
      this.board.setOwner(id, f);
      this.board.stacks[id].set(state.armies[id], f);
    }
    this.hud.setTurn(state);
    this.applyFog(state);
    this.applyWeather(state);
  }

  // Krigsdimma: vem som tittar (lokalt: den enda människan; online: den egna platsen; annars ingen dimma).
  viewerSeat(state) {
    if (!state.fog) return null;
    if (this.localSeats) return this.localSeats.size === 1 ? [...this.localSeats][0] : null;
    const humans = state.players.map((p, i) => (p.kind === 'human' ? i : -1)).filter((i) => i >= 0);
    return humans.length === 1 ? humans[0] : null;
  }
  applyFog(state) {
    const seat = this.viewerSeat(state);
    const vis = seat == null ? null : visibleTo(state, seat);
    for (const id in this.board.stacks) this.board.stacks[id].setHidden(vis ? !vis.has(id) : false);
    this.hud.fogSeat = seat;
  }
  hidden(id) { return !!this.board.stacks[id]?.hidden; }

  applyWeather(state) {
    const w = state.world?.round === state.round ? state.world : null;
    const frost = w?.id === 'winter' ? ['ural', 'siberia', 'yakutsk', 'irkutsk', 'kamchatka', 'mongolia'] : [];
    const heat = w?.id === 'heat' ? TERRITORIES.filter((t) => t.continent === 'africa').map((t) => t.id) : [];
    this.board.weather(frost, heat);
    this.hud.worldEvent?.(w);
  }

  // Spela upp ett drags händelser. state = läget efter draget.
  async play(events, state) {
    this.busy = true;
    try {
      let i = 0;
      while (i < events.length) {
        const e = events[i];
        if (e.type === 'battle' || (e.type === 'occupy' && this.pending)) {
          const seq = [];
          while (i < events.length && SEQ.has(events[i].type)) {
            const x = events[i];
            if (x.type === 'battle' && seq.some((s) => s.type === 'conquer')) break;
            if (x.type === 'battle' && seq.length && (x.from !== e.from || x.to !== e.to)) break;
            seq.push(x); i++;
          }
          await this.battle(seq, state);
          continue;
        }
        await this.single(e, state);
        i++;
      }
      this.reconcile(state);
      this.applyFog(state);
      this.applyWeather(state);
      this.lastState = state;
      this.hud.updateRoster(state);
      if (this.press) await this.press.after(events, state, this);
    } finally {
      this.busy = false;
      if (this.skipping) { this.skipping = false; speed.factor = this.pace.factor; }
    }
  }

  // Säkerhetsnät: det visade läget ska alltid sluta lika med motorns.
  reconcile(state) {
    for (const id in state.owner) {
      const f = this.faction(state, state.owner[id]);
      if (this.view.owner[id] !== f) { this.board.setOwner(id, f); this.view.owner[id] = f; }
      if (this.view.armies[id] !== state.armies[id] || this.board.stacks[id].faction !== f || state.armies[id] == null) {
        if (this.pending && (id === this.pending.from || id === this.pending.to)) continue;
        this.view.armies[id] = state.armies[id];
        this.board.stacks[id].set(state.armies[id], f);
      }
    }
  }

  async single(e, state) {
    const f = e.player != null ? this.faction(state, e.player) : null;
    switch (e.type) {
      case 'turn': {
        this.hud.setTurn({ ...state, turn: e.player, round: e.round });
        if (e.round > 1 && e.round % 3 === 0 && e.round !== this.lastStain) { this.lastStain = e.round; this.notes?.stain(); }
        const human = state.players[e.player].kind === 'human';
        this.audio?.play('turn');
        const portrait = this.world.camera.aspect < 0.9;
        // mellan generalernas turer: tillbaka till översikten (kameran har zoomat in på striderna)
        if (!this.instant && (portrait || !human)) await this.rig.overview(1.4, this.centroid(state, e.player));
        break;
      }
      case 'income': {
        const p = state.players[e.player];
        const bonus = e.continents.map((c) => `+${c.bonus}`).join(' ');
        if (p.kind === 'human' || this.pace.film === 0) this.hud.toast(`<b>${p.name}</b> receives ${e.total} armies${bonus ? ` <span class="stamp">${bonus}</span>` : ''}`, { ms: 2400 });
        break;
      }
      case 'trade': {
        const p = state.players[e.player];
        this.hud.toast(`<b>${p.name}</b> turns in cards for <span class="stamp">+${e.value}</span>`, { ms: 2600 });
        this.audio?.play('cards');
        break;
      }
      case 'place': {
        const n = e.n == null || this.view.armies[e.territory] == null ? null : (this.view.armies[e.territory] += e.n);
        if (n == null) this.view.armies[e.territory] = null;
        const human = state.players[e.player].kind === 'human';
        if (!human && e.n >= 3 && this.pace.film === 0 && !this.instant) await this.rig.look(this.board.anchor(e.territory), 3.6, 1.1);
        this.audio?.play('place');
        const job = this.board.stacks[e.territory].set(n, f, { animate: !this.instant });
        if (!human) await job;
        if (!human && !this.instant) await wait(0.25);
        break;
      }
      case 'fortify': {
        await this.fortify(e, state);
        break;
      }
      case 'proposal': await this.phoneCall(e, state); break;
      case 'pact': case 'declined': await this.phoneAnswer(e, state); break;
      case 'betrayal': {
        const A = FACTION[this.faction(state, e.player)].army, B = FACTION[this.faction(state, e.victim)].army;
        this.hud.stamp('BETRAYAL');
        this.audio?.play('betrayal');
        this.world.flicker?.();
        const quip = generalSays(state, e.player, 'betray', { army: B });
        this.hud.toast(`<b>${cap(A)}</b> breaks its pact and attacks <b>${B}</b>!${quip ? `<br><i>“${quip}”</i>` : ''}`, { kind: 'big', ms: 5200 });
        if (!this.instant) await wait(1.1);
        break;
      }
      case 'worldEvent': {
        this.applyWeather({ ...state, world: e, round: e.round });
        this.audio?.play('turn');
        break;
      }
      case 'pactExpired':
        this.hud.toast(`The pact between <b>${FACTION[this.faction(state, e.a)].army}</b> and <b>${FACTION[this.faction(state, e.b)].army}</b> has expired`, { ms: 3000 });
        break;
      case 'card': break;
      case 'continent': this.hud.continent(e, state); break;
      case 'eliminated': this.eliminated(e, state); break;
      case 'victory': await this.victory(e, state); break;
    }
  }

  // ------------------------------------------------------------ telefonen

  // Vilka platser som sitter vid just den här skärmen (lokalt: alla människor; online: den egna platsen).
  isLocal(state, p) { return this.localSeats ? this.localSeats.has(p) : state.players[p].kind === 'human'; }

  async phoneCall(e, state) {
    const mineTo = this.isLocal(state, e.to), mineFrom = this.isLocal(state, e.from);
    const P = this.props;
    if (!(mineTo || mineFrom) || this.instant || !P?.phone) return;
    this.phoneBack = { pos: this.world.camera.position.clone(), target: this.world.controls.target.clone() };
    const S = P.phoneShot();
    await this.rig.fly(S.from, S.target, 1.2, { fov: 30 });
    this.rig.cut(S.from, S.target, { p1: S.to, sec: 14, fade: false, focus: 0.5 });
    if (mineFrom) {
      // vi ringer: lyft luren, slå numret, signal i luren tills svaret kommer
      this.audio?.play('pickup');
      await P.lift(true);
      await P.dialNumber(String(1000 + ((e.to * 7919 + state.round * 104729) % 9000)));
      this.audio?.play('ringback');
    } else {
      // det ringer hos oss: klockan går en stund, sedan lyfts luren (kortet i luren visas av gränssnittet)
      P.ring(true);
      this.audio?.play('ring');
      await wait(2.2);
      P.ring(false);
      this.audio?.stop('ring');
      this.audio?.play('pickup');
      await P.lift(true);
    }
  }

  async phoneAnswer(e, state) {
    const A = FACTION[this.faction(state, e.type === 'pact' ? e.a : e.from)].army;
    const B = FACTION[this.faction(state, e.type === 'pact' ? e.b : e.to)].army;
    const from = e.type === 'pact' ? e.a : e.from;
    const P = this.props;
    this.audio?.stop('ringback'); this.audio?.stop('ring'); P?.ring(false);
    const local = this.phoneBack && !this.instant;
    if (local && this.isLocal(state, from)) {
      // svaret i luren på vårt samtal
      this.audio?.play('pickup');
      this.audio?.phoneVoice(2200);
      const other = e.type === 'pact' ? e.b : e.to;
      const bitter = e.type === 'declined' && state.players[other]?.grudges?.[from] != null;
      const said = generalSays(state, other, e.type === 'pact' ? 'accept' : bitter ? 'betrayed' : 'decline', { army: FACTION[this.faction(state, from)].army });
      await reply(e.type === 'pact'
        ? `“${said ?? 'Agreed.'}” <small>No attacks between us until the end of ${monthOf(e.until)}.</small>`
        : `“${said ?? 'Out of the question.'}” <i>The line goes dead.</i>`, 3200, { st: state, p: other });
    }
    if (e.type === 'pact') {
      this.hud.stamp('PACT SIGNED', 'small');
      this.hud.toast(`<b>${cap(A)}</b> and <b>${B}</b> sign a ${e.months === 6 ? 'six' : 'three'}-month pact — until the end of ${monthOf(e.until)}`, { ms: 3600 });
    } else if (local) this.hud.toast(`<b>${cap(B)}</b> declines the pact`, { ms: 2600 });
    this.hud.updateRoster(state);
    if (local) {
      if (P?.phone) { await P.lift(false); this.audio?.play('hangup'); }
      await this.rig.cut(this.phoneBack.pos, this.phoneBack.target, { fade: true, focus: 0 });
      this.world.controls.enabled = true;
      this.phoneBack = null;
    }
  }

  // Tyngdpunkten för en fraktions territorier (där kameran ska titta på mobil).
  centroid(state, p) {
    const ids = Object.keys(state.owner).filter((id) => state.owner[id] === p);
    const c = new THREE.Vector3();
    for (const id of ids) c.add(this.board.anchor(id));
    return ids.length ? c.multiplyScalar(1 / ids.length) : c;
  }

  // Hur mycket ett slag förtjänar kameran.
  importance(seq, state) {
    let s = 0;
    for (const e of seq) {
      if (e.type === 'battle') s += e.losses.a + e.losses.d;
      if (e.type === 'conquer') s += 6 + (FAMOUS.has(e.to) ? 6 : 0);
      if (e.type === 'continent') s += 12;
      if (e.type === 'eliminated') s += 30;
      if (e.type === 'victory') s += 50;
    }
    const b = seq.find((e) => e.type === 'battle');
    if (b && (state.players[b.player].kind === 'human' || state.players[b.defender].kind === 'human')) s += 100;
    return s;
  }

  async battle(seq, state) {
    const battles = seq.filter((e) => e.type === 'battle');
    const conquer = seq.find((e) => e.type === 'conquer');
    const occupy = seq.find((e) => e.type === 'occupy');
    // fortsättning: occupy-draget efter en tidigare erövring
    if (!battles.length) {
      if (occupy && this.pending) await this.occupy(occupy, state);
      for (const e of seq) if (e.type !== 'occupy') await this.single(e, state);
      return;
    }
    const first = battles[0];
    const A = first.from, B = first.to;
    if (!this.replaying) {
      const vb = this.view;
      this.lastBattle = { seq, state, pre: { [A]: { n: vb.armies[A], f: vb.owner[A] }, [B]: { n: vb.armies[B], f: vb.owner[B] } } };
    }
    if (this.stats) {
      const losses = battles.reduce((n, b) => n + b.losses.a + b.losses.d, 0);
      this.stats.battles++; this.stats.rolls += battles.length;
      if (conquer) this.stats.conquests++;
      if (!this.stats.biggest || losses > this.stats.biggest.losses) this.stats.biggest = { losses, at: B, round: state.round };
    }
    const att = this.faction(state, first.player), def = this.faction(state, first.defender);
    // i dimman syns inte strider där båda territorierna är dolda
    const unseen = this.hidden(A) && this.hidden(B);
    const instant = speed.factor >= 50 || unseen;
    const film = !instant && (this.replaying || this.importance(seq, state) >= this.pace.film);
    const route = this.board.route(A, B);
    const staging = stagingPoint(route);

    if (instant) {
      const last = battles.at(-1);
      this.view.armies[A] = last.armies.from; this.view.armies[B] = last.armies.to;
      this.board.stacks[A].set(last.armies.from, att);
      if (conquer) {
        this.view.owner[B] = att;
        this.board.setOwner(B, att);
        if (!this.replaying) { this.notes?.arrow(this.board.anchor(A), this.board.anchor(B), att); this.aftermath(A, B, stagingPoint(route)); }
        this.board.stacks[B].set(0, def);
        this.pending = { from: A, to: B, att, exp: null };
      } else this.board.stacks[B].set(last.armies.to, def);
    } else {
      if (film) await this.rig.battle(this.board.anchor(A), this.board.anchor(B), staging, 1.3);
      else if (this.pace.zoom) await this.rig.region(this.board.anchor(A), this.board.anchor(B), staging);
      const exp = new Expedition(this, att, A, Math.min(3, first.dice.a.length), this.view.armies[A]);
      this.audio?.play('march');
      await exp.travel(route, { stopShort: 0.2 });
      for (let k = 0; k < battles.length; k++) {
        const b = battles[k];
        const dur = film ? Math.max(0.32, 0.85 - k * 0.07) : 0.28;
        // filmstrid: de tre första kasten med riktiga tärningar på kartan, sedan tärningsbrickan
        const real = film && k < 3 && this.dice && speed.factor < 50;
        if (real) {
          const zone = this.diceZone(A, B, staging);
          this.world.setFocus(zone.at, 1);
          const thrown = await this.dice.roll({ a: b.dice.a, d: b.dice.d }, zone.at, this.world.camera.position, { radius: zone.radius });
          await wait(0.45);
          this.world.setFocus(staging, 1);
          const pairs = Math.min(b.dice.a.length, b.dice.d.length);
          const losers = thrown.filter((D, i) => {
            const isA = i < b.dice.a.length, j = isA ? i : i - b.dice.a.length;
            if (j >= pairs) return false;
            return isA ? !(b.dice.a[j] > b.dice.d[j]) : b.dice.a[j] > b.dice.d[j];
          });
          // sista riktiga kastet: räfsan sveper bort tärningarna, annars bleknar de
          const lastReal = k === Math.min(2, battles.length - 1);
          if (lastReal && this.props?.rake) { this.dice.markLosers(losers); this.dice.sweep(this.props.rake, this.world.camera.position.clone()); }
          else this.dice.clear(losers);
        }
        exp.fire(this.board.anchor(B));
        this.audio?.play(exp.loud ? 'cannon' : 'rifles');
        await wait(dur * 0.3);
        this.shell(B, b.losses.d, film);
        if (!real) { this.hud.dice(b.dice.a, b.dice.d, b.losses, att, def); this.audio?.play('dice'); }
        this.view.armies[A] = b.armies.from;
        this.view.armies[B] = b.armies.to;
        this.board.stacks[B].set(b.armies.to, def, { animate: true });
        this.board.stacks[A].set(b.armies.from, att, { animate: true });
        if (b.losses.a) exp.casualty(b.losses.a, b.armies.from > 1 && k < battles.length - 1);
        await wait(dur * 0.7);
      }
      if (conquer) {
        this.view.owner[B] = att;
        this.audio?.play('conquer');
        this.notes?.arrow(this.board.anchor(A), this.board.anchor(B), att);
        const flood = this.board.setOwner(B, att, { origin: staging, animate: true, sec: film ? 1.6 : 0.8 });
        this.aftermath(A, B, staging);
        this.pending = { from: A, to: B, att, exp };
        await Promise.all([flood, exp.travel({ kind: 'land', pts: [exp.head(), this.board.anchor(B)] }, { spread: true })]);
      } else {
        await exp.travel({ kind: 'land', pts: [exp.head(), this.board.anchor(A)] }, { speedMul: 1.4 });
        exp.dispose();
      }
    }
    for (const e of seq) {
      if (e.type === 'occupy') await this.occupy(e, state);
      else if (this.replaying) continue;
      else if (e.type !== 'battle' && e.type !== 'conquer') await this.single(e, state);
    }
  }

  // Repris av senaste slaget: garnisonerna ställs som före slaget och slaget spelas igen i filmtempo.
  async replay() {
    const lb = this.lastBattle;
    if (!lb || this.busy) return;
    this.busy = true; this.replaying = true;
    const oldPace = this.paceName;
    this.setPace('film');
    this.hud.replayBanner?.(true);
    try {
      for (const [id, v] of Object.entries(lb.pre)) {
        this.view.armies[id] = v.n; this.view.owner[id] = v.f;
        this.board.setOwner(id, v.f);
        await this.board.stacks[id].set(v.n, v.f);
      }
      const back = { pos: this.world.camera.position.clone(), target: this.world.controls.target.clone() };
      await this.battle(lb.seq, lb.state);
      await wait(0.8);
      await this.rig.cut(back.pos, back.target, { fade: true, focus: 0 });
      this.world.controls.enabled = true;
    } finally {
      this.pending = null;
      this.replaying = false;
      this.hud.replayBanner?.(false);
      this.setPace(oldPace);
      this.busy = false;
      if (this.lastState) { this.reconcile(this.lastState); this.applyFog(this.lastState); }
    }
  }

  // Var tärningarna landar: en plats nära fronten där HELA väggrutan (tärningarna kan inte lämna den) syns i bild,
  // gärna bort från garnisonerna. Returnerar { at, radius }.
  diceZone(A, B, staging) {
    const cam = this.world.camera;
    cam.updateMatrixWorld();
    const toCam = cam.position.clone().sub(staging).setY(0).normalize();
    const side = new THREE.Vector3(-toCam.z, 0, toCam.x);
    const avoid = [this.board.anchor(A), this.board.anchor(B), staging];
    const inView = (p, m) => { const v = p.clone().project(cam); return v.z < 1 && Math.abs(v.x) < m && Math.abs(v.y) < m; };
    const boxVisible = (c, r) => [[1, 1], [1, -1], [-1, 1], [-1, -1]].every(([a, b]) => inView(c.clone().add(new THREE.Vector3(a * r, 0, b * r)), 0.9))
      && inView(c.clone().add(new THREE.Vector3(0, 0.6, 0)), 0.9);
    let best = null, bestScore = -Infinity;
    for (const r of [0.85, 0.7, 0.55, 0.45]) {
      for (const s of [0.6, -0.6, 0.85, -0.85, 0.35, -0.35, 0]) for (const f of [0.15, 0.35, 0.6, 0.9]) {
        const p = staging.clone().addScaledVector(toCam, f).addScaledVector(side, s);
        if (!boxVisible(p, r)) continue;
        const score = Math.min(...avoid.map((q) => q.distanceTo(p))) - Math.abs(s) * 0.2 + r * 0.5;
        if (score > bestScore) { bestScore = score; best = { at: p, radius: r }; }
      }
      if (best) return best;
    }
    // inget fick plats (mycket nära kamera): mitt i bilden på kartan, liten ruta
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, -0.2), cam);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return { at: hit ?? staging.clone(), radius: 0.4 };
  }

  // Granatnedslag bland försvararna.
  shell(B, hits, film) {
    const st = this.board.stacks[B];
    const pieces = [...st.pieces.artillery, ...st.pieces.tank, ...st.pieces.infantry];
    const n = hits + 2;                                  // träffar + nedslag som missar
    for (let i = 0; i < n; i++) {
      const p = pieces[i % Math.max(1, pieces.length)];
      const at = p ? p.getWorldPosition(new THREE.Vector3()) : this.board.anchor(B);
      at.x += (Math.random() - 0.5) * 0.3; at.z += (Math.random() - 0.5) * 0.3;
      setTimeout(() => this.fx.explosion(at, i < hits ? 1.15 : 0.65), i * 110 / speed.factor);
    }
    if (hits) {
      this.audio?.play('explosion');
      // det brinner där granaterna slog ned
      const at = this.board.anchor(B).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3));
      this.fx.burn(at, { sec: 14 + hits * 4, size: 0.8 + hits * 0.2 });
    }
    if (film && hits >= 2) { this.world.shake = Math.max(this.world.shake, 0.02); this.world.flicker?.(); }
  }

  // Efter en erövring: territoriet brinner en god stund (syns som rökpelare även från översikten), sot på kartan.
  aftermath(A, B, staging) {
    const T = this.board.anchor(B);
    this.fx.burn(T.clone().add(new THREE.Vector3(0.18, 0, 0.12)), { sec: 70, size: 1.4 });
    this.fx.burn(staging, { sec: 35, size: 1 });
    this.notes?.scorch?.(T);
  }

  async occupy(e, state) {
    const p = this.pending;
    this.pending = null;
    const att = p?.att ?? this.faction(state, e.player);
    this.view.armies[e.to] = e.n;
    p?.exp?.dispose();
    await Promise.all([
      this.board.stacks[e.to].set(e.n, att, { animate: !p?.exp && speed.factor < 50 }),
      this.board.stacks[e.from].set(state.armies[e.from] ?? this.view.armies[e.from], att, { animate: speed.factor < 50 }),
    ]);
    this.view.armies[e.from] = this.board.stacks[e.from].n;
  }

  async fortify(e, state) {
    const f = this.faction(state, e.player);
    this.view.armies[e.from] -= e.n;
    await this.board.stacks[e.from].set(this.view.armies[e.from], f, { animate: speed.factor < 50 });
    if (speed.factor < 50) {
      if (this.pace.film === 0 && state.players[e.player].kind !== 'human') await this.rig.battle(this.board.anchor(e.from), this.board.anchor(e.to), null, 1.1);
      const exp = new Expedition(this, f, e.from, Math.min(3, e.n), e.n);
      for (let i = 0; i + 1 < e.path.length; i++) await exp.travel(this.board.route(e.path[i], e.path[i + 1]), { speedMul: 1.3 });
      exp.dispose();
    }
    this.view.armies[e.to] += e.n;
    await this.board.stacks[e.to].set(this.view.armies[e.to], f, { animate: speed.factor < 50 });
  }

  eliminated(e, state) {
    const p = state.players[e.player], by = state.players[e.by];
    this.hud.toast(`<b>${p.name}</b> has been wiped off the map by <b>${by.name}</b>${e.cards ? ` — ${e.cards} cards seized` : ''}`, { kind: 'big', ms: 4200 });
    this.audio?.play('eliminated');
  }

  async victory(e, state) {
    const p = state.players[e.player];
    this.hud.toast(`<b>${p.name}</b> is master of the world`, { kind: 'big', ms: 8000 });
    this.audio?.play('victory');
    await this.rig.overview(2.5);
  }
}

// Punkten där anfallet tar mark: gränsen (land), kusten på andra sidan (hav) eller kartkanten (runt jorden).
function stagingPoint(route) {
  if (route.kind === 'land') return route.pts[1] ?? route.pts.at(-1);
  if (route.kind === 'sea') return route.pts2[0];
  return route.pts2[1];
}

// ------------------------------------------------------------------ expeditionen: figurerna som går ut i strid

const MARCH = 0.85;          // enheter per sekund (filmtempo)
const SAIL = 2.2;

class Expedition {
  constructor(dir, faction, from, n, armies) {
    this.dir = dir;
    this.faction = faction;
    this.group = new THREE.Group();
    dir.board.group.add(this.group);
    // stora arméer skickar en stridsvagn eller kanon först
    const kinds = armies >= 10 ? ['artillery', 'tank', 'infantry'] : armies >= 5 ? ['tank', 'infantry', 'infantry'] : ['infantry', 'infantry', 'infantry'];
    this.loud = armies >= 5;
    this.pieces = kinds.slice(0, Math.max(1, n)).map((k, i) => {
      const p = makePiece(k, faction);
      p.position.copy(dir.board.anchor(from)).add(new THREE.Vector3((i - 1) * 0.12, 0, 0.12));
      this.group.add(p);
      return p;
    });
    this.ship = null;
  }

  head() { return this.pieces[0]?.position.clone() ?? new THREE.Vector3(); }

  // Följ en väg (land: punkter; hav: gå till kusten, segla, gå i land; runt jorden: ut över kanten och in igen).
  async travel(route, { stopShort = 0, speedMul = 1, spread = false } = {}) {
    if (route.kind === 'land') return this.walk(route.pts, { stopShort, speedMul, spread });
    await this.walk(route.pts, { speedMul });
    if (route.kind === 'sea') {
      await this.sail(route.sea);
      return this.walk(route.pts2, { stopShort, speedMul, spread });
    }
    // runt jorden: gå ut över kanten, kom in från andra sidan
    for (const p of this.pieces) p.visible = false;
    for (const p of this.pieces) p.position.copy(route.pts2[0]);
    for (const p of this.pieces) p.visible = true;
    return this.walk(route.pts2, { stopShort, speedMul, spread });
  }

  // Leksaksmarsch: figurerna skuttar fram i kolonn, lätt vickande; stridsvagnar och kanoner glider.
  walk(pts, { stopShort = 0, speedMul = 1, spread = false }) {
    const path = trimmed(pts.map((v) => v.clone()), stopShort);
    const len = pathLength(path);
    if (len < 1e-3) return Promise.resolve();
    const sec = len / (MARCH * speedMul);
    const n = this.pieces.length;
    return tween(sec, (k) => {
      this.pieces.forEach((p, i) => {
        const lag = (i * 0.14) / Math.max(len, 0.5);
        const t = Math.min(1, Math.max(0, k * (1 + lag * (n - 1)) - lag * i));
        const { pos, dir } = along(path, t);
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(((i % 3) - 1) * (spread ? 0.16 * t : 0.09));
        p.position.copy(pos).add(side);
        p.rotation.y = Math.atan2(dir.x, dir.z);
        const kind = p.userData.kind;
        if (kind === 'infantry') {
          const ph = t * len * 9;
          p.position.y = Math.abs(Math.sin(ph * Math.PI)) * 0.028;
          p.rotation.z = Math.sin(ph * Math.PI) * 0.12;
        } else p.rotation.z = 0;
      });
    }, ease.linear);
  }

  async sail(seg) {
    const [a, b] = seg;
    const ship = (this.ship = makePiece('ship', this.faction));
    ship.position.copy(a);
    ship.scale.setScalar(0.001);
    this.dir.board.group.add(ship);
    const dir = b.clone().sub(a).normalize();
    ship.rotation.y = Math.atan2(dir.x, dir.z);
    // trupperna kliver ombord
    await Promise.all([
      tween(0.35, (k) => ship.scale.setScalar(Math.max(0.001, k)), ease.back),
      tween(0.3, (k) => this.pieces.forEach((p) => p.scale.setScalar(1 - k))),
    ]);
    this.pieces.forEach((p) => (p.visible = false));
    const smoke = node(ship, 'smoke');
    const len = a.distanceTo(b);
    let puff = 0;
    await tween(len / SAIL + 0.4, (k) => {
      ship.position.lerpVectors(a, b, ease.inOut(k));
      ship.position.y = Math.sin(k * 40) * 0.006;
      ship.rotation.z = Math.sin(k * 23) * 0.04;
      if (smoke && (puff += 1) % 6 === 0) this.dir.fx.emit('smoke', smoke.getWorldPosition(new THREE.Vector3()), { size: 0.05, grow: 3, life: 1.6, rise: 0.15, opacity: 0.5, tint: 0x666666 });
    }, ease.linear);
    this.pieces.forEach((p) => { p.visible = true; p.position.copy(b); });
    await Promise.all([
      tween(0.3, (k) => this.pieces.forEach((p) => p.scale.setScalar(k))),
      tween(0.35, (k) => ship.scale.setScalar(Math.max(0.001, 1 - k))),
    ]);
    this.dir.board.group.remove(ship);
    this.ship = null;
  }

  fire(target) {
    for (const p of this.pieces) {
      if (!p.visible) continue;
      const fwd = target.clone().sub(p.position).setY(0).normalize();
      p.rotation.y = Math.atan2(fwd.x, fwd.z);
      const barrel = node(p, 'barrel');
      let muzzle;
      if (barrel) {
        muzzle = barrel.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.16);
        const z0 = barrel.position.z;
        tween(0.18, (k) => { barrel.position.z = z0 - Math.sin(k * Math.PI) * 0.02; }, ease.linear);
      } else muzzle = p.position.clone().add(new THREE.Vector3(0, 0.2, 0)).addScaledVector(fwd, 0.06);
      this.dir.fx.muzzle(muzzle, fwd, !!barrel);
      if (!barrel) for (let k = 0; k < 3; k++) setTimeout(() => this.dir.fx.tracer(muzzle, target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.1, (Math.random() - 0.5) * 0.3))), k * 70);
    }
  }

  // Angriparen förlorar figurer: den främsta faller; finns det fler kast kommer en ersättare.
  casualty(n, replace) {
    for (let i = 0; i < n && this.pieces.length; i++) {
      const p = this.pieces.shift();
      const rz = (Math.random() < 0.5 ? -1 : 1) * Math.PI / 2;
      tween(0.4, (k) => { p.rotation.x = -k * Math.PI / 2 * 0.9; p.rotation.z = rz * k * 0.2; p.position.y = -k * 0.02; }, ease.in)
        .then(() => tween(0.6, (k) => p.scale.setScalar(1 - k * 0.999)))
        .then(() => this.group.remove(p));
      if (replace) {
        const q = makePiece('infantry', this.faction);
        const at = (this.pieces[0] ?? p).position.clone();
        q.position.set(at.x, 1.0, at.z);
        q.rotation.y = p.rotation.y;
        this.group.add(q);
        this.pieces.push(q);
        tween(0.5, (k) => { q.position.y = 1.0 * (1 - ease.bounce(k)); }, ease.linear);
      }
    }
  }

  dispose() { this.dir.board.group.remove(this.group); if (this.ship) this.dir.board.group.remove(this.ship); }
}

function pathLength(path) { let s = 0; for (let i = 1; i < path.length; i++) s += path[i].distanceTo(path[i - 1]); return s; }

function trimmed(path, cut) {
  if (cut <= 0 || path.length < 2) return path;
  const last = path.at(-1), prev = path.at(-2);
  const d = last.distanceTo(prev);
  if (d > cut) last.lerp(prev, cut / d);
  return path;
}

function along(path, t) {
  const L = pathLength(path);
  let want = t * L;
  for (let i = 1; i < path.length; i++) {
    const d = path[i].distanceTo(path[i - 1]);
    if (want <= d || i === path.length - 1) {
      const k = d > 0 ? Math.min(1, want / d) : 1;
      return { pos: path[i - 1].clone().lerp(path[i], k), dir: path[i].clone().sub(path[i - 1]).setY(0).normalize() };
    }
    want -= d;
  }
  return { pos: path.at(-1).clone(), dir: new THREE.Vector3(0, 0, 1) };
}
