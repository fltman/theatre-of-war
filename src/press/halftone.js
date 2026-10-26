// Tidningsrastrering: gör en rendering (canvas/bild/video) till ett halvtonsfoto med punkter i 45°,
// och en tecknad kartskiss när det inte finns något foto.

import { at } from './geo.js';
import { TERRITORY } from '../../shared/map.js';
import { drawWorld } from './worldmap.js';

const MAP_ASPECT = 2.03;

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

// src täcker rutan (object-fit: cover). w,h = rutans storlek i designpixlar, scale = pixlar per designpixel.
export function halftone(src, w, h, { scale = 2, cell = 4.2, angle = 45, ink = '#1d1a15', contrast = 1.35, gamma = 1.1 } = {}) {
  const sw = Math.round(w / 2);
  const sh = Math.round(h / 2);
  const sample = mk(sw, sh);
  const sx = sample.getContext('2d', { willReadFrequently: true });
  const iw = src.videoWidth || src.naturalWidth || src.width;
  const ih = src.videoHeight || src.naturalHeight || src.height;
  const k = Math.max(sw / iw, sh / ih);
  sx.filter = 'blur(0.6px)';
  sx.drawImage(src, (sw - iw * k) / 2, (sh - ih * k) / 2, iw * k, ih * k);
  const px = sx.getImageData(0, 0, sw, sh).data;
  const lum = new Float32Array(sw * sh);
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < sw * sh; i++) {
    const v = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
    lum[i] = v;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = Math.max(0.05, hi - lo);
  const L = (x, y) => {
    const xi = Math.min(sw - 1, Math.max(0, Math.round(x / 2)));
    const yi = Math.min(sh - 1, Math.max(0, Math.round(y / 2)));
    let v = (lum[yi * sw + xi] - lo) / span;           // nivåutjämning
    v = 0.5 + (v - 0.5) * contrast;
    return Math.min(1, Math.max(0, v)) ** gamma;
  };

  const out = mk(w * scale, h * scale);
  const g = out.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = ink;
  const a = angle * Math.PI / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const R = Math.hypot(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  for (let j = -R; j < R; j += cell) {
    for (let i = -R; i < R; i += cell) {
      const x = cx + i * ca - j * sa;
      const y = cy + i * sa + j * ca;
      if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
      const d = 1 - L(x, y);
      if (d < 0.04) continue;
      const r = cell * 0.5 * Math.sqrt(d) * 1.42;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return out;
}

// Kartskiss i tuschstil: kustlös skiss med prickade gränser, pilar och namn. Används utan foto.
export function sketch(story, w, h, { scale = 2, ink = '#1d1a15', world = null } = {}) {
  const out = mk(w * scale, h * scale);
  const g = out.getContext('2d');
  g.scale(scale, scale);
  const ids = (story?.focus?.territories || []).filter((t) => TERRITORY[t]);
  const pts = ids.map(at);
  const focus = pts.length ? pts : [[0.5, 0.4]];
  // fönster runt fokus
  let [x0, y0, x1, y1] = [1, 1, 0, 0];
  for (const [x, y] of focus) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const span = Math.max(0.12, x1 - x0, ((y1 - y0) * (w / h)) / MAP_ASPECT) * 1.9;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const ky = w / span / MAP_ASPECT;
  const P = ([x, y]) => [w / 2 + ((x - cx) / span) * w, h / 2 + (y - cy) * ky];

  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineCap = 'round';
  // gradnät
  g.globalAlpha = 0.35;
  g.lineWidth = 0.6;
  for (let i = -10; i <= 10; i++) {
    g.beginPath(); g.moveTo(w / 2 + i * w / 10, 0); g.lineTo(w / 2 + i * w / 10, h); g.stroke();
    g.beginPath(); g.moveTo(0, h / 2 + i * h / 6); g.lineTo(w, h / 2 + i * h / 6); g.stroke();
  }
  g.globalAlpha = 1;
  const real = world && drawWorld(g, world, { w, h, x0: cx - span / 2, x1: cx + span / 2, y0: cy - h / 2 / ky, y1: cy + h / 2 / ky },
    { strong: ids.slice(0, 1), highlight: ids.slice(1), style: 'ink' });
  // grannar som små prickar
  const near = new Set();
  for (const id of ids) for (const n of TERRITORY[id].neighbors) if (!ids.includes(n)) near.add(n);
  g.font = 'italic 13px "Old Standard TT", serif';
  g.textAlign = 'center';
  for (const n of near) {
    const [x, y] = P(at(n));
    const half = g.measureText(TERRITORY[n].name).width / 2 + 6;
    if (x < half || y < 30 || x > w - half || y > h - 24) continue;
    if (!real) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
    g.fillText(TERRITORY[n].name, x, y + (real ? 5 : 17));
  }
  // pil från andra fokus till första
  if (pts.length >= 2) {
    const [ax, ay] = P(pts[1]);
    const [bx, by] = P(pts[0]);
    const ang = Math.atan2(by - ay, bx - ax);
    const s = [ax + Math.cos(ang) * 34, ay + Math.sin(ang) * 34];
    const e = [bx - Math.cos(ang) * 50, by - Math.sin(ang) * 50];
    const mx = (s[0] + e[0]) / 2 - Math.sin(ang) * 30;
    const my = (s[1] + e[1]) / 2 + Math.cos(ang) * 30;
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(...s); g.quadraticCurveTo(mx, my, ...e); g.stroke();
    const ha = Math.atan2(e[1] - my, e[0] - mx);
    g.beginPath();
    g.moveTo(e[0] + Math.cos(ha) * 16, e[1] + Math.sin(ha) * 16);
    g.lineTo(e[0] + Math.cos(ha + 2.4) * 18, e[1] + Math.sin(ha + 2.4) * 18);
    g.lineTo(e[0] + Math.cos(ha - 2.4) * 18, e[1] + Math.sin(ha - 2.4) * 18);
    g.fill();
  }
  // fokus: skrafferade ringar
  ids.forEach((id, i) => {
    const [x, y] = P(at(id));
    const r = i === 0 ? 44 : 30;
    if (real) {
      g.font = '700 18px "Oswald", sans-serif';
      const label = TERRITORY[id].name.toUpperCase();
      const tw = g.measureText(label).width;
      g.fillStyle = '#f1e9d4';
      g.fillRect(x - tw / 2 - 5, y - 12, tw + 10, 24);
      g.strokeRect(x - tw / 2 - 5, y - 12, tw + 10, 24);
      g.fillStyle = ink;
      g.fillText(label, x, y + 7);
      return;
    }
    g.save();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
    g.lineWidth = 1;
    for (let k = -r * 2; k < r * 2; k += 5) { g.beginPath(); g.moveTo(x + k - r, y - r); g.lineTo(x + k + r, y + r); g.stroke(); }
    g.restore();
    g.lineWidth = 2;
    g.setLineDash(i === 0 ? [] : [5, 4]);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.font = '700 18px "Oswald", sans-serif';
    g.fillStyle = '#f1e9d4';
    const label = TERRITORY[id].name.toUpperCase();
    const tw = g.measureText(label).width;
    g.fillRect(x - tw / 2 - 4, y - 11, tw + 8, 22);
    g.fillStyle = ink;
    g.fillText(label, x, y + 7);
  });
  // kompassros
  g.save();
  g.translate(w - 38, 40);
  g.lineWidth = 1.2;
  g.beginPath(); g.arc(0, 0, 18, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(0, -24); g.lineTo(5, 0); g.lineTo(0, 24); g.lineTo(-5, 0); g.closePath(); g.fill();
  g.font = '700 11px "Oswald", sans-serif';
  g.fillText('N', 0, -27);
  g.restore();
  // rubrik
  g.font = '700 13px "Oswald", sans-serif';
  g.textAlign = 'left';
  g.fillStyle = '#efe6cd';
  g.fillRect(6, 6, g.measureText('MAP OF THE FRONT').width + 14, 24);
  g.fillStyle = ink;
  g.fillText('MAP OF THE FRONT', 12, 22);
  g.lineWidth = 1.5;
  g.strokeRect(4, 4, w - 8, h - 8);
  return out;
}
