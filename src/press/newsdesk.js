// Nyhetsredaktionen: gör reportage (tidning, radio, journalfilm) av motorns händelser.
// Ren JS utan DOM – körs i webbläsaren, på servern och i node --test.
//
//   const desk = new Newsdesk({ players: state.players, seed, perspective });   // perspective: spelarindex eller null
//
// Med perspektiv skriver Evening Clarion för den sidan (propaganda, se spin.js): egna segrar triumferande, egna
// förluster som eufemismer, fiendens framgångar misstänkliggjorda. Siffror och ägare är alltid sanna. Radion och
// journalfilmen är neutrala oavsett perspektiv. Slås den egna sidan ut kommer en sista upplaga ("Presses Seized"),
// och därefter skriver tidningen under ny ledning för den som slog ut den (story.perspective visar vems tidning det är).
//   const stories = desk.feed(events, state);   // efter varje apply()
//   const last = desk.flush(state);             // stänger ett pågående slag (t.ex. vid partiets slut)
//
// Redaktionen strypar: högst en tidning och en journalfilm per runda (månad) och två radioinslag (+ månadsöversikten), utom när något
// riktigt stort händer (prioritet ≥ 85: krigsutbrott, utslagen armé, seger). Det som inte blir reportage hamnar i
// notisspalten ("News in Brief") i nästa tidning.

import { TERRITORY, CONTINENT, CONTINENTS } from '../../shared/map.js';
import { FACTION } from '../../shared/factions.js';
import * as K from './copy.js';
import * as PB from './phrasebook.js';
import * as S from './spin.js';
import { words, num, cap, rng, Bags, dateLine, shortDate, daysIn, monthName, monthYear } from './words.js';

const BIG = 85;                 // prioritet som går förbi budgeten
const GIANT = 14;               // förlorade divisioner (båda sidor) för ett "jätteslag"
const BIG_FIGHT = 8;            // förluster som gör en erövring värd journalfilm

export class Newsdesk {
  constructor({ players = [], seed = 1952, budget, perspective = null } = {}) {
    this.players = players;
    this.perspective = perspective;
    this.newManagement = false;
    this.random = rng(perspective == null ? seed : seed + 7919 * (perspective + 1)); // varje sida väljer sina egna ord
    this.bags = new Bags(this.random);
    // Rösternas minne: det som hörs har ett eget, och radioreserven till tidningar/journalfilmer ett annat –
    // annars förbrukar reserver som aldrig spelas upp variationen i de sändningar som faktiskt hörs.
    this.voiceBags = new Bags(rng(seed + 1));
    this.spareBags = new Bags(rng(seed + 2));
    this.curBags = this.voiceBags;
    this.budget = { paper: 1, tv: 1, radio: 2, ...budget };
    this.used = { paper: 0, tv: 0, radio: 0 };
    this.usedRound = 0;
    this.round = 0;
    this.day = 0;
    this.dayRound = 0;
    this.seq = 0;
    this.issue = 87;
    this.reelNo = 0;
    this.started = false;
    this.firstBlood = false;
    this.engagement = null;
    this.owners = new Map();      // territorium -> Set(spelare som någon gång ägt det)
    this.since = new Map();       // territorium -> runda då nuvarande ägare tog det
    this.continentHolders = new Map(); // kontinent -> Set(spelare som någon gång ägt den)
    this.wire = [];               // notiser till nästa tidning
    this.monthCounts = null;
    this.lastConquer = null;
    this.prevLead = null;
    this.state = null;
  }

  // ---------------------------------------------------------------- in

  feed(events = [], state = this.state) {
    this.state = state || this.state;
    if (state?.players) this.players = state.players;
    const items = [];
    let cur = null;
    const closeEngagement = () => {
      const it = this.engagement && this.engagementItem(this.engagement);
      this.engagement = null;
      if (it) items.push(it);
    };
    for (const ev of events) {
      if (!['battle', 'conquer', 'continent', 'eliminated', 'victory', 'occupy'].includes(ev.type)) closeEngagement();
      switch (ev.type) {
        case 'turn': {
          cur = null;
          if (!this.started) {
            this.started = true;
            this.round = ev.round || 1;
            items.push(this.startItem());
            this.snapshot();
          } else if (ev.round > this.round) {
            const prev = this.round;
            this.round = ev.round;
            items.push(this.monthlyItem(prev));
            this.snapshot();
          }
          break;
        }
        case 'battle': {
          const key = ev.from + '|' + ev.to;
          if (this.engagement && this.engagement.key !== key) closeEngagement();
          if (!this.engagement) {
            this.engagement = {
              key, from: ev.from, to: ev.to, attacker: ev.player, defender: ev.defender,
              startA: ev.armies.from + ev.losses.a, startD: ev.armies.to + ev.losses.d, lossA: 0, lossD: 0, rolls: 0,
            };
          }
          const e = this.engagement;
          e.lossA += ev.losses.a;
          e.lossD += ev.losses.d;
          e.rolls++;
          e.endA = ev.armies.from;
          e.endD = ev.armies.to;
          if (ev.armies.from <= 1 && ev.armies.to > 0) closeEngagement(); // angriparen kan inte fortsätta
          break;
        }
        case 'conquer': {
          const e = this.engagement && this.engagement.key === ev.from + '|' + ev.to ? this.engagement : null;
          this.engagement = null;
          cur = this.lastConquer = this.conquerItem(ev, e);
          items.push(cur);
          break;
        }
        case 'continent': {
          const owner = ev.gained ? ev.player : ev.by;
          if (cur && owner === cur.player) (ev.gained ? cur.gained : cur.lost).push(ev);
          else if (ev.gained) this.remember(ev);
          break;
        }
        case 'eliminated':
          if (cur && ev.by === cur.player) cur.eliminated = ev;
          else if (this.lastConquer) items.push(cur = this.echo(this.lastConquer, { eliminated: ev }));
          break;
        case 'victory':
          if (cur) cur.victory = ev;
          else if (this.lastConquer) items.push(cur = this.echo(this.lastConquer, { victory: ev }));
          break;
        case 'trade':
          if (ev.value >= 10) items.push({ kind: 'trade', round: this.round, player: ev.player, value: ev.value });
          break;
        default:
          break;
      }
    }
    for (const it of items) if (it.kind === 'conquer') for (const g of it.gained) this.remember(g, true);
    return this.publish(items);
  }

  // Stänger ett pågående slag (anropa när partiet tar slut eller regin vill tömma redaktionen).
  flush(state = this.state) {
    this.state = state || this.state;
    if (!this.engagement) return [];
    const it = this.engagementItem(this.engagement);
    this.engagement = null;
    return this.publish(it ? [it] : []);
  }

  // Krigsutbrottet kan beställas uttryckligen (annars kommer det vid första `turn`).
  opening(state = this.state) {
    this.state = state || this.state;
    if (this.started) return [];
    this.started = true;
    this.round = this.state?.round || 1;
    this.snapshot();
    return this.publish([this.startItem()]);
  }

  // ---------------------------------------------------------------- nyheter

  startItem() {
    return { kind: 'start', round: this.round, priority: 86, media: ['paper', 'radio'] };
  }

  monthlyItem(prevRound) {
    return { kind: 'monthly', round: this.round, prevRound, prevCounts: this.monthCounts, priority: 30, media: ['radio'], free: true };
  }

  conquerItem(ev, e) {
    const to = ev.to;
    const seen = this.owners.get(to) || new Set([ev.defender]);
    const reconquest = seen.has(ev.player);
    seen.add(ev.player);
    this.owners.set(to, seen);
    const held = this.round - (this.since.get(to) ?? 0);
    this.since.set(to, this.round);
    const first = !this.firstBlood;
    this.firstBlood = true;
    const eng = e || { startA: 0, startD: 0, lossA: 0, lossD: 0, rolls: 1 };
    return {
      kind: 'conquer', round: this.round, player: ev.player, defender: ev.defender, from: ev.from, to,
      eng, reconquest, held, first, sea: K.bySea(ev.from, to), fame: K.FAME[to] || 1, home: to === K.HOME,
      gained: [], lost: [], eliminated: null, victory: null,
    };
  }

  // En utslagning eller seger som kom i ett eget flöde: ny nyhet med den senaste erövringens plats.
  echo(last, extra) {
    return { ...last, round: this.round, gained: [], lost: [], eliminated: null, victory: null, lead: undefined, ...extra };
  }

  engagementItem(e) {
    const total = e.lossA + e.lossD;
    const miracle = e.endD > 0 && e.startA >= 6 && e.startA >= 3 * e.startD && e.lossA >= 4;
    if (miracle) return { kind: 'miracle', round: this.round, eng: e, from: e.from, to: e.to, player: e.attacker, defender: e.defender, priority: 70, media: ['paper', 'tv', 'radio'] };
    if (total >= GIANT) return { kind: 'battle', round: this.round, eng: e, from: e.from, to: e.to, player: e.attacker, defender: e.defender, priority: 60, media: ['tv', 'radio'] };
    return null;
  }

  remember(ev, already) {
    const set = this.continentHolders.get(ev.continent) || new Set();
    if (!already) set.add(ev.player);
    this.continentHolders.set(ev.continent, set);
  }

  // Avgör ledande nyhet och medium för en erövring.
  rank(it) {
    const r = this.rankBase(it);
    const P = this.perspective;
    if (P == null || !it.priority) return r;
    // Propagandaupplagan: det som rör "oss" är större nyheter.
    if (it.kind === 'conquer' && it.eliminated && it.eliminated.player === P) {
      return Object.assign(it, { lead: 'final', priority: 97, media: ['paper'] });
    }
    if (it.player === P || it.defender === P) {
      it.priority = Math.min(it.priority >= BIG ? 100 : 84, it.priority + 10);
      if (it.lead === 'fall' && !it.media.includes('paper')) it.media = ['paper', ...it.media];
    }
    return it;
  }

  rankBase(it) {
    if (it.kind === 'trade') return Object.assign(it, { priority: 35, media: ['radio'] });
    if (it.kind !== 'conquer') return it;
    const big = it.eng.lossA + it.eng.lossD >= BIG_FIGHT;
    if (it.victory) Object.assign(it, { lead: 'victory', priority: 100, media: ['paper'] });
    else if (it.eliminated) Object.assign(it, { lead: 'eliminated', priority: 90, media: ['paper', 'radio'] });
    else if (it.gained.length) Object.assign(it, { lead: 'continent', priority: 80, media: big ? ['tv', 'paper', 'radio'] : ['paper', 'tv', 'radio'] });
    else if (it.fame >= 3 || it.home) Object.assign(it, { lead: 'fall', priority: 65 + (it.reconquest ? 8 : 0) + (it.home ? 10 : 0) + (big ? 5 : 0), media: big ? ['tv', 'paper', 'radio'] : ['paper', 'radio'] });
    else if (it.lost.length) Object.assign(it, { lead: 'lost', priority: 55, media: ['radio'] });
    else if (it.eng.lossA + it.eng.lossD >= GIANT) Object.assign(it, { lead: 'battle', priority: 60, media: ['tv', 'radio'] });
    else if (it.first) Object.assign(it, { lead: 'first', priority: 50, media: ['radio'] });
    else if (it.sea) Object.assign(it, { lead: 'landing', priority: 38, media: ['radio'] });
    else if (it.fame === 2) Object.assign(it, { lead: 'fall', priority: 40, media: ['radio'] });
    else Object.assign(it, { lead: 'minor', priority: 0, media: [] });
    return it;
  }

  // ---------------------------------------------------------------- budget och utgivning

  publish(items) {
    const out = [];
    items.map((it) => this.rank(it)).sort((a, b) => b.priority - a.priority).forEach((it) => {
      if (it.round !== this.usedRound) {
        this.usedRound = it.round;
        this.used = { paper: 0, tv: 0, radio: 0 };
      }
      const medium = this.choose(it);
      if (!medium) {
        if (it.kind === 'conquer') this.addWire(it);
        return;
      }
      const story = this.write(it, medium);
      if (story) out.push(story);
      else if (it.kind === 'conquer') this.addWire(it);
    });
    return out;
  }

  choose(it) {
    if (it.free) return it.media[0];
    for (const m of it.media) {
      if (it.priority >= BIG || this.used[m] < this.budget[m]) {
        this.used[m]++;
        return m;
      }
    }
    // Viktiga nyheter som inte fick plats någon annanstans blir åtminstone radio.
    if (it.priority >= 50 && !it.media.includes('radio') && this.used.radio < this.budget.radio + 2) {
      this.used.radio++;
      return 'radio';
    }
    return null;
  }

  addWire(it) {
    const c = this.ctx(it);
    if (this.perspective != null) {
      this.wire.unshift(S.WIRE[this.relation(it, 'fall')](c));
      this.wire.length = Math.min(this.wire.length, 6);
      return;
    }
    const line = this.bags.pick('wire', [
      `${c.T.CITY} (${K.WIRE.short}) — ${c.F.adj} forces have occupied ${c.T.ref}.`,
      `${c.T.CITY} (${K.WIRE.short}) — ${c.T.Ref} has fallen to ${c.F.army} after ${c.days > 1 ? 'a brief struggle' : 'a single engagement'}.`,
      `${c.T.CITY} (${K.WIRE.short}) — ${c.D.Army} reports the loss of ${c.T.ref}.`,
    ], c);
    this.wire.unshift(line);
    this.wire.length = Math.min(this.wire.length, 6);
  }

  // ---------------------------------------------------------------- sammanhang för mallarna

  faction(i, continent) {
    const p = this.players[i] || {};
    const f = FACTION[p.faction] || { name: p.name || 'Unknown', id: p.faction };
    const color = f.name;
    // "Black" och "Yellow" (i Asien/Oceanien) som substantiv eller predikat ger fel klang ("Black master",
    // "Asia goes Yellow"); där skrivs "Black Army" och predikatmallarna hoppas över.
    const sensitive = f.id === 'black' || (f.id === 'yellow' && ['asia', 'oceania', 'world'].includes(continent));
    const armyBare = `${color} Army`;
    const army = f.army || `the ${armyBare}`;
    const plural = sensitive ? `the ${armyBare} forces` : f.plural || `the ${color}s`;
    return {
      id: f.id, color, plain: !sensitive,
      name: sensitive ? armyBare : color,
      adj: sensitive ? armyBare : f.adj || color,
      lower: color.toLowerCase(),
      army, Army: cap(army), armyBare, armyPoss: `${army}’s`, ArmyPoss: cap(`${army}’s`),
      who: sensitive ? cap(army) : color,
      plural, Plural: cap(plural), pluralBare: sensitive ? `${armyBare} Forces` : plural.replace(/^the /, ''),
    };
  }

  territory(id, key = 'place:' + id) {
    if (!id) return null;
    const t = TERRITORY[id];
    const ref = t.ref || (t.the ? 'the ' : '') + t.name;
    const city = K.CITY[id] || t.name;
    return {
      id, name: t.name, ref, Ref: cap(ref), poss: t.poss || ref + "'s", prep: t.prep || 'in', continent: t.continent,
      city, CITY: city.toUpperCase(), place: this.bags.pick(key, K.PLACES[id] || [`${t.prep || 'in'} ${ref}`]),
      fame: K.FAME[id] || 1,
    };
  }

  counts() {
    const n = this.players.map(() => 0);
    for (const o of Object.values(this.state?.owner || {})) if (o != null && n[o] != null) n[o]++;
    return n;
  }

  holders() {
    const owner = this.state?.owner || {};
    return CONTINENTS.map((c) => {
      const o = owner[c.territories[0]];
      return o != null && c.territories.every((t) => owner[t] === o) ? { continent: c, player: o } : null;
    }).filter(Boolean);
  }

  snapshot() {
    this.monthCounts = this.counts();
  }

  alive() {
    return this.players.map((p, i) => i).filter((i) => this.players[i]?.alive !== false);
  }

  nextDay(round) {
    if (round !== this.dayRound) {
      this.dayRound = round;
      this.day = 1 + Math.floor(this.random() * 2);
    }
    this.day = Math.min(daysIn(round), this.day + 1 + Math.floor(this.random() * 3));
    return this.day;
  }

  ctx(it) {
    const round = it.round || this.round || 1;
    const T = this.territory(it.to);
    const cont = T?.continent;
    const counts = this.counts();
    const e = it.eng || {};
    const c = {
      round, T, from: this.territory(it.from, 'from:' + it.from),
      F: it.player != null ? this.faction(it.player, cont) : null,
      D: it.defender != null ? this.faction(it.defender, cont) : null,
      startA: e.startA || 0, startD: e.startD || 0, lossA: e.lossA || 0, lossD: e.lossD || 0,
      days: Math.max(1, e.rolls || 1), total: (e.lossA || 0) + (e.lossD || 0),
      ratio: e.startD ? Math.max(2, Math.round(e.startA / e.startD)) : 2,
      owned: it.player != null ? counts[it.player] : 0,
      dOwned: it.defender != null ? counts[it.defender] : 0,
      held: it.held || 0, value: it.value || 0,
    };
    c.A = c.F;
    if (T) {
      const owner = this.state?.owner || {};
      const nb = TERRITORY[it.to].neighbors;
      const ret = nb.filter((n) => owner[n] === it.defender).sort((a, b) => (K.FAME[b] || 1) - (K.FAME[a] || 1));
      c.retreat = ret.length ? this.territory(ret[0], 'ret:' + ret[0]) : null;
      const nxt = nb.filter((n) => owner[n] != null && owner[n] !== it.player).sort((a, b) => (K.FAME[b] || 1) - (K.FAME[a] || 1));
      c.next = nxt.length ? this.territory(nxt[0], 'next:' + nxt[0]) : null;
      c.C = { ...CONTINENT[cont] };
    }
    return c;
  }

  // ---------------------------------------------------------------- skriv

  write(it, medium) {
    const lead = it.lead || it.kind;
    const writer = {
      start: () => this.writeStart(it, medium),
      monthly: () => this.writeMonthly(it),
      trade: () => this.writeTrade(it),
      miracle: () => this.writeMiracle(it, medium),
      battle: () => this.writeBattle(it, medium),
      victory: () => this.writeConquer(it, medium, 'victory'),
      eliminated: () => this.writeConquer(it, medium, 'eliminated'),
      continent: () => this.writeConquer(it, medium, 'continent'),
      lost: () => this.writeConquer(it, medium, 'lost'),
      fall: () => this.writeConquer(it, medium, 'fall'),
      first: () => this.writeConquer(it, medium, 'first'),
      landing: () => this.writeConquer(it, medium, 'landing'),
      final: () => this.writeConquer(it, medium, 'final'),
    }[lead];
    if (!writer) return null;
    const perspective = this.perspective;
    const s = writer();
    if (!s) return null;
    const story = {
      id: `s${++this.seq}`, kind: lead, medium, priority: it.priority, round: it.round,
      ...s,
    };
    if (perspective != null) {
      story.perspective = perspective;
      story.relation = this.relation(it, lead);
    }
    // Vår sida är utslagen: tidningen fortsätter under ny ledning.
    if (lead === 'final') {
      this.perspective = it.player;
      this.newManagement = true;
    }
    return story;
  }

  pick(key, list, c) {
    return this.bags.pick(key, list, c);
  }

  // Tidningens ramverk: rubrik, ingress och spalter.
  paper(c, { headline, deck, kicker, body, caption, extra }) {
    const columns = [];
    const wires = this.wire.splice(0, 3);
    while (wires.length < 2) wires.push(this.pick('filler', K.FILLER_WIRES));
    columns.push({ title: 'News in Brief', text: wires.join('\n') });
    columns.push({ title: this.perspective != null ? 'The Score' : 'The War in Figures', text: this.standings() });
    columns.push(this.random() < 0.5
      ? { title: 'Weather', text: this.pick('weather', K.WEATHER) }
      : { title: 'Markets', text: this.pick('markets', K.MARKETS) });
    const ads = [this.pick('ad', K.ADS.map((a) => () => a)), this.pick('ad', K.ADS.map((a) => () => a))];
    const P = this.perspective;
    const side = P != null ? FACTION[this.players[P]?.faction] : null;
    return {
      masthead: K.PAPER.masthead,
      motto: side ? S.MOTTO({ U: this.faction(P), newManagement: this.newManagement }) : K.PAPER.motto,
      ...(side ? { side: side.id, accent: side.paint } : {}),
      edition: extra ? 'Extra' : this.pick('edition', ['Home Edition', 'Late City Edition', 'Night Final', 'Final Edition']),
      price: K.PAPER.price, number: `${K.PAPER.volume} — No. ${this.issue++}`,
      headline: headline.toUpperCase(), deck, kicker: kicker ? kicker.toUpperCase() : undefined,
      body, photoCaption: caption, columns, ads, dateline: c.T ? c.T.CITY : undefined,
    };
  }

  standings() {
    const n = this.counts();
    const P = this.perspective;
    if (P != null) {
      // Sanna siffror, vinklad uppställning: vi först, fienderna efter, och två rader ren åsikt.
      const enemies = this.alive().filter((i) => i !== P).sort((a, b) => n[b] - n[a]);
      return [`Our forces (${this.faction(P).armyBare})\t${n[P]}`, ...enemies.map((i) => `${this.faction(i).armyBare}\t${n[i]}`),
        'Our morale\tExcellent', 'Enemy morale\tPoor'].join('\n');
    }
    return this.alive().map((i) => [i, n[i]]).sort((a, b) => b[1] - a[1])
      .map(([i, k]) => `${this.faction(i).armyBare}\t${k}`).join('\n');
  }

  dated(it) {
    const day = this.nextDay(it.round || this.round || 1);
    return { day, date: dateLine(it.round || 1, day), mday: shortDate(it.round || 1, day) };
  }

  // ---------------------------------------------------------------- röster (frasboken)

  // En slumpad replik ur en kategori i frasboken; blandpåsen ser till att varianterna turas om.
  say(cat) {
    const list = PB.lines(cat);
    if (!list.length) return null;
    const l = this.curBags.pick('pb:' + cat, list.map((x) => () => x));
    return { id: l.id, speaker: l.speaker, text: l.text };
  }

  sayId(id) {
    const l = PB.LINE[id];
    return l ? { id: l.id, speaker: l.speaker, text: l.text } : null;
  }

  fid(i) {
    return this.players[i]?.faction;
  }

  opener(priority) {
    if (priority >= 85) return this.say('open.extra');
    if (priority >= 60 || this.random() < 0.15) return this.say('open.bulletin');
    return this.say('open.news');
  }

  // Färg efter nyheten: korrespondenten på plats (terrängens repliker) eller en allmän kommentar.
  colour(terr, { reporter = 0.5, sea = false } = {}) {
    if (this.random() < reporter) return this.say(this.random() < 0.25 ? 'rep:gen' : `rep:${sea ? 'sea' : PB.terrainOf(terr)}`);
    return this.say('color');
  }

  radio(lines) {
    return { station: K.STATION, lines: lines.filter(Boolean) };
  }

  // Bygger radioreserven för ett reportage som visas som tidning eller journalfilm (eget minne).
  spare(isSpare, fn) {
    if (!isSpare) return fn();
    this.curBags = this.spareBags;
    try {
      return fn();
    } finally {
      this.curBags = this.voiceBags;
    }
  }

  // Journalfilmens klippetiketter (regin väljer klipp ur public/reel/clips.json): terräng + händelse.
  clipTags(it, kind) {
    const first = it.sea ? 'sea' : PB.terrainOf(it.to);
    const second = it.home ? 'home' : kind;
    return first === second ? [first] : [first, second];
  }

  // Korten och berättelsen hör ihop: varje kort utom ledaren har sin replik (`card.line`), och
  // `narration` är samma repliker i ordning.
  tv(c, { title, subtitle, map, footage, outcome, lines, clipTags }) {
    const n = ++this.reelNo;
    const cards = [
      { kind: 'countdown', duration: 3 },
      { kind: 'title', text: K.NEWSREEL, sub: `No. ${n} — ${monthYear(c.round)}`, duration: 3.5, line: lines.title },
      { kind: 'text', text: title.toUpperCase(), sub: subtitle, duration: 3, line: lines.text },
    ];
    if (map) cards.push({ kind: 'map', text: map.text, from: map.from, to: map.to, territories: map.territories, duration: 4.5, line: lines.map });
    if (footage) cards.push({ kind: 'footage', text: footage, duration: 6, tag: clipTags[0], line: lines.footage });
    if (outcome) cards.push({ kind: 'text', text: outcome.toUpperCase(), duration: 3, line: lines.outcome });
    for (const card of cards) if (!card.line) delete card.line;
    return { title: title.toUpperCase(), subtitle, cards, narration: cards.filter((x) => x.line).map((x) => x.line), clipTags };
  }

  battleReel(c, it, won, held = false) {
    const clipTags = this.clipTags(it, 'battle');
    return this.tv(c, {
      title: this.pick('reel.bt', K.REEL.battleTitle, c),
      subtitle: `${c.A.Army} against ${c.D.army}`,
      map: { text: c.T.name, from: it.from, to: it.to, territories: [it.to, it.from] },
      footage: cap(c.T.place),
      outcome: won ? `${c.T.name} taken` : `${c.T.name} holds`,
      clipTags,
      lines: {
        title: this.say('n.intro'),
        text: this.say(`n.t:${it.to}`),
        map: held ? this.say(`n.f.hold:${this.fid(it.defender)}`) : this.say(`n.f.strike:${this.fid(it.player)}`),
        footage: this.say(`n.tag:${clipTags[0]}`),
        outcome: won ? this.say('n.won') : this.say('n.held'),
      },
    });
  }

  continentReel(c, it, gained) {
    const clipTags = this.clipTags(it, this.random() < 0.5 ? 'victory' : 'command');
    const A = this.fid(it.player);
    return this.tv(c, {
      title: this.pick('reel.ct', K.REEL.continentTitle, c),
      subtitle: `${c.F.Army} completes its conquest`,
      map: { text: c.C.name, from: it.from, to: it.to, territories: CONTINENT[gained.continent].territories },
      footage: cap(c.T.place),
      outcome: `${c.C.name} — ${c.F.name}`,
      clipTags,
      lines: {
        title: this.say('n.intro'),
        text: this.say(`n.c:${gained.continent}`),
        map: this.say(`n.f.strike:${A}`),
        footage: this.say(`n.tag:${clipTags[0]}`),
        outcome: this.say(`n.f.triumph:${A}`),
      },
    });
  }

  // Vems seger är det? 'ours' (vi vann/höll), 'lost' (vi förlorade/misslyckades), 'others' (fiender emellan).
  relation(it, lead) {
    const P = this.perspective;
    if (P == null) return 'neutral';
    if (lead === 'final') return 'lost';
    if (lead === 'start' || lead === 'victory') return 'ours';
    if (lead === 'miracle') return it.defender === P ? 'ours' : it.player === P ? 'lost' : 'others';
    if (it.player === P) return 'ours';
    if (it.defender === P) return 'lost';
    if (lead === 'lost' && it.lost?.[0]?.player === P) return 'lost';
    return 'others';
  }

  // Propagandatidningen för en erövring.
  spinPaper(it, lead, c, out, gained, lost) {
    const rel = this.relation(it, lead);
    c.U = this.faction(this.perspective, c.T?.continent);
    c.ourCount = this.counts()[this.perspective] || 0;
    c.newManagement = this.newManagement;
    const P = (key, list) => this.pick('spin.' + key, list, c);
    const body = (alts, key) => alts.map((a, i) => (Array.isArray(a) ? P(`${key}.b${i}`, a) : typeof a === 'function' ? a(c) : a)).filter(Boolean);
    let set;
    let kicker = P('k.' + rel, S.KICKER[rel === 'neutral' ? 'others' : rel]);
    if (lead === 'final') {
      set = S.ELIMINATED.final;
      kicker = 'Final Edition';
    } else if (lead === 'victory') set = S.VICTORY;
    else if (lead === 'eliminated') set = rel === 'ours' ? S.ELIMINATED.ours : S.ELIMINATED.others;
    else if (lead === 'continent') set = rel === 'ours' ? S.CONTINENT.ours : rel === 'lost' ? S.FALL.lost : S.CONTINENT.others;
    else if (lead === 'lost' && lost?.player === this.perspective) {
      c.C = { ...CONTINENT[lost.continent] };
      set = S.CONTINENT.lost;
    } else set = S.FALL[rel] || S.FALL.others;
    const deckList = it.reconquest && set === S.FALL.ours ? S.FALL.ours.deckAgain : set.deck;
    out.paper = this.paper(c, {
      headline: P(`h.${lead}.${rel}`, set.headline),
      deck: P(`d.${lead}.${rel}`, deckList),
      kicker,
      body: body(set.body, `${lead}.${rel}`),
      caption: c.T ? this.pick('spin.c.' + rel, S.CAPTION[rel === 'neutral' ? 'others' : rel], c) : this.pick('start.c', K.START.caption, c),
      extra: it.priority >= BIG,
    });
    if (lead === 'final') Object.assign(out.paper, { edition: 'Final Edition', final: true });
    return out;
  }

  writeStart(it, medium) {
    const d = this.dated(it);
    const counts = this.counts();
    const alive = this.alive();
    const byCount = [...alive].sort((a, b) => counts[b] - counts[a]);
    const armies = alive.map((i) => this.faction(i).army);
    const c = {
      round: it.round, ...d, nPlayers: alive.length || this.players.length,
      armyList: armies.length > 1 ? armies.slice(0, -1).join(', ') + ' and ' + armies[armies.length - 1] : armies[0] || 'the armies',
      lead: this.faction(byCount[0] ?? 0), leadCount: counts[byCount[0]] || 0,
      last: this.faction(byCount[byCount.length - 1] ?? 0), lastCount: counts[byCount[byCount.length - 1]] || 0,
      some: this.faction(alive[Math.floor(this.random() * alive.length)] ?? 0),
      homeCity: K.CITY[K.HOME].toUpperCase(),
    };
    const focus = { territories: [], players: alive };
    const radio = this.spare(medium !== 'radio', () => this.radio([this.say('open.extra'), this.say('war.start'), this.say('war.start'), this.say('close')]));
    if (medium !== 'paper') return { date: d.date, focus, radio };
    if (this.perspective != null) {
      const sc = { ...c, U: this.faction(this.perspective), ourCount: counts[this.perspective] || 0 };
      return {
        date: d.date, focus, radio,
        paper: this.paper({ T: null }, {
          headline: this.pick('spin.start.h', S.START.headline, sc),
          deck: this.pick('spin.start.d', S.START.deck, sc),
          kicker: 'Extra',
          body: S.START.body.map((t) => (typeof t === 'function' ? t(sc) : t)),
          caption: this.pick('start.c', K.START.caption, sc),
          extra: true,
        }),
      };
    }
    return {
      date: d.date, focus, radio,
      paper: this.paper({ T: null }, {
        headline: this.pick('start.h', K.START.headline, c),
        deck: this.pick('start.d', K.START.deck, c),
        kicker: this.pick('start.k', K.START.kicker, c),
        body: K.START.body.map((alts, i) => this.pick('start.b' + i, alts, c)),
        caption: this.pick('start.c', K.START.caption, c),
        extra: true,
      }),
    };
  }

  writeMonthly(it) {
    const counts = this.counts();
    const alive = this.alive();
    const byCount = [...alive].sort((a, b) => counts[b] - counts[a]);
    const prev = it.prevCounts || counts;
    const delta = alive.map((i) => [i, counts[i] - (prev[i] || 0)]).sort((a, b) => b[1] - a[1]);
    const lead = byCount[0];
    const newLead = this.prevLead != null && this.prevLead !== lead;
    this.prevLead = lead;
    const lines = [this.say('m.open'), this.say(`m.month:${monthName(it.round).toLowerCase()}`),
      this.say(`f.${newLead ? 'leadnew' : 'leadsame'}:${this.fid(lead)}`)];
    // Kontinenter: nya innehav nämns alltid, gamla bara ibland ("still holds").
    const held = this.holders();
    const before = this.monthHolders || new Map();
    this.monthHolders = new Map(held.map((h) => [h.continent.id, h.player]));
    let named = 0;
    for (const h of held) {
      const same = before.get(h.continent.id) === h.player;
      if (named >= 2 || (same && this.random() > 0.4)) continue;
      lines.push(this.sayId(`${same ? 'fcs' : 'fc'}.${this.fid(h.player)}.${h.continent.id}`));
      named++;
    }
    if (!held.length && this.random() < 0.7) lines.push(this.say('m.none'));
    // Månadens vinnare och förlorare nämns inte alltid – annars blir översikten en ramsa.
    const r = this.random();
    if (r < 0.75 && delta.length && delta[0][1] > 0) lines.push(this.say(`f.good:${this.fid(delta[0][0])}`));
    if (r > 0.35 && delta.length > 1 && delta[delta.length - 1][1] < 0) lines.push(this.say(`f.bad:${this.fid(delta[delta.length - 1][0])}`));
    if (this.random() < 0.45) lines.push(this.say('m.color'));
    lines.push(this.say('m.close'));
    return {
      date: dateLine(it.round, 1),
      focus: { territories: [], players: [lead] },
      radio: this.radio(lines),
    };
  }

  writeTrade(it) {
    const d = this.dated(it);
    return {
      date: d.date, focus: { territories: [], players: [it.player] },
      radio: this.radio([this.say('open.news'), this.say(`f.muster:${this.fid(it.player)}`), this.say('color'), this.say('close')]),
    };
  }

  writeMiracle(it, medium) {
    const d = this.dated(it);
    const c = { ...this.ctx(it), ...d };
    const focus = { territories: [it.to, it.from], players: [it.defender, it.player] };
    const radio = this.spare(medium !== 'radio', () => this.radio([this.opener(it.priority), this.say(`t.hold:${it.to}`),
      this.say(`f.hold:${this.fid(it.defender)}`), this.say(`f.repulsed:${this.fid(it.player)}`), this.colour(it.to, { reporter: 0.4 }),
      this.say('close')]));
    const out = { date: d.date, focus, radio };
    if (medium === 'paper' && this.perspective != null) {
      const rel = this.relation(it, 'miracle');
      const set = S.MIRACLE[rel];
      const sc = { ...c, U: this.faction(this.perspective, c.T.continent) };
      out.paper = this.paper(sc, {
        headline: this.pick(`spin.mir.h.${rel}`, set.headline, sc),
        deck: this.pick(`spin.mir.d.${rel}`, set.deck, sc),
        kicker: this.pick(`spin.k.${rel}`, S.KICKER[rel], sc),
        body: set.body.map((t) => (typeof t === 'function' ? t(sc) : t)),
        caption: this.pick('mir.c', K.MIRACLE.caption, sc),
      });
    } else if (medium === 'paper') {
      out.paper = this.paper(c, {
        headline: this.pick('mir.h', K.MIRACLE.headline, c),
        deck: this.pick('mir.d', K.MIRACLE.deck, c),
        kicker: this.pick('mir.k', K.MIRACLE.kicker, c),
        body: [this.pick('mir.l', K.MIRACLE.lead, c), this.pick('mir.n', K.MIRACLE.numbers, c), this.pick('mir.q', K.MIRACLE.quote, c)],
        caption: this.pick('mir.c', K.MIRACLE.caption, c),
      });
    } else if (medium === 'tv') {
      out.tv = this.battleReel(c, it, false, true);
    }
    return out;
  }

  writeBattle(it, medium) {
    const d = this.dated(it);
    const c = { ...this.ctx(it), ...d };
    const won = it.kind === 'conquer';
    const focus = { territories: [it.to, it.from], players: [it.player, it.defender] };
    const radio = this.spare(medium !== 'radio', () => this.radio([this.opener(it.priority), this.say(`t.fight:${it.to}`),
      this.colour(it.to, { reporter: 0.5, sea: it.sea }),
      ...(won ? [this.say(`t.fall:${it.to}`), this.say(`f.advance:${this.fid(it.player)}`)]
        : [this.say(`t.hold:${it.to}`), this.say(`f.hold:${this.fid(it.defender)}`)]),
      this.say('close')]));
    const out = { date: d.date, focus, radio };
    if (medium === 'tv') out.tv = this.battleReel(c, it, won);
    return out;
  }

  writeConquer(it, medium, lead) {
    if (lead === 'battle') return this.writeBattle(it, medium);
    const d = this.dated(it);
    const c = { ...this.ctx(it), ...d };
    const gained = it.gained[0];
    const lost = it.lost[0];
    if (gained) c.C = { ...CONTINENT[gained.continent], before: (this.continentHolders.get(gained.continent) || new Set()).has(it.player) };
    if (lost && !gained) {
      c.C = { ...CONTINENT[lost.continent] };
      c.L = this.faction(lost.player, lost.continent);
    }
    if (it.eliminated) {
      c.E = this.faction(it.eliminated.player, c.T.continent);
      c.cards = it.eliminated.cards || 0;
      c.left = this.alive().filter((i) => i !== it.eliminated.player).length;
    }
    if (it.victory) {
      c.months = it.victory.round || it.round;
      c.F = this.faction(it.player, 'world'); // världen omfattar Asien: samma försiktighet som där
    }
    const focus = { territories: [it.to, it.from], players: [it.player, it.defender] };

    // Radioversionen finns alltid (reserv för regin) och består bara av frasbokens repliker.
    const A = this.fid(it.player);
    const D = this.fid(it.defender);
    const T = it.to;
    const fc = gained ? this.sayId(`fc.${A}.${gained.continent}`) : null;
    const parts = this.spare(medium !== 'radio', () => this.conquerRadio(it, lead, c, { A, D, T, fc, lost }));
    const out = { date: d.date, focus, radio: this.radio(parts) };

    if (medium === 'tv') out.tv = gained ? this.continentReel(c, it, gained) : this.battleReel(c, it, true);
    if (medium !== 'paper') return out;
    if (this.perspective != null) return this.spinPaper(it, lead, c, out, gained, lost);
    return this.conquerPaper(it, lead, c, out, gained, lost);
  }

  conquerRadio(it, lead, c, { A, D, T, fc, lost }) {
    let parts;
    if (lead === 'victory') parts = [this.say('open.extra'), this.say('war.over'), this.say(`f.win:${A}`), this.say('close')];
    else if (lead === 'eliminated' || lead === 'final') {
      parts = [this.say('open.bulletin'), this.say(`t.fall:${T}`), this.say(`f.out:${this.fid(it.eliminated.player)}`), fc,
        this.colour(T, { reporter: 0.3 }), this.say('close')];
    } else if (lead === 'continent') parts = [this.opener(it.priority), this.say(`t.fall:${T}`), fc, this.colour(T, { reporter: 0.4, sea: it.sea }), this.say('close')];
    else if (lead === 'lost') {
      parts = [this.opener(it.priority), this.say(`t.fall:${T}`), this.say(`c.lost:${lost.continent}`),
        this.say(`f.retreat:${this.fid(lost.player)}`), this.say('close')];
    } else if (lead === 'first') parts = [this.opener(it.priority), this.say('first'), this.say(`t.fall:${T}`), this.say(`f.advance:${A}`), this.say('close')];
    else if (lead === 'landing') parts = [this.opener(it.priority), this.say(`t.land:${T}`), this.say(`f.advance:${A}`), this.colour(T, { reporter: 0.6, sea: true }), this.say('close')];
    else {
      parts = [this.opener(it.priority), this.say(`t.fall:${T}`), this.say(it.reconquest ? `f.back:${A}` : `f.advance:${A}`),
        this.random() < 0.5 ? this.say(`f.retreat:${D}`) : null, this.colour(T, { reporter: c.T.fame >= 2 ? 0.6 : 0.3, sea: it.sea }),
        this.say('close')];
    }
    return parts;
  }

  conquerPaper(it, lead, c, out, gained, lost) {
    const P = (key, list) => this.pick(key, list, c);
    let headline, deck, kicker, body, caption;
    const fallBody = () => {
      const b = [P('fall.l', K.FALL.lead), P('fall.n', K.FALL.numbers), P('fall.q', K.FALL.quote)];
      if (it.reconquest) b.push(P('fall.a', K.FALL.again));
      if (it.home) b.push(P('fall.home', K.FALL.homeNote));
      b.push(P('fall.ctx', K.FALL.context));
      return b;
    };
    if (lead === 'victory') {
      headline = P('vic.h', K.VICTORY.headline);
      deck = P('vic.d', K.VICTORY.deck);
      kicker = 'Extra';
      body = K.VICTORY.body.map((t) => (typeof t === 'function' ? t(c) : t));
      caption = P('vic.c', K.VICTORY.caption);
    } else if (lead === 'eliminated') {
      headline = P('elim.h', K.ELIMINATED.headline);
      deck = P('elim.d', K.ELIMINATED.deck);
      kicker = P('elim.k', K.ELIMINATED.kicker);
      body = [P('elim.l', K.ELIMINATED.lead), P('elim.n', K.ELIMINATED.numbers), P('elim.q', K.ELIMINATED.quote)].filter(Boolean);
      if (gained) body.push(P('cg.n', K.CONTINENT_GAINED.numbers));
      caption = P('elim.c', K.ELIMINATED.caption);
    } else if (lead === 'continent') {
      headline = c.C.before ? P('cg.again', K.CONTINENT_GAINED.again) : P('cg.h', K.CONTINENT_GAINED.headline);
      deck = P('cg.d', K.CONTINENT_GAINED.deck);
      kicker = P('cg.k', K.CONTINENT_GAINED.kicker);
      body = [P('cg.l', K.CONTINENT_GAINED.lead), P('fall.n', K.FALL.numbers), P('cg.n', K.CONTINENT_GAINED.numbers), P('cg.q', K.CONTINENT_GAINED.quote)];
      caption = P('cg.c', K.CONTINENT_GAINED.caption);
    } else {
      if (it.home) headline = P('fall.home.h', K.FALL.home);
      else headline = it.reconquest ? P('fall.re', K.FALL.reconquest) : P('fall.h', K.FALL.headline);
      deck = it.home ? P('fall.home.d', K.FALL.deckHome) : it.reconquest ? P('fall.dre', K.FALL.deckReconquest) : P('fall.d', K.FALL.deck);
      kicker = P('fall.k', K.FALL.kicker);
      body = fallBody();
      if (lost) {
        c.C = { ...CONTINENT[lost.continent] };
        c.L = this.faction(lost.player, lost.continent);
        body.splice(1, 0, P('cl.l', K.CONTINENT_LOST.lead));
      }
      caption = P('fall.c', K.FALL.caption);
    }
    out.paper = this.paper(c, { headline, deck, kicker, body: body.filter(Boolean), caption, extra: it.priority >= BIG });
    return out;
  }
}
