// Onlineservern med riktiga ws-klienter: identitet, lobby, hela partier (människor styrda av AI:n i testet),
// avslag, åskådare, återanslutning, överlämning, omstart mitt i ett parti och omräkning ur dragloggen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { decide } from '../shared/ai.js';
import { actor } from '../shared/engine.js';
import { IDS, TERRITORY } from '../shared/map.js';

const dir = mkdtempSync(join(tmpdir(), 'tow-'));
const quiet = () => {};
const fast = { bucket: 1e9, refill: 1e9 };   // AI-styrda "människor" spelar snabbare än hastighetsgränsen
test.after(() => rmSync(dir, { recursive: true, force: true }));
// Allt som öppnas stängs efter varje test, även när testet fallerar (annars hänger node --test kvar).
const servers = new Set(), clients = new Set();
// protokollet testas, inte generalernas skärpa: snabba regelbaserade beslut
async function serve(opts) { const s = await startServer({ aiThink: false, ...opts }); servers.add(s); const close = s.close; s.close = () => { servers.delete(s); return close(); }; return s; }
test.afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients.clear();
  for (const s of [...servers]) await s.close();
});

class Client {
  constructor(port) {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    clients.add(this);
    this.msgs = [];
    this.waiters = [];
    this.rid = 0;
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      for (const fn of [...this.listeners ?? []]) fn(m);
      this.flush();
    });
    this.closed = new Promise((r) => this.ws.on('close', (code) => r(code)));
  }
  static async connect(port, hello = {}) {
    const c = new Client(port);
    await new Promise((res, rej) => { c.ws.once('open', res); c.ws.once('error', rej); });
    const w = await c.request({ t: 'hello', ...hello });
    c.player = w.player;
    c.token = w.token ?? hello.token;
    return c;
  }
  on(fn) { (this.listeners ??= []).push(fn); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  flush() {
    for (const w of [...this.waiters]) {
      const m = this.msgs.find((x) => !x.used && w.pred(x));
      if (m) { m.used = true; this.waiters.splice(this.waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(m); }
    }
  }
  wait(pred, ms = 8000) {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve, timer: setTimeout(() => reject(new Error('väntade förgäves')), ms) };
      this.waiters.push(w);
      this.flush();
    });
  }
  request(m, ms) {
    const rid = ++this.rid;
    this.send({ ...m, rid });
    return this.wait((x) => x.rid === rid, ms);
  }
  close() { this.ws.close(); return this.closed; }
}

// Styr en människoplats med AI:n (på den offentliga vyn av tillståndet, som en riktig klient har).
// truth: () => ({ state, seq }) ger AI:n serverns fulla läge (krigsdimma: den offentliga vyn har null-arméer).
function autopilot(c, code, seat, truth = null) {
  let sent = -1, last = null, kind = 'human', on = true;
  const go = () => {
    if (!on || !last || kind !== 'human') return;
    let { state, seq } = last;
    if (truth) { const t = truth(); if (t.seq !== seq) return; state = t.state; }
    if (state.phase === 'over' || actor(state) !== seat || sent === seq) return;   // svarar också på paktförslag
    sent = seq;
    c.send({ t: 'act', code, seq, action: decide(state) });
  };
  c.on((m) => {
    if (m.code !== code) return;
    if (m.seats) kind = m.seats[seat].kind;
    if (m.state && (m.t === 'start' || m.t === 'events' || m.t === 'game' || m.t === 'reject')) {
      if (!last || m.seq >= last.seq) last = { state: m.state, seq: m.seq };
      if (m.t === 'reject' && on) { sent = -1; assert.fail(`avslag: ${m.reason}`); }
    }
    go();
  });
  return { stop() { on = false; }, kick() { go(); } };
}

const victory = (m) => m.t === 'events' && m.events.some((e) => e.type === 'victory');

function sameWar(a, b) {
  assert.deepEqual(a.owner, b.owner);
  assert.deepEqual(a.armies, b.armies);
  assert.equal(a.turn, b.turn);
  assert.equal(a.round, b.round);
  assert.equal(a.phase, b.phase);
  assert.equal(a.winner, b.winner);
  assert.equal(a.rng, b.rng);
  assert.deepEqual(a.deck, b.deck);
  assert.deepEqual(a.players.map((p) => [p.alive, p.cards]), b.players.map((p) => [p.alive, p.cards]));
}

test('identitet: ny spelare får token, samma token ger samma spelare', async () => {
  const srv = await serve({ port: 0, dbPath: join(dir, 'id.db'), aiDelay: 0, log: quiet, rate: fast });
  const a = await Client.connect(srv.port, { name: 'Montgomery' });
  assert.ok(a.token && a.token.length > 20);
  assert.equal(a.player.name, 'Montgomery');
  const b = await Client.connect(srv.port, { token: a.token, name: '  Monty \n ' });
  assert.equal(b.player.id, a.player.id);
  assert.equal(b.player.name, 'Monty');
  const c = await Client.connect(srv.port, { token: 'x'.repeat(30) });
  assert.notEqual(c.player.id, a.player.id);
  const e = await c.request({ t: 'nonsense' });
  assert.equal(e.code, 'bad-request');
  for (const x of [a, b, c]) await x.close();
  await srv.close();
});

test('helt parti: två människor, två AI, en åskådare; omräkning ur loggen', async () => {
  const srv = await serve({ port: 0, dbPath: join(dir, 'full.db'), aiDelay: 0, log: quiet, rate: fast });
  const A = await Client.connect(srv.port, { name: 'Alpha' });
  const B = await Client.connect(srv.port, { name: 'Bravo' });
  const C = await Client.connect(srv.port, { name: 'Charlie' });
  const created = await A.request({
    t: 'create',
    seats: [{ kind: 'human', faction: 'red' }, { kind: 'human', faction: 'blue' }, { kind: 'ai', faction: 'green', ai: 'aggressive' }, { kind: 'ai', faction: 'yellow', ai: 'cautious' }],
  });
  assert.equal(created.t, 'created');
  assert.equal(created.you.seat, 0);
  assert.ok(created.you.host);
  const code = created.code;
  assert.match(code, /^[A-Z2-9]{6}$/);

  // lobbyn visar en öppen plats
  const lobby = await C.request({ t: 'list' });
  assert.ok(lobby.open.some((g) => g.code === code && g.seats[1].open));

  const joined = await B.request({ t: 'join', code: code.toLowerCase() });
  assert.equal(joined.you.seat, 1);
  const seatsMsg = await A.wait((m) => m.t === 'seats' && m.seats[1].claimed);
  assert.equal(seatsMsg.seats[1].name, 'Bravo');
  const watching = await C.request({ t: 'watch', code });
  assert.equal(watching.you.seat, null);

  // bara värden får starta
  const notHost = await B.request({ t: 'start', code });
  assert.equal(notHost.code, 'not-host');

  const pa = autopilot(A, code, 0);
  const pb = autopilot(B, code, 1);
  A.send({ t: 'start', code });
  const [start] = await Promise.all([C.wait((m) => m.t === 'start'), A.wait((m) => m.t === 'start')]);
  assert.equal(start.seq, 0);
  assert.equal(start.state.rng, undefined, 'slumpen får inte skickas till klienterna');
  assert.equal(start.state.deck, undefined);
  assert.equal(typeof start.state.deckSize, 'number');

  const [endA, endB, endC] = await Promise.all([A.wait(victory, 60000), B.wait(victory, 60000), C.wait(victory, 60000)]);
  pa.stop(); pb.stop();
  assert.equal(endA.seq, endC.seq);
  assert.equal(endB.seq, endC.seq);
  const final = endC.state;
  assert.equal(final.phase, 'over');
  assert.equal(new Set(IDS.map((id) => final.owner[id])).size, 1);
  // åskådaren ser inga kort; A ser bara sina egna
  for (const p of final.players) assert.ok(p.cards.every((x) => x === null));
  assert.ok(endA.state.players[0].cards.every(Number.isInteger));
  assert.ok(endA.state.players.slice(1).every((p) => p.cards.every((x) => x === null)));

  // omräkning ur frö + drag ger exakt samma krig som ögonblicksbilden
  const g = srv.games.byCode(code);
  sameWar(srv.games.replay(code), g.state);
  const row = srv.store.game(g.id);
  assert.equal(row.status, 'over');
  assert.equal(row.seq, endC.seq);

  // historiken: dragen med händelser, i ordning
  const h = await C.request({ t: 'history', code, from: 0, to: 25 });
  assert.equal(h.moves.length, 25);
  assert.deepEqual(h.moves.map((m) => m.seq), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.ok(h.moves.every((m) => Array.isArray(m.events) && m.action.type));

  // ett drag efter slutet avvisas
  const late = await A.request({ t: 'act', code, seq: endA.seq, action: { type: 'endTurn' } });
  assert.equal(late.reason, 'over');
  for (const x of [A, B, C]) await x.close();
  await srv.close();
});

test('avslag: fel tur, fel sekvensnummer, otillåtet drag, åskådare, ej startat', async () => {
  const srv = await serve({ port: 0, dbPath: join(dir, 'rej.db'), aiDelay: 0, log: quiet, rate: fast });
  const A = await Client.connect(srv.port);
  const B = await Client.connect(srv.port);
  const C = await Client.connect(srv.port);
  const { code } = await A.request({ t: 'create', seats: [{ kind: 'human', faction: 'red' }, { kind: 'human', faction: 'blue' }, { kind: 'ai', faction: 'black' }] });
  await B.request({ t: 'join', code });
  const early = await A.request({ t: 'act', code, seq: 0, action: { type: 'endTurn' } });
  assert.equal(early.reason, 'not-started');
  await C.request({ t: 'watch', code });
  A.send({ t: 'start', code });
  const s = await A.wait((m) => m.t === 'start');
  let st = s.state, seq = s.seq;
  // vänta tills det är en människas tur (AI:n kan börja)
  while (st.turn === 2) { const m = await A.wait((x) => x.t === 'events'); st = m.state; seq = m.seq; }
  const [me, other] = st.turn === 0 ? [A, B] : [B, A];
  const r1 = await other.request({ t: 'act', code, seq, action: { type: 'endTurn' } });
  assert.equal(r1.reason, 'not-your-turn');
  const r2 = await me.request({ t: 'act', code, seq: seq + 5, action: { type: 'endTurn' } });
  assert.equal(r2.reason, 'seq');
  const theirs = IDS.find((id) => st.owner[id] !== st.turn);
  const r3 = await me.request({ t: 'act', code, seq, action: { type: 'place', territory: theirs, n: 1 } });
  assert.equal(r3.reason, 'not-yours');
  assert.equal(r3.seq, seq);
  assert.ok(r3.state.owner);
  const r4 = await C.request({ t: 'act', code, seq, action: { type: 'endTurn' } });
  assert.equal(r4.reason, 'spectator');
  const r5 = await me.request({ t: 'act', code, seq, action: 'boom' });
  assert.equal(r5.reason, 'bad-action');
  // ett giltigt drag går igenom och kommer till alla
  const mine = IDS.find((id) => st.owner[id] === st.turn);
  me.send({ t: 'act', code, seq, action: { type: 'place', territory: mine, n: 1, junk: 'x'.repeat(100) } });
  const ev = await C.wait((m) => m.t === 'events' && m.seq === seq + 1);
  assert.deepEqual(ev.action, { type: 'place', territory: mine, n: 1 });
  assert.deepEqual(ev.events, [{ type: 'place', player: st.turn, territory: mine, n: 1 }]);
  // samma sekvensnummer igen (dubblett) avvisas
  const dup = await me.request({ t: 'act', code, seq, action: { type: 'place', territory: mine, n: 1 } });
  assert.equal(dup.reason, 'seq');
  for (const x of [A, B, C]) await x.close();
  await srv.close();
});

test('återanslutning med token och överlämning till generalstaben', async () => {
  const srv = await serve({ port: 0, dbPath: join(dir, 're.db'), aiDelay: 0, log: quiet, rate: fast });
  const A = await Client.connect(srv.port, { name: 'Host' });
  let B = await Client.connect(srv.port, { name: 'Guest' });
  const { code } = await A.request({ t: 'create', seats: [{ kind: 'human', faction: 'red' }, { kind: 'human', faction: 'blue' }, { kind: 'ai', faction: 'purple' }] });
  await B.request({ t: 'join', code });
  const pa = autopilot(A, code, 0);
  let pb = autopilot(B, code, 1);
  A.send({ t: 'start', code });
  await A.wait((m) => m.t === 'events' && m.seq > 40, 20000);

  // B tappar förbindelsen; A ser det i platslistan
  pb.stop();
  const tokenB = B.token;
  await B.close();
  const off = await A.wait((m) => m.t === 'seats' && m.seats[1].claimed && !m.seats[1].online);
  assert.equal(off.seats[1].kind, 'human');

  // B kommer tillbaka med sin token och fortsätter där partiet står
  B = await Client.connect(srv.port, { token: tokenB });
  pb = autopilot(B, code, 1);
  const snap = await B.request({ t: 'open', code });
  assert.equal(snap.you.seat, 1);
  assert.ok(snap.seq > 40 && snap.seq <= srv.games.byCode(code).seq);
  pb.kick();
  const seqNow = snap.seq;
  await A.wait((m) => m.t === 'events' && m.seq > seqNow + 30, 20000);

  // B försvinner igen; värden lämnar över platsen till AI:n och kriget går vidare till slutet
  pb.stop();
  await B.close();
  const notHost = await (await Client.connect(srv.port)).request({ t: 'handover', code, seat: 1 });
  assert.equal(notHost.code, 'not-host');
  A.send({ t: 'handover', code, seat: 1 });
  const handed = await A.wait((m) => m.t === 'seats' && m.seats[1].kind === 'ai');
  assert.ok(handed.seats[1].claimed);
  const end = await A.wait(victory, 60000);
  pa.stop();
  sameWar(srv.games.replay(code), srv.games.byCode(code).state);
  assert.equal(end.state.phase, 'over');

  // "mina partier" visar partiet för B
  B = await Client.connect(srv.port, { token: tokenB });
  const mine = await B.request({ t: 'list' });
  assert.ok(mine.mine.some((g) => g.code === code && g.you === 1));
  await A.close(); await B.close();
  await srv.close();
});

test('omstart mitt i ett parti: AI-turerna fortsätter och loggen räcker för att räkna om', async () => {
  const db = join(dir, 'restart.db');
  let srv = await serve({ port: 0, dbPath: db, aiDelay: 3, log: quiet, rate: fast });
  const H = await Client.connect(srv.port, { name: 'Producer' });
  const created = await H.request({ t: 'create', seat: null, seats: [{ kind: 'ai', faction: 'red' }, { kind: 'ai', faction: 'blue', ai: 'aggressive' }, { kind: 'ai', faction: 'yellow', ai: 'cautious' }] });
  assert.equal(created.you.seat, null);
  const code = created.code;
  H.send({ t: 'start', code });
  await H.wait((m) => m.t === 'events' && m.seq >= 60, 20000);
  const tokenH = H.token;
  await srv.close();                                 // mitt i en AI-tur
  await H.closed;

  srv = await serve({ port: 0, dbPath: db, aiDelay: 0, log: quiet, rate: fast });
  const H2 = await Client.connect(srv.port, { token: tokenH });
  assert.equal(H2.player.name, 'Producer');
  const snap = await H2.request({ t: 'watch', code });
  assert.ok(snap.seq >= 60);
  const end = await H2.wait(victory, 60000);
  assert.equal(end.state.phase, 'over');
  sameWar(srv.games.replay(code), srv.games.byCode(code).state);
  await H2.close();
  await srv.close();
});

test('gränser: för stora meddelanden stänger förbindelsen, för många ger rate-limited', async () => {
  const srv = await serve({ port: 0, dbPath: join(dir, 'lim.db'), aiDelay: 0, log: quiet });
  const a = await Client.connect(srv.port);
  for (let i = 0; i < 80; i++) a.send({ t: 'ping' });
  const limited = await a.wait((m) => m.t === 'error' && m.code === 'rate-limited');
  assert.ok(limited);
  const b = await Client.connect(srv.port);
  const before = await b.request({ t: 'create', seats: [{ kind: 'human', faction: 'red' }, { kind: 'human', faction: 'red' }] });
  assert.equal(before.code, 'bad-request');
  const bad = await b.request({ t: 'join', code: 'NOPE00' });
  assert.equal(bad.code, 'no-such-game');
  b.send({ t: 'ping', pad: 'x'.repeat(20000) });
  const code = await b.closed;
  assert.equal(code, 1009);
  const c = new Client(srv.port);
  await new Promise((r) => c.ws.once('open', r));
  const first = await c.request({ t: 'list' });
  assert.equal(first.code, 'hello-first');
  await a.close(); await c.close();
  await srv.close();
});

test('klientbiblioteket src/online.js: anslut, skapa, spela, återanslut efter avbrott', async (t) => {
  const { Online } = await import('../src/online.js');
  const srv = await serve({ port: 0, dbPath: join(dir, 'lib.db'), aiDelay: 0, log: quiet, rate: fast });
  const net = new Online({ url: `ws://localhost:${srv.port}/ws`, name: 'Ike' });
  t.after(() => net.close());                         // annars återansluter biblioteket för evigt om testet fallerar
  const statuses = [];
  net.on('status', (s) => statuses.push(s));
  const me = await net.connect();
  assert.equal(me.name, 'Ike');
  const g = await net.create({ seats: [{ kind: 'human', faction: 'blue' }, { kind: 'ai', faction: 'red' }, { kind: 'ai', faction: 'black' }] });
  assert.equal(net.seat, 0);
  assert.equal(net.code, g.code);
  const started = new Promise((r) => net.on('start', r));
  net.start();
  await started;
  // spela tio egna drag med AI:ns beslut (vänta in turen när AI:n spelar)
  let played = 0;
  while (played < 10 && net.state.phase !== 'over') {
    if (!net.myTurn) { await new Promise((r) => { const off = net.on('events', () => { if (net.myTurn || net.state.phase === 'over') { off(); r(); } }); }); continue; }
    const ev = await net.act(decide(net.state));
    assert.ok(ev.seq <= net.seq);                      // AI:ns svar kan redan ha kommit i samma paket
    played++;
  }
  // ett otillåtet drag avvisas med motorns kod
  if (net.myTurn) await assert.rejects(net.act({ type: 'fortify', from: 'alaska', to: 'argentina', n: 99 }), (e) => typeof e.code === 'string');
  // avbrott: biblioteket återansluter och synkar partiet
  const resync = new Promise((r) => net.on('resync', r));
  net.ws.close(4000);
  const snap = await resync;
  assert.equal(snap.code, g.code);
  assert.equal(net.status, 'online');
  assert.ok(statuses.includes('offline'));
  const moves = await net.history(0, 5);
  assert.equal(moves.length, 5);
  net.close();
});

test('telegram: till alla, privat, ransonering, åskådare, efter återanslutning', async () => {
  const srv = await serve({ port: 0, dbPath: join(dir, 'tg.db'), aiDelay: 0, log: quiet, rate: fast, telegramGap: 40, telegramMax: 3 });
  const A = await Client.connect(srv.port, { name: 'Ike' });
  let B = await Client.connect(srv.port, { name: 'Monty' });
  let C = await Client.connect(srv.port, { name: 'Press' });
  const { code } = await A.request({ t: 'create', seats: [{ kind: 'human', faction: 'red' }, { kind: 'human', faction: 'blue' }, { kind: 'ai', faction: 'green' }] });
  await B.request({ t: 'join', code });
  await C.request({ t: 'watch', code });
  const pause = () => new Promise((r) => setTimeout(r, 60));

  const sent = await A.request({ t: 'telegram', code, to: null, text: '  stop at once\n\u0007STOP  ' });
  assert.equal(sent.t, 'sent');
  const [tb, tc, ta] = await Promise.all([B, C, A].map((x) => x.wait((m) => m.t === 'telegram' && m.id === sent.id)));
  assert.equal(tb.text, 'stop at once STOP');
  assert.equal(tb.from, 0);
  assert.equal(tb.to, null);
  assert.equal(tc.text, tb.text);
  assert.equal(ta.id, sent.id);

  const busy = await A.request({ t: 'telegram', code, to: 1, text: 'TOO SOON' });
  assert.equal(busy.code, 'rate-limited');
  await pause();
  const priv = await A.request({ t: 'telegram', code, to: 1, text: 'x'.repeat(200) });
  const pb = await B.wait((m) => m.t === 'telegram' && m.id === priv.id);
  assert.equal(pb.text.length, 140);
  assert.equal(pb.to, 1);
  await C.request({ t: 'ping' });                       // allt som skulle komma till C har kommit
  assert.ok(!C.msgs.some((m) => m.t === 'telegram' && m.id === priv.id), 'åskådaren ska inte se privata telegram');

  await pause();
  assert.equal((await A.request({ t: 'telegram', code, to: null, text: 'THIRD' })).t, 'sent');
  await pause();
  assert.equal((await A.request({ t: 'telegram', code, to: null, text: 'FOURTH' })).code, 'telegram-limit');
  assert.equal((await C.request({ t: 'telegram', code, to: null, text: 'HELLO' })).code, 'spectator');
  assert.equal((await B.request({ t: 'telegram', code, to: 1, text: 'ME' })).code, 'bad-request');
  assert.equal((await B.request({ t: 'telegram', code, to: 7, text: 'NOBODY' })).code, 'bad-request');
  assert.equal((await B.request({ t: 'telegram', code, to: null, text: '   ' })).code, 'bad-request');

  // efter återanslutning: telegrammen ligger i partiet, privata bara hos avsändare och mottagare
  const tokenB = B.token, tokenC = C.token;
  await B.close(); await C.close();
  B = await Client.connect(srv.port, { token: tokenB });
  C = await Client.connect(srv.port, { token: tokenC });
  const sb = await B.request({ t: 'open', code });
  const sc = await C.request({ t: 'watch', code });
  assert.deepEqual(sb.telegrams.map((x) => x.text), ['stop at once STOP', 'x'.repeat(140), 'THIRD']);
  assert.deepEqual(sc.telegrams.map((x) => x.text), ['stop at once STOP', 'THIRD']);
});

test('lobbyn listar pågående krig att titta på', async () => {
  const srv = await serve({ port: 0, dbPath: join(dir, 'act.db'), aiDelay: 50, log: quiet, rate: fast });
  const A = await Client.connect(srv.port);
  const X = await Client.connect(srv.port);
  const running = await A.request({ t: 'create', seats: [{ kind: 'human', faction: 'red' }, { kind: 'ai', faction: 'blue' }] });
  const waiting = await A.request({ t: 'create', seats: [{ kind: 'human', faction: 'red' }, { kind: 'human', faction: 'blue' }] });
  const film = await A.request({ t: 'create', seat: null, seats: [{ kind: 'ai', faction: 'red' }, { kind: 'ai', faction: 'blue' }] });
  A.send({ t: 'start', code: running.code });
  A.send({ t: 'start', code: film.code });
  await A.wait((m) => m.t === 'start' && m.code === running.code);
  const l = await X.request({ t: 'list' });
  const codes = l.active.map((g) => g.code);
  assert.ok(codes.includes(running.code), 'pågående krig med en människa');
  assert.ok(!codes.includes(waiting.code), 'mönstrande krig hör till open');
  assert.ok(!codes.includes(film.code), 'krig med bara generaler listas inte');
  assert.ok(l.open.some((g) => g.code === waiting.code));
  const one = l.active.find((g) => g.code === running.code);
  assert.equal(one.status, 'active');
  assert.equal(one.you, null);
});

// ------------------------------------------------------------------ krigsdimma

// Oberoende av servern: vad en plats får se enligt CONTRACT.md (egna + grannar + pakt-partners; åskådare inget;
// allt när kriget är slut). null = allt.
function seen(state, seat) {
  if (!state.fog || state.phase === 'over') return null;
  const out = new Set();
  if (seat === null) return out;
  const allies = new Set((state.pacts ?? []).filter((x) => x.a === seat || x.b === seat).map((x) => (x.a === seat ? x.b : x.a)));
  for (const t of IDS) if (state.owner[t] === seat || allies.has(state.owner[t])) { out.add(t); for (const n of TERRITORY[t].neighbors) out.add(n); }
  return out;
}

// Alla ställen där en mottagare fick ett antal den inte ska se (och där den inte fick det den ska se).
function fogLeaks(msgs, seat) {
  const out = [];
  let prev = null;
  for (const m of msgs) {
    if (!m.state || !['start', 'game', 'events', 'reject'].includes(m.t)) continue;
    const st = m.state;
    const vis = seen(st, seat);
    for (const t of IDS) {
      const hidden = vis && !vis.has(t);
      if (hidden && st.armies[t] !== null) out.push(`${m.t}#${m.seq} state.armies.${t}`);
      if (!hidden && !Number.isInteger(st.armies[t])) out.push(`${m.t}#${m.seq} saknar state.armies.${t}`);
    }
    if (vis && st.occupy && !vis.has(st.occupy.from) && st.occupy.max !== null) out.push(`${m.t}#${m.seq} occupy.max`);
    if (m.t === 'events' && prev) {
      const a = seen(prev, seat), b = vis;
      const u = a && b ? new Set([...a, ...b]) : null;
      const see = (t) => !u || u.has(t);
      for (const e of m.events) {
        if (e.type === 'place' && !see(e.territory) && e.n !== null) out.push(`events#${m.seq} place.n ${e.territory}`);
        if (e.type === 'battle' && !see(e.from) && e.armies.from !== null) out.push(`events#${m.seq} battle.armies.from ${e.from}`);
        if (e.type === 'battle' && !see(e.to) && e.armies.to !== null) out.push(`events#${m.seq} battle.armies.to ${e.to}`);
        if ((e.type === 'occupy' || e.type === 'fortify') && !see(e.from) && !see(e.to) && e.n !== null) out.push(`events#${m.seq} ${e.type}.n`);
      }
    }
    prev = st;
  }
  return out;
}

async function fogWar(leak, untilOver) {
  const srv = await serve({ port: 0, dbPath: join(dir, `fog-${leak ?? 'none'}.db`), aiDelay: 0, log: quiet, rate: fast, fogLeak: leak });
  const A = await Client.connect(srv.port);
  const B = await Client.connect(srv.port);
  const C = await Client.connect(srv.port);
  const created = await A.request({
    t: 'create', options: { fog: true },
    seats: [{ kind: 'human', faction: 'red' }, { kind: 'human', faction: 'blue' }, { kind: 'ai', faction: 'green', ai: 'aggressive' }, { kind: 'ai', faction: 'yellow' }],
  });
  assert.equal(created.options.fog, true);
  const code = created.code;
  await B.request({ t: 'join', code });
  await C.request({ t: 'watch', code });
  const truth = () => { const g = srv.games.byCode(code); return { state: g.state, seq: g.seq }; };
  const pa = autopilot(A, code, 0, truth), pb = autopilot(B, code, 1, truth);
  A.send({ t: 'start', code });
  if (untilOver) await C.wait(victory, 120000);
  else await C.wait((m) => m.t === 'events' && m.seq >= 120, 60000);
  pa.stop(); pb.stop();
  await Promise.all([A, B, C].map((x) => x.request({ t: 'ping' })));
  return { srv, code, A, B, C };
}

test('krigsdimma: planterade läckor i läget och i händelserna fälls av kontrollen', async () => {
  for (const leak of ['state', 'battle']) {
    const { srv, A, B, C } = await fogWar(leak, false);
    const found = [...fogLeaks(A.msgs, 0), ...fogLeaks(B.msgs, 1), ...fogLeaks(C.msgs, null)];
    assert.ok(found.length > 0, `den planterade läckan '${leak}' måste fällas`);
    assert.ok(found.some((x) => (leak === 'state' ? /state\.armies/ : /battle\.armies/).test(x)), `läckan '${leak}' ska synas som sådan`);
    await srv.close();
  }
});

test('krigsdimma: ingen ser arméer den inte ska se, varken i läget, händelserna eller historiken', async () => {
  const { srv, code, A, B, C } = await fogWar(null, true);
  assert.deepEqual(fogLeaks(A.msgs, 0), []);
  assert.deepEqual(fogLeaks(B.msgs, 1), []);
  assert.deepEqual(fogLeaks(C.msgs, null), []);
  // spelarna ser en del av kartan, inte allt och inte inget (annars prövar kontrollen ingenting)
  for (const [x, seat] of [[A, 0], [B, 1]]) {
    const m = x.msgs.find((y) => y.t === 'events' && y.seq === 50);
    const hidden = IDS.filter((t) => m.state.armies[t] === null).length;
    assert.ok(hidden > 0 && hidden < IDS.length, `plats ${seat} ser ${IDS.length - hidden} av ${IDS.length}`);
    assert.ok(IDS.filter((t) => m.state.owner[t] === seat).every((t) => Number.isInteger(m.state.armies[t])));
  }
  // åskådaren såg ägandet men inga arméer så länge kriget pågick
  const mid = C.msgs.find((m) => m.t === 'events' && m.seq === 50);
  assert.ok(IDS.every((t) => Number.isInteger(mid.state.owner[t]) && mid.state.armies[t] === null));
  const before = C.msgs.filter((m) => m.t === 'events' && !victory(m)).flatMap((m) => m.events).filter((e) => e.type === 'battle');
  assert.ok(before.length > 50 && before.every((e) => e.armies.to === null && e.armies.from === null), 'före segern syns inga antal i slagen');
  // efter kriget ser alla allt
  const end = C.msgs.find(victory);
  assert.ok(IDS.every((t) => Number.isInteger(end.state.armies[t])));
  // historiken är redigerad likadant som det levande flödet medan kriget pågår (räknas om ur loggen)
  const g = srv.games.byCode(code);
  g.status = 'active';                                  // låtsas att kriget pågår: historiken redigeras då
  const live = new Map(A.msgs.filter((m) => m.t === 'events').map((m) => [m.seq, m.events]));
  const h = srv.games.history(code, 0, 200, { id: g.seats[0].player });
  assert.equal(h.moves.length, 200);
  for (const mv of h.moves) assert.deepEqual(mv.events, live.get(mv.seq), `historiken för drag ${mv.seq}`);
  const hs = srv.games.history(code, 0, 200, null);
  assert.ok(hs.moves.flatMap((m) => m.events).filter((e) => e.type === 'battle').every((e) => e.armies.from === null && e.armies.to === null));
  g.status = 'over';
});
