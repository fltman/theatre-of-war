// Telefondiplomatin i gränssnittet: inkommande samtal (paktförslag till en människa), växeln (ring upp en makt
// och föreslå en pakt) och korta besked. Korten är anteckningsblock på slitet papper; kameran står vid telefonen.
import { FACTION } from '../shared/factions.js';
import { TERRITORY, IDS } from '../shared/map.js';
import { pactBetween, PACT_MONTHS } from '../shared/engine.js';
import { monthOf } from './hud.js';
import { GENERALS, line, pick } from './generals.js';

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const army = (st, p) => FACTION[st.players[p].faction].army.replace(/^the /, 'the ');
const Army = (st, p) => { const a = army(st, p); return a[0].toUpperCase() + a.slice(1); };
const chip = (st, p) => `<i class="chip" style="--c:${FACTION[st.players[p].faction].paint}"></i>`;

// Gemensam gräns mellan p och q: antal kontaktpunkter och q:s styrka längs den.
export function borderWith(st, p, q) {
  let n = 0, theirs = 0;
  const seen = new Set();
  for (const t of IDS) {
    if (st.owner[t] !== p) continue;
    for (const x of TERRITORY[t].neighbors) if (st.owner[x] === q) { n++; if (!seen.has(x)) { seen.add(x); theirs += st.armies[x]; } }
  }
  return { n, theirs };
}

function card(html) {
  const root = document.getElementById('overlay');
  root.querySelector('.phone-card')?.remove();
  const c = el(`<div class="phone-card"><div class="pad">${html}</div></div>`);
  root.append(c);
  requestAnimationFrame(() => c.classList.add('in'));
  return c;
}
export function closeCard() {
  const c = document.querySelector('.phone-card');
  if (!c) return;
  c.classList.remove('in');
  setTimeout(() => c.remove(), 350);
}

// Ett samtal till människan: generalen på andra sidan föreslår en pakt.
// Generalens porträtt och namn överst på kortet.
function caller(st, p) {
  const g = GENERALS[st.players[p].faction];
  if (!g) return `<p class="who">${chip(st, p)} The field marshal of <b>${army(st, p)}</b> is on the line.</p>`;
  return `<div class="caller"><img src="${g.portrait}" alt=""><div><b>${g.title} ${g.name}</b><span>${chip(st, p)} ${Army(st, p)}</span></div></div>`;
}
export function generalSays(st, p, cat, extra = {}) {
  const f = st.players[p].faction;
  if (!GENERALS[f]) return null;
  return line(pick(f, cat, st.round * 7 + p), extra);
}

export function incoming(st, onVoice) {
  const { from, to, months } = st.proposal;
  const b = borderWith(st, to, from);
  const trust = st.players[from].betrayals ?? 0;
  const said = generalSays(st, from, 'propose', { months, until: monthOf(st.round + months), army: army(st, to) })
    ?? `No attacks between our armies for ${months === 6 ? 'six' : 'three'} months — until the end of ${monthOf(st.round + months)}. Do we have an understanding?`;
  const c = card(`
    <div class="hdr">TELEPHONE · PRIORITY CALL</div>
    ${caller(st, from)}
    <blockquote>“${said}”</blockquote>
    <p class="terms">Terms: no attacks either way for ${months === 6 ? 'six' : 'three'} months — until the end of ${monthOf(st.round + months)}.</p>
    <p class="note">${b.n ? `You share ${b.n} border${b.n === 1 ? '' : 's'}; ${b.theirs} of their armies stand along it.` : 'Your armies do not meet anywhere.'}
    ${trust ? `<br><b class="warn">They have broken their word ${trust === 1 ? 'once' : trust + ' times'} before.</b>` : ''}</p>
    <div class="row"><button data-a="yes" class="primary">Agree — shake on it</button><button data-a="no">Hang up</button></div>`);
  onVoice?.(4200);
  return new Promise((resolve) => {
    c.querySelector('[data-a=yes]').onclick = () => { closeCard(); resolve({ type: 'answer', accept: true }); };
    c.querySelector('[data-a=no]').onclick = () => { closeCard(); resolve({ type: 'answer', accept: false }); };
  });
}

// Växeln: människan ringer upp en makt. Löses med ett propose-drag eller null (avbröt).
export function switchboard(st, me) {
  const rows = st.players.map((pl, q) => {
    if (q === me || !pl.alive) return '';
    const pact = pactBetween(st, me, q);
    const b = borderWith(st, me, q);
    const right = pact
      ? `<span class="tag">pact until ${monthOf(pact.until)}</span>`
      : PACT_MONTHS.map((m) => `<button data-q="${q}" data-m="${m}">${m} months</button>`).join('');
    const bitter = pl.grudges?.[me] != null;
    return `<div class="line">${chip(st, q)}<b>${Army(st, q)}</b><span class="meta">${b.n ? `${b.n} border${b.n === 1 ? '' : 's'} · ${b.theirs} armies` : 'no common border'}${pl.betrayals ? ' · <span class="warn">broke a pact</span>' : ''}${bitter ? ' · <span class="warn">has not forgiven you</span>' : ''}</span><span class="act">${right}</span></div>`;
  }).join('');
  const c = card(`
    <div class="hdr">SWITCHBOARD · ONE CALL PER MONTH</div>
    <p class="who">Propose a non-aggression pact: neither side may attack the other until it expires. Attacking a partner breaks it — and the papers will call it betrayal.</p>
    <div class="lines">${rows}</div>
    <div class="row"><button data-a="cancel">Put the receiver down</button></div>`);
  return new Promise((resolve) => {
    c.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { closeCard(); resolve({ type: 'propose', partner: +b.dataset.q, months: +b.dataset.m }); }));
    c.querySelector('[data-a=cancel]').onclick = () => { closeCard(); resolve(null); };
  });
}

// Kort besked i luren (svar på ett samtal människan ringde). who: { st, p } visar generalen som svarar.
export function reply(text, ms = 2600, who = null) {
  card(`<div class="hdr">TELEPHONE</div>${who ? caller(who.st, who.p) : ''}<blockquote>${text}</blockquote>`);
  return new Promise((r) => setTimeout(() => { closeCard(); r(); }, ms));
}

export { army, Army };
