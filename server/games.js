// Spellogiken på servern: identiteter, lobby, partier, drag, AI-turer. Inga sockets här – index.js skickar
// meddelandena vidare. Servern är auktoritativ: bara motorn (shared/engine.js) avgör vad som är tillåtet.
import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import { newGame, apply, actor } from '../shared/engine.js';
import { decide } from '../shared/ai.js';
import { FACTION } from '../shared/factions.js';
import { sight, eventSight, fogArmies, fogOccupy, fogEvents } from './fog.js';

export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const STYLES = ['aggressive', 'strategist', 'cautious'];
// Motorns felkoder (shared/engine.js) som klienten får tillbaka i reject.
const ENGINE_CODES = new Set(['over', 'phase', 'not-a-set', 'must-trade', 'not-yours', 'count', 'not-adjacent', 'own-territory',
  'too-few', 'dice', 'no-path', 'unknown-action', 'players', 'awaiting-answer', 'bad-partner', 'already-allied', 'one-call-per-turn', 'no-proposal', 'gales']);

export class GameError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}
const fail = (code, message) => { throw new GameError(code, message); };

const hash = (token) => createHash('sha256').update(token).digest('hex');

export function cleanName(s, fallback) {
  if (typeof s !== 'string') return fallback;
  const n = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return n || fallback;
}

// Det klienten får se av tillståndet: ingen slump (tärningarna går inte att förutsäga), ingen kortlek,
// bara sina egna kort (andras ersätts med null – antalet syns) och, i krigsdimma, bara de arméer platsen ser.
// leak: testkrok som stänger av en redigering (för att visa att läcktestet fäller).
export function publicState(state, seat, leak = null) {
  if (!state) return null;
  const { rng, seed, deck, ...rest } = state;
  const vis = leak === 'state' ? null : sight(state, seat);
  return {
    ...rest,
    armies: fogArmies(state.armies, vis),
    occupy: fogOccupy(state.occupy, vis),
    deckSize: deck.length,
    players: state.players.map((p, i) => (i === seat ? p : { ...p, cards: p.cards.map(() => null) })),
  };
}

// Telegrammets text: ren text på en rad, högst 140 tecken.
export function cleanTelegram(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

export class Games {
  /**
   * @param {object} o
   * @param {import('./db.js').Store} o.store
   * @param {number} o.aiDelay  ms mellan AI-drag
   * @param {(game, build: (viewer) => object) => void} o.broadcast  skicka till alla som följer partiet
   * @param {(game, seat) => boolean} o.isOnline  är platsens spelare ansluten till partiet just nu
   */
  // aiThink: generalerna tänker framåt (Monte Carlo). false = snabba regelbaserade beslut (testerna).
  constructor({ store, aiDelay = 400, aiThink = true, broadcast = () => {}, isOnline = () => false, telegramGap = 5000, telegramMax = 30, fogLeak = null }) {
    this.aiThink = aiThink;
    this.store = store;
    this.aiDelay = aiDelay;
    this.broadcast = broadcast;
    this.isOnline = isOnline;
    this.telegramGap = telegramGap;  // ms mellan två telegram från samma plats
    this.telegramMax = telegramMax;  // telegram per plats och parti
    this.fogLeak = fogLeak;          // testkrok: 'state' | 'battle' redigeras inte
    this.cache = new Map();          // id -> game
    this.lastTelegram = new Map();   // `${game}:${seat}` -> ts
    this.closed = false;
  }

  view(state, seat) { return publicState(state, seat, this.fogLeak); }

  // Efter omstart: ladda pågående partier och låt AI:n fortsätta där den var.
  resume() {
    let n = 0;
    for (const id of this.store.activeGameIds()) { const g = this.load(id); if (g) { this.pump(g); n++; } }
    return n;
  }

  close() {
    this.closed = true;
    for (const g of this.cache.values()) g.aiCancel?.();
  }

  // ------------------------------------------------------------------ identitet

  hello({ token, name }) {
    if (typeof token === 'string' && token.length >= 16 && token.length <= 100) {
      const p = this.store.playerByHash(hash(token));
      if (p) {
        const n = cleanName(name, p.name);
        if (n !== p.name) this.store.renamePlayer(p.id, n);
        this.store.seen(p.id);
        return { player: { id: p.id, name: n } };
      }
    }
    const id = randomUUID();
    const t = randomBytes(24).toString('base64url');
    const n = cleanName(name, `Commander ${randomInt(100, 1000)}`);
    this.store.insertPlayer(id, n, hash(t));
    return { player: { id, name: n }, token: t };
  }

  // ------------------------------------------------------------------ partier

  load(id) {
    if (id == null) return null;
    let g = this.cache.get(id);
    if (g) return g;
    const row = this.store.game(id);
    if (!row) return null;
    g = {
      id: row.id, code: row.code, status: row.status, host: row.host, options: row.options, seed: row.seed,
      state: row.state, startEvents: row.start_events ?? [], seq: row.seq, seats: row.seats, aiCancel: null,
    };
    this.cache.set(id, g);
    return g;
  }

  byCode(code) {
    if (typeof code !== 'string') fail('bad-request', 'Missing invite code.');
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(c)) fail('no-such-game', 'No game with that code.');
    const g = this.load(this.store.gameIdByCode(c));
    if (!g) fail('no-such-game', 'No game with that code.');
    return g;
  }

  newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (!this.store.codeExists(c)) return c;
    }
  }

  seatOf(g, playerId) { return g.seats.find((s) => s.player === playerId)?.seat ?? null; }

  /** Skapa ett parti. seats: [{kind, faction, ai?}], seat: platsen värden tar (null = bara titta). */
  create(player, { seats, seat, options = {} }) {
    if (!Array.isArray(seats) || seats.length < 2 || seats.length > 6) fail('bad-request', 'A war needs 2 to 6 sides.');
    const used = new Set();
    const list = seats.map((s, i) => {
      if (!s || typeof s !== 'object') fail('bad-request', 'Bad seat.');
      if (!FACTION[s.faction] || used.has(s.faction)) fail('bad-request', 'Each side needs its own colour.');
      used.add(s.faction);
      const kind = s.kind === 'ai' ? 'ai' : 'human';
      const ai = STYLES.includes(s.ai) ? s.ai : 'strategist';
      return { seat: i, player: null, faction: s.faction, kind, ai, name: FACTION[s.faction].name };
    });
    let mine = seat === undefined ? list.find((s) => s.kind === 'human')?.seat ?? null : seat;
    if (mine !== null) {
      if (!Number.isInteger(mine) || !list[mine] || list[mine].kind !== 'human') fail('bad-request', 'You can only take a human seat.');
      list[mine].player = player.id;
      list[mine].name = player.name;
    }
    let victory = 'world';
    if (Number.isInteger(options.victory) && options.victory >= 10 && options.victory <= 42) victory = options.victory;
    const opts = { victory, fog: options.fog === true };
    const code = this.newCode();
    const seed = randomInt(1, 2 ** 31);
    const id = this.store.insertGame({ code, host: player.id, options: opts, seed, seats: list });
    return this.load(id);
  }

  join(player, code, seat) {
    const g = this.byCode(code);
    const already = this.seatOf(g, player.id);
    if (already !== null) return g;                       // redan med: samma som att öppna partiet
    if (g.status !== 'lobby') fail('started', 'That war has already begun.');
    const open = g.seats.filter((s) => s.kind === 'human' && !s.player);
    const s = seat == null ? open[0] : open.find((x) => x.seat === seat);
    if (!s) fail('game-full', 'No free seat at that table.');
    s.player = player.id;
    s.name = player.name;
    this.store.setSeat(g.id, s.seat, s.player, s.kind, s.name);
    this.pushSeats(g);
    return g;
  }

  leave(player, code) {
    const g = this.byCode(code);
    if (g.status !== 'lobby') return g;                   // i ett pågående parti behåller man platsen
    const s = g.seats.find((x) => x.player === player.id);
    if (s) {
      s.player = null;
      s.name = FACTION[s.faction].name;
      this.store.setSeat(g.id, s.seat, null, s.kind, s.name);
      this.pushSeats(g);
    }
    return g;
  }

  start(player, code) {
    const g = this.byCode(code);
    if (g.host !== player.id) fail('not-host', 'Only the host can start the war.');
    if (g.status !== 'lobby') fail('started', 'That war has already begun.');
    // tomma människoplatser går till generalstaben (AI)
    for (const s of g.seats) if (s.kind === 'human' && !s.player) {
      s.kind = 'ai';
      this.store.setSeat(g.id, s.seat, null, 'ai', s.name);
    }
    const { state, events } = this.newWar(g);
    g.state = state;
    g.startEvents = events;
    g.seq = 0;
    g.status = 'active';
    this.store.start(g.id, state, events);
    this.broadcast(g, (viewer) => ({ t: 'start', code: g.code, seq: 0, events: this.eventsFor(state, state, events, viewer), state: this.view(state, viewer), seats: this.seatInfo(g) }));
    this.pump(g);
    return g;
  }

  /** Ett drag från en människa. seq = antal drag spelaren har sett (skydd mot dubbletter). */
  act(player, code, seq, action) {
    const g = this.byCode(code);
    const seat = this.seatOf(g, player.id);
    const reject = (reason) => ({ reject: { t: 'reject', code: g.code, reason, seq: g.seq, state: this.view(g.state, seat) } });
    if (g.status === 'lobby') return reject('not-started');
    if (g.status === 'over') return reject('over');
    if (seat === null) return reject('spectator');
    if (seq !== g.seq) return reject('seq');
    if (actor(g.state) !== seat) return reject('not-your-turn');
    if (g.seats[seat].kind !== 'human') return reject('handed-over');
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') return reject('bad-action');
    try {
      this.commit(g, seat, sanitize(action));
    } catch (e) {
      return reject(ENGINE_CODES.has(e.message) ? e.message : 'illegal');
    }
    this.pump(g);
    return { ok: true };
  }

  commit(g, seat, action) {
    const pre = g.state;
    const { state, events } = apply(pre, action);
    const seq = g.seq + 1;
    this.store.append(g.id, seq, seat, action, events, state);
    g.state = state;
    g.seq = seq;
    if (state.phase === 'over') g.status = 'over';
    this.broadcast(g, (viewer) => ({ t: 'events', code: g.code, seq, by: seat, action, events: this.eventsFor(pre, state, events, viewer), state: this.view(state, viewer) }));
  }

  // Händelserna som mottagaren får se (krigsdimma: antal i territorier den inte ser blir null).
  eventsFor(pre, post, events, seat) {
    return fogEvents(events, eventSight(pre, post, seat), this.fogLeak === 'battle' ? 'battle' : null);
  }

  newWar(g) {
    const r = newGame({
      seed: g.seed, victory: g.options.victory, fog: !!g.options.fog,
      players: g.seats.map((s) => ({ faction: s.faction, name: s.name, kind: s.kind, ai: s.ai })),
    });
    if (g.options.fog) r.state.fog = true;            // äldre motor utan fog-parametern: dimman är bara en vy
    return r;
  }

  // AI-turer: kör nästa drag efter en paus om det är en AI-plats tur.
  pump(g) {
    g.aiCancel?.();
    g.aiCancel = null;
    if (this.closed || g.status !== 'active' || !g.state || g.state.phase === 'over') return;
    const seat = actor(g.state);         // mottagaren av ett paktförslag svarar utanför sin tur
    if (g.seats[seat]?.kind !== 'ai') return;
    const step = () => {
      g.aiCancel = null;
      if (this.closed || g.status !== 'active' || actor(g.state) !== seat || g.seats[seat].kind !== 'ai') return;
      try {
        this.commit(g, seat, decide(g.state, { think: this.aiThink }));
      } catch (e) {
        // Ska aldrig hända (motorn och AI:n testas tillsammans). Avsluta turen hellre än att fastna.
        console.error(`AI-fel i ${g.code}:`, e.message);
        try { this.commit(g, seat, g.state.proposal ? { type: 'answer', accept: false } : { type: g.state.phase === 'reinforce' ? 'place' : 'endTurn', territory: firstOwned(g.state, seat), n: g.state.pending }); }
        catch { return; }
      }
      this.pump(g);
    };
    g.aiCancel = later(this.aiDelay, step);
  }

  // Lämna över en människoplats till generalstaben (värden, eller spelaren själv). reclaim tar tillbaka den.
  handover(player, code, seat) {
    const g = this.byCode(code);
    if (g.status !== 'active') fail('bad-request', 'The war is not running.');
    const s = g.seats[seat];
    if (!s) fail('bad-request', 'No such seat.');
    if (g.host !== player.id && s.player !== player.id) fail('not-host', 'Only the host can hand over another seat.');
    if (s.kind === 'ai') return g;
    s.kind = 'ai';
    this.store.setSeat(g.id, s.seat, s.player, 'ai', s.name);
    g.state.players[seat].kind = 'ai';
    g.state.players[seat].ai = s.ai;
    this.store.q.saveState.run(JSON.stringify(g.state), g.seq, g.status, Date.now(), g.id);
    this.pushSeats(g);
    this.pump(g);
    return g;
  }

  reclaim(player, code) {
    const g = this.byCode(code);
    const s = g.seats.find((x) => x.player === player.id);
    if (!s) fail('not-in-game', 'You have no seat in that war.');
    if (g.status !== 'active' || s.kind === 'human') return g;
    s.kind = 'human';
    this.store.setSeat(g.id, s.seat, s.player, 'human', s.name);
    g.state.players[s.seat].kind = 'human';
    this.store.q.saveState.run(JSON.stringify(g.state), g.seq, g.status, Date.now(), g.id);
    if (actor(g.state) === s.seat) { g.aiCancel?.(); g.aiCancel = null; }
    this.pushSeats(g);
    return g;
  }

  // ------------------------------------------------------------------ vyer

  seatInfo(g) {
    return g.seats.map((s) => ({
      seat: s.seat, faction: s.faction, kind: s.kind, ai: s.ai, name: s.name,
      open: s.kind === 'human' && !s.player, claimed: !!s.player, online: s.player ? this.isOnline(g, s.seat) : false,
    }));
  }

  pushSeats(g) { this.broadcast(g, () => ({ t: 'seats', code: g.code, seats: this.seatInfo(g) })); }

  snapshot(g, player) {
    const seat = player ? this.seatOf(g, player.id) : null;
    return {
      t: 'game', code: g.code, status: g.status, options: g.options, seq: g.seq,
      you: { seat, host: !!player && g.host === player.id },
      seats: this.seatInfo(g), state: this.view(g.state, seat),
      startEvents: g.state ? this.eventsFor(g.state, g.state, g.startEvents, seat) : g.startEvents,
      telegrams: this.telegramsFor(g, seat),
    };
  }

  summary(g, player) {
    const seat = player ? this.seatOf(g, player.id) : null;
    const turn = g.state && g.status === 'active' ? actor(g.state) : null;
    return {
      code: g.code, status: g.status, round: g.state?.round ?? 0, seq: g.seq,
      seats: g.seats.map((s) => ({ faction: s.faction, kind: s.kind, name: s.name, open: s.kind === 'human' && !s.player })),
      turn: turn === null ? null : { seat: turn, faction: g.seats[turn].faction },
      you: seat, host: !!player && g.host === player.id,
      yourTurn: turn !== null && turn === seat && g.seats[seat].kind === 'human',
      winner: g.state?.winner ?? null,
    };
  }

  list(player) {
    return {
      open: this.store.openGameIds().map((id) => this.summary(this.load(id), player)),
      mine: this.store.myGameIds(player.id).map((id) => this.summary(this.load(id), player)),
      active: this.store.watchableGameIds(20).map((id) => this.summary(this.load(id), player)),
    };
  }

  history(code, from = 0, to, player = null) {
    const g = this.byCode(code);
    const f = Math.max(0, from | 0), t = Math.min(g.seq, to == null ? g.seq : to | 0);
    if (t - f > 500) fail('bad-request', 'Ask for at most 500 moves at a time.');
    const moves = this.store.actions(g.id, f, t);
    const seat = player ? this.seatOf(g, player.id) : null;
    if (g.options.fog && g.status !== 'over' && moves.length) {
      // dimman beror på läget före och efter varje drag: räkna fram dem ur loggen
      let { state } = this.newWar(g);
      const want = new Map(moves.map((m) => [m.seq, m]));
      for (const m of this.store.actions(g.id, 0, t)) {
        const post = apply(state, m.action).state;
        const hit = want.get(m.seq);
        if (hit) hit.events = this.eventsFor(state, post, hit.events, seat);
        state = post;
      }
    }
    return { t: 'history', code: g.code, from: f, to: t, moves };
  }

  /** Räkna om ett parti ur frö + dragloggen (för kontroll och repris). */
  replay(code) {
    const g = this.byCode(code);
    let { state } = this.newWar(g);
    for (const m of this.store.actions(g.id)) state = apply(state, m.action).state;
    return state;
  }

  // ------------------------------------------------------------------ telegram

  /** Telegram till alla (to = null) eller en plats. Ren text, högst 140 tecken, glest och ransonerat. */
  telegram(player, code, to, text) {
    const g = this.byCode(code);
    const seat = this.seatOf(g, player.id);
    if (seat === null) fail('spectator', 'Only commanders may send telegrams.');
    if (to !== null && (!Number.isInteger(to) || !g.seats[to] || to === seat)) fail('bad-request', 'No such recipient.');
    const body = cleanTelegram(text);
    if (!body) fail('bad-request', 'The telegram is empty.');
    const key = `${g.id}:${seat}`;
    const now = Date.now();
    if (now - (this.lastTelegram.get(key) ?? 0) < this.telegramGap) fail('rate-limited', 'The wire is busy. Wait a few seconds.');
    if (this.store.telegramCount(g.id, seat) >= this.telegramMax) fail('telegram-limit', 'You have sent all the telegrams allowed in this war.');
    this.lastTelegram.set(key, now);
    const tg = this.store.addTelegram(g.id, seat, to, body);
    const msg = { t: 'telegram', code: g.code, ...tg };
    // till alla: alla som följer partiet (även åskådare); privat: bara avsändaren och mottagaren
    this.broadcast(g, (viewer) => (to === null || viewer === seat || viewer === to ? msg : null));
    return tg;
  }

  telegramsFor(g, seat) {
    return this.store.telegrams(g.id).filter((x) => x.to === null || (seat !== null && (x.from === seat || x.to === seat))).slice(-50);
  }
}

// setTimeout med 0 ms blir setImmediate (snabbt i testerna utan att spränga stacken); returnerar en avbrytare.
function later(ms, fn) {
  if (ms > 0) { const t = setTimeout(fn, ms); return () => clearTimeout(t); }
  const i = setImmediate(fn);
  return () => clearImmediate(i);
}

function firstOwned(state, p) { return Object.keys(state.owner).find((id) => state.owner[id] === p); }

// Bara de fält motorn läser, med rätt typer (ingen främmande data i loggen).
function sanitize(a) {
  const out = { type: String(a.type).slice(0, 20) };
  for (const k of ['from', 'to', 'territory']) if (typeof a[k] === 'string') out[k] = a[k].slice(0, 32);
  for (const k of ['n', 'dice', 'stopAt', 'partner', 'months']) if (Number.isInteger(a[k])) out[k] = a[k];
  if (typeof a.accept === 'boolean') out.accept = a.accept;
  if (Array.isArray(a.cards)) out.cards = a.cards.slice(0, 3).filter(Number.isInteger);
  return out;
}
