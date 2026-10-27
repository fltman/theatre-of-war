// Utvecklingssida för pressen (press.html): kör ett fejkat krig genom redaktionen och visar resultatet.
// URL: ?seed=7&players=4&persp=1 (sidans tidning)&diplo=1 (pakter och svek)  ·  ?paper=betrayal&rel=lost  ·  ?scrapbook=1&open=K  ·  ?paper=N (N:te tidningen, ligger kvar)  ·  &nophoto=1  ·  ?radio=N&line=K
//      ?reel=N&card=K&t=1.5 (fryst journalfilmsruta)  ·  ?gallery=1 (alla korttyper)
import { Newsdesk } from './newsdesk.js';
import { showNewspaper } from './newspaper.js';
import { showSubtitle } from './subtitles.js';
import { drawReelCard, loadPressFonts } from './reel.js';
import { loadWorld } from './worldmap.js';
import { showScrapbook, scrapbookEntry } from './scrapbook.js';
import { warSteps } from '../../test/fixtures/simwar.mjs';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
let stories = [];
let filter = 'all';
let playing = 0;
let world = null;
const worldReady = loadWorld().then((w) => (world = w));

function runWar(seed, players, perspective = null) {
  let desk;
  let last;
  const out = [];
  for (const { events, state } of warSteps({ seed, players, diplomacy: $('#diplo').checked, worldEvents: $('#world').checked, fog: $('#fog').checked })) {
    desk ??= new Newsdesk({ players: state.players, seed, perspective });
    out.push(...desk.feed(events, state));
    last = state;
  }
  out.push(...desk.flush(last));
  return out;
}

// Ett påhittat "foto" från fronten (regin skickar en riktig rendering).
function fakePhoto(seed = 1) {
  const c = document.createElement('canvas');
  c.width = 960;
  c.height = 600;
  const g = c.getContext('2d');
  const r = (k) => { const x = Math.sin(seed * 91.7 + k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const sky = g.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, '#d8d4c8'); sky.addColorStop(0.5, '#a8a294'); sky.addColorStop(0.52, '#6b6253'); sky.addColorStop(1, '#2b261f');
  g.fillStyle = sky; g.fillRect(0, 0, 960, 600);
  for (let i = 0; i < 14; i++) {
    const x = r(i) * 960; const y = 140 + r(i + 20) * 200; const rad = 60 + r(i + 40) * 140;
    const s = g.createRadialGradient(x, y, 0, x, y, rad);
    s.addColorStop(0, `rgba(${40 + r(i) * 60},${38 + r(i) * 55},${34 + r(i) * 50},0.75)`); s.addColorStop(1, 'rgba(60,55,50,0)');
    g.fillStyle = s; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.fillStyle = '#181512';
  g.beginPath(); g.moveTo(0, 330);
  for (let x = 0; x <= 960; x += 40) g.lineTo(x, 320 + Math.sin(x * 0.013 + seed) * 18 + r(x) * 10);
  g.lineTo(960, 600); g.lineTo(0, 600); g.fill();
  for (let i = 0; i < 3; i++) { // stridsvagnar
    const x = 120 + i * 270 + r(i + 7) * 60; const y = 400 + i * 40; const s = 1 + i * 0.25;
    g.fillStyle = '#0b0a09';
    g.fillRect(x, y, 170 * s, 40 * s); g.fillRect(x + 45 * s, y - 32 * s, 80 * s, 34 * s); g.fillRect(x + 120 * s, y - 22 * s, 110 * s, 9 * s);
    g.fillStyle = '#4b453c';
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x + 18 * s + k * 27 * s, y + 38 * s, 11 * s, 0, 7); g.fill(); }
  }
  for (let i = 0; i < 12; i++) { // soldater
    const x = r(i + 70) * 900 + 30; const y = 470 + r(i + 90) * 110; const s = 0.7 + r(i) * 0.6;
    g.fillStyle = '#0d0b0a';
    g.beginPath(); g.arc(x, y - 52 * s, 9 * s, 0, 7); g.fill();
    g.fillRect(x - 8 * s, y - 44 * s, 16 * s, 34 * s); g.fillRect(x - 7 * s, y - 10 * s, 6 * s, 26 * s); g.fillRect(x + 2 * s, y - 10 * s, 6 * s, 26 * s);
    g.fillRect(x + 4 * s, y - 70 * s, 3 * s, 46 * s);
  }
  return c;
}

const firstLine = (s) => (s.paper ? [s.paper.headline, s.paper.deck] : s.tv ? [s.tv.title, s.tv.narration[1]?.text] : [s.radio.lines[1]?.text || s.radio.lines[0].text, s.radio.lines[2]?.text || '']);

function renderList() {
  const list = $('#list');
  list.textContent = '';
  stories.forEach((s, i) => {
    if (filter !== 'all' && s.medium !== filter) return;
    const row = document.createElement('div');
    row.className = 'row';
    const [a, b] = firstLine(s);
    row.innerHTML = `<span class="r">r${s.round}<br>p${s.priority}</span><span class="m ${s.medium}">${s.medium}<br><span class="r">${s.kind}</span></span>`;
    const h = document.createElement('span');
    h.className = 'h';
    h.textContent = a;
    const sm = document.createElement('small');
    sm.textContent = `${s.date} — ${b}`;
    h.append(sm);
    row.append(h);
    row.onclick = () => play(i);
    list.append(row);
  });
}

async function playRadio(s, onlyLine) {
  const lines = onlyLine != null ? [s.radio.lines[onlyLine]] : s.radio.lines;
  for (const l of lines) await showSubtitle(l.text, { speaker: l.speaker, style: 'radio', station: s.radio.station, instant: onlyLine != null, duration: onlyLine != null ? Infinity : undefined });
}

async function playReel(s, freeze) {
  const token = ++playing;
  const canvas = $('#reel');
  const ctx = canvas.getContext('2d');
  await loadPressFonts();
  const cards = s.tv.cards;
  if (freeze) {
    drawReelCard(ctx, cards[freeze.card], freeze.t, { world });
    return;
  }
  for (const card of cards) {
    const t0 = performance.now();
    if (card.line) showSubtitle(card.line.text, { style: 'tv', duration: card.duration * 1000 - 200 });
    await new Promise((res) => {
      const tick = () => {
        if (token !== playing) return res();
        const t = (performance.now() - t0) / 1000;
        drawReelCard(ctx, card, Math.min(t, card.duration), { world });
        if (t >= card.duration) res();
        else requestAnimationFrame(tick);
      };
      tick();
    });
  }
}

async function play(i, extra = {}) {
  const s = stories[i];
  $('#note').textContent = `${s.id} · ${s.medium} · ${s.kind} · ${s.date}`;
  if (s.medium === 'paper') await showNewspaper(s, { photo: q.has('nophoto') ? null : fakePhoto(i), hold: extra.hold ?? 6000, world });
  else if (s.medium === 'radio') await playRadio(s, extra.line);
  else await playReel(s, extra.freeze);
}

async function gallery() {
  await loadPressFonts();
  const tv = stories.find((s) => s.medium === 'tv');
  const cards = [{ kind: 'countdown', duration: 3, t: 0.62 }, { ...tv.tv.cards[1], t: 2 }, { ...tv.tv.cards[2], t: 1.5 },
    { ...tv.tv.cards.find((c) => c.kind === 'map'), t: 3.2 }, { ...tv.tv.cards.find((c) => c.kind === 'footage'), t: 2 },
    { ...tv.tv.cards[tv.tv.cards.length - 1], t: 1.5 }];
  const box = $('#gallery');
  box.textContent = '';
  for (const c of cards) {
    const cv = document.createElement('canvas');
    cv.width = 640;
    cv.height = 480;
    box.append(cv);
    drawReelCard(cv.getContext('2d'), c, c.t, { world });
  }
}

function scrapbook(open = null) {
  const entries = stories.map((s, i) => [s, i]).filter(([s]) => s.paper).map(([s, i]) => scrapbookEntry(s, i % 3 === 2 ? null : fakePhoto(i)));
  return showScrapbook(entries, { world, open, title: $('#persp').value === '' ? 'The War in Clippings' : `The War in Clippings \u2014 ${$('#persp').selectedOptions[0].text} Edition` });
}

function start() {
  const p = $('#persp').value;
  stories = runWar(+$('#seed').value, +$('#players').value, p === '' ? null : +p);
  renderList();
  gallery();
}

$('#run').onclick = start;
$('#scrap').onclick = () => scrapbook();
$('#persp').onchange = start;
document.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
  filter = b.dataset.f;
  document.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
  renderList();
}));

if (q.has('seed')) $('#seed').value = q.get('seed');
if (q.has('players')) $('#players').value = q.get('players');
if (q.has('persp')) $('#persp').value = q.get('persp');
if (q.has('diplo')) $('#diplo').checked = true;
if (q.has('world')) $('#world').checked = true;
if (q.has('fog')) $('#fog').checked = true;
for (const id of ['#diplo', '#world', '#fog']) $(id).onchange = start;
start();

(async () => {
  await loadPressFonts();
  await worldReady;
  gallery();
  const nth = (medium, n) => stories.map((s, i) => [s, i]).filter(([s]) => s.medium === medium)[n]?.[1];
  if (q.has('scrapbook')) {
    scrapbook(q.has('open') ? +q.get('open') : null);
    setTimeout(() => (window.__pressReady = true), 3500);
  } else if (q.has('paper')) {
    const kind = q.get('paper');
    const rel = q.get('rel');
    const wid = q.get('wid');
    const box = q.has('box'); // en vanlig tidning med månadens regelruta
    const i = box ? stories.findIndex((s) => s.paper && s.kind !== 'world' && s.paper.columns[0]?.kind === 'rule')
      : /^[a-z]+$/.test(kind) ? stories.findIndex((s) => s.kind === kind && s.paper && (!rel || s.relation === rel) && (!wid || s.worldId === wid)) : nth('paper', +kind);
    play(i, { hold: Infinity });
    setTimeout(() => (window.__pressReady = true), 2400);
  } else if (q.has('radio')) {
    play(nth('radio', +q.get('radio')), { line: +(q.get('line') || 1) });
    setTimeout(() => (window.__pressReady = true), 600);
  } else if (q.has('reel')) {
    await play(nth('tv', +q.get('reel')), { freeze: { card: +(q.get('card') || 0), t: +(q.get('t') || 1.5) } });
    window.__pressReady = true;
  } else window.__pressReady = true;
})();
