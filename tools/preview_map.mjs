// Snabb kontrollbild av public/map/world.json -> build/map/preview.svg (+ png via magick)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { TERRITORIES } from '../shared/map.js';
const w = JSON.parse(fs.readFileSync('public/map/world.json', 'utf8'));
const S = 80, W = w.width * S, H = w.height * S;
const X = (x) => ((x + w.width / 2) * S).toFixed(1), Y = (y) => ((y + w.height / 2) * S).toFixed(1);
const path = (r) => { let d = ''; for (let i = 0; i < r.length; i += 2) d += (i ? 'L' : 'M') + X(r[i]) + ',' + Y(r[i + 1]); return d + 'Z'; };
const line = (r) => { let d = ''; for (let i = 0; i < r.length; i += 2) d += (i ? 'L' : 'M') + X(r[i]) + ',' + Y(r[i + 1]); return d; };
const hue = { north_america: 30, south_america: 100, europe: 210, africa: 45, asia: 140, oceania: 300 };
let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#cfd8d4"/>`;
for (const g of w.graticule) s += `<path d="${line(g.pts)}" stroke="#9aa" stroke-width="1" fill="none"/>`;
TERRITORIES.forEach((t, i) => {
  const d = w.territories[t.id].polys.map((p) => p.map(path).join('')).join('');
  s += `<path d="${d}" fill="hsl(${hue[t.continent]},${35 + (i % 4) * 12}%,${55 + (i % 3) * 8}%)" fill-rule="evenodd"/>`;
});
for (const l of w.lakes) s += `<path d="${l.map(path).join('')}" fill="#cfd8d4"/>`;
for (const r of w.rivers) s += `<path d="${line(r)}" stroke="#7aa" stroke-width="1" fill="none"/>`;
for (const b of w.borders) s += `<path d="${line(b)}" stroke="#a33" stroke-width="1.5" fill="none" stroke-dasharray="4 3"/>`;
for (const c of w.coast) s += `<path d="${line(c)}" stroke="#222" stroke-width="1.6" fill="none"/>`;
for (const l of w.lanes) s += `<path d="M${X(l.pts[0][0])},${Y(l.pts[0][1])}L${X(l.pts[1][0])},${Y(l.pts[1][1])}" stroke="#036" stroke-width="2" stroke-dasharray="8 5" fill="none"/>`;
for (const [k, c] of Object.entries(w.crossings)) if (c.kind === 'land') s += `<circle cx="${X(c.at[0])}" cy="${Y(c.at[1])}" r="4" fill="#d80"/>`;
for (const t of TERRITORIES) { const a = w.territories[t.id].anchor; s += `<circle cx="${X(a[0])}" cy="${Y(a[1])}" r="${w.territories[t.id].room * S}" fill="none" stroke="#000" stroke-opacity=".25"/><text x="${X(a[0])}" y="${Y(a[1])}" font-family="Georgia" font-size="22" text-anchor="middle">${t.name}</text>`; }
fs.writeFileSync('build/map/preview.svg', s + '</svg>');
execFileSync('magick', ['build/map/preview.svg', 'build/map/preview.png']);
console.log('build/map/preview.png', W, H);
