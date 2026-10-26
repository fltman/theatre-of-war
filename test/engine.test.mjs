import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TERRITORIES, TERRITORY, IDS, CARDS } from '../shared/map.js';
import { newGame, apply, income, isSet, tradeValue, path } from '../shared/engine.js';
import { decide } from '../shared/ai.js';

test('grannskapet är symmetriskt och kartan har en övergång per grannpar', () => {
  const world = JSON.parse(fs.readFileSync(new URL('../public/map/world.json', import.meta.url)));
  for (const t of TERRITORIES) for (const n of t.neighbors) {
    assert.ok(TERRITORY[n], `${t.id} -> okänt ${n}`);
    assert.ok(TERRITORY[n].neighbors.includes(t.id), `${t.id} <-> ${n} är inte symmetriskt`);
    assert.ok(world.crossings[[t.id, n].sort().join('|')], `ingen övergång ${t.id}|${n}`);
  }
  assert.equal(IDS.length, 42);
  assert.equal(CARDS.length, 44);
});

test('kortvärden och tretal', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(tradeValue), [4, 6, 8, 10, 12, 15, 20, 25]);
  assert.ok(isSet([0, 3, 6]));          // tre infantry
  assert.ok(isSet([0, 1, 2]));          // en av varje
  assert.ok(!isSet([0, 3, 1]));
  assert.ok(isSet([0, 3, 42]));         // joker
});

test('nytt parti: alla territorier ägda, rätt startarméer, första turen i förstärkning', () => {
  const players = ['red', 'blue', 'green', 'yellow'].map((f) => ({ faction: f }));
  const { state, events } = newGame({ seed: 7, players });
  assert.equal(Object.keys(state.owner).length, 42);
  for (let p = 0; p < 4; p++) {
    const sum = IDS.filter((id) => state.owner[id] === p).reduce((s, id) => s + state.armies[id], 0);
    assert.equal(sum, 30);
  }
  assert.equal(state.phase, 'reinforce');
  assert.equal(state.pending, income(state, state.turn).total);
  assert.deepEqual(events.map((e) => e.type), ['turn', 'income']);
});

test('otillåtna drag kastar och ändrar inget', () => {
  const { state } = newGame({ seed: 3, players: ['red', 'blue', 'green'].map((f) => ({ faction: f })) });
  const theirs = IDS.find((id) => state.owner[id] !== state.turn);
  const snap = JSON.stringify(state);
  assert.throws(() => apply(state, { type: 'place', territory: theirs, n: 1 }), /not-yours/);
  assert.throws(() => apply(state, { type: 'attack', from: IDS[0], to: IDS[1] }), /phase/);
  assert.equal(JSON.stringify(state), snap);
});

test('väg genom egna territorier', () => {
  const { state } = newGame({ seed: 1, players: ['red', 'blue'].map((f) => ({ faction: f })) });
  for (const id of IDS) state.owner[id] = 0;
  assert.deepEqual(path(state, 'alaska', 'kamchatka'), ['alaska', 'kamchatka']);
  assert.equal(path(state, 'iceland', 'argentina').at(0), 'iceland');
});

function play(seed, n, styles) {
  const factions = ['red', 'blue', 'green', 'yellow', 'black', 'purple'];
  let { state } = newGame({ seed, players: factions.slice(0, n).map((f, i) => ({ faction: f, ai: styles[i % styles.length] })) });
  let actions = 0;
  const counts = {};
  while (state.phase !== 'over' && state.round <= 250) {
    const a = decide(state);
    const r = apply(state, a);
    state = r.state;
    actions++;
    for (const e of r.events) counts[e.type] = (counts[e.type] || 0) + 1;
    for (const id of IDS) if (state.armies[id] < 1 && state.phase !== 'occupy') throw new Error(`${id} har ${state.armies[id]} arméer efter ${a.type}`);
    if (actions > 60000) throw new Error('för många drag');
  }
  return { state, actions, counts };
}

test('AI mot AI spelar klart utan otillåtna drag', () => {
  const styles = ['aggressive', 'strategist', 'cautious'];
  const results = [];
  for (let seed = 1; seed <= 12; seed++) {
    const n = 2 + (seed % 5);
    const { state, actions, counts } = play(seed, n, styles);
    results.push({ seed, n, over: state.phase === 'over', round: state.round, actions, winner: state.winner, battles: counts.battle, trades: counts.trade ?? 0 });
  }
  console.table(results);
  assert.ok(results.filter((r) => r.over).length >= 10, 'de flesta partier ska ta slut inom 250 rundor');
});
