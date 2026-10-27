// Datorspelarna. decide(state) -> nästa drag för spelaren vars tur det är. Deterministisk (inga slumptal):
// samma läge ger samma beslut, så servern och en repris är överens.
// Strategin: välj en målkontinent, samla trupperna på en utgångspunkt, anfall där oddsen räcker (lägre krav när ett
// anfall tar en kontinent, slår ut en spelare eller ger turens kort), flytta reserver från inlandet till fronten.
import { TERRITORY, CONTINENTS, CONTINENT, CARDS } from './map.js';
import { AI_STYLES } from './factions.js';
import { sets, owned, ownsContinent, path, apply, income, pactBetween, partners, actor, canAttack } from './engine.js';

const STYLE = {
  aggressive: { ratio: 1.0, stop: 1, split: 0 },
  strategist: { ratio: 1.35, stop: 2, split: 0.25 },
  cautious: { ratio: 1.8, stop: 3, split: 0.5 },
};
const styleOf = (st, p) => STYLE[st.players[p].ai] ?? STYLE.strategist;

const enemyNeighbors = (st, t) => TERRITORY[t].neighbors.filter((n) => st.owner[n] !== st.owner[t]);
// hot: grannar som inte är egna och inte en pakt-partners (en gräns mot en partner är lugn så länge pakten håller)
const hostile = (st, t) => { const p = st.owner[t]; const ally = new Set(partners(st, p)); return enemyNeighbors(st, t).filter((n) => !ally.has(st.owner[n])); };
const threat = (st, t) => hostile(st, t).reduce((s, n) => s + st.armies[n], 0);

// Svek: bara när det lönar sig mycket, och olika mycket per personlighet (den försiktige sviker aldrig).
const BETRAY = { aggressive: { value: 8, ratio: 2.5 }, strategist: { value: 12, ratio: 3 }, cautious: null };
function mayBetray(st, p, value, ratio) {
  const b = BETRAY[st.players[p].ai] ?? BETRAY.strategist;
  return !!b && value >= b.value && ratio >= b.ratio;
}

// Hur mycket spelare p vinner på fred med q (positivt = vill ha pakt).
export function pactValue(st, p, q) {
  if (!st.players[q]?.alive || p === q) return -9;
  const wish = continentWish(st, p);
  let border = 0, mine = 0, theirs = 0, opp = 0, guard = 0;
  for (const t of owned(st, p)) {
    const qs = TERRITORY[t].neighbors.filter((n) => st.owner[n] === q);
    if (!qs.length) continue;
    border++;
    mine += st.armies[t];
    for (const x of qs) {
      theirs += st.armies[x];
      opp = Math.max(opp, targetValue(st, p, x, wish) * Math.min(2, (st.armies[t] - 1) / st.armies[x]));
    }
    if (ownsContinent(st, p, TERRITORY[t].continent)) guard = 1;
  }
  if (!border) return 0.1;                                   // ingen gemensam gräns: ofarlig men meningslös
  const count = (r) => owned(st, r).length;
  const leader = st.players.map((_, r) => r).filter((r) => st.players[r].alive).sort((a, b) => count(b) - count(a))[0];
  let v = (theirs / (mine + 1)) * 1.2 - opp * 0.25 + guard * 0.8 - (st.players[q].betrayals ?? 0) * 1.5;
  if (q === leader && count(q) > count(p) * 1.3) v -= 1.2;  // hjälp inte den som redan leder
  return v;
}

const ACCEPT = { aggressive: 0.6, strategist: 0.3, cautious: 0.05 };
// Hur länge en sviken general vägrar all pakt med sveket (månader). Den försiktige förlåter aldrig.
const GRUDGE = { aggressive: 12, strategist: 18, cautious: Infinity };

// Har p ett agg mot q? Ger antal månader sedan sveket, eller null.
export function grudge(st, p, q) {
  const r = st.players[p]?.grudges?.[q];
  return r == null ? null : st.round - r;
}

function answer(st) {
  const { from, to } = st.proposal;
  const g = grudge(st, to, from);
  if (g != null && g < (GRUDGE[st.players[to].ai] ?? 18)) return { type: 'answer', accept: false };
  let v = pactValue(st, to, from);
  if (g != null) v -= 1.5;                                   // förlåtet men inte glömt
  return { type: 'answer', accept: v > (ACCEPT[st.players[to].ai] ?? 0.3) };
}

// Ska generalen ringa någon? Högst var tredje månad, bara med tre eller fler makter kvar, till den granne
// som det lönar sig mest att ha fred med.
function proposal(st, p) {
  const me = st.players[p];
  if (st.phase !== 'reinforce' || st.round < 2) return null;
  if (st.players.filter((x) => x.alive).length < 3) return null;
  if (me.lastProposal != null && st.round - me.lastProposal < 3) return null;
  let best = null, bestV = 0.9;
  st.players.forEach((x, q) => {
    if (q === p || !x.alive || pactBetween(st, p, q) || (x.betrayals ?? 0) >= 2) return;
    if (grudge(st, p, q) != null) return;                    // ring aldrig den som svikit en
    const v = pactValue(st, p, q);
    if (v > bestV) { bestV = v; best = q; }
  });
  return best == null ? null : { type: 'propose', partner: best, months: 3 };
}

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

export function heuristic(st) {
  if (st.proposal) return answer(st);
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
      if (!canAttack(st, from, to)) continue;                  // t.ex. storm till havs
      const def = st.armies[to];
      const v = targetValue(st, p, to, wish);
      if (pactBetween(st, p, st.owner[to]) && !mayBetray(st, p, v, (st.armies[from] - 1) / def)) continue;
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

// ------------------------------------------------------------------ framåtblick (Monte Carlo)
//
// Vid de viktiga besluten – var förstärkningen placeras och om/var generalen anfaller – prövas de bästa
// alternativen (plus att låta bli) genom att spela kriget framåt flera gånger med olika tärningar: resten av den
// egna turen och sedan varje motståndares nästa tur, med den regelbaserade policyn ovan. Slutlägena värderas och
// alternativet med högst medelvärde väljs. Fröna härleds ur läget, så beslutet är deterministiskt.

const THINK = {
  aggressive: { rollouts: 3, cands: 3, terr: 1.25, safety: 0.6 },
  strategist: { rollouts: 5, cands: 4, terr: 1.0, safety: 1.0 },
  cautious: { rollouts: 3, cands: 3, terr: 0.85, safety: 1.5 },
};
const MAX_PLAYOUT = 260;           // säkerhetsgräns för antal drag i en simulering

function mix(a, b) { let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); return (h ^ (h >>> 13)) >>> 0; }

// Hur bra ett läge är för spelare p (jämfört med den starkaste motståndaren).
export function evaluate(st, p, w = THINK.strategist) {
  if (st.phase === 'over') return st.winner === p ? 1e4 : -1e4;
  if (!st.players[p].alive) return -5e3;
  const strength = (q) => {
    const mine = owned(st, q);
    const armies = mine.reduce((n, t) => n + st.armies[t], 0);
    const inc = income(st, q);
    let exposed = 0;
    const ally = new Set(partners(st, q));
    for (const t of mine) {
      const foe = TERRITORY[t].neighbors.reduce((n, x) => n + (st.owner[x] !== q && !ally.has(st.owner[x]) ? st.armies[x] : 0), 0);
      if (foe) exposed += Math.max(0, foe - st.armies[t]);
    }
    return mine.length * w.terr + inc.continents.reduce((n, c) => n + c.bonus, 0) * 2.2 + armies * 0.12
      + inc.total * 0.8 + st.players[q].cards.length * 0.6 - exposed * 0.06 * w.safety;
  };
  let best = -Infinity;
  st.players.forEach((pl, q) => { if (q !== p && pl.alive) best = Math.max(best, strength(q)); });
  return strength(p) - 0.45 * best;
}

// Spela vidare med policyn tills det åter är p:s tur (eller kriget tar slut).
function playout(st, p) {
  let n = 0, left = false;
  while (st.phase !== 'over' && n++ < MAX_PLAYOUT) {
    if (st.turn !== p) left = true;
    else if (left) break;
    st = apply(st, heuristic(st)).state;
  }
  return st;
}

function score(st, action, p, w, seed) {
  let sum = 0;
  for (let k = 0; k < w.rollouts; k++) {
    try {
      const s0 = { ...st, rng: mix(seed, k + 1) };
      let s1 = apply(s0, action).state;
      s1 = playout(s1, p);
      sum += evaluate(s1, p, w);
    } catch { return -Infinity; }
  }
  return sum / w.rollouts;
}

// Kandidater för förstärkningen: de bästa platserna enligt policyns egen värdering.
function placementCandidates(st, p, n) {
  const wish = continentWish(st, p);
  const scored = owned(st, p).filter((t) => enemyNeighbors(st, t).length).map((t) => {
    let opp = 0;
    for (const x of enemyNeighbors(st, t)) opp = Math.max(opp, targetValue(st, p, x, wish) * Math.min(2, (st.armies[t] + st.pending - 1) / (st.armies[x] + 1)));
    const c = TERRITORY[t].continent;
    const guard = ownsContinent(st, p, c) ? Math.max(0, threat(st, t) - st.armies[t]) * 0.6 : 0;
    return { t, s: opp + guard + wish[c] * 0.5 };
  }).sort((a, b) => b.s - a.s);
  return scored.slice(0, n).map((x) => x.t);
}

// Kandidater för anfall: de bästa enligt policyn, utan kvotkravet (simuleringen avgör), plus "sluta".
function attackCandidates(st, p, n, style) {
  const wish = continentWish(st, p);
  const list = [];
  for (const from of owned(st, p)) {
    const force = st.armies[from] - 1;
    if (force < 1) continue;
    for (const to of enemyNeighbors(st, from)) {
      if (!canAttack(st, from, to)) continue;
      const ratio = force / st.armies[to];
      if (ratio < 0.6) continue;
      if (pactBetween(st, p, st.owner[to])) continue;
      list.push({ from, to, s: targetValue(st, p, to, wish) * Math.min(ratio, 3) });
    }
  }
  list.sort((a, b) => b.s - a.s);
  return list.slice(0, n).map(({ from, to }) => ({ type: 'blitz', from, to, stopAt: Math.max(style.stop, Math.ceil(st.armies[to] * 0.5)) }))
    .map((a) => ({ ...a, stopAt: Math.min(a.stopAt, st.armies[a.from] - 1) }));
}

// Generalens beslut. think: false = bara regelbaserat (snabbt, t.ex. i simuleringar och tester).
export function decide(st, { think = true } = {}) {
  if (st.proposal) return answer(st);
  const p = st.turn;
  if (think) { const call = proposal(st, p); if (call) return call; }
  const base = heuristic(st);
  if (!think) return base;
  const w = THINK[st.players[p].ai] ?? THINK.strategist;
  const style = styleOf(st, p);
  const seed = mix(st.rng >>> 0, (st.round << 8) ^ (p << 4) ^ st.pending);

  if (st.phase === 'reinforce' && base.type === 'place' && st.pending > 0) {
    const cands = placementCandidates(st, p, w.cands);
    if (cands.length < 2) return base;
    let best = base, bestScore = -Infinity;
    for (const t of cands) {
      const a = { type: 'place', territory: t, n: st.pending };
      const sc = score(st, a, p, w, seed);
      if (sc > bestScore) { bestScore = sc; best = a; }
    }
    return best;
  }

  if (st.phase === 'attack') {
    const cands = attackCandidates(st, p, w.cands, style);
    if (!cands.length) return base;
    const stop = base.type === 'blitz' ? { type: 'endAttack' } : base;   // "sluta anfalla": policyns förflyttning/turslut
    let best = stop, bestScore = score(st, stop, p, w, seed);
    for (const a of cands) {
      const sc = score(st, a, p, w, seed);
      if (sc > bestScore + 0.05) { bestScore = sc; best = a; }
    }
    return best;
  }
  return base;
}
