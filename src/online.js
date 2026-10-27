// Klientbiblioteket för onlinespel (utan UI). Protokollet står i server/PROTOCOL.md.
// Håller förbindelsen vid liv, återansluter själv och synkar partiet igen; spelets händelser kommer via on('events').
//
//   const net = new Online({ name: 'Monty' });
//   await net.connect();
//   const g = await net.create({ seats: [{ kind: 'human', faction: 'red' }, { kind: 'ai', faction: 'blue' }] });
//   net.on('events', ({ events, state, seq }) => director.play(events, state));
//   await net.act({ type: 'place', territory: 'germany', n: 3 });

const KEY = 'tow.identity';
const PING_MS = 20_000;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* privat läge: identiteten lever bara i fliken */ } };

export class OnlineError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}

export function defaultUrl() {
  const forced = (() => { try { return sessionStorage.getItem('tow.ws'); } catch { return null; } })();
  if (forced) return forced;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

// Inbjudningslänk: ?join=KOD (spela) eller ?watch=KOD (titta).
export const inviteLink = (code, kind = 'join') => `${location.origin}${location.pathname}?${kind}=${code}`;

export class Online {
  constructor({ url = defaultUrl(), name } = {}) {
    this.url = url;
    this.name = name ?? load().name;
    this.ws = null;
    this.player = null;
    this.handlers = new Map();
    this.pending = new Map();         // rid -> { resolve, reject }
    this.rid = 0;
    this.status = 'offline';
    this.wanted = false;              // ska vara ansluten (återanslut vid avbrott)
    this.backoff = 1000;
    // aktuellt parti
    this.code = null; this.seat = null; this.host = false; this.seq = 0; this.state = null; this.seats = []; this.gameStatus = null;
    this.options = {}; this.telegrams = [];
  }

  // ---------------------------------------------------------------- händelser

  /** on(typ, fn) -> avregistrering. Typer: status, welcome, game, start, events, seats, reject, error, resync, telegram. */
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }
  emit(type, payload) { for (const fn of this.handlers.get(type) ?? []) fn(payload); }

  // ---------------------------------------------------------------- förbindelsen

  connect() {
    this.wanted = true;
    return new Promise((resolve, reject) => {
      this.setStatus('connecting');
      const ws = (this.ws = new WebSocket(this.url));
      let first = true;
      ws.onopen = async () => {
        try {
          const id = load();
          const w = await this.request({ t: 'hello', token: id.token, name: this.name ?? id.name });
          this.player = w.player;
          save({ token: w.token ?? id.token, name: w.player.name, id: w.player.id });
          this.backoff = 1000;
          this.setStatus('online');
          this.emit('welcome', w.player);
          // efter ett avbrott: hämta partiet på nytt
          if (this.code) {
            const snap = await this.request({ t: this.seat === null ? 'watch' : 'open', code: this.code });
            this.emit('resync', snap);
          }
          if (first) { first = false; resolve(w.player); }
        } catch (e) { if (first) { first = false; reject(e); } }
      };
      ws.onmessage = (ev) => this.receive(ev.data);
      ws.onclose = () => {
        clearInterval(this.pinger);
        for (const p of this.pending.values()) p.reject(new OnlineError('offline', 'Connection lost.'));
        this.pending.clear();
        this.setStatus('offline');
        if (first) { first = false; reject(new OnlineError('offline', 'Could not reach the server.')); }
        if (this.wanted) {
          setTimeout(() => this.wanted && this.connect().catch(() => {}), this.backoff);
          this.backoff = Math.min(15_000, this.backoff * 2);
        }
      };
      ws.onerror = () => {};
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.send({ t: 'ping' }), PING_MS);
    });
  }

  close() {
    this.wanted = false;
    clearInterval(this.pinger);
    this.ws?.close();
  }

  setStatus(s) { if (s !== this.status) { this.status = s; this.emit('status', s); } }

  send(msg) {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  request(msg) {
    const rid = ++this.rid;
    return new Promise((resolve, reject) => {
      if (!this.send({ ...msg, rid })) { reject(new OnlineError('offline', 'Not connected.')); return; }
      this.pending.set(rid, { resolve, reject });
    });
  }

  receive(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'pong') return;
    this.track(m);
    if (m.rid !== undefined && this.pending.has(m.rid)) {
      const p = this.pending.get(m.rid);
      this.pending.delete(m.rid);
      if (m.t === 'error') p.reject(new OnlineError(m.code, m.message));
      else p.resolve(m);
    }
    this.emit(m.t, m);
  }

  // Håll reda på det aktuella partiet ur meddelandena.
  track(m) {
    if (m.code && this.code && m.code !== this.code && m.t !== 'created' && m.t !== 'game') return;
    switch (m.t) {
      case 'created':
      case 'game':
        this.code = m.code; this.seat = m.you.seat; this.host = m.you.host; this.seq = m.seq;
        this.options = m.options ?? {}; this.telegrams = m.telegrams ?? [];
        this.state = m.state; this.seats = m.seats; this.gameStatus = m.status;
        break;
      case 'start':
        this.seq = m.seq; this.state = m.state; this.seats = m.seats; this.gameStatus = 'active';
        break;
      case 'events':
        this.seq = m.seq; this.state = m.state;
        if (m.state.phase === 'over') this.gameStatus = 'over';
        break;
      case 'reject':
        this.seq = m.seq; if (m.state) this.state = m.state;
        break;
      case 'seats':
        this.seats = m.seats;
        break;
      case 'left':
        if (m.code === this.code) { this.code = null; this.seat = null; this.state = null; this.telegrams = []; }
        break;
      case 'telegram':
        if (m.code === this.code && !this.telegrams.some((x) => x.id === m.id)) this.telegrams.push({ id: m.id, from: m.from, to: m.to, text: m.text, ts: m.ts });
        break;
    }
  }

  // ---------------------------------------------------------------- lobby

  create({ seats, seat, options } = {}) { return this.request({ t: 'create', seats, seat, options }); }
  join(code, seat) { return this.request({ t: 'join', code, seat }); }
  open(code) { return this.request({ t: 'open', code }); }
  watch(code) { return this.request({ t: 'watch', code }); }
  leave() { return this.request({ t: 'leave', code: this.code }); }
  list() { return this.request({ t: 'list' }); }
  start() { this.send({ t: 'start', code: this.code }); }
  handover(seat) { this.send({ t: 'handover', code: this.code, seat }); }
  reclaim() { this.send({ t: 'reclaim', code: this.code }); }

  /** Telegram till alla makter (to = null) eller en plats. Avvisas med OnlineError('rate-limited' | 'telegram-limit' | …). */
  telegram(to, text) { return this.request({ t: 'telegram', code: this.code, to: to ?? null, text }); }

  /** Min plats (som i `seats`) eller null för åskådare. */
  get mySeat() { return this.seat === null ? null : this.seats[this.seat] ?? null; }

  // ---------------------------------------------------------------- partiet

  get myTurn() {
    const s = this.state;
    const who = s?.proposal ? s.proposal.to : s?.turn;     // mottagaren av ett paktförslag svarar
    return !!s && this.seat !== null && s.phase !== 'over' && who === this.seat && this.seats[this.seat]?.kind === 'human';
  }

  /** Skicka ett drag. Löses med servern 'events' för draget, avvisas med OnlineError(reason) vid 'reject'. */
  act(action) {
    const seq = this.seq;
    return new Promise((resolve, reject) => {
      if (!this.send({ t: 'act', code: this.code, seq, action })) { reject(new OnlineError('offline', 'Not connected.')); return; }
      const offE = this.on('events', (m) => { if (m.seq === seq + 1) { done(); resolve(m); } });
      const offR = this.on('reject', (m) => { done(); reject(Object.assign(new OnlineError(m.reason, m.reason), { state: m.state, seq: m.seq })); });
      const done = () => { offE(); offR(); };
    });
  }

  /** Dragen (med händelser) mellan två sekvensnummer, för att spela upp det man missat. */
  async history(from, to = this.seq) {
    const out = [];
    for (let f = from; f < to; f += 500) {
      const h = await this.request({ t: 'history', code: this.code, from: f, to: Math.min(to, f + 500) });
      out.push(...h.moves);
    }
    return out;
  }
}
