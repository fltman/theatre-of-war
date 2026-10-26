// Lagringen: SQLite via node:sqlite (inbyggt i Node 25, inga native-beroenden). En fil, WAL-läge.
// Partierna lagras som frö + dragloggen (append-only); ögonblicksbilden i games.state är bara en genväg
// för snabb laddning. Ett parti kan alltid räknas om ur seed + actions (se Games.replay).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created    INTEGER NOT NULL,
  seen       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL CHECK (status IN ('lobby', 'active', 'over')),
  host         TEXT REFERENCES players(id),
  options      TEXT NOT NULL,
  seed         INTEGER NOT NULL,
  state        TEXT,
  start_events TEXT,
  seq          INTEGER NOT NULL DEFAULT 0,
  created      INTEGER NOT NULL,
  updated      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_status ON games(status, updated);
CREATE TABLE IF NOT EXISTS seats (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat    INTEGER NOT NULL,
  player  TEXT REFERENCES players(id),
  faction TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('human', 'ai')),
  ai      TEXT NOT NULL,
  name    TEXT NOT NULL,
  PRIMARY KEY (game_id, seat)
);
CREATE INDEX IF NOT EXISTS seats_player ON seats(player);
CREATE TABLE IF NOT EXISTS actions (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  seat    INTEGER NOT NULL,
  action  TEXT NOT NULL,
  events  TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  PRIMARY KEY (game_id, seq)
);
CREATE TABLE IF NOT EXISTS stories (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  story   TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stories_game ON stories(game_id, seq);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
  db.exec(SCHEMA);
  return new Store(db);
}

const J = (s) => (s == null ? null : JSON.parse(s));

export class Store {
  constructor(db) {
    this.db = db;
    const p = (sql) => db.prepare(sql);
    this.q = {
      playerByHash: p('SELECT id, name FROM players WHERE token_hash = ?'),
      playerById: p('SELECT id, name FROM players WHERE id = ?'),
      insertPlayer: p('INSERT INTO players (id, name, token_hash, created, seen) VALUES (?, ?, ?, ?, ?)'),
      renamePlayer: p('UPDATE players SET name = ? WHERE id = ?'),
      seenPlayer: p('UPDATE players SET seen = ? WHERE id = ?'),
      insertGame: p('INSERT INTO games (code, status, host, options, seed, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      gameByCode: p('SELECT * FROM games WHERE code = ?'),
      gameById: p('SELECT * FROM games WHERE id = ?'),
      codeExists: p('SELECT 1 FROM games WHERE code = ?'),
      startGame: p("UPDATE games SET status = 'active', state = ?, start_events = ?, seq = 0, updated = ? WHERE id = ?"),
      saveState: p('UPDATE games SET state = ?, seq = ?, status = ?, updated = ? WHERE id = ?'),
      touchGame: p('UPDATE games SET updated = ? WHERE id = ?'),
      insertSeat: p('INSERT INTO seats (game_id, seat, player, faction, kind, ai, name) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      seats: p('SELECT seat, player, faction, kind, ai, name FROM seats WHERE game_id = ? ORDER BY seat'),
      setSeat: p('UPDATE seats SET player = ?, kind = ?, name = ? WHERE game_id = ? AND seat = ?'),
      insertAction: p('INSERT INTO actions (game_id, seq, seat, action, events, ts) VALUES (?, ?, ?, ?, ?, ?)'),
      actions: p('SELECT seq, seat, action, events FROM actions WHERE game_id = ? AND seq > ? AND seq <= ? ORDER BY seq'),
      insertStory: p('INSERT INTO stories (game_id, seq, story, created) VALUES (?, ?, ?, ?)'),
      stories: p('SELECT id, seq, story FROM stories WHERE game_id = ? ORDER BY seq, id'),
      activeGames: p("SELECT id FROM games WHERE status = 'active'"),
      openGames: p(`SELECT g.id FROM games g WHERE g.status = 'lobby'
        AND EXISTS (SELECT 1 FROM seats s WHERE s.game_id = g.id AND s.kind = 'human' AND s.player IS NULL)
        ORDER BY g.updated DESC LIMIT ?`),
      myGames: p(`SELECT DISTINCT g.id FROM games g LEFT JOIN seats s ON s.game_id = g.id
        WHERE (s.player = ? OR g.host = ?) AND (g.status != 'over' OR g.updated > ?)
        ORDER BY g.updated DESC LIMIT ?`),
    };
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  playerByHash(h) { return this.q.playerByHash.get(h) ?? null; }
  playerById(id) { return this.q.playerById.get(id) ?? null; }
  insertPlayer(id, name, hash) { const now = Date.now(); this.q.insertPlayer.run(id, name, hash, now, now); }
  renamePlayer(id, name) { this.q.renamePlayer.run(name, id); }
  seen(id) { this.q.seenPlayer.run(Date.now(), id); }

  codeExists(code) { return !!this.q.codeExists.get(code); }

  insertGame({ code, host, options, seed, seats }) {
    return this.tx(() => {
      const now = Date.now();
      const r = this.q.insertGame.run(code, 'lobby', host, JSON.stringify(options), seed, now, now);
      const id = Number(r.lastInsertRowid);
      for (const s of seats) this.q.insertSeat.run(id, s.seat, s.player, s.faction, s.kind, s.ai, s.name);
      return id;
    });
  }

  game(id) {
    const g = this.q.gameById.get(id);
    return g ? { ...g, options: J(g.options), state: J(g.state), start_events: J(g.start_events), seats: this.seats(id) } : null;
  }
  gameIdByCode(code) { return this.q.gameByCode.get(code)?.id ?? null; }
  seats(id) { return this.q.seats.all(id).map((s) => ({ ...s })); }
  setSeat(id, seat, player, kind, name) { this.q.setSeat.run(player, kind, name, id, seat); this.q.touchGame.run(Date.now(), id); }

  start(id, state, events) { this.q.startGame.run(JSON.stringify(state), JSON.stringify(events), Date.now(), id); }

  // Ett godkänt drag: loggrad + ny ögonblicksbild i samma transaktion.
  append(id, seq, seat, action, events, state) {
    this.tx(() => {
      this.q.insertAction.run(id, seq, seat, JSON.stringify(action), JSON.stringify(events), Date.now());
      this.q.saveState.run(JSON.stringify(state), seq, state.phase === 'over' ? 'over' : 'active', Date.now(), id);
    });
  }

  actions(id, from = 0, to = Number.MAX_SAFE_INTEGER) {
    return this.q.actions.all(id, from, to).map((r) => ({ seq: r.seq, by: r.seat, action: J(r.action), events: J(r.events) }));
  }

  addStory(id, seq, story) { this.q.insertStory.run(id, seq, JSON.stringify(story), Date.now()); }
  stories(id) { return this.q.stories.all(id).map((r) => ({ id: r.id, seq: r.seq, story: J(r.story) })); }

  activeGameIds() { return this.q.activeGames.all().map((r) => r.id); }
  openGameIds(limit = 30) { return this.q.openGames.all(limit).map((r) => r.id); }
  myGameIds(player, limit = 30) {
    return this.q.myGames.all(player, player, Date.now() - 7 * 86400_000, limit).map((r) => r.id);
  }

  close() { this.db.close(); }
}
