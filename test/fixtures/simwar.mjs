// Fejkat krig för pressens tester och press.html: en förenklad, aggressiv Risk-simulering som ger händelser
// enligt händelsetabellen i CONTRACT.md, grupperade per drag (som apply() gör). Inte spelmotorn – bara en fixtur.
//
//   for (const { action, events, state } of warSteps({ seed: 7, players: 4 })) desk.feed(events, state);
//
// `state` är samma levande objekt hela vägen: läs det direkt, spara det inte.

import { TERRITORIES, TERRITORY, CONTINENTS } from '../../shared/map.js';
import { FACTIONS } from '../../shared/factions.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRADE = [4, 6, 8, 10, 12, 15];

// diplomacy: true lägger till telefondiplomati som i motorn: proposal → pact/declined, betrayal (före slagets
// battle-händelser) och pactExpired vid månadsskiftet. Egen slump, så att kriget utan diplomati är oförändrat.
// worldEvents: true drar månadens världshändelse (worldEvent före månadens första turn), fog: true sätter state.fog.
export function* warSteps({ seed = 7, players = 4, maxRounds = 150, diplomacy = false, worldEvents = false, fog = false } = {}) {
  const R = rng(seed);
  const RD = rng(seed ^ 0x5bd1e995);
  const RW = rng(seed ^ 0x2545f491);
  const die = () => 1 + Math.floor(R() * 6);
  const ids = TERRITORIES.map((t) => t.id);
  const state = {
    players: FACTIONS.slice(0, players).map((f) => ({ faction: f.id, name: f.name, kind: 'ai', ai: 'aggressive', alive: true, cards: [] })),
    owner: {}, armies: {}, turn: 0, round: 1, phase: 'reinforce', trades: 0, pacts: [], proposal: null,
    world: null, ...(fog ? { fog: true } : {}),
  };
  const pactWith = (a, b) => state.pacts.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)) || null;
  // Utdelning
  const order = [...ids].sort(() => R() - 0.5);
  order.forEach((t, i) => { state.owner[t] = i % players; state.armies[t] = 1; });
  const start = [0, 0, 40, 35, 30, 25, 20][players];
  for (let p = 0; p < players; p++) {
    const mine = ids.filter((t) => state.owner[t] === p);
    for (let k = mine.length; k < start; k++) state.armies[mine[Math.floor(R() * mine.length)]]++;
  }
  const owned = (p) => ids.filter((t) => state.owner[t] === p);
  const holders = () => Object.fromEntries(CONTINENTS.map((c) => {
    const o = state.owner[c.territories[0]];
    return [c.id, c.territories.every((t) => state.owner[t] === o) ? o : null];
  }));
  const income = (p) => {
    const n = owned(p).length;
    const conts = CONTINENTS.filter((c) => c.territories.every((t) => state.owner[t] === p));
    return { player: p, total: Math.max(3, Math.floor(n / 3)) + conts.reduce((s, c) => s + c.bonus, 0), territories: n,
      continents: conts.map((c) => ({ id: c.id, bonus: c.bonus })) };
  };
  const enemyNb = (t) => TERRITORY[t].neighbors.filter((n) => state.owner[n] !== state.owner[t]);

  let inc = income(0);
  yield { action: { type: 'start' }, events: [{ type: 'turn', player: 0, round: 1 }, { type: 'income', ...inc }], state };

  while (state.round <= maxRounds) {
    const p = state.turn;
    let pending = inc.total;
    // Telefondiplomati: ibland ringer generalen en granne.
    if (diplomacy && RD() < 0.3) {
      const near = [...new Set(owned(p).flatMap((t) => TERRITORY[t].neighbors).map((n) => state.owner[n]))]
        .filter((q) => q !== p && state.players[q].alive && !pactWith(p, q));
      if (near.length) {
        const q = near[Math.floor(RD() * near.length)];
        const months = RD() < 0.6 ? 3 : 6;
        yield { action: { type: 'propose', partner: q, months }, events: [{ type: 'proposal', from: p, to: q, months }], state };
        if (RD() < 0.55) {
          const pact = { a: p, b: q, made: state.round, until: state.round + months };
          state.pacts.push(pact);
          yield { action: { type: 'answer', accept: true }, events: [{ type: 'pact', a: p, b: q, months, until: pact.until }], state };
        } else {
          yield { action: { type: 'answer', accept: false }, events: [{ type: 'declined', from: p, to: q, months }], state };
        }
      }
    }
    // Kort
    if (state.players[p].cards.length >= 3 && (state.players[p].cards.length >= 5 || R() < 0.5)) {
      const cards = state.players[p].cards.splice(0, 3);
      const value = state.trades < TRADE.length ? TRADE[state.trades] : 15 + 5 * (state.trades - TRADE.length + 1);
      state.trades++;
      pending += value;
      yield { action: { type: 'trade' }, events: [{ type: 'trade', player: p, cards: cards.map((t) => ({ territory: t, symbol: 'infantry' })), value, bonus: [] }], state };
    }
    // Placering: på gränsen med svagast granne
    const border = owned(p).filter((t) => enemyNb(t).length);
    const target = border.sort((a, b) => Math.min(...enemyNb(a).map((n) => state.armies[n])) - Math.min(...enemyNb(b).map((n) => state.armies[n])) || state.armies[b] - state.armies[a])[0] || owned(p)[0];
    state.armies[target] += pending;
    yield { action: { type: 'place' }, events: [{ type: 'place', player: p, territory: target, n: pending }], state };

    // Anfall
    let conquered = false;
    for (let guard = 0; guard < 30; guard++) {
      const options = [];
      // Pakten håller – utom när frestelsen blir för stor (svek).
      const treachery = diplomacy && RD() < 0.08;
      for (const from of owned(p)) {
        if (state.armies[from] < 3) continue;
        for (const to of enemyNb(from)) {
          if (diplomacy && pactWith(p, state.owner[to]) && !treachery) continue;
          options.push([from, to, (state.armies[from] - 1) / state.armies[to]]);
        }
      }
      options.sort((a, b) => b[2] - a[2]);
      const pickIt = options.find((o) => o[2] > 1.15) || (R() < 0.15 ? options[0] : null);
      if (!pickIt) break;
      const [from, to] = pickIt;
      const defender = state.owner[to];
      const before = holders();
      const events = [];
      const broken = diplomacy ? pactWith(p, defender) : null;
      if (broken) {
        state.pacts = state.pacts.filter((x) => x !== broken);
        state.players[p].betrayals = (state.players[p].betrayals || 0) + 1;
        events.push({ type: 'betrayal', player: p, victim: defender, made: broken.made });
      }
      // Ibland ger angriparen upp tidigt (ger försvarsmirakel och halvslag).
      const stopAt = R() < 0.12 ? Math.max(2, Math.floor(state.armies[from] * 0.6)) : 1;
      while (state.armies[from] > stopAt && state.armies[to] > 0) {
        const a = Array.from({ length: Math.min(3, state.armies[from] - 1) }, die).sort((x, y) => y - x);
        const d = Array.from({ length: Math.min(2, state.armies[to]) }, die).sort((x, y) => y - x);
        const losses = { a: 0, d: 0 };
        for (let i = 0; i < Math.min(a.length, d.length); i++) (a[i] > d[i] ? losses.d++ : losses.a++);
        state.armies[from] -= losses.a;
        state.armies[to] -= losses.d;
        events.push({ type: 'battle', player: p, defender, from, to, dice: { a, d }, losses, armies: { from: state.armies[from], to: state.armies[to] } });
      }
      if (state.armies[to] === 0) {
        conquered = true;
        state.owner[to] = p;
        events.push({ type: 'conquer', player: p, defender, from, to });
        const after = holders();
        for (const c of CONTINENTS) {
          if (before[c.id] === defender && after[c.id] !== defender) events.push({ type: 'continent', continent: c.id, player: defender, gained: false, by: p });
          if (after[c.id] === p && before[c.id] !== p) events.push({ type: 'continent', continent: c.id, player: p, gained: true });
        }
        if (!owned(defender).length) {
          state.players[defender].alive = false;
          state.pacts = state.pacts.filter((x) => x.a !== defender && x.b !== defender);
          const cards = state.players[defender].cards.splice(0);
          state.players[p].cards.push(...cards);
          events.push({ type: 'eliminated', player: defender, by: p, cards: cards.length });
        }
        if (owned(p).length === ids.length) events.push({ type: 'victory', player: p, round: state.round });
        yield { action: { type: 'blitz', from, to }, events, state };
        const n = Math.max(1, Math.floor((state.armies[from] - 1) * 0.75));
        state.armies[from] -= n;
        state.armies[to] = n;
        yield { action: { type: 'occupy' }, events: [{ type: 'occupy', player: p, from, to, n }], state };
        if (events.some((e) => e.type === 'victory')) return;
      } else {
        yield { action: { type: 'blitz', from, to }, events, state };
      }
    }

    // Förflyttning + nästa spelare
    const events = [];
    const inner = owned(p).filter((t) => !enemyNb(t).length && state.armies[t] > 1);
    if (inner.length) {
      const from = inner.sort((a, b) => state.armies[b] - state.armies[a])[0];
      const to = TERRITORY[from].neighbors.find((n) => state.owner[n] === p);
      if (to) {
        const n = state.armies[from] - 1;
        state.armies[from] = 1;
        state.armies[to] += n;
        events.push({ type: 'fortify', player: p, from, to, n, path: [from, to] });
      }
    }
    if (conquered) {
      state.players[p].cards.push(ids[Math.floor(R() * ids.length)]);
      events.push({ type: 'card', player: p });
    }
    let next = p;
    do {
      next = (next + 1) % players;
      if (next === 0) {
        state.round++;
        for (const x of state.pacts.filter((x) => x.until < state.round)) events.push({ type: 'pactExpired', a: x.a, b: x.b });
        state.pacts = state.pacts.filter((x) => x.until >= state.round);
        state.world = null;
        if (worldEvents && RW() < 0.55) {
          const ids = ['winter', 'heat', 'gales', 'harvest', 'strike', 'oil', 'volunteers'];
          const id = ids[Math.floor(RW() * ids.length)];
          const w = { id, round: state.round };
          if (id === 'harvest') w.continent = CONTINENTS[Math.floor(RW() * CONTINENTS.length)].id;
          if (id === 'strike') {
            const alive = state.players.map((_, i) => i).filter((i) => state.players[i].alive);
            w.player = alive.sort((a, b) => owned(b).length - owned(a).length)[0];
          }
          if (id === 'oil') w.territory = RW() < 0.5 ? 'middle_east' : 'venezuela';
          state.world = w;
          events.push({ type: 'worldEvent', ...w });
        }
      }
    } while (!state.players[next].alive);
    state.turn = next;
    inc = income(next);
    events.push({ type: 'turn', player: next, round: state.round }, { type: 'income', ...inc });
    yield { action: { type: 'endTurn' }, events, state };
  }
}
