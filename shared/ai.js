// Datorspelarna. decide(state) -> nästa drag för spelaren vars tur det är. Deterministisk (inga slumptal):
// samma läge ger samma beslut, så servern och en repris är överens.
// Strategin: välj en målkontinent, samla trupperna på en utgångspunkt, anfall där oddsen räcker (lägre krav när ett
// anfall tar en kontinent, slår ut en spelare eller ger turens kort), flytta reserver från inlandet till fronten.
import { TERRITORY, CONTINENTS, CONTINENT, CARDS } from './map.js';
import { AI_STYLES } from './factions.js';
import { sets, owned, ownsContinent, path } from './engine.js';

const STYLE = {
  aggressive: { ratio: 1.0, stop: 1, split: 0 },
  strategist: { ratio: 1.35, stop: 2, split: 0.25 },
  cautious: { ratio: 1.8, stop: 3, split: 0.5 },
};
const styleOf = (st, p) => STYLE[st.players[p].ai] ?? STYLE.strategist;

const enemyNeighbors = (st, t) => TERRITORY[t].neighbors.filter((n) => st.owner[n] !== st.owner[t]);
const threat = (st, t) => enemyNeighbors(st, t).reduce((s, n) => s + st.armies[n], 0);

// Hur gärna spelaren vill ha varje kontinent (andel ägd, bonus, motstånd).
function continentWish(st, p) {
  const w = {};
  for (const c of CONTINENTS) {
    const ts = c.territories;
    const mine = ts.filter((t) => st.owner[t] === p).length;
    const foe = ts.filter((t) => st.owner[t] !== p).reduce((s, t) => s + st.armies[t], 0);
    w[c.id] = (mine / ts.length) * 2 + c.bonus / ts.length - foe / (ts.length * 12);
  }
  return w;
}

// Värdet av att ta territoriet t för spelare p.
function targetValue(st, p, t, wish) {
  const c = TERRITORY[t].continent;
  const d = st.owner[t];
  let v = 1 + Math.max(0, wish[c]);
  const left = CONTINENT[c].territories.filter((x) => st.owner[x] !== p).length;
  if (left === 1) v += CONTINENT[c].bonus * 1.2;                      // fullbordar kontinenten
  if (ownsContinent(st, d, c)) v += CONTINENT[c].bonus * 0.8;          // bryter motståndarens bonus
  if (owned(st, d).length === 1) v += 6 + st.players[d].cards.length * 2;  // slår ut spelaren (och tar korten)
  return v;
}

export function decide(st) {
  const p = st.turn;
  const me = st.players[p];
  const style = styleOf(st, p);
  const wish = continentWish(st, p);

  if (st.phase === 'reinforce') {
    const all = sets(me.cards);
    if (all.length) {                       // byt så fort ett tretal finns (värdet stiger för alla ändå)
      // föredra tretal med ett eget territorium (+2) och spara jokrar
      const score = (s) => s.filter((i) => CARDS[i].territory && st.owner[CARDS[i].territory] === p).length * 2
        - s.filter((i) => CARDS[i].symbol === 'wild').length * 3;
      return { type: 'trade', cards: all.sort((a, b) => score(b) - score(a))[0] };
    }
    return place(st, p, style, wish);
  }

  if (st.phase === 'occupy') {
    const { from, to, min, max } = st.occupy;
    const tf = TERRITORY[from].neighbors.filter((n) => n !== to && st.owner[n] !== p).reduce((s, n) => s + st.armies[n], 0);
    const tt = TERRITORY[to].neighbors.filter((n) => st.owner[n] !== p).reduce((s, n) => s + st.armies[n], 0);
    if (tf === 0) return { type: 'occupy', n: max };
    const n = Math.round((st.armies[from] - 1) * (tt + 1) / (tf + tt + 2));
    return { type: 'occupy', n: Math.max(min, Math.min(max, n)) };
  }

  if (st.phase === 'attack') {
    const a = bestAttack(st, p, style, wish);
    if (a) return a;
    return fortify(st, p) ?? { type: 'endTurn' };
  }

  if (st.phase === 'fortify') return fortify(st, p) ?? { type: 'endTurn' };
  throw new Error('ai: fas ' + st.phase);
}

function place(st, p, style, wish) {
  const mine = owned(st, p);
  let best = null, bestScore = -Infinity;
  for (const t of mine) {
    const foes = enemyNeighbors(st, t);
    if (!foes.length) continue;
    // anfallsläge: bästa målet härifrån, med de nya trupperna inräknade
    let opp = 0;
    for (const n of foes) {
      const force = st.armies[t] + st.pending - 1;
      const odds = force / (st.armies[n] + 1);
      opp = Math.max(opp, targetValue(st, p, n, wish) * Math.min(2, odds));
    }
    // försvarsbehov: gräns mot en kontinent vi redan äger
    const c = TERRITORY[t].continent;
    const guard = ownsContinent(st, p, c) ? Math.max(0, threat(st, t) - st.armies[t]) * 0.6 * (CONTINENT[c].bonus / 3) : 0;
    const s = opp + guard + wish[c] * 0.5;
    if (s > bestScore) { bestScore = s; best = t; }
  }
  best ??= mine[0];
  // försiktiga lägger en del på den mest hotade gränsen
  if (style.split > 0 && st.pending >= 4) {
    const exposed = mine.filter((t) => t !== best && threat(st, t) > st.armies[t]).sort((a, b) => (threat(st, b) - st.armies[b]) - (threat(st, a) - st.armies[a]))[0];
    if (exposed) return { type: 'place', territory: exposed, n: Math.max(1, Math.floor(st.pending * style.split)) };
  }
  return { type: 'place', territory: best, n: st.pending };
}

function bestAttack(st, p, style, wish) {
  let best = null, bestScore = 0;
  for (const from of owned(st, p)) {
    const force = st.armies[from] - 1;
    if (force < 1) continue;
    for (const to of enemyNeighbors(st, from)) {
      const def = st.armies[to];
      const v = targetValue(st, p, to, wish);
      // kravet sänks för värdefulla mål och för turens första erövring (kortet)
      let need = style.ratio;
      if (v > 4) need *= 0.8;
      if (!st.conquered) need *= 0.85;
      if (force < 2 && def > 1) continue;
      const ratio = force / def;
      if (ratio < need) continue;
      const s = v * Math.min(ratio, 3);
      if (s > bestScore) { bestScore = s; best = { from, to }; }
    }
  }
  if (!best) return null;
  const stopAt = Math.max(style.stop, Math.ceil(st.armies[best.to] * 0.5));
  return { type: 'blitz', from: best.from, to: best.to, stopAt: Math.min(stopAt, st.armies[best.from] - 1) };
}

// Flytta inlandets reserver till den mest hotade sammanhängande gränsen.
function fortify(st, p) {
  const mine = owned(st, p);
  const inland = mine.filter((t) => st.armies[t] > 1 && enemyNeighbors(st, t).length === 0).sort((a, b) => st.armies[b] - st.armies[a]);
  const borders = mine.filter((t) => enemyNeighbors(st, t).length).sort((a, b) => (threat(st, b) - st.armies[b]) - (threat(st, a) - st.armies[a]));
  for (const from of inland) for (const to of borders) {
    if (path(st, from, to)) return { type: 'fortify', from, to, n: st.armies[from] - 1 };
  }
  return null;
}

export { AI_STYLES };
