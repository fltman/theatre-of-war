// Klippboken: krigets alla tidningar som urklipp i ett album – bläddra, klicka för att förstora.
//
//   const entry = scrapbookEntry(story, photoCanvas);   // när tidningen visas: liten JPEG av fotot + tidningen
//   await showScrapbook(entries, { container, world, title, signal, open });   // löses när albumet stängs; open = index att förstora direkt
//
// Esc/✕ stänger (först förstoringen, sedan albumet), ←/→ eller svep bläddrar. Fungerar på mobil.

import './scrapbook.css';
import { renderPage } from './newspaper.js';
import { loadPressFonts } from './fonts.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// Det regin sparar när en tidning visas: själva tidningen och fotot som liten JPEG (data-URL).
export function scrapbookEntry(story, photo = null, { width = 480, quality = 0.72 } = {}) {
  let img = null;
  if (photo) {
    const w0 = photo.videoWidth || photo.naturalWidth || photo.width;
    const h0 = photo.videoHeight || photo.naturalHeight || photo.height;
    if (w0 && h0) {
      const c = document.createElement('canvas');
      c.width = Math.min(width, w0);
      c.height = Math.round((c.width * h0) / w0);
      c.getContext('2d').drawImage(photo, 0, 0, c.width, c.height);
      try {
        img = c.toDataURL('image/jpeg', quality);
      } catch {
        img = null; // smutsig canvas (annan origin): klippet får en kartskiss i stället
      }
    }
  }
  return {
    id: story.id, kind: story.kind, round: story.round, date: story.date, focus: story.focus,
    perspective: story.perspective ?? null, paper: story.paper, photo: img,
  };
}

const PAGE_W = 1280; // tidningens bredd i designpixlar (bred layout)

export function showScrapbook(entries, { container = document.body, world = null, title = 'The War in Clippings', signal, open = null } = {}) {
  const items = (entries || []).filter((e) => e && e.paper);
  const root = el('div', 'sb-root');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', title);
  const head = el('header', 'sb-head');
  const h = el('h2', 'sb-title', title);
  const pager = el('span', 'sb-pager');
  const prev = el('button', 'sb-btn sb-prev', '←');
  const next = el('button', 'sb-btn sb-next', '→');
  const close = el('button', 'sb-btn sb-close', '✕');
  prev.setAttribute('aria-label', 'Previous page');
  next.setAttribute('aria-label', 'Next page');
  close.setAttribute('aria-label', 'Close');
  head.append(h, prev, pager, next, close);
  const sheet = el('div', 'sb-sheet');
  root.append(head, sheet);
  container.append(root);
  loadPressFonts();

  const cache = new Map();
  let page = 0;
  let pages = 1;
  let per = 6;
  let cols = 3;
  let lightbox = null;
  let resolve;
  const done = new Promise((r) => (resolve = r));

  const GAP = 28;
  const clipWidth = () => Math.max(200, Math.floor((sheet.clientWidth - 48 - GAP * (cols - 1)) / cols) - 16);
  // Så många rader som ryms på bladet (klippet: 0,56 × bredden + kant och etikett + radavstånd).
  function geometry() {
    const vw = window.innerWidth;
    cols = vw >= 1100 ? 3 : vw >= 700 ? 2 : 1;
    const w = clipWidth();
    const rows = Math.max(1, Math.floor((sheet.clientHeight - 70 + 34) / (w * 0.56 + 38 + 34)));
    const first = page * per;
    per = cols * rows;
    pages = Math.max(1, Math.ceil(items.length / per));
    page = Math.min(Math.floor(first / per), pages - 1);
  }

  async function thumb(entry, w) {
    const key = entry.id + '@' + w;
    if (!cache.has(key)) cache.set(key, renderPage(entry, { scale: w / PAGE_W, layout: 'wide', world }));
    return cache.get(key);
  }

  async function draw() {
    geometry();
    sheet.textContent = '';
    sheet.style.setProperty('--sb-cols', cols);
    pager.textContent = items.length ? `${page + 1} / ${pages}` : '';
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
    if (!items.length) {
      sheet.append(el('p', 'sb-empty', 'No clippings yet. The presses are still warming up.'));
      return;
    }
    const slice = items.slice(page * per, page * per + per);
    const w = clipWidth();
    const token = (draw.token = (draw.token || 0) + 1);
    for (const entry of slice) {
      const r = hash(entry.id);
      const clip = el('button', 'sb-clip');
      clip.style.setProperty('--sb-rot', `${((r % 700) / 100 - 3.5).toFixed(2)}deg`);
      clip.style.setProperty('--sb-w', `${w}px`);
      clip.dataset.tape = String(r % 3);
      clip.setAttribute('aria-label', `${entry.paper.headline} — ${entry.date || ''}`);
      const cut = el('div', 'sb-cut');
      cut.style.height = `${Math.round(w * 0.56)}px`;
      clip.append(cut, el('span', 'sb-label', entry.date || ''));
      clip.addEventListener('click', () => zoom(entry));
      sheet.append(clip);
      thumb(entry, w).then((node) => {
        if (token !== draw.token) return;
        cut.append(node); // samma nod flyttas vid ombritning (canvas kan inte klonas)
      });
    }
  }

  async function zoom(entry) {
    closeZoom();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wide = vw / vh >= 0.9;
    const L = wide ? { w: 1280, h: 960 } : { w: 600, h: 1240 };
    const s = Math.min((vw * 0.92) / L.w, (vh * 0.9) / L.h);
    lightbox = el('div', 'sb-zoom');
    const shut = el('button', 'sb-btn sb-close sb-zoom-close', '✕');
    shut.setAttribute('aria-label', 'Close clipping');
    lightbox.append(shut);
    root.append(lightbox);
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target === shut) closeZoom();
    });
    const page = await renderPage(entry, { scale: s, layout: wide ? 'wide' : 'narrow', world });
    if (!lightbox) return;
    page.classList.add('sb-zoom-page');
    lightbox.append(page);
  }

  function closeZoom() {
    lightbox?.remove();
    lightbox = null;
  }

  function finish() {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    root.classList.add('sb-out');
    setTimeout(() => root.remove(), 280);
    resolve();
  }

  const go = (d) => {
    const n = Math.min(pages - 1, Math.max(0, page + d));
    if (n !== page) {
      page = n;
      sheet.classList.remove('sb-turn');
      void sheet.offsetWidth;
      sheet.classList.add('sb-turn');
      draw();
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (lightbox) closeZoom();
      else finish();
    } else if (!lightbox && e.key === 'ArrowRight') go(1);
    else if (!lightbox && e.key === 'ArrowLeft') go(-1);
  };
  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 150);
  };
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  close.addEventListener('click', finish);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  // svep
  let x0 = null;
  sheet.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  sheet.addEventListener('pointerup', (e) => {
    if (x0 != null && Math.abs(e.clientX - x0) > 60) go(e.clientX < x0 ? 1 : -1);
    x0 = null;
  });
  if (signal) signal.addEventListener('abort', finish, { once: true });

  requestAnimationFrame(() => {
    root.classList.add('sb-in');
    draw();
    if (open != null && items[open]) zoom(items[open]);
  });
  return done;
}
