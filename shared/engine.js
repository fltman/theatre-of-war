// Spelreglerna (klassisk Risk). Rena funktioner: apply(state, action) -> { state, events }. Muterar aldrig indata.
// Tärningar och kortlek kommer ur den seedade slumpen i state.rng, så samma frö + samma dragföljd ger samma krig
// (servern sparar bara fröet och dragen; repriser och journalfilm räknas fram ur loggen).
import { TERRITORIES, TERRITORY, CONTINENTS, CONTINENT, CARDS, IDS, bySea } from './map.js';
import { rand, die, shuffle } from './rng.js';

export const START_ARMIES = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
export const TRADE_VALUES = [4, 6, 8, 10, 12, 15];
export const tradeValue = (n) => (n < TRADE_VALUES.length ? TRADE_VALUES[n] : 15 + 5 * (n - TRADE_VALUES.length + 1));

const fail = (code) => { throw new Error(code); };
const clone = (s) => structuredClone(s);

// ------------------------------------------------------------------ nytt parti

export function newGame({ seed = Date.now() >>> 0, players, setup = 'random', victory = 'world', fog = false }) {
  if (!players || players.length < 2 || players.length > 6) fail('players');
  const st = {
    v: 1, seed: seed >>> 0, rng: seed >>> 0,
    players: players.map((p) => ({ faction: p.faction, name: p.name ?? p.faction, kind: p.kind ?? 'ai', ai: p.ai ?? 'strategist', alive: true, cards: [] })),
    owner: {}, armies: {},
    turn: 0, round: 1, phase: 'reinforce', pending: 0, conquered: false, occupy: null, mustTrade: false,
    deck: [], discard: [], trades: 0, winner: null, victory,
    fog: !!fog,                // krigsdimma (en vy; motorn räknar som vanligt), se visibleTo
    world: null,               // månadens händelse { id, round, ... } eller null
    pacts: [],                 // [{ a, b, made, until }]: inga anfall mellan a och b t.o.m. runda `until`
    proposal: null,            // { from, to, months }: väntar på svar från `to`
  };
  // utdelning: blandade territorier runt bordet, en armé på varje, resten utspritt
  const order = shuffle(st, [...IDS]);
  order.forEach((id, i) => { st.owner[id] = i % st.players.length; st.armies[id] = 1; });
  if (setup === 'random') {
    const per = START_ARMIES[st.players.length];
    st.players.forEach((_, p) => {
      const mine = IDS.filter((id) => st.owner[id] === p);
      for (let left = per - mine.length; left > 0; left--) st.armies[mine[Math.floor(rand(st) * mine.length)]]++;
    });
  }
  st.deck = shuffle(st, CARDS.map((_, i) => i));
  st.turn = Math.floor(rand(st) * st.players.length);
  const events = [];
  startTurn(st, events);
  return { state: st, events };
}

// ------------------------------------------------------------------ frågor

export const owned = (st, p) => IDS.filter((id) => st.owner[id] === p);
export const ownsContinent = (st, p, c) => CONTINENT[c].territories.every((id) => st.owner[id] === p);

export function income(st, p) {
  const mine = owned(st, p);
  const n = mine.length;
  const continents = CONTINENTS.filter((c) => ownsContinent(st, p, c.id)).map((c) => ({ id: c.id, bonus: c.bonus }));
  const base = Math.max(3, Math.floor(n / 3));
  let total = base + continents.reduce((s, c) => s + c.bonus, 0);
  // månadens händelse
  let world = 0;
  const w = st.world;
  if (w && w.round === st.round) {
    if (w.id === 'harvest' && mine.some((t) => TERRITORY[t].continent === w.continent)) world = 2;
    if (w.id === 'oil' && st.owner[w.territory] === p) world = 4;
    if (w.id === 'volunteers') world = 2;
    if (w.id === 'strike' && w.player === p) world = -Math.min(3, total - 3);
  }
  total += world;
  return { total, territories: n, continents, world };
}

// ------------------------------------------------------------------ månadens händelse

const COLD = new Set(['ural', 'siberia', 'yakutsk', 'irkutsk', 'kamchatka', 'mongolia']);
export const WORLD_EVENTS = ['winter', 'heat', 'gales', 'harvest', 'strike', 'oil', 'volunteers'];
const live = (st) => (st.world && st.world.round === st.round ? st.world : null);

// Hur många tärningar angriparen högst får slå (vinter i öster, hetta i Afrika: två).
export function maxDice(st, from, to) {
  const w = live(st);
  if (w?.id === 'winter' && COLD.has(to)) return 2;
  if (w?.id === 'heat' && TERRITORY[to].continent === 'africa') return 2;
  return 3;
}

// Får from anfalla to just nu? (granne, fiende, minst två arméer, inte över havet under storm)
export function canAttack(st, from, to) {
  if (!TERRITORY[from]?.neighbors.includes(to)) return false;
  if (st.owner[from] === st.owner[to] || st.armies[from] < 2) return false;
  if (live(st)?.id === 'gales' && bySea(from, to)) return false;
  return true;
}

function drawWorld(st, ev) {
  st.world = null;
  if (st.round < 2 || rand(st) > 0.55) return;
  const id = WORLD_EVENTS[Math.floor(rand(st) * WORLD_EVENTS.length)];
  const w = { id, round: st.round };
  if (id === 'harvest') w.continent = CONTINENTS[Math.floor(rand(st) * CONTINENTS.length)].id;
  if (id === 'oil') w.territory = rand(st) < 0.6 ? 'middle_east' : 'venezuela';
  if (id === 'strike') {
    const alive = st.players.map((_, i) => i).filter((i) => st.players[i].alive);
    w.player = alive.sort((a, b) => owned(st, b).length - owned(st, a).length)[0];
  }
  st.world = w;
  ev.push({ type: 'worldEvent', ...w });
}

// ------------------------------------------------------------------ krigsdimma

// Territorier vars arméer `seat` ser: egna, grannarnas och pakt-partners. Utan dimma: alla.
export function visibleTo(st, seat) {
  if (!st.fog || seat == null) return new Set(IDS);
  const out = new Set();
  const allies = new Set((st.pacts ?? []).filter((x) => x.a === seat || x.b === seat).map((x) => (x.a === seat ? x.b : x.a)));
  for (const t of IDS) {
    const o = st.owner[t];
    if (o === seat || allies.has(o)) { out.add(t); for (const n of TERRITORY[t].neighbors) out.add(n); }
  }
  return out;
}

export function isSet(ids) {
  if (ids.length !== 3 || new Set(ids).size !== 3) return false;
  const sym = ids.map((i) => CARDS[i].symbol);
  const wild = sym.filter((s) => s === 'wild').length;
  if (wild >= 1) return true;
  return new Set(sym).size === 1 || new Set(sym).size === 3;
}

// Alla giltiga tretal ur en hand (för AI och UI).
export function sets(hand) {
  const out = [];
  for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) for (let k = j + 1; k < hand.length; k++) {
    const s = [hand[i], hand[j], hand[k]];
    if (isSet(s)) out.push(s);
  }
  return out;
}
export const canTrade = (st, p = st.turn) => sets(st.players[p].cards).length > 0;

// Kortaste väg genom egna territorier (för förflyttning). null om ingen finns.
export function path(st, from, to) {
  const p = st.owner[from];
  if (st.owner[to] !== p) return null;
  const prev = { [from]: null };
  const q = [from];
  while (q.length) {
    const c = q.shift();
    if (c === to) break;
    for (const n of TERRITORY[c].neighbors) if (!(n in prev) && st.owner[n] === p) { prev[n] = c; q.push(n); }
  }
  if (!(to in prev)) return null;
  const out = [];
  for (let c = to; c; c = prev[c]) out.unshift(c);
  return out;
}

const aliveCount = (st) => st.players.filter((p) => p.alive).length;

// ------------------------------------------------------------------ diplomati

export const PACT_MONTHS = [3, 6];
export const pactBetween = (st, a, b) => (st.pacts ?? []).find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)) ?? null;
export const partners = (st, p) => (st.pacts ?? []).filter((x) => x.a === p || x.b === p).map((x) => (x.a === p ? x.b : x.a));
// Vem som ska agera nu: mottagaren av ett paktförslag svarar, annars den som har turen.
export const actor = (st) => (st.proposal ? st.proposal.to : st.turn);

// ------------------------------------------------------------------ drag

export function apply(state, action) {
  if (state.phase === 'over') fail('over');
  const st = clone(state);
  st.pacts ??= []; st.proposal ??= null;
  const ev = [];
  const p = st.turn;
  const me = st.players[p];
  // ett obesvarat paktförslag måste besvaras först
  if (st.proposal && action.type !== 'answer') fail('awaiting-answer');
  switch (action.type) {
    case 'propose': {
      if (st.phase !== 'reinforce' && st.phase !== 'attack') fail('phase');
      const q = action.partner;
      const months = PACT_MONTHS.includes(action.months) ? action.months : 3;
      if (!Number.isInteger(q) || q === p || !st.players[q]?.alive) fail('bad-partner');
      if (pactBetween(st, p, q)) fail('already-allied');
      if (me.lastProposal === st.round) fail('one-call-per-turn');
      me.lastProposal = st.round;
      st.proposal = { from: p, to: q, months };
      ev.push({ type: 'proposal', from: p, to: q, months });
      break;
    }
    case 'answer': {
      const pr = st.proposal;
      if (!pr) fail('no-proposal');
      st.proposal = null;
      if (action.accept) {
        const pact = { a: pr.from, b: pr.to, made: st.round, until: st.round + pr.months };
        st.pacts.push(pact);
        ev.push({ type: 'pact', a: pr.from, b: pr.to, months: pr.months, until: pact.until });
      } else ev.push({ type: 'declined', from: pr.from, to: pr.to, months: pr.months });
      break;
    }
    case 'trade': {
      if (st.phase !== 'reinforce') fail('phase');
      const ids = action.cards ?? [];
      if (!ids.every((i) => me.cards.includes(i)) || !isSet(ids)) fail('not-a-set');
      me.cards = me.cards.filter((i) => !ids.includes(i));
      st.discard.push(...ids);
      const value = tradeValue(st.trades++);
      st.pending += value;
      const bonusAt = ids.map((i) => CARDS[i].territory).find((t) => t && st.owner[t] === p);
      if (bonusAt) st.armies[bonusAt] += 2;
      ev.push({ type: 'trade', player: p, cards: ids.map((i) => ({ ...CARDS[i] })), value, bonus: bonusAt ? [bonusAt] : [] });
      if (bonusAt) ev.push({ type: 'place', player: p, territory: bonusAt, n: 2, bonus: true });
      if (me.cards.length < 5) st.mustTrade = false;
      maybeLeaveReinforce(st);
      break;
    }
    case 'place': {
      if (st.phase !== 'reinforce') fail('phase');
      if (st.mustTrade || me.cards.length >= 5) fail('must-trade');
      const n = action.n | 0;
      if (st.owner[action.territory] !== p) fail('not-yours');
      if (n < 1 || n > st.pending) fail('count');
      st.armies[action.territory] += n;
      st.pending -= n;
      ev.push({ type: 'place', player: p, territory: action.territory, n });
      maybeLeaveReinforce(st);
      break;
    }
    case 'attack':
    case 'blitz': {
      if (st.phase !== 'attack') fail('phase');
      const { from, to } = action;
      if (st.owner[from] !== p) fail('not-yours');
      if (!TERRITORY[from]?.neighbors.includes(to)) fail('not-adjacent');
      if (st.owner[to] === p) fail('own-territory');
      if (st.armies[from] < 2) fail('too-few');
      if (!canAttack(st, from, to)) fail('gales');
      const victim = st.owner[to];
      const broken = pactBetween(st, p, victim);
      if (broken) {
        st.pacts = st.pacts.filter((x) => x !== broken);
        me.betrayals = (me.betrayals ?? 0) + 1;
        // den svikne minns: vem och när (generalerna och tidningarna läser det)
        st.players[victim].grudges = { ...(st.players[victim].grudges ?? {}), [p]: st.round };
        ev.push({ type: 'betrayal', player: p, victim, made: broken.made });
      }
      const stopAt = Math.max(1, action.type === 'blitz' ? (action.stopAt ?? 1) : 1);
      do {
        const cap = maxDice(st, from, to);
        const dice = action.type === 'attack' ? Math.min(action.dice ?? cap, cap, st.armies[from] - 1) : Math.min(cap, st.armies[from] - 1);
        if (dice < 1) fail('dice');
        roll(st, ev, from, to, dice);
        if (st.phase !== 'attack') break;                 // erövrat (occupy) eller över
      } while (action.type === 'blitz' && st.armies[from] > stopAt);
      break;
    }
    case 'occupy': {
      if (st.phase !== 'occupy') fail('phase');
      const { from, to, min, max } = st.occupy;
      const n = action.n | 0;
      if (n < min || n > max) fail('count');
      occupy(st, ev, from, to, n);
      break;
    }
    case 'endAttack': {
      if (st.phase !== 'attack') fail('phase');
      st.phase = 'fortify';
      break;
    }
    case 'fortify': {
      if (st.phase !== 'fortify' && st.phase !== 'attack') fail('phase');
      const { from, to } = action;
      const n = action.n | 0;
      if (st.owner[from] !== p || st.owner[to] !== p || from === to) fail('not-yours');
      if (n < 1 || n > st.armies[from] - 1) fail('count');
      const route = path(st, from, to);
      if (!route) fail('no-path');
      st.armies[from] -= n;
      st.armies[to] += n;
      ev.push({ type: 'fortify', player: p, from, to, n, path: route });
      endTurn(st, ev);
      break;
    }
    case 'endTurn': {
      if (st.phase !== 'attack' && st.phase !== 'fortify') fail('phase');
      endTurn(st, ev);
      break;
    }
    default: fail('unknown-action');
  }
  return { state: st, events: ev };
}

// Ett tärningskast. Försvararen slår alltid så många den får (högst 2).
function roll(st, ev, from, to, n) {
  const p = st.turn, d = st.owner[to];
  const a = Array.from({ length: n }, () => die(st)).sort((x, y) => y - x);
  const dd = Array.from({ length: Math.min(2, st.armies[to]) }, () => die(st)).sort((x, y) => y - x);
  const losses = { a: 0, d: 0 };
  for (let i = 0; i < Math.min(a.length, dd.length); i++) (a[i] > dd[i] ? losses.d++ : losses.a++);
  st.armies[from] -= losses.a;
  st.armies[to] -= losses.d;
  ev.push({ type: 'battle', player: p, defender: d, from, to, dice: { a, d: dd }, losses, armies: { from: st.armies[from], to: st.armies[to] } });
  if (st.armies[to] > 0) return;

  // erövring
  const cont = TERRITORY[to].continent;
  const defenderHad = ownsContinent(st, d, cont);
  st.owner[to] = p;
  st.conquered = true;
  ev.push({ type: 'conquer', player: p, defender: d, from, to });
  if (defenderHad) ev.push({ type: 'continent', continent: cont, player: d, gained: false, by: p });
  if (ownsContinent(st, p, cont)) ev.push({ type: 'continent', continent: cont, player: p, gained: true });

  if (owned(st, d).length === 0) {
    const loser = st.players[d];
    loser.alive = false;
    const taken = loser.cards.length;
    st.players[p].cards.push(...loser.cards);
    loser.cards = [];
    ev.push({ type: 'eliminated', player: d, by: p, cards: taken });
    st.pacts = (st.pacts ?? []).filter((x) => x.a !== d && x.b !== d);
    if (st.players[p].cards.length >= 6) st.mustTrade = true;
  }

  const min = n, max = st.armies[from] - 1;
  const won = st.victory === 'world' ? aliveCount(st) === 1 : owned(st, p).length >= st.victory;
  if (won || min >= max) {
    occupy(st, ev, from, to, won ? max : min);
    if (won) { st.phase = 'over'; st.winner = p; ev.push({ type: 'victory', player: p, round: st.round }); }
    return;
  }
  st.phase = 'occupy';
  st.occupy = { from, to, min, max };
}

function occupy(st, ev, from, to, n) {
  st.armies[from] -= n;
  st.armies[to] = n;
  st.occupy = null;
  ev.push({ type: 'occupy', player: st.turn, from, to, n });
  if (st.phase === 'over') return;
  // efter att ha slagit ut någon med många kort: byt ned till högst 4 innan anfallet fortsätter
  st.phase = st.mustTrade ? 'reinforce' : 'attack';
  if (st.mustTrade) st.resume = 'attack';
}

function maybeLeaveReinforce(st) {
  const me = st.players[st.turn];
  if (st.pending > 0) return;
  if (st.mustTrade && me.cards.length >= 5) return;
  st.mustTrade = false;
  if (st.resume === 'attack' || me.cards.length < 5) { st.phase = 'attack'; st.resume = null; }
}

function endTurn(st, ev) {
  const p = st.turn;
  if (st.conquered) {
    if (!st.deck.length && st.discard.length) st.deck = shuffle(st, st.discard.splice(0));
    if (st.deck.length) { st.players[p].cards.push(st.deck.pop()); ev.push({ type: 'card', player: p }); }
  }
  let n = p;
  do {
    n = (n + 1) % st.players.length;
    if (n === 0) {
      st.round++;
      for (const x of (st.pacts ?? []).filter((x) => x.until < st.round)) ev.push({ type: 'pactExpired', a: x.a, b: x.b });
      st.pacts = (st.pacts ?? []).filter((x) => x.until >= st.round);
      drawWorld(st, ev);
    }
  } while (!st.players[n].alive);
  st.turn = n;
  startTurn(st, ev);
}

function startTurn(st, ev) {
  const p = st.turn;
  const inc = income(st, p);
  st.phase = 'reinforce';
  st.pending = inc.total;
  st.conquered = false;
  st.occupy = null;
  st.mustTrade = st.players[p].cards.length >= 5;
  st.resume = null;
  ev.push({ type: 'turn', player: p, round: st.round });
  ev.push({ type: 'income', player: p, ...inc });
}
