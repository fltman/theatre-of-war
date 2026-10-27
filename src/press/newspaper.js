// Kvällstidningen: ett DOM-överlägg som snurrar in som i gamla filmer, ligger kvar och snurrar ut.
//
//   await showNewspaper(story, { photo: canvas | null, hold: 4500 });
//
// story = ett reportage från Newsdesk (med `paper` och `date`) eller ett `paper`-objekt direkt.
// Tillval: hold (ms, Infinity = tills klick), photo (canvas/bild/video – rastreras till halvton),
// world (public/map/world.json – kartskissen utan foto får riktiga kuster),
// container (standard document.body), signal (AbortSignal som stänger tidningen), onLand() när den landat,
// onLeave() när den börjar snurra ut, motion: false = ingen snurr (bara tona). Klick, mellanslag, Enter och Esc
// hoppar fram. Promiset löses när tidningen är borta.

import './newspaper.css';
import { loadPressFonts } from './fonts.js';
import { halftone, sketch } from './halftone.js';

const WIDE = { w: 1280, h: 960, maxLines: 2, maxFs: 134, minFs: 60 };
const NARROW = { w: 600, h: 1240, maxLines: 4, maxFs: 104, minFs: 44 };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// "BERLIN, March 14 (AW) — Text" -> fet datumrad + text
function paragraph(text, cls) {
  const p = el('p', cls);
  const m = text.match(/^([A-Z][A-Z .'-]+(?:, [A-Z][a-z]+ \d{1,2})? \([A-Z]+\) — )/);
  if (m) {
    p.classList.add('np-has-dl');
    p.append(el('span', 'np-dl', m[1]), text.slice(m[1].length));
  } else p.textContent = text;
  return p;
}

function box(col) {
  const b = el('section', 'np-box' + (col.kind === 'rule' ? ' np-box-rule' : ''));
  b.append(el('h3', null, col.title));
  const lines = String(col.text || '').split('\n').filter(Boolean);
  if (lines.every((l) => l.includes('\t'))) {
    const t = el('table', 'np-fig');
    for (const l of lines) {
      const [a, n] = l.split('\t');
      const tr = el('tr');
      tr.append(el('td', null, a), el('td', 'np-dots'), el('td', null, n));
      t.append(tr);
    }
    b.append(t);
  } else {
    for (const l of lines) b.append(paragraph(l));
  }
  return b;
}

function ad(a, i) {
  const d = el('div', `np-ad np-ad-${i % 3}`);
  d.append(el('div', 'np-brand', a.brand), el('div', 'np-line', a.line), el('div', 'np-copy', a.text));
  return d;
}

function build(story, layout) {
  const p = story.paper || story;
  const extra = /extra/i.test(p.edition || '');
  const page = el('article', 'np-page np-ink' + (layout === NARROW ? ' np-narrow' : ''));
  page.style.width = layout.w + 'px';
  page.style.height = layout.h + 'px';

  const ears = el('div', 'np-ears');
  const weather = (p.columns || []).find((c) => /weather/i.test(c.title));
  const left = el('div', 'np-ear');
  left.append(el('b', null, weather ? 'Weather' : 'Late Wire'), el('span', null, weather ? weather.text.split('.')[0] + '.' : 'Bulletins hourly'));
  const right = el('div', 'np-ear' + (extra ? ' np-extra' : ''));
  right.append(el('b', null, extra ? 'Extra' : p.edition), el('span', null, p.price));
  ears.append(left, el('div', 'np-mast', p.masthead), right);
  page.append(ears);
  if (p.motto) page.append(el('div', 'np-motto', `“${p.motto}”`));
  const folio = el('div', 'np-folio');
  folio.append(el('span', null, p.number || ''), el('span', null, story.date || p.date || ''), el('span', null, `${extra ? 'Extra' : p.edition} · ${p.price}`));
  page.append(folio);

  const kicker = el('div', 'np-kicker' + (extra || p.accent ? ' np-red' : ''));
  kicker.append(el('span', null, extra ? 'Extra! Extra!' : p.kicker || 'Late News'));
  page.append(kicker);
  const h1 = el('h1', 'np-headline', p.headline);
  page.append(h1);
  page.append(el('p', 'np-deck', p.deck));
  // Månadens regel (världshändelse): tidningen är där spelaren får veta den.
  if (p.rule) {
    const r = el('div', 'np-rulebox');
    r.append(el('b', null, 'By order \u2014 this month: '), p.rule);
    page.append(r);
  }
  page.append(el('div', 'np-rule2'));

  const grid = el('div', 'np-grid');
  const main = el('div', 'np-main');
  const fig = el('figure', 'np-photo');
  const cap = el('figcaption');
  cap.append(el('b', null, story.photo === false ? 'MAP' : 'WIREPHOTO'), p.photoCaption || '');
  fig.append(el('canvas'), cap);
  const text = el('div', 'np-story');
  (p.body || []).forEach((t) => text.append(paragraph(t)));
  main.append(fig, text);
  // Sidospalten i prioritetsordning: det som inte ryms klipps bakifrån.
  const side = el('aside', 'np-side');
  const cols = (p.columns || []).filter((c) => !/weather/i.test(c.title) || layout === NARROW);
  const ads = (p.ads || []).map(ad);
  for (const e of [box(cols[0] || { title: '', text: '' }), cols[1] && box(cols[1]), ads[0], cols[2] && box(cols[2]), ads[1]]) if (e) side.append(e);
  grid.append(main, side);
  page.append(grid);
  return { page, h1, fig, cap, text, side };
}

// Störst möjliga rubrik som ryms på högst maxLines rader utan att något ord sticker ut.
function fitHeadline(h1, layout) {
  for (let fs = layout.maxFs; fs >= layout.minFs; fs -= 3) {
    h1.style.fontSize = fs + 'px';
    const lines = Math.round(h1.offsetHeight / (fs * 0.98));
    if (lines <= layout.maxLines && h1.scrollWidth <= h1.clientWidth + 1) return fs;
  }
  return layout.minFs;
}

// Tidningsnamnet krymper tills det ryms mellan öronen.
function fitMast(m) {
  let fs = parseFloat(getComputedStyle(m).fontSize);
  while (fs > 20 && m.scrollWidth > m.clientWidth + 1) m.style.fontSize = (fs -= 2) + 'px';
}

// Klipp brödtext och sidospalt så att allt ryms på sidan ("Continued on Page 3").
function fitColumns(parts, layout, pageTop, s) {
  const limit = layout.h - 22;
  const bottom = (e) => (e.getBoundingClientRect().bottom - pageTop) / s;
  const ps = [...parts.text.querySelectorAll('p')];
  let cut = false;
  while (ps.length > 1 && bottom(parts.text) > limit - 18) {
    ps.pop().remove();
    cut = true;
  }
  if (cut || bottom(parts.text) > limit - 18) {
    const last = parts.text.lastElementChild;
    if (last && bottom(parts.text) > limit - 18) {
      // klipp sista stycket ord för ord
      const words = last.lastChild && last.lastChild.nodeType === 3 ? last.lastChild : null;
      if (words) {
        let t = words.textContent;
        while (t.length > 20 && bottom(parts.text) > limit - 18) {
          t = t.slice(0, t.lastIndexOf(' ', t.length - 2));
          words.textContent = t + '…';
        }
      }
    }
    parts.text.append(el('div', 'np-cont', `Continued on Page ${2 + Math.floor(Math.random() * 6)}`));
  }
  const kids = [...parts.side.children];
  while (kids.length && bottom(parts.side) > limit) kids.pop().remove();
  if (!kids.length) parts.side.remove();
}

// Ett foto kan vara canvas/bild/video eller en data-URL (klippboken sparar små JPEG:ar).
async function loadPhoto(photo) {
  if (!photo || typeof photo !== 'string') return photo;
  const img = new Image();
  img.src = photo;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

const pickLayout = (layout, vw, vh) => (layout === 'wide' ? WIDE : layout === 'narrow' ? NARROW : vw / vh >= 0.9 ? WIDE : NARROW);

// Bygger och mäter en sida i skala s inuti `host` (som måste sitta i dokumentet). Returnerar .np-fit.
async function compose(story, layout, s, host, { photo, world }) {
  photo = await loadPhoto(photo);
  const fit = el('div', 'np-fit');
  fit.style.width = layout.w * s + 'px';
  fit.style.height = layout.h * s + 'px';
  const parts = build({ ...story, photo: photo ? true : false }, layout);
  const paper = story.paper || story;
  if (paper.accent) parts.page.style.setProperty('--np-red', paper.accent);
  if (paper.final) parts.page.classList.add('np-final');
  parts.page.style.transform = `scale(${s})`;
  fit.append(parts.page);
  host.append(fit);

  fitHeadline(parts.h1, layout);
  fitMast(parts.page.querySelector('.np-mast'));
  const fw = parts.fig.offsetWidth;
  // Fotot får det som blir kvar under rubriken (bildtexten behöver ~44 px), men aldrig mer än 3:5.
  const figTop = (parts.fig.getBoundingClientRect().top - parts.page.getBoundingClientRect().top) / s;
  const room = layout.h - 24 - figTop - 44;
  const fh = Math.round(Math.max(140, Math.min(fw * (layout === WIDE ? 0.7 : 0.62), room)));
  const scale = Math.min(3, Math.max(0.5, s * (window.devicePixelRatio || 1) * 1.25));
  let pic;
  try {
    pic = photo ? halftone(photo, fw, fh, { scale }) : sketch(story, fw, fh, { scale, world });
  } catch (e) {
    console.warn('[press] foto', e);
    pic = sketch(story, fw, fh, { scale, world });
  }
  parts.fig.querySelector('canvas').replaceWith(pic);
  fitColumns(parts, layout, parts.page.getBoundingClientRect().top, s);
  return fit;
}

// Statisk tidningssida (samma sida som showNewspaper, utan animation), t.ex. till klippboken.
//   const el = await renderPage(story, { photo, world, scale: 0.4, layout: 'wide' | 'narrow' | 'auto' });
// story = reportage eller klippboksuppslag (scrapbookEntry). Elementet har fast storlek (layout × scale).
export async function renderPage(story, { photo = story.photo ?? null, world = null, scale = 0.5, layout = 'wide' } = {}) {
  await loadPressFonts();
  const L = pickLayout(layout, window.innerWidth, window.innerHeight);
  const host = el('div', 'np-static');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none';
  document.body.append(host);
  try {
    await compose(story, L, scale, host, { photo: typeof photo === 'boolean' ? null : photo, world });
  } finally {
    host.remove();
  }
  host.style.cssText = '';
  return host;
}

export async function showNewspaper(story, opts = {}) {
  const {
    photo = null, hold = 4500, container = document.body, signal, onLand, onLeave, world = null,
    motion = !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  } = opts;
  await loadPressFonts();

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const layout = pickLayout('auto', vw, vh);
  // Sidan vilar lätt snedställd: lämna marginal så att hörnen inte hamnar utanför bilden.
  const s = Math.min((vw * (layout === WIDE ? 0.94 : 0.86)) / layout.w, (vh * (layout === WIDE ? 0.95 : 0.9)) / layout.h);

  const stage = el('div', 'np-stage');
  const backdrop = el('div', 'np-backdrop');
  const spin = el('div', 'np-spin');
  const drift = el('div', 'np-drift');
  spin.append(drift);
  stage.append(backdrop, spin);
  stage.style.visibility = 'hidden';
  container.append(stage);
  // Layout och mätning innan något rör sig.
  await compose(story, layout, s, drift, { photo, world });
  stage.style.visibility = '';

  let skip;
  const skipped = new Promise((r) => (skip = r));
  const onKey = (e) => {
    if ([' ', 'Enter', 'Escape'].includes(e.key)) {
      e.preventDefault();
      skip();
    }
  };
  stage.addEventListener('pointerdown', () => skip());
  window.addEventListener('keydown', onKey, true);
  if (signal) {
    if (signal.aborted) skip();
    else signal.addEventListener('abort', () => skip(), { once: true });
  }

  const rest = 'rotate(-2.2deg) scale(1)';
  const anims = [];
  const run = (target, frames, o) => {
    const a = target.animate(frames, { fill: 'forwards', ...o });
    anims.push(a);
    return a.finished.catch(() => {});
  };

  // In: snurrar upp ur mitten.
  run(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
  const spinIn = motion
    ? run(spin, [
      { transform: 'rotate(-1260deg) scale(0.03)', opacity: 0 },
      { opacity: 1, offset: 0.06 },
      { transform: 'rotate(-14deg) scale(1.05)', offset: 0.84 },
      { transform: rest },
    ], { duration: 1650, easing: 'cubic-bezier(.2,.62,.28,1)' })
    : run(spin, [{ opacity: 0, transform: rest }, { opacity: 1, transform: rest }], { duration: 400 });
  await Promise.race([spinIn, skipped]);
  anims.forEach((a) => a.finish());
  onLand?.();

  // Ligger kvar och glider långsamt närmare (Ken Burns).
  if (motion && Number.isFinite(hold)) run(drift, [{ transform: 'scale(1)' }, { transform: 'scale(1.045) translateY(1%)' }], { duration: hold, easing: 'linear' });
  await Promise.race([skipped, Number.isFinite(hold) ? new Promise((r) => setTimeout(r, hold)) : new Promise(() => {})]);

  // Ut.
  onLeave?.();
  window.removeEventListener('keydown', onKey, true);
  stage.style.pointerEvents = 'none';
  const from = getComputedStyle(spin).transform;
  run(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 650, delay: 150 });
  await (motion
    ? run(spin, [{ transform: from === 'none' ? rest : from, opacity: 1 }, { transform: 'rotate(560deg) scale(0.03)', opacity: 0 }], { duration: 750, easing: 'cubic-bezier(.55,0,.85,.35)' })
    : run(spin, [{ opacity: 1 }, { opacity: 0 }], { duration: 400 }));
  stage.remove();
}
