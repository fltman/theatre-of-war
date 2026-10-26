// Journalfilmens kort (4:3) ritade på en canvas, animerade med t (sekunder sedan kortet började).
//
//   drawReelCard(ctx, card, t, { footage, drawMap, damage })
//
// card.kind: 'countdown' (3-2-1-ledare), 'title' (förtexter med jordglob och solfjäder), 'text' (mellantext i art déco),
// 'map' (kartkort med pil från card.from till card.to), 'footage' (bilder från fronten; opts.footage = canvas/video
// som ritas svartvit, annars en platshållare). card.duration styr in- och uttoning.
// opts.world = innehållet i public/map/world.json (worldmap.loadWorld()) ger riktiga kuster och gränser på kartkortet.
// opts.drawMap(ctx, view) får rita riktig kartgeometri under kartkortets pilar: view = { w, h, x0, y0, x1, y1 } där
// x/y är enhetskoordinater i geo.project (Miller, 11° Ö), och view.toScreen(ux, uy) ger canvaspixlar.
// drawFilmDamage(ctx, t, rect) lägger korn, repor, damm, flimmer och vinjett över valfri bild (t.ex. regins rendering).

import { loadPressFonts } from './fonts.js';
import { at, project } from './geo.js';
import { TERRITORY, TERRITORIES } from '../../shared/map.js';
import { drawWorld } from './worldmap.js';

export { loadPressFonts };

const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => v * v * (3 - 2 * v);
const MAP_ASPECT = 2.03; // bordskartans bredd/höjd

function wrap(ctx, text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > max && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Största teckenstorlek där texten ryms på högst maxLines rader.
function fitText(ctx, text, font, maxW, maxLines, start, min) {
  for (let fs = start; fs >= min; fs *= 0.94) {
    ctx.font = font(fs);
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { fs, lines };
  }
  ctx.font = font(min);
  return { fs: min, lines: wrap(ctx, text, maxW) };
}

function spaced(ctx, text, x, y, spacing) {
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = spacing + 'px';
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
  } else ctx.fillText(text, x, y);
}

// ------------------------------------------------------------------ korten

const PAINT = {
  countdown({ ctx, w, h, u, t }) {
    const sec = Math.floor(t);
    const n = 3 - sec;
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.1, w / 2, h / 2, h * 0.75);
    g.addColorStop(0, '#a4a29d');
    g.addColorStop(1, '#55534f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (n < 1) {
      ctx.fillStyle = '#060606';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const cx = w / 2;
    const cy = h / 2;
    const R = h * 0.4;
    // svepet
    const frac = t - sec;
    ctx.fillStyle = 'rgba(20,20,20,0.28)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R * 1.6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    // hårkors och ringar
    ctx.strokeStyle = 'rgba(15,15,15,0.85)';
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.stroke();
    ctx.strokeStyle = '#f2efe8';
    ctx.lineWidth = 5 * u;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2.5 * u;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, 0, Math.PI * 2); ctx.stroke();
    // siffran
    ctx.font = `700 ${h * 0.5}px "Oswald", "Arial Narrow", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6 * u;
    ctx.strokeStyle = '#f2efe8';
    ctx.strokeText(String(n), cx, cy + h * 0.02);
    ctx.fillStyle = '#141414';
    ctx.fillText(String(n), cx, cy + h * 0.02);
    // kantmärken
    ctx.font = `500 ${12 * u}px "Oswald", sans-serif`;
    ctx.fillStyle = 'rgba(20,20,20,0.7)';
    ctx.textBaseline = 'alphabetic';
    spaced(ctx, 'ATLAS NEWSREEL · 35MM · SOUND', cx, h - 18 * u, 3 * u);
  },

  title({ ctx, w, h, u, t, card }) {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.4;
    const zoom = 1.06 - 0.06 * ease(clamp01(t / 3));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    // solfjäder
    const rays = 40;
    for (let i = 0; i < rays; i++) {
      const a0 = (i / rays) * Math.PI * 2 + t * 0.06;
      const a1 = a0 + (Math.PI * 2) / rays / 2;
      ctx.fillStyle = i % 2 ? 'rgba(200,196,186,0.10)' : 'rgba(200,196,186,0.04)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, w, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    const fade = ctx.createRadialGradient(0, 0, h * 0.2, 0, 0, w * 0.6);
    fade.addColorStop(0, 'rgba(5,5,5,0)');
    fade.addColorStop(1, 'rgba(5,5,5,0.95)');
    ctx.fillStyle = fade;
    ctx.fillRect(-w, -h, w * 2, h * 2);
    // jordgloben (snurrar)
    const r = h * 0.19;
    const gg = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    gg.addColorStop(0, '#8c8a84');
    gg.addColorStop(1, '#2a2926');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(236,232,222,0.9)';
    ctx.lineWidth = 2.2 * u;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.2 * u;
    for (let k = 0; k < 6; k++) {
      const a = ((k * 30 + t * 24) % 180) * Math.PI / 180;
      ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(r * Math.cos(a)), r, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (const f of [-0.75, -0.4, 0, 0.4, 0.75]) {
      const yy = r * f;
      const xx = Math.sqrt(r * r - yy * yy);
      ctx.beginPath(); ctx.ellipse(0, yy, xx, xx * 0.12, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // vingar i art déco
    ctx.fillStyle = 'rgba(236,232,222,0.85)';
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const y = -r * 0.32 + i * r * 0.22;
        const len = r * (1.7 - i * 0.28);
        ctx.fillRect(s > 0 ? r * 1.12 : -r * 1.12 - len, y, len, r * 0.075);
      }
    }
    ctx.restore();
    // titeln
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const title = String(card.text || 'Atlas Newsreel').toUpperCase();
    const fit = fitText(ctx, title, (fs) => `${fs}px "Limelight", "Georgia", serif`, w * 0.86, 1, h * 0.13, h * 0.05);
    ctx.font = `${fit.fs}px "Limelight", "Georgia", serif`;
    ctx.shadowColor = 'rgba(255,250,235,0.35)';
    ctx.shadowBlur = 14 * u;
    ctx.fillStyle = '#efe9da';
    spaced(ctx, title, cx, h * 0.77, fit.fs * 0.08);
    ctx.shadowBlur = 0;
    if (card.sub) {
      ctx.font = `${h * 0.045}px "Poiret One", "Georgia", serif`;
      ctx.fillStyle = 'rgba(239,233,218,0.85)';
      spaced(ctx, String(card.sub).toUpperCase(), cx, h * 0.86, 4 * u);
    }
    ctx.strokeStyle = 'rgba(239,233,218,0.6)';
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.805); ctx.lineTo(w * 0.7, h * 0.805); ctx.stroke();
  },

  text({ ctx, w, h, u, card }) {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.1, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, '#22201c');
    g.addColorStop(1, '#040404');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // ram i art déco
    const ink = '#e9e3d3';
    ctx.strokeStyle = ink;
    const m1 = h * 0.07;
    const m2 = h * 0.095;
    ctx.lineWidth = 2.4 * u;
    ctx.strokeRect(m1, m1, w - m1 * 2, h - m1 * 2);
    ctx.lineWidth = 1 * u;
    ctx.strokeRect(m2, m2, w - m2 * 2, h - m2 * 2);
    for (const [x, y, sx, sy] of [[m1, m1, 1, 1], [w - m1, m1, -1, 1], [m1, h - m1, 1, -1], [w - m1, h - m1, -1, -1]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      ctx.fillStyle = ink;
      for (let i = 0; i < 3; i++) ctx.fillRect(i * 7 * u, i * 7 * u, (22 - i * 7) * u, 3 * u), ctx.fillRect(i * 7 * u, i * 7 * u, 3 * u, (22 - i * 7) * u);
      ctx.beginPath();
      ctx.arc(m2 - m1 + 4 * u, m2 - m1 + 4 * u, 18 * u, 0, Math.PI / 2);
      ctx.stroke();
      ctx.restore();
    }
    // texten
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    const text = String(card.text || '').toUpperCase();
    const fit = fitText(ctx, text, (fs) => `${fs}px "Limelight", "Georgia", serif`, w * 0.74, 3, h * 0.12, h * 0.05);
    const lh = fit.fs * 1.18;
    const top = h / 2 - ((fit.lines.length - 1) * lh) / 2 - (card.sub ? h * 0.05 : 0);
    fit.lines.forEach((l, i) => spaced(ctx, l, w / 2, top + i * lh, fit.fs * 0.05));
    if (card.sub) {
      const y = top + (fit.lines.length - 1) * lh + fit.fs * 0.8 + h * 0.03;
      ctx.lineWidth = 1 * u;
      ctx.beginPath(); ctx.moveTo(w * 0.38, y); ctx.lineTo(w * 0.62, y); ctx.stroke();
      const sub = fitText(ctx, card.sub, (fs) => `${fs}px "Poiret One", "Georgia", serif`, w * 0.7, 2, h * 0.05, h * 0.03);
      sub.lines.forEach((l, i) => ctx.fillText(l, w / 2, y + h * 0.05 + i * sub.fs * 1.2));
    }
  },

  map({ ctx, w, h, u, t, card, opts }) {
    const ids = [...new Set([card.to, card.from, ...(card.territories || [])].filter((x) => TERRITORY[x]))];
    const pts = ids.map(at);
    let [x0, y0, x1, y1] = [1, 1, 0, 0];
    for (const [x, y] of pts.length ? pts : [[0.5, 0.45]]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    // fönster i kartans proportioner, 4:3, med marginal och långsam inzoomning
    let vw = Math.max((x1 - x0) * MAP_ASPECT, (y1 - y0) * (4 / 3), 0.35) * 1.7 * (1.06 - 0.06 * ease(clamp01(t / card.duration || 0)));
    const vh = vw * 0.75;
    const cx = ((x0 + x1) / 2) * MAP_ASPECT;
    const cy = (y0 + y1) / 2 + vh * 0.04;
    const view = { w, h, x0: (cx - vw / 2) / MAP_ASPECT, y0: cy - vh / 2, x1: (cx + vw / 2) / MAP_ASPECT, y1: cy + vh / 2 };
    const S = ([x, y]) => [((x * MAP_ASPECT - (cx - vw / 2)) / vw) * w, ((y - (cy - vh / 2)) / vh) * h];
    view.toScreen = (x, y) => S([x, y]);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, opts.world ? '#8f8b82' : '#d9d4c9');
    bg.addColorStop(1, opts.world ? '#76726a' : '#bdb7aa');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // gradnät
    ctx.strokeStyle = 'rgba(40,38,34,0.25)';
    ctx.lineWidth = 1 * u;
    for (let lon = -180; lon <= 180; lon += 10) {
      ctx.beginPath();
      for (let lat = -56; lat <= 84; lat += 4) { const [sx, sy] = S(project(lon, lat)); lat === -56 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy); }
      ctx.stroke();
    }
    for (let lat = -50; lat <= 80; lat += 10) {
      const [, sy] = S(project(0, lat));
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    }
    const real = opts.world && drawWorld(ctx, opts.world, view, {
      highlight: ids.filter((x) => x !== card.to), strong: card.to ? [card.to] : [], style: 'reel', u,
    });
    if (opts.drawMap) {
      ctx.save();
      opts.drawMap(ctx, view, card, t);
      ctx.restore();
    } else if (!real) {
      // stabskarta: förbindelser och orter
      ctx.setLineDash([4 * u, 5 * u]);
      ctx.strokeStyle = 'rgba(30,28,25,0.45)';
      for (const T of TERRITORIES) for (const n of T.neighbors) {
        if (n < T.id) continue;
        const a = S(at(T.id));
        const b = S(at(n));
        if (Math.abs(a[0] - b[0]) > w * 1.5) continue;
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const T of TERRITORIES) {
      const [sx, sy] = S(at(T.id));
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
      const hot = ids.includes(T.id);
      if (!real || hot) {
        ctx.fillStyle = '#1b1916';
        ctx.beginPath(); ctx.arc(sx, sy, (hot ? 6 : 3.5) * u, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `${hot ? 700 : 500} ${(hot ? 17 : 12) * u}px "Oswald", "Arial Narrow", sans-serif`;
      const label = T.name.toUpperCase();
      if (hot) {
        const tw = ctx.measureText(label).width + 10 * u;
        ctx.fillStyle = 'rgba(236,230,214,0.92)';
        ctx.fillRect(sx - tw / 2, sy + 9 * u, tw, 21 * u);
      }
      ctx.fillStyle = real && !hot ? 'rgba(27,25,22,0.75)' : '#1b1916';
      spaced(ctx, label, sx, sy + (hot ? 25 : real ? 4 : 17) * u, 1.5 * u);
    }
    // målets pulserande ringar och pilen
    const p = ease(clamp01((t - 0.5) / 1.6));
    if (card.from && card.to && TERRITORY[card.from] && TERRITORY[card.to]) {
      const a = S(at(card.from));
      const b = S(at(card.to));
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mx = (a[0] + b[0]) / 2 - Math.sin(ang) * len * 0.22;
      const my = (a[1] + b[1]) / 2 + Math.cos(ang) * len * 0.22;
      const end = (k) => {
        const q = k;
        return [(1 - q) * (1 - q) * a[0] + 2 * (1 - q) * q * mx + q * q * b[0], (1 - q) * (1 - q) * a[1] + 2 * (1 - q) * q * my + q * q * b[1]];
      };
      const stop = 0.12 + 0.72 * p;
      for (const [col, lw] of [['#ece6d6', 15], ['#141210', 9]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw * u;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let k = 0.12; k <= stop + 1e-6; k += 0.02) { const [x, y] = end(k); k === 0.12 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.stroke();
      }
      if (p > 0.02) {
        const [ex, ey] = end(stop);
        const [px, py] = end(stop - 0.02);
        const ha = Math.atan2(ey - py, ex - px);
        for (const [col, s] of [['#ece6d6', 1.35], ['#141210', 1]]) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(ex + Math.cos(ha) * 22 * u * s, ey + Math.sin(ha) * 22 * u * s);
          ctx.lineTo(ex + Math.cos(ha + 2.5) * 20 * u * s, ey + Math.sin(ha + 2.5) * 20 * u * s);
          ctx.lineTo(ex + Math.cos(ha - 2.5) * 20 * u * s, ey + Math.sin(ha - 2.5) * 20 * u * s);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (p >= 1) {
        const k = (t - 2.1) % 1.1;
        ctx.strokeStyle = `rgba(20,18,16,${1 - k})`;
        ctx.lineWidth = 3 * u;
        ctx.beginPath(); ctx.arc(b[0], b[1], (12 + k * 46) * u, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // rubrikband
    if (card.text) {
      const text = String(card.text).toUpperCase();
      ctx.font = `${h * 0.06}px "Limelight", "Georgia", serif`;
      const tw = ctx.measureText(text).width + w * 0.08;
      ctx.fillStyle = 'rgba(12,11,10,0.86)';
      ctx.fillRect(w / 2 - tw / 2, h * 0.05, tw, h * 0.1);
      ctx.fillStyle = '#ece6d6';
      ctx.textBaseline = 'middle';
      spaced(ctx, text, w / 2, h * 0.1 + 1, 3 * u);
    }
  },

  footage({ ctx, w, h, u, t, card, opts }) {
    const src = opts.footage;
    if (src) {
      const iw = src.videoWidth || src.naturalWidth || src.width;
      const ih = src.videoHeight || src.naturalHeight || src.height;
      const k = Math.max(w / iw, h / ih);
      ctx.filter = 'grayscale(1) contrast(1.25) brightness(0.95) sepia(0.06)';
      ctx.drawImage(src, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
      ctx.filter = 'none';
    } else {
      // platshållare: horisont, rök och stridsvagnssiluetter
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#9c9a94');
      sky.addColorStop(0.55, '#6e6c66');
      sky.addColorStop(0.56, '#3c3b37');
      sky.addColorStop(1, '#1d1c1a');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 9; i++) {
        const x = ((hash(i) * 1.4 + t * 0.02 * (1 + hash(i + 3))) % 1.2 - 0.1) * w;
        const y = h * (0.35 + hash(i + 9) * 0.2);
        const r = h * (0.08 + hash(i + 5) * 0.12) * (1 + t * 0.03);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(40,39,36,0.55)');
        g.addColorStop(1, 'rgba(40,39,36,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.fillStyle = '#121110';
      for (let i = 0; i < 3; i++) {
        const x = w * (0.15 + i * 0.3) + t * 9 * u;
        const y = h * (0.62 + i * 0.05);
        const s = (34 + i * 8) * u;
        ctx.fillRect(x, y, s * 2.2, s * 0.55);
        ctx.fillRect(x + s * 0.6, y - s * 0.4, s, s * 0.45);
        ctx.fillRect(x + s * 1.5, y - s * 0.25, s * 1.3, s * 0.12);
      }
    }
    if (card.text) {
      const a = clamp01((t - 0.6) / 0.5) * clamp01(((card.duration || 6) - 0.4 - t) / 0.5);
      ctx.globalAlpha = a;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `${h * 0.065}px "Limelight", "Georgia", serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 8 * u;
      ctx.fillStyle = '#f2ede0';
      spaced(ctx, String(card.text).toUpperCase(), w * 0.07, h * 0.88, 2 * u);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  },
};

export function drawReelCard(ctx, card, t, opts = {}) {
  const CW = ctx.canvas.width;
  const CH = ctx.canvas.height;
  let w = CW;
  let h = (CW * 3) / 4;
  if (h > CH) {
    h = CH;
    w = (CH * 4) / 3;
  }
  const x0 = (CW - w) / 2;
  const y0 = (CH - h) / 2;
  const u = w / 640;
  const frame = Math.floor(t * 24);
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CW, CH);
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  // bildfönstrets ostadighet
  const wx = (Math.sin(t * 11.3) * 0.6 + (hash(frame) - 0.5) * 0.8) * u;
  const wy = (Math.sin(t * 7.1) * 0.9 + (hash(frame + 7) - 0.5) * 1.2) * u;
  ctx.translate(x0 + wx, y0 + wy);
  (PAINT[card.kind] || PAINT.text)({ ctx, w, h, u, t, card, frame, opts });
  // in- och uttoning (inte ledaren)
  if (card.kind !== 'countdown') {
    const d = card.duration || 3;
    const a = 1 - clamp01(t / 0.35) * clamp01((d - t) / 0.35);
    if (a > 0) {
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(-10, -10, w + 20, h + 20);
    }
  }
  ctx.restore();
  if (opts.damage !== false) drawFilmDamage(ctx, t, { x: x0, y: y0, w, h, intensity: card.kind === 'countdown' ? 1.3 : 1 });
}

// ------------------------------------------------------------------ filmskador

let tiles = null;
function grainTiles() {
  if (tiles) return tiles;
  tiles = [0, 1, 2].map((k) => {
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const g = c.getContext('2d');
    const img = g.createImageData(192, 192);
    for (let i = 0; i < 192 * 192; i++) {
      const v = Math.floor(hash(i * 3.17 + k * 1000.3) * 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  });
  return tiles;
}

export function drawFilmDamage(ctx, t, { x = 0, y = 0, w = ctx.canvas.width, h = ctx.canvas.height, intensity = 1 } = {}) {
  const frame = Math.floor(t * 24);
  const u = w / 640;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // flimmer
  const f = (hash(frame * 1.7) - 0.5) * 0.09 * intensity;
  ctx.fillStyle = f > 0 ? `rgba(255,250,240,${f})` : `rgba(0,0,0,${-f})`;
  ctx.fillRect(x, y, w, h);
  // korn
  const tile = grainTiles()[frame % 3];
  ctx.globalAlpha = 0.13 * intensity;
  ctx.globalCompositeOperation = 'overlay';
  const ox = Math.floor(hash(frame + 0.3) * 192);
  const oy = Math.floor(hash(frame + 0.7) * 192);
  const step = 192 * Math.max(1, u * 0.9);
  for (let yy = y - oy; yy < y + h; yy += step) for (let xx = x - ox; xx < x + w; xx += step) ctx.drawImage(tile, xx, yy, step, step);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // repor (långsamt vandrande, blinkande)
  for (let k = 0; k < 3; k++) {
    if (hash(frame * 3 + k * 17) < 0.45) continue;
    const sx = x + w * ((hash(k * 13 + Math.floor(t * 1.5)) + Math.sin(t * 0.7 + k) * 0.01) % 1);
    ctx.strokeStyle = hash(k + 40) > 0.5 ? `rgba(255,255,245,${0.22 * intensity})` : `rgba(0,0,0,${0.3 * intensity})`;
    ctx.lineWidth = (0.8 + hash(frame + k) * 1.2) * u;
    ctx.beginPath();
    ctx.moveTo(sx, y);
    ctx.lineTo(sx + (hash(frame + k * 5) - 0.5) * 3 * u, y + h);
    ctx.stroke();
  }
  // damm och hår
  const n = Math.floor(hash(frame + 99) * 5 * intensity);
  for (let i = 0; i < n; i++) {
    const dx = x + hash(frame * 7 + i) * w;
    const dy = y + hash(frame * 11 + i) * h;
    ctx.fillStyle = hash(frame + i * 3) > 0.3 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,250,0.6)';
    ctx.beginPath();
    ctx.ellipse(dx, dy, (0.6 + hash(i + frame) * 2.4) * u, (0.5 + hash(i * 2 + frame) * 1.6) * u, hash(i) * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (hash(frame * 0.37) > 0.965) {
    const hx = x + hash(frame + 5) * w;
    const hy = y + hash(frame + 6) * h;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1 * u;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.bezierCurveTo(hx + 20 * u, hy - 15 * u, hx + 10 * u, hy + 25 * u, hx + 35 * u, hy + 18 * u);
    ctx.stroke();
  }
  // vinjett
  const v = ctx.createRadialGradient(x + w / 2, y + h / 2, h * 0.38, x + w / 2, y + h / 2, w * 0.68);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${0.62 * intensity})`);
  ctx.fillStyle = v;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}
