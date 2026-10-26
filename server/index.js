// Theatre of War online: WebSocket på /ws och GET /health. Protokollet står i PROTOCOL.md, spellogiken i
// games.js och lagringen i db.js – här finns bara sockets, prenumerationer, närvaro och hastighetsbegränsning.
//   node server/index.js            (PORT=8261, DB=server/data/theatre.db, AI_DELAY_MS=400, TRUST_PROXY=1)
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { Games, GameError } from './games.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BYTES = 16 * 1024;          // största meddelande
const BUCKET = 40, REFILL = 20;       // högst 20 meddelanden/s i snitt, skurar upp till 40
const CREATES_PER_MIN = 10;
const MAX_WATCHERS = 50;
const HEARTBEAT_MS = 30_000;

export function startServer({ port = 8261, dbPath = join(HERE, 'data', 'theatre.db'), aiDelay = 400, trustProxy = false, log = console.log,
  rate = { bucket: BUCKET, refill: REFILL } } = {}) {
  const store = openDb(dbPath);
  const subs = new Map();             // game.id -> Set<ws>

  const viewerSeat = (g, ws) => (ws.player ? games.seatOf(g, ws.player.id) : null);
  const games = new Games({
    store,
    aiDelay,
    broadcast(g, build) {
      const set = subs.get(g.id);
      if (!set) return;
      // samma vy till alla med samma plats (korten skiljer sig mellan platserna)
      const cache = new Map();
      for (const ws of set) {
        const seat = viewerSeat(g, ws);
        if (!cache.has(seat)) cache.set(seat, JSON.stringify(build(seat)));
        send(ws, cache.get(seat));
      }
    },
    isOnline(g, seat) {
      const pid = g.seats[seat]?.player;
      if (!pid) return false;
      for (const ws of subs.get(g.id) ?? []) if (ws.player?.id === pid) return true;
      return false;
    },
  });
  const resumed = games.resume();

  function send(ws, msg) {
    if (ws.readyState !== 1) return;
    ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  function subscribe(ws, g) {
    let set = subs.get(g.id);
    if (!set) subs.set(g.id, (set = new Set()));
    if (set.has(ws)) return;
    const seated = viewerSeat(g, ws) !== null;
    if (!seated) {
      let watchers = 0;
      for (const x of set) if (viewerSeat(g, x) === null) watchers++;
      if (watchers >= MAX_WATCHERS) throw new GameError('room-full', 'Too many spectators at that table.');
    }
    set.add(ws);
    ws.games.add(g.id);
    if (seated) games.pushSeats(g);
  }

  function unsubscribe(ws, gameId) {
    const set = subs.get(gameId);
    if (!set?.delete(ws)) return;
    ws.games.delete(gameId);
    if (!set.size) subs.delete(gameId);
    const g = games.load(gameId);
    if (g && viewerSeat(g, ws) !== null) games.pushSeats(g);
  }

  // ---- högst 10 nya partier per IP och minut
  const creates = new Map();
  const mayCreate = (ip) => {
    const now = Date.now();
    const recent = (creates.get(ip) ?? []).filter((t) => now - t < 60_000);
    const ok = recent.length < CREATES_PER_MIN;
    if (ok) recent.push(now);
    creates.set(ip, recent);
    return ok;
  };

  function handle(ws, m) {
    const rid = typeof m.rid === 'number' || (typeof m.rid === 'string' && m.rid.length < 40) ? m.rid : undefined;
    const reply = (msg) => send(ws, rid === undefined ? msg : { ...msg, rid });
    if (m.t === 'ping') return reply({ t: 'pong' });
    if (m.t === 'hello') {
      const r = games.hello({ token: m.token, name: m.name });
      ws.player = r.player;
      return reply({ t: 'welcome', player: r.player, ...(r.token ? { token: r.token } : {}) });
    }
    if (!ws.player) throw new GameError('hello-first', 'Say hello first.');
    switch (m.t) {
      case 'create': {
        if (!mayCreate(ws.ip)) throw new GameError('rate-limited', 'Too many new wars, wait a minute.');
        const g = games.create(ws.player, { seats: m.seats, seat: m.seat, options: m.options ?? {} });
        subscribe(ws, g);
        return reply({ ...games.snapshot(g, ws.player), t: 'created' });
      }
      case 'join': {
        const g = games.join(ws.player, m.code, Number.isInteger(m.seat) ? m.seat : null);
        subscribe(ws, g);
        return reply(games.snapshot(g, ws.player));
      }
      case 'open':
      case 'watch': {
        const g = games.byCode(m.code);
        subscribe(ws, g);
        return reply(games.snapshot(g, m.t === 'watch' && games.seatOf(g, ws.player.id) === null ? null : ws.player));
      }
      case 'start': {
        games.start(ws.player, m.code);
        return;                                   // alla får 'start'
      }
      case 'act': {
        if (!Number.isInteger(m.seq)) throw new GameError('bad-request', 'Missing move number.');
        const r = games.act(ws.player, m.code, m.seq, m.action);
        if (r.reject) return reply(r.reject);
        return;                                   // alla (även avsändaren) får 'events'
      }
      case 'handover': {
        if (!Number.isInteger(m.seat)) throw new GameError('bad-request', 'Which seat?');
        games.handover(ws.player, m.code, m.seat);
        return;
      }
      case 'reclaim': {
        games.reclaim(ws.player, m.code);
        return;
      }
      case 'leave': {
        const g = games.byCode(m.code);
        games.leave(ws.player, m.code);
        unsubscribe(ws, g.id);
        return reply({ t: 'left', code: g.code });
      }
      case 'list':
        return reply({ t: 'lobby', ...games.list(ws.player) });
      case 'history':
        return reply(games.history(m.code, m.from, m.to));
      default:
        throw new GameError('bad-request', 'Unknown message.');
    }
  }

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, games: games.cache.size, sockets: wss.clients.size }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_BYTES });

  wss.on('connection', (ws, req) => {
    ws.ip = (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
    ws.games = new Set();
    ws.player = null;
    ws.alive = true;
    ws.tokens = rate.bucket;
    ws.last = Date.now();
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      ws.tokens = Math.min(rate.bucket, ws.tokens + ((now - ws.last) / 1000) * rate.refill);
      ws.last = now;
      if (ws.tokens < 1) return send(ws, { t: 'error', code: 'rate-limited', message: 'Slow down.' });
      ws.tokens -= 1;
      let m;
      try {
        if (isBinary) throw new Error();
        m = JSON.parse(data.toString());
        if (!m || typeof m !== 'object' || typeof m.t !== 'string') throw new Error();
      } catch {
        return send(ws, { t: 'error', code: 'bad-request', message: 'Not a message.' });
      }
      try {
        handle(ws, m);
      } catch (e) {
        const code = e instanceof GameError ? e.code : 'server-error';
        if (!(e instanceof GameError)) log('Serverfel:', e);
        send(ws, { t: 'error', code, message: e instanceof GameError ? e.message : 'Something went wrong.', ...(m.rid !== undefined ? { rid: m.rid } : {}) });
      }
    });
    ws.on('close', () => { for (const id of [...ws.games]) unsubscribe(ws, id); });
    ws.on('error', () => {});
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  return new Promise((resolve) => {
    http.listen(port, () => {
      const actual = http.address().port;
      log(`Theatre of War online på :${actual} (/ws), databas ${dbPath}, ${resumed} pågående partier återupptagna`);
      resolve({
        port: actual, games, store,
        close: () => new Promise((done) => {
          clearInterval(beat);
          games.close();
          for (const ws of wss.clients) ws.terminate();
          wss.close(() => http.close(() => { store.close(); done(); }));
        }),
      });
    });
  });
}

if (import.meta.main) {
  const srv = await startServer({
    port: Number(process.env.PORT ?? 8261),
    dbPath: process.env.DB ?? join(HERE, 'data', 'theatre.db'),
    aiDelay: Number(process.env.AI_DELAY_MS ?? 400),
    trustProxy: !!process.env.TRUST_PROXY,
  });
  const stop = async () => { await srv.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
