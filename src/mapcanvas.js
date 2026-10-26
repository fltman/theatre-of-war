// Den tryckta kartan som canvastextur: åldrat papper, hav med vattenlinjer (koncentriska kustlinjer som på gamla
// sjökort), gradnät, kust- och gränslinjer, floder, namn, ram med rutnät, kartusch, kompassros, veck och kafferingar.
// Territoriernas ägarfärg ritas INTE här utan av board.js (shader ovanpå, så att erövringar kan animeras).
import { TERRITORIES, CONTINENTS } from '../shared/map.js';

export const MARGIN = 0.55;                 // papperskant runt själva kartan (enheter)

export const INK = {
  paper: '#e8dcbc', land: '#efe5c8', sea: '#c4cfc2', seaInk: 'rgba(52,84,92,', ink: '#2b2116',
  border: 'rgba(92,40,24,0.75)', continent: 'rgba(120,28,20,0.85)', lane: 'rgba(30,52,84,0.85)', river: 'rgba(60,96,110,0.55)',
  label: '#2a1f14', ocean: 'rgba(40,70,82,0.75)', red: '#a3221b',
};

const FONTS = [
  ['Old Standard TT', 'fonts/old-standard-tt-latin-400-normal.woff2', { weight: '400' }],
  ['Old Standard TT', 'fonts/old-standard-tt-latin-700-normal.woff2', { weight: '700' }],
  ['Old Standard TT', 'fonts/old-standard-tt-latin-400-italic.woff2', { style: 'italic' }],
  ['Oswald', 'fonts/oswald-latin-500-normal.woff2', { weight: '500' }],
  ['Oswald', 'fonts/oswald-latin-700-normal.woff2', { weight: '700' }],
  ['Special Elite', 'fonts/special-elite-latin-400-normal.woff2', {}],
];
export async function loadFonts() {
  await Promise.all(FONTS.map(async ([fam, path, desc]) => {
    try { const f = new FontFace(fam, `url(${new URL(path, document.baseURI)})`, desc); document.fonts.add(await f.load()); }
    catch { /* reservtypsnitt duger */ }
  }));
}

// Placering av namn som inte ska stå mitt på arméplatsen (enheter, relativt arméplatsen).
const LABEL_OFFSET = {
  iceland: [0, -0.28], great_britain: [-0.42, -0.18], japan: [0.36, -0.18], madagascar: [0.5, 0], indonesia: [-0.1, 0.32],
  new_guinea: [0.15, -0.3], central_america: [-0.35, -0.18], scandinavia: [0, -0.32], northwest: [0, -0.28],
  western_us: [0, -0.3], eastern_us: [0.1, -0.3], siam: [0, -0.3], egypt: [0, -0.3], italy: [0.05, -0.32],
};
const OCEANS = [
  ['PACIFIC OCEAN', -10.0, 0.9, 0.3], ['PACIFIC OCEAN', 9.9, -0.9, 0.26], ['ATLANTIC', -3.2, -0.6, 0.3], ['OCEAN', -3.0, -0.18, 0.3],
  ['SOUTH ATLANTIC', -2.0, 3.6, 0.22], ['INDIAN OCEAN', 4.8, 2.6, 0.3], ['ARCTIC OCEAN', -0.8, -5.45, 0.2],
];
const CONT_LABEL = {
  north_america: [-7.0, -3.5], south_america: [-7.0, 1.6], europe: [0.4, -4.6], africa: [-0.9, 1.9], asia: [6.3, -3.2], oceania: [10.3, 1.5],
};

export function drawMap(world, size = 8192) {
  const W = world.width + MARGIN * 2, H = world.height + MARGIN * 2;
  const S = size / W;
  const c = document.createElement('canvas');
  c.width = size; c.height = Math.round(H * S);
  const g = c.getContext('2d');
  const X = (x) => (x + W / 2) * S, Y = (y) => (y + H / 2) * S;
  const u = (v) => v * S;                         // enheter -> pixlar
  let seed = 1234;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const ring = (r, close = true) => {
    g.moveTo(X(r[0]), Y(r[1]));
    for (let i = 2; i < r.length; i += 2) g.lineTo(X(r[i]), Y(r[i + 1]));
    if (close) g.closePath();
  };
  const landPath = () => {
    g.beginPath();
    for (const t of TERRITORIES) for (const p of world.territories[t.id].polys) for (const r of p) ring(r);
  };
  const linesPath = (list) => { g.beginPath(); for (const l of list) ring(l, false); };

  // ---- papper
  g.fillStyle = INK.paper;
  g.fillRect(0, 0, c.width, c.height);

  // ---- hav inom kartramen
  const mx0 = X(-world.width / 2), my0 = Y(-world.height / 2), mw = u(world.width), mh = u(world.height);
  g.save();
  g.beginPath(); g.rect(mx0, my0, mw, mh); g.clip();
  const sea = g.createLinearGradient(0, my0, 0, my0 + mh);
  sea.addColorStop(0, '#c9d2c3'); sea.addColorStop(0.5, INK.sea); sea.addColorStop(1, '#bccabe');
  g.fillStyle = sea;
  g.fillRect(mx0, my0, mw, mh);

  // gradnät (under land)
  g.lineCap = 'round';
  for (const gr of world.graticule) {
    g.beginPath(); ring(gr.pts, false);
    const strong = gr.kind === 'equator' || gr.kind === 'prime';
    g.strokeStyle = gr.kind === 'tropic' || gr.kind === 'arctic' ? 'rgba(52,84,92,0.35)' : `rgba(52,84,92,${strong ? 0.55 : 0.28})`;
    g.lineWidth = u(strong ? 0.012 : 0.006);
    g.setLineDash(gr.kind === 'tropic' || gr.kind === 'arctic' ? [u(0.08), u(0.05)] : []);
    g.stroke();
  }
  g.setLineDash([]);

  // vattenlinjer: koncentriska kustlinjer, tätast närmast land
  g.lineJoin = 'round';
  const N = 7, gap = 0.032, lw = Math.max(1, u(0.0045));
  for (let i = N; i >= 1; i--) {
    linesPath(world.coast);
    g.strokeStyle = INK.seaInk + (0.42 * (1 - (i - 1) / N) + 0.05) + ')';
    g.lineWidth = u(2 * i * gap) + lw;
    g.stroke();
    linesPath(world.coast);
    g.strokeStyle = INK.sea;
    g.lineWidth = u(2 * i * gap) - lw;
    g.stroke();
  }

  // ---- land
  landPath();
  g.fillStyle = INK.land;
  g.fill('evenodd');

  // sjöar
  g.beginPath();
  for (const l of world.lakes) for (const r of l) ring(r);
  g.fillStyle = INK.sea; g.fill('evenodd');
  g.strokeStyle = INK.seaInk + '0.6)'; g.lineWidth = u(0.005); g.stroke();

  // floder
  linesPath(world.rivers);
  g.strokeStyle = INK.river; g.lineWidth = u(0.0065); g.stroke();

  // territoriegränser (streckade), kontinentgränser (kraftigare streck-punkt), kust
  linesPath(world.borders);
  g.strokeStyle = INK.border; g.lineWidth = u(0.011); g.setLineDash([u(0.05), u(0.03)]); g.stroke();
  linesPath(world.continentBorders);
  g.strokeStyle = INK.continent; g.lineWidth = u(0.022); g.setLineDash([u(0.12), u(0.04), u(0.02), u(0.04)]); g.stroke();
  g.setLineDash([]);
  linesPath(world.coast);
  g.strokeStyle = INK.ink; g.lineWidth = u(0.012); g.stroke();

  // sjövägar: streckade med pilspetsar
  for (const l of world.lanes) {
    const [a, b] = l.pts;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    // lätt båge
    const bend = l.wrap ? 0 : Math.min(0.35, len * 0.12);
    const cx = (a[0] + b[0]) / 2 - (dy / len) * bend, cy = (a[1] + b[1]) / 2 + (dx / len) * bend;
    g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.quadraticCurveTo(X(cx), Y(cy), X(b[0]), Y(b[1]));
    g.strokeStyle = INK.lane; g.lineWidth = u(0.016); g.setLineDash([u(0.07), u(0.05)]); g.stroke();
    g.setLineDash([]);
    for (const [p, q] of l.wrap ? [[b, [cx, cy]]] : [[a, [cx, cy]], [b, [cx, cy]]]) {
      const ang = Math.atan2(p[1] - q[1], p[0] - q[0]);
      g.beginPath();
      g.moveTo(X(p[0]), Y(p[1]));
      g.lineTo(X(p[0] - Math.cos(ang - 0.45) * 0.09), Y(p[1] - Math.sin(ang - 0.45) * 0.09));
      g.lineTo(X(p[0] - Math.cos(ang + 0.45) * 0.09), Y(p[1] - Math.sin(ang + 0.45) * 0.09));
      g.closePath(); g.fillStyle = INK.lane; g.fill();
    }
  }

  // havsnamn
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [name, x, y, s] of OCEANS) spaced(g, name, X(x), Y(y), u(s), `italic ${u(s)}px "Old Standard TT", Georgia, serif`, INK.ocean, 0.45);

  // kontinentnamn: stora, glesa, svaga
  for (const ct of CONTINENTS) {
    const [x, y] = CONT_LABEL[ct.id];
    spaced(g, ct.name.toUpperCase(), X(x), Y(y), u(0.3), `700 ${u(0.3)}px "Old Standard TT", Georgia, serif`, 'rgba(110,40,24,0.28)', 0.7);
  }

  // territorienamn
  for (const t of TERRITORIES) {
    const T = world.territories[t.id];
    const off = LABEL_OFFSET[t.id] ?? [0, -Math.min(0.26, Math.max(0.17, T.room * 0.55))];
    const size = Math.max(0.11, Math.min(0.16, T.room * 0.32));
    const words = t.name.toUpperCase().split(' ');
    const lines = words.length > 1 && t.name.length > 12 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [t.name.toUpperCase()];
    lines.forEach((ln, i) => {
      const y = T.anchor[1] + off[1] + (i - (lines.length - 1) / 2) * size * 1.15;
      // ljus gloria så att namnet läses över gränslinjer
      spaced(g, ln, X(T.anchor[0] + off[0]), Y(y), u(size), `700 ${u(size)}px "Old Standard TT", Georgia, serif`, INK.label, 0.22, 'rgba(239,229,200,0.85)');
    });
  }
  g.restore();

  // ---- ram: dubbel linje + rutnät med bokstäver/siffror
  g.strokeStyle = INK.ink;
  g.lineWidth = u(0.012); g.strokeRect(mx0, my0, mw, mh);
  const band = u(0.07);
  g.lineWidth = u(0.008); g.strokeRect(mx0 - band, my0 - band, mw + band * 2, mh + band * 2);
  for (let i = 0; i < 48; i++) {           // svartvita gradstreck
    if (i % 2) continue;
    g.fillStyle = INK.ink;
    g.fillRect(mx0 + (i * mw) / 48, my0 - band, mw / 48, band * 0.45);
    g.fillRect(mx0 + (i * mw) / 48, my0 + mh + band * 0.55, mw / 48, band * 0.45);
  }
  for (let i = 0; i < 24; i++) {
    if (i % 2) continue;
    g.fillRect(mx0 - band, my0 + (i * mh) / 24, band * 0.45, mh / 24);
    g.fillRect(mx0 + mw + band * 0.55, my0 + (i * mh) / 24, band * 0.45, mh / 24);
  }
  g.font = `500 ${u(0.13)}px Oswald, Impact, sans-serif`;
  g.fillStyle = INK.ink;
  for (let i = 0; i < 24; i++) {
    const ch = 'ABCDEFGHJKLMNOPQRSTUVWXY'[i];
    g.fillText(ch, mx0 + ((i + 0.5) * mw) / 24, my0 - band - u(0.12));
    g.fillText(ch, mx0 + ((i + 0.5) * mw) / 24, my0 + mh + band + u(0.12));
  }
  for (let i = 0; i < 12; i++) {
    g.fillText(String(i + 1), mx0 - band - u(0.14), my0 + ((i + 0.5) * mh) / 12);
    g.fillText(String(i + 1), mx0 + mw + band + u(0.14), my0 + ((i + 0.5) * mh) / 12);
  }
  // marginaltext
  g.font = `${u(0.11)}px "Special Elite", "Courier New", monospace`;
  g.textAlign = 'left';
  g.fillText('GENERAL STAFF · OPERATIONS DIVISION · SHEET 1 OF 1', mx0, Y(world.height / 2) + band + u(0.32));
  g.textAlign = 'right';
  g.fillText('MILLER CYLINDRICAL PROJECTION · REVISED APRIL 1952', mx0 + mw, Y(world.height / 2) + band + u(0.32));

  cartouche(g, X(-9.4), Y(3.95), u, world);
  compass(g, X(10.7), Y(3.95), u(0.55));
  scaleBar(g, X(5.0), Y(4.85), u);
  age(g, c, u, rnd);
  return c;
}

// Text med spärrning (letter-spacing) och valfri ljus gloria bakom.
function spaced(g, text, x, y, px, font, color, spacing = 0.2, halo = null) {
  g.font = font;
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((s, w) => s + w, 0) + px * spacing * (chars.length - 1);
  let cx = x - total / 2;
  g.textAlign = 'left'; g.textBaseline = 'middle';
  if (halo) {
    g.strokeStyle = halo; g.lineWidth = px * 0.28; g.lineJoin = 'round';
    let hx = cx;
    chars.forEach((ch, i) => { g.strokeText(ch, hx, y); hx += widths[i] + px * spacing; });
  }
  g.fillStyle = color;
  chars.forEach((ch, i) => { g.fillText(ch, cx, y); cx += widths[i] + px * spacing; });
  g.textAlign = 'center';
}

function cartouche(g, x, y, u, world) {
  const w = u(3.6), h = u(2.55);
  g.save();
  g.translate(x - w / 2, y - h / 2);
  g.fillStyle = 'rgba(236,226,198,0.96)';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#2b2116'; g.lineWidth = u(0.016); g.strokeRect(0, 0, w, h);
  g.lineWidth = u(0.006); g.strokeRect(u(0.05), u(0.05), w - u(0.1), h - u(0.1));
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#2b2116';
  spaced(g, 'THEATRE OF WAR', w / 2, u(0.32), u(0.3), `700 ${u(0.3)}px "Old Standard TT", Georgia, serif`, '#2b2116', 0.12);
  g.font = `italic ${u(0.13)}px "Old Standard TT", Georgia, serif`;
  g.fillText('Operational Map of the World', w / 2, u(0.6));
  g.beginPath(); g.moveTo(u(0.5), u(0.76)); g.lineTo(w - u(0.5), u(0.76)); g.lineWidth = u(0.006); g.stroke();
  spaced(g, 'CONTINENTAL REINFORCEMENTS', w / 2, u(0.92), u(0.1), `500 ${u(0.1)}px Oswald, sans-serif`, '#2b2116', 0.25);
  g.font = `${u(0.12)}px "Old Standard TT", Georgia, serif`;
  CONTINENTS.forEach((ct, i) => {
    const row = Math.floor(i / 2), col = i % 2;
    const cx = u(0.35) + col * (w / 2), cy = u(1.18) + row * u(0.24);
    g.textAlign = 'left'; g.fillText(ct.name, cx, cy);
    g.textAlign = 'right'; g.fillText(`+${ct.bonus}`, cx + w / 2 - u(0.6), cy);
  });
  g.textAlign = 'center';
  g.font = `${u(0.09)}px "Special Elite", monospace`;
  g.fillText('Sea routes shown thus  - - - ->', w / 2, u(2.0));
  g.fillText('Prepared for the Allied Council of Nations', w / 2, u(2.22));
  g.restore();
  // stämpel
  g.save();
  g.translate(x + w * 0.33, y - h * 0.52);
  g.rotate(-0.14);
  g.strokeStyle = 'rgba(163,34,27,0.72)'; g.fillStyle = 'rgba(163,34,27,0.72)';
  g.lineWidth = u(0.025);
  g.strokeRect(-u(0.75), -u(0.2), u(1.5), u(0.4));
  g.font = `700 ${u(0.25)}px Oswald, Impact, sans-serif`;
  g.fillText('TOP SECRET', 0, u(0.01));
  g.restore();
}

function compass(g, x, y, r) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = '#2b2116'; g.fillStyle = '#2b2116'; g.lineWidth = r * 0.02;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(0, 0, r * 0.82, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
    g.lineTo(Math.cos(a) * r * (i % 4 ? 0.9 : 1), Math.sin(a) * r * (i % 4 ? 0.9 : 1));
    g.stroke();
  }
  const star = (len, wid, rot, dark) => {
    for (let k = 0; k < 4; k++) {
      const a = rot + (k * Math.PI) / 2;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        g.lineTo(Math.cos(a + side * Math.PI / 2) * wid, Math.sin(a + side * Math.PI / 2) * wid);
        g.closePath();
        g.fillStyle = side === 1 ? (dark ? '#2b2116' : '#a3221b') : '#efe5c8';
        g.fill(); g.stroke();
      }
    }
  };
  star(r * 0.62, r * 0.09, Math.PI / 4, true);
  star(r * 0.95, r * 0.13, -Math.PI / 2, false);
  g.font = `700 ${r * 0.3}px "Old Standard TT", Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#2b2116';
  g.fillText('N', 0, -r * 1.22);
  g.restore();
}

function scaleBar(g, x, y, u) {
  // 1 enhet vid ekvatorn ≈ 1 670 km ≈ 1 038 miles; fem fält à 500 miles
  const unitsPerMile = 1 / 1038, seg = 500 * unitsPerMile;
  g.save();
  g.translate(x, y);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i % 2 ? '#efe5c8' : '#2b2116';
    g.fillRect(u(i * seg), 0, u(seg), u(0.05));
  }
  g.strokeStyle = '#2b2116'; g.lineWidth = u(0.006); g.strokeRect(0, 0, u(5 * seg), u(0.05));
  g.fillStyle = '#2b2116'; g.font = `${u(0.09)}px "Old Standard TT", Georgia, serif`; g.textAlign = 'center';
  for (let i = 0; i <= 5; i += 1) g.fillText(String(i * 500), u(i * seg), -u(0.08));
  g.font = `italic ${u(0.1)}px "Old Standard TT", Georgia, serif`;
  g.fillText('Statute Miles at the Equator', u(2.5 * seg), u(0.2));
  g.restore();
}

// Åldrande: fiberbrus, fläckar, vikveck, kafferingar.
function age(g, c, u, rnd) {
  // fiberbrus i låg upplösning, uppskalat
  const n = document.createElement('canvas');
  n.width = 1024; n.height = Math.round((1024 * c.height) / c.width);
  const ng = n.getContext('2d');
  const img = ng.createImageData(n.width, n.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rnd() - 0.5) * 60;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ng.putImageData(img, 0, 0);
  g.save();
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.14;
  g.drawImage(n, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = 1;
  // stora, svaga fläckar
  for (let i = 0; i < 26; i++) {
    const x = rnd() * c.width, y = rnd() * c.height, r = u(0.6 + rnd() * 2.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(170,140,90,${0.05 + rnd() * 0.07})`); gr.addColorStop(1, 'rgba(170,140,90,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // mörkare kanter
  const e = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.45, c.width / 2, c.height / 2, c.width * 0.62);
  e.addColorStop(0, 'rgba(120,90,50,0)'); e.addColorStop(1, 'rgba(120,90,50,0.35)');
  g.fillStyle = e; g.fillRect(0, 0, c.width, c.height);
  // vikveck: kartan har legat hopvikt i tre gånger två fält
  for (const fx of [1 / 3, 2 / 3]) {
    const x = c.width * fx;
    const gr = g.createLinearGradient(x - u(0.08), 0, x + u(0.08), 0);
    gr.addColorStop(0, 'rgba(90,70,40,0)'); gr.addColorStop(0.5, 'rgba(90,70,40,0.22)'); gr.addColorStop(1, 'rgba(90,70,40,0)');
    g.fillStyle = gr; g.fillRect(x - u(0.08), 0, u(0.16), c.height);
  }
  {
    const y = c.height / 2;
    const gr = g.createLinearGradient(0, y - u(0.08), 0, y + u(0.08));
    gr.addColorStop(0, 'rgba(90,70,40,0)'); gr.addColorStop(0.5, 'rgba(90,70,40,0.2)'); gr.addColorStop(1, 'rgba(90,70,40,0)');
    g.fillStyle = gr; g.fillRect(0, y - u(0.08), c.width, u(0.16));
  }
  // kafferingar
  for (const [fx, fy, r] of [[0.9, 0.82, 0.62], [0.08, 0.14, 0.5]]) {
    const x = c.width * fx, y = c.height * fy, R = u(r);
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.ellipse(x + k * u(0.02), y, R * (1 - k * 0.012), R * (0.97 - k * 0.01), 0.2, 0.3 + k, Math.PI * 2 - 0.6 + k * 0.3);
      g.strokeStyle = `rgba(120,72,28,${0.22 - k * 0.05})`; g.lineWidth = u(0.035 - k * 0.008); g.stroke();
    }
    const gr = g.createRadialGradient(x, y, R * 0.2, x, y, R);
    gr.addColorStop(0, 'rgba(150,100,50,0.05)'); gr.addColorStop(1, 'rgba(150,100,50,0.12)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R * 0.97, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
