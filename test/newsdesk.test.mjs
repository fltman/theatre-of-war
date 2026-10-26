// Pressens tester: kör hela simulerade krig genom redaktionen och kontrollerar reportagen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Newsdesk } from '../src/press/newsdesk.js';
import { dateLine, words, monthYear } from '../src/press/words.js';
import { warSteps } from './fixtures/simwar.mjs';
import { TERRITORY, TERRITORIES, CONTINENTS } from '../shared/map.js';
import { FACTIONS } from '../shared/factions.js';
import { LINES, LINE, lines as pbLines, CLIP_TAGS, SPEAKERS, voiceUrl, spoken } from '../src/press/phrasebook.js';
import { bySea } from '../src/press/copy.js';

function runWar(seed, players) {
  let desk;
  let last;
  const stories = [];
  for (const { events, state } of warSteps({ seed, players })) {
    desk ??= new Newsdesk({ players: state.players, seed });
    stories.push(...desk.feed(events, state));
    last = state;
  }
  stories.push(...desk.flush(last));
  return { stories, state: last };
}

const WARS = [[3, 3], [7, 4], [11, 6], [21, 5], [42, 6]].map(([s, p]) => ({ seed: s, players: p, ...runWar(s, p) }));

const texts = (s) => [
  ...(s.paper ? [s.paper.headline, s.paper.deck, s.paper.kicker, ...s.paper.body, s.paper.photoCaption,
    ...s.paper.columns.map((c) => c.text)] : []),
  ...(s.radio ? s.radio.lines.map((l) => l.text) : []),
  ...(s.tv ? [s.tv.title, s.tv.subtitle, ...s.tv.narration.map((l) => l.text), ...s.tv.cards.map((c) => c.text)] : []),
].filter((t) => t != null);

test('datumrad: runda 1 = april 1952', () => {
  assert.equal(dateLine(1, 1), 'Tuesday, April 1, 1952');
  assert.equal(dateLine(10, 2), 'Friday, January 2, 1953');
  assert.equal(monthYear(12), 'March 1953');
  assert.equal(words(42), 'forty-two');
  assert.equal(words(105), 'one hundred and five');
});

test('varje reportage har rätt fält för sitt medium', () => {
  for (const w of WARS) {
    for (const s of w.stories) {
      assert.ok(s.id && s.kind && s.date, s.id);
      assert.ok(['paper', 'radio', 'tv'].includes(s.medium));
      assert.ok(s[s.medium], `${s.id} saknar ${s.medium}`);
      assert.ok(s.radio, `${s.id} saknar radioreserv`);
      assert.ok(Array.isArray(s.focus.territories) && Array.isArray(s.focus.players));
      for (const t of s.focus.territories) assert.ok(TERRITORY[t], t);
      assert.match(s.date, /^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day, [A-Z][a-z]+ \d{1,2}, 19\d\d$/);
      if (s.paper) {
        const p = s.paper;
        assert.ok(p.masthead && p.edition && p.price && p.headline && p.deck && p.body.length >= 2 && p.photoCaption, s.id);
        assert.equal(p.headline, p.headline.toUpperCase());
        assert.equal(p.columns.length, 3);
        assert.equal(p.ads.length, 2);
      }
      if (s.tv) {
        assert.ok(s.tv.cards.length >= 4 && s.tv.narration.length >= 3);
        for (const c of s.tv.cards) assert.ok(['countdown', 'title', 'text', 'map', 'footage'].includes(c.kind) && c.duration > 0);
      }
      for (const l of s.radio.lines) assert.ok(['announcer', 'reporter'].includes(l.speaker), l.id);
    }
  }
});

test('ingen trasig text: inga hål, inga dubbla mellanslag, versal i meningsbörjan', () => {
  for (const w of WARS) {
    for (const s of w.stories) {
      for (const t of texts(s)) {
        assert.doesNotMatch(t, /undefined|null|NaN|\[object|\$\{|  |\s[,.;]/, `${s.id}: ${t}`);
        // Mening börjar med versal, citat eller siffra (efter punkt, utrop, frågetecken och tankstreck i datumraden).
        assert.match(t, /^["“\d—A-Z*]/, `${s.id}: ${t}`);
        const after = t.replace(/\b(St|No|Vol|Mr|Mrs|Dr)\. /g, '$1 ').match(/[.!?] +[a-z]/);
        assert.equal(after, null, `${s.id}: liten bokstav efter punkt: ${t}`);
        assert.doesNotMatch(t, /\) — [a-z]/, `${s.id}: liten bokstav efter datumraden: ${t}`);
      }
    }
  }
});

test('budget: högst en tidning och en journalfilm per månad (utom extraupplagor)', () => {
  for (const w of WARS) {
    const per = {};
    for (const s of w.stories) {
      if (s.priority >= 85) continue;
      const k = s.round + s.medium;
      per[k] = (per[k] || 0) + 1;
      if (s.medium === 'paper' || s.medium === 'tv') assert.ok(per[k] <= 1, `${w.seed}: runda ${s.round} ${s.medium} ${per[k]}`);
      if (s.medium === 'radio' && s.kind !== 'monthly') assert.ok(per[k] <= 4, `${w.seed}: runda ${s.round} radio ${per[k]}`);
    }
    const rounds = w.state.round;
    assert.ok(w.stories.length / rounds <= 6.5, `${w.seed}: ${w.stories.length} reportage på ${rounds} rundor`);
  }
});

test('krigsutbrottet kommer först, och segern blir extraupplaga', () => {
  for (const w of WARS) {
    assert.equal(w.stories[0].kind, 'start');
    assert.equal(w.stories[0].medium, 'paper');
    assert.equal(w.stories[0].paper.edition, 'Extra');
  }
  const wins = WARS.flatMap((w) => w.stories.filter((s) => s.kind === 'victory'));
  assert.ok(wins.length >= 1, 'minst ett simulerat krig ska vinnas');
  for (const s of wins) {
    assert.equal(s.medium, 'paper');
    assert.equal(s.priority, 100);
    assert.equal(s.paper.edition, 'Extra');
  }
});

test('månadsöversikten kommer var tredje månad och sänds den första', () => {
  for (const w of WARS) {
    const monthly = w.stories.filter((s) => s.kind === 'monthly');
    assert.equal(monthly.length, Math.floor((w.state.round - 1) / 3));
    for (const s of monthly) {
      assert.match(s.date, / 1, 19/);
      assert.match(s.radio.lines[0].text, /The World Situation/);
    }
  }
});

test('rubrikerna upprepas inte i rad', () => {
  for (const w of WARS) {
    const h = w.stories.filter((s) => s.paper).map((s) => s.paper.headline);
    for (let i = 1; i < h.length; i++) assert.notEqual(h[i], h[i - 1]);
  }
});

test('känsliga ordval: "Black" och "Yellow" i Asien skrivs som arméer', () => {
  for (const w of WARS) {
    for (const s of w.stories) {
      for (const t of texts(s)) {
        assert.doesNotMatch(t, /\bBlacks\b|Black (master|troops|columns|sentries|patrols|forces advancing)|Goes Black|No Longer Black|exclusively in black/i, t);
      }
      const t0 = TERRITORY[s.focus.territories[0]];
      if (t0 && (t0.continent === 'asia' || t0.continent === 'oceania')) {
        for (const t of texts(s)) assert.doesNotMatch(t, /\bYellows\b|Goes Yellow|Yellow (troops|columns|sentries|patrols|hands|flags|master)\b/i, `${s.id}: ${t}`);
      }
    }
  }
});

// Handgjorda flöden

const players = [{ faction: 'red', alive: true }, { faction: 'blue', alive: true }];
const owner = (o) => ({ players, owner: o, armies: {}, round: 3 });

test('återerövring: rubrik eller ingress säger att det har hänt förut', () => {
  const desk = new Newsdesk({ players, seed: 5, budget: { paper: 9 } });
  desk.feed([{ type: 'turn', player: 0, round: 1 }], owner({ germany: 1, france: 0 }));
  const conquer = (p, d, from) => [
    { type: 'battle', player: p, defender: d, from, to: 'germany', dice: { a: [6, 5, 1], d: [3, 2] }, losses: { a: 0, d: 2 }, armies: { from: 6, to: 0 } },
    { type: 'conquer', player: p, defender: d, from, to: 'germany' },
  ];
  desk.feed(conquer(0, 1, 'france'), owner({ germany: 0, france: 0 }));
  desk.feed(conquer(1, 0, 'scandinavia'), owner({ germany: 1, france: 0 }));
  const s = desk.feed(conquer(0, 1, 'france'), owner({ germany: 0, france: 0 })).find((x) => x.medium === 'paper');
  assert.ok(s, 'tidning');
  assert.match(`${s.paper.headline} ${s.paper.deck}`, /once more|again|back|regain|retake|return/i);
});

test('försvarsmirakel: få mot många som håller blir en nyhet', () => {
  const desk = new Newsdesk({ players, seed: 9 });
  desk.feed([{ type: 'turn', player: 0, round: 1 }], owner({ iceland: 1, greenland: 0 }));
  const roll = (from, to) => ({ type: 'battle', player: 0, defender: 1, from: 'greenland', to: 'iceland', dice: { a: [3, 2, 1], d: [6, 5] }, losses: { a: 2, d: 0 }, armies: { from, to } });
  const st = owner({ iceland: 1, greenland: 0 });
  desk.feed([roll(10, 3)], st);
  desk.feed([roll(8, 3)], st);
  desk.feed([roll(6, 3)], st);
  const out = desk.feed([{ type: 'fortify', player: 0, from: 'greenland', to: 'greenland', n: 0, path: [] }], st);
  const s = out.find((x) => x.kind === 'miracle');
  assert.ok(s, 'mirakel');
  assert.deepEqual(s.focus.territories, ['iceland', 'greenland']);
  assert.match(texts(s).join(' '), /Iceland/);
});

test('deterministiskt: samma frö ger samma tidningar', () => {
  const a = runWar(7, 4).stories.map((s) => s.paper?.headline || s.radio.lines[1]?.text);
  const b = runWar(7, 4).stories.map((s) => s.paper?.headline || s.radio.lines[1]?.text);
  assert.deepEqual(a, b);
});

// ------------------------------------------------------------------ den röstade frasboken

test('frasboken: unika id:n som duger som filnamn, rätt röster, inga hål', () => {
  const seen = new Set();
  for (const l of LINES) {
    assert.match(l.id, /^[a-z0-9._]+$/, l.id);
    assert.ok(!seen.has(l.id), `dubblett ${l.id}`);
    seen.add(l.id);
    assert.ok(SPEAKERS.includes(l.speaker), l.id);
    assert.doesNotMatch(l.text, /undefined|null|NaN|\$\{|[{}\[\]]|  |^\s|\s$/, `${l.id}: ${l.text}`);
    assert.match(l.text, /^[A-Z“"]/, `${l.id}: ${l.text}`);
    assert.match(l.text, /[.!?”]$/, `${l.id}: ${l.text}`);
    if (l.tag) assert.match(l.tag, /^\[[a-z ]+\]$/);
    assert.equal(spoken(l).endsWith(l.text), true);
  }
  assert.equal(voiceUrl('t.germany.fall.1'), 'audio/voice/t.germany.fall.1.mp3');
});

test('frasboken täcker alla territorier, fraktioner och kontinenter', () => {
  for (const t of TERRITORIES) {
    for (const k of ['fall', 'fight', 'hold']) assert.ok(pbLines(`t.${k}:${t.id}`).length, `${k} ${t.id}`);
    assert.ok(pbLines(`n.t:${t.id}`).length, t.id);
    if (TERRITORIES.some((o) => bySea(t.id, o.id))) assert.ok(pbLines(`t.land:${t.id}`).length, `land ${t.id}`);
  }
  for (const f of FACTIONS) {
    for (const k of ['advance', 'retreat', 'back', 'out', 'win', 'hold', 'repulsed', 'muster', 'leadsame', 'leadnew', 'good', 'bad']) {
      assert.ok(pbLines(`f.${k}:${f.id}`).length, `${k} ${f.id}`);
    }
    for (const k of ['strike', 'hold', 'triumph']) assert.ok(pbLines(`n.f.${k}:${f.id}`).length, `n ${k} ${f.id}`);
    for (const c of CONTINENTS) assert.ok(LINE[`fc.${f.id}.${c.id}`] && LINE[`fcs.${f.id}.${c.id}`], `${f.id} ${c.id}`);
  }
  for (const tag of CLIP_TAGS) assert.ok(pbLines(`n.tag:${tag}`).length >= 3, tag);
  // Rösterna nämner aldrig fraktionerna i plural ("the Yellows", "the Blacks").
  for (const l of LINES) assert.doesNotMatch(l.text, /\b(Reds|Blues|Greens|Yellows|Blacks|Purples)\b/, l.id);
});

test('radio och journalfilm består bara av frasbokens repliker', () => {
  for (const w of WARS) {
    for (const s of w.stories) {
      const voiced = [...s.radio.lines, ...(s.tv ? s.tv.narration : [])];
      for (const l of voiced) {
        const pb = LINE[l.id];
        assert.ok(pb, `${s.id}: okänd replik ${l.id}`);
        assert.equal(l.text, pb.text);
        assert.equal(l.speaker, pb.speaker);
      }
      assert.ok(s.radio.lines.length >= 1, s.id);
      if (s.tv) {
        assert.ok(s.tv.clipTags.length >= 1 && s.tv.clipTags.length <= 2, s.id);
        for (const t of s.tv.clipTags) assert.ok(CLIP_TAGS.includes(t), t);
        const said = s.tv.cards.filter((c) => c.line).map((c) => c.line.id);
        assert.deepEqual(said, s.tv.narration.map((l) => l.id));
        assert.equal(said.length, s.tv.cards.length - 1, 'varje kort utom ledaren har en replik');
        for (const l of s.tv.narration) assert.equal(l.speaker, 'narrator');
      }
    }
  }
});

test('variation: ett 20-rundorskrig låter inte upprepat', () => {
  for (const [seed, players] of [[7, 4], [11, 6], [21, 5]]) {
    let desk;
    const out = [];
    for (const { events, state } of warSteps({ seed, players, maxRounds: 20 })) {
      desk ??= new Newsdesk({ players: state.players, seed });
      out.push(...desk.feed(events, state));
    }
    const heard = out.filter((s) => s.medium !== 'paper');
    const seqs = new Set();
    const uses = {};
    for (const s of heard) {
      const ls = s.medium === 'tv' ? s.tv.narration : s.radio.lines;
      const key = ls.map((l) => l.id).join('|');
      assert.ok(!seqs.has(key), `${seed}: samma sändning två gånger`);
      seqs.add(key);
      for (const l of ls) uses[l.id] = (uses[l.id] || 0) + 1;
    }
    const max = Math.max(...Object.values(uses));
    // Färre sändningar än förr (användaren: radion kom för ofta), men varierade: få upprepningar per replik.
    const total = Object.values(uses).reduce((a, b) => a + b, 0);
    assert.ok(heard.length >= 25 && heard.length <= 60, `${seed}: ${heard.length} sändningar`);
    assert.ok(Object.keys(uses).length >= 100, `${seed}: bara ${Object.keys(uses).length} olika repliker`);
    assert.ok(Object.keys(uses).length / total >= 0.6, `${seed}: för många upprepningar (${Object.keys(uses).length}/${total})`);
    assert.ok(max <= 6, `${seed}: en replik hördes ${max} gånger`);
    // Samma öppning två radiosändningar i rad förekommer inte.
    const radio = heard.filter((s) => s.medium === 'radio');
    for (let i = 1; i < radio.length; i++) {
      const a = radio[i - 1].radio.lines[0].id;
      const b = radio[i].radio.lines[0].id;
      if (/^open/.test(a) && /^open/.test(b)) assert.notEqual(a, b, `${seed}: samma öppning i rad (${a})`);
    }
  }
});

// ------------------------------------------------------------------ propaganda per sida

function runSides(seed, players, perspectives, maxRounds = 150) {
  const desks = perspectives.map((p) => ({ p, out: [], problems: [] }));
  for (const { events, state } of warSteps({ seed, players, maxRounds })) {
    for (const d of desks) {
      d.desk ??= new Newsdesk({ players: state.players, seed, perspective: d.p });
      for (const s of d.desk.feed(events, state)) {
        d.out.push(s);
        if (s.perspective == null || !s.paper) continue;
        // Rubrikerna får vinkla men inte ljuga om läget just nu.
        const P = s.perspective;
        const T = s.focus.territories[0];
        const owner = T ? state.owner[T] : null;
        if (['fall', 'continent', 'eliminated', 'victory'].includes(s.kind) && s.relation === 'ours' && owner !== P) d.problems.push(`${s.id} påstår seger i ${T}`);
        if (['fall', 'continent'].includes(s.kind) && s.relation === 'lost' && owner === P) d.problems.push(`${s.id} påstår förlust av ${T}`);
        if (s.kind === 'continent' && s.relation === 'ours') {
          const c = TERRITORY[T].continent;
          if (!CONTINENTS.find((x) => x.id === c).territories.every((t) => state.owner[t] === P)) d.problems.push(`${s.id} påstår hela ${c}`);
        }
        const score = s.paper.columns.find((c) => c.title === 'The Score');
        const n = Object.values(state.owner).filter((o) => o === P).length;
        if (!score || !score.text.startsWith('Our forces') || +score.text.split('\n')[0].split('\t')[1] !== n) d.problems.push(`${s.id} fel siffra i The Score`);
      }
    }
  }
  return desks;
}

test('propaganda: samma krig, olika förstasidor för samma händelse', () => {
  const [neutral, a, b] = runSides(7, 4, [null, 0, 1]);
  const key = (s) => `${s.round}|${s.kind}|${s.focus.territories.join(',')}`;
  const pa = new Map(a.out.filter((s) => s.paper).map((s) => [key(s), s]));
  const pb = new Map(b.out.filter((s) => s.paper).map((s) => [key(s), s]));
  const pn = new Map(neutral.out.filter((s) => s.paper).map((s) => [key(s), s]));
  let compared = 0;
  for (const [k, s] of pa) {
    const t = pb.get(k);
    if (!t || s.kind === 'start' || s.perspective === t.perspective) continue; // båda kan ha tagits över av samma segrare
    compared++;
    assert.notEqual(s.paper.headline, t.paper.headline, k);
    if (pn.get(k)) assert.notEqual(s.paper.headline, pn.get(k).paper.headline, k);
    if (s.relation === 'ours') assert.equal(t.relation === 'ours', false, k);
  }
  assert.ok(compared >= 5, `bara ${compared} gemensamma förstasidor`);
  // Radion är neutral i alla upplagor: bara frasbokens repliker, aldrig "our boys" och liknande.
  for (const d of [a, b]) for (const s of d.out) for (const l of s.radio.lines) assert.doesNotMatch(l.text, /\bour (boys|forces|troops|lines|army|defenders|gallant|cause)\b/i, l.id);
  // Sidorna har olika motto och färg.
  const sa = a.out.find((s) => s.paper);
  const sb = b.out.find((s) => s.paper);
  assert.notEqual(sa.paper.motto, sb.paper.motto);
  assert.notEqual(sa.paper.accent, sb.paper.accent);
});

test('propaganda: inga påståenden som strider mot ägare och kontinenter', () => {
  for (const [seed, players] of [[7, 4], [11, 6], [21, 5]]) {
    for (const d of runSides(seed, players, [...Array(players).keys()])) assert.deepEqual(d.problems, [], `${seed}/${d.p}`);
  }
});

test('propaganda: utslagen sida ger sista upplaga, sedan ny ledning', () => {
  const desks = runSides(7, 4, [0, 1, 2, 3]);
  const finals = desks.filter((d) => d.out.some((s) => s.kind === 'final'));
  assert.ok(finals.length >= 1);
  for (const d of finals) {
    const i = d.out.findIndex((s) => s.kind === 'final');
    const f = d.out[i];
    assert.equal(f.medium, 'paper');
    assert.equal(f.paper.edition, 'Final Edition');
    assert.equal(f.perspective, d.p);
    const later = d.out.slice(i + 1).filter((s) => s.paper);
    for (const s of later) {
      assert.notEqual(s.perspective, d.p);
      assert.match(s.paper.motto, /Under new management/);
    }
  }
});
