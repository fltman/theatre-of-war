// Bygger public/map/world.json ur Natural Earth (public domain).
//   node tools/build_map.mjs
// Kedja: admin-1-provinser (10m) -> varje polygondel får ett territorium -> mapshaper slår ihop per territorium ->
// d3 projicerar (Miller, centrerad på 11° Ö, 24 enheter bred) -> mapshaper förenklar plant och ger kust/gränslinjer ->
// etikettpunkter (polylabel), gränsmittpunkter och sjövägar för grannar som inte delar gräns.
// Källor (gitignorerade) i assets/src/ne/: admin1/, lakes/, rivers/ (se CLAUDE.md för nedladdning).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { geoMiller, geoProject } from 'd3-geo-projection';
import polylabel from 'polylabel';
import { TERRITORIES, TERRITORY } from '../shared/map.js';

const SRC = 'assets/src/ne';
const TMP = 'build/map';
const OUT = 'public/map/world.json';
const W = 24;                       // kartans bredd i enheter (1 enhet = 1 dm)
const CENTER = 11;                  // mittmeridian: Tjuktjerhalvön hamnar till höger, Alaska till vänster
const LAT_N = 84, LAT_S = -56;
const K = 1000;                     // mapshaper ska se plana koordinater: skala upp under förenklingen
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync('public/map', { recursive: true });

const ms = (...args) => execFileSync('npx', ['mapshaper', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

// ------------------------------------------------------------------ 1. provinser -> territorier

if (!fs.existsSync(`${TMP}/admin1.json`)) {
  ms('-i', `${SRC}/admin1/ne_10m_admin_1_states_provinces.shp`, 'encoding=utf8',
    '-filter-fields', 'adm0_a3,admin,name', '-simplify', '12%', 'keep-shapes',
    '-o', `${TMP}/admin1.json`, 'format=geojson', 'precision=0.0001');
}

const BY_COUNTRY = {
  greenland: 'GRL',
  central_america: 'MEX GTM BLZ HND SLV NIC CRI PAN CUB JAM HTI DOM PRI BHS TCA CYM ATG KNA DMA LCA VCT BRB GRD TTO ABW CUW SXM MAF BLM VGB VIR AIA MSR USG',
  venezuela: 'VEN COL GUY SUR',
  peru: 'PER ECU BOL',
  brazil: 'BRA PRY',
  argentina: 'ARG CHL URY FLK',
  iceland: 'ISL FRO',
  scandinavia: 'NOR SWE FIN DNK ALD',
  great_britain: 'GBR IRL IMN GGY JEY',
  germany: 'DEU POL NLD BEL LUX CZE SVK AUT CHE LIE',
  france: 'ESP PRT AND MCO GIB',
  italy: 'ITA VAT SMR MLT SVN HRV BIH SRB MNE KOS ALB MKD GRC BGR ROU HUN',
  ukraine: 'UKR BLR MDA LTU LVA EST GEO ARM AZE',
  north_africa: 'MAR SAH DZA TUN MRT MLI NER TCD SEN GMB GNB GIN SLE LBR CIV BFA GHA TGO BEN NGA CPV',
  egypt: 'EGY LBY',
  east_africa: 'SDN SDS ETH ERI DJI SOM SOL KEN UGA TZA RWA BDI',
  congo: 'CMR CAF GNQ GAB COG COD AGO ZMB STP',
  south_africa: 'ZAF NAM BWA ZWE MOZ MWI LSO SWZ',
  madagascar: 'MDG COM MUS SYC',
  mongolia: 'MNG',
  japan: 'JPN',
  afghanistan: 'AFG UZB TKM KGZ TJK KAB',
  china: 'CHN TWN HKG MAC KOR PRK',
  middle_east: 'TUR SYR LBN ISR PSX JOR IRQ IRN SAU YEM OMN ARE QAT BHR KWT CYP CYN ESB WSB',
  india: 'IND PAK BGD NPL BTN LKA MDV KAS',
  siam: 'THA MMR LAO KHM VNM SGP',
  indonesia: 'IDN BRN PHL TLS',
  new_guinea: 'PNG SLB',
  eastern_australia: 'NZL',
};
const COUNTRY = {};
for (const [t, list] of Object.entries(BY_COUNTRY)) for (const c of list.split(' ')) COUNTRY[c] = t;

const US_WEST = new Set(['Washington', 'Oregon', 'California', 'Nevada', 'Idaho', 'Montana', 'Wyoming', 'Utah',
  'Colorado', 'Arizona', 'New Mexico', 'North Dakota', 'South Dakota', 'Nebraska', 'Kansas', 'Hawaii']);
const CA = {
  'British Columbia': 'alberta', Alberta: 'alberta', Saskatchewan: 'ontario', Manitoba: 'ontario', Ontario: 'ontario',
  Yukon: 'northwest', 'Northwest Territories': 'northwest', Nunavut: 'northwest',
};
const AU_WEST = new Set(['Western Australia', 'Northern Territory', 'South Australia']);
const CN_MONGOLIA = new Set(['Inner Mongol', 'Heilongjiang', 'Jilin']);

// Plan tyngdpunkt för en ring (lon/lat), räcker för att klassa delar.
function ringCentroid(ring) {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) return ring[0];
  return [x / (3 * a), y / (3 * a)];
}

function classify(c, name, [lon, lat]) {
  if (lat < -56 || lat > 84) return null;
  switch (c) {
    case 'USA':
      if (name === 'Alaska') return lon > 0 ? null : 'alaska';
      return US_WEST.has(name) ? 'western_us' : 'eastern_us';
    case 'CAN': return CA[name] ?? 'quebec';
    case 'AUS':
      if (name === 'Macquarie Island' || name === 'Lord Howe Island') return null;
      return AU_WEST.has(name) ? 'western_australia' : 'eastern_australia';
    case 'CHN': return name === 'Paracel Islands' ? null : CN_MONGOLIA.has(name) ? 'mongolia' : 'china';
    case 'KAZ': return lat > 48 ? 'ural' : 'afghanistan';
    case 'MYS': return lon < 105 ? 'siam' : 'indonesia';
    case 'IDN': return lon > 131 ? 'new_guinea' : 'indonesia';
    case 'FRA':
      if (lon < -45 && lat < 10) return 'venezuela';            // Franska Guyana
      if (lon < -45) return 'central_america';                  // Antillerna
      if (lon > 40 && lat < 0) return 'madagascar';             // Réunion, Mayotte
      if (lon > -10 && lon < 12 && lat > 40) return 'france';
      return null;
    case 'NLD': return lat > 45 ? 'germany' : 'central_america';
    case 'ESP': return 'france';
    case 'RUS': {
      if (lon < 0) return 'kamchatka';                          // Tjuktjerhalvön öster om datumlinjen
      if (lon < 23) return 'germany';                           // Kaliningrad (Ostpreussen)
      if (lon < 56) return 'ukraine';
      if (lon < 78) return 'ural';
      if (lon < 102) return 'siberia';
      if (lon < 120 && lat < 62) return 'irkutsk';
      if (lon < 140 && lat >= 56) return 'yakutsk';
      return 'kamchatka';
    }
    default: return COUNTRY[c] ?? null;
  }
}

const admin1 = JSON.parse(fs.readFileSync(`${TMP}/admin1.json`, 'utf8'));
const parts = [];
const unknown = new Set();
for (const f of admin1.features) {
  const g = f.geometry;
  if (!g) continue;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of polys) {
    const t = classify(f.properties.adm0_a3, f.properties.name, ringCentroid(p[0]));
    if (!t) { if (!COUNTRY[f.properties.adm0_a3]) unknown.add(f.properties.adm0_a3); continue; }
    parts.push({ type: 'Feature', properties: { t, c: TERRITORY[t].continent }, geometry: { type: 'Polygon', coordinates: p } });
  }
}
console.log(`delar: ${parts.length}; utan territorium: ${[...unknown].sort().join(' ')}`);
fs.writeFileSync(`${TMP}/parts.json`, JSON.stringify({ type: 'FeatureCollection', features: parts }));
ms('-i', `${TMP}/parts.json`, '-dissolve2', 't', 'copy-fields=c', '-o', `${TMP}/dissolved.json`, 'format=geojson');

// ------------------------------------------------------------------ 2. projektion

const S = W / (2 * Math.PI);
const proj = geoMiller().rotate([-CENTER, 0]).scale(S).translate([0, 0]).precision(0.01);
const yN = proj([CENTER, LAT_N])[1], yS = proj([CENTER, LAT_S])[1];
const H = yS - yN;
proj.translate([0, -(yN + yS) / 2]).clipExtent([[-W / 2, -H / 2], [W / 2, H / 2]]);
// d3 vill ha medurs yttre ringar (sfäriskt); mapshaper skriver moturs (RFC 7946). Fel varv = "hela jorden utom formen".
const signed = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return a; };
const wind = (poly) => poly.map((ring, i) => ((i === 0) === (signed(ring) > 0) ? ring.slice().reverse() : ring));
function rewind(g) {
  if (g.type === 'Polygon') return { ...g, coordinates: wind(g.coordinates) };
  if (g.type === 'MultiPolygon') return { ...g, coordinates: g.coordinates.map(wind) };
  return g;
}
// Europalinsen: mjuk radiell förstoring kring Centraleuropa (som tryckta spelbräden) så att arméerna får plats.
// g(r) = r·(1 + a·e^-(r/R)²) är monoton för a < 2,2, så inget viks eller överlappar; långt bort är allt orört.
const LENS = { c: proj([12, 49]), R: 1.9, a: 0.75 };
const warp = ([x, y]) => {
  const dx = x - LENS.c[0], dy = y - LENS.c[1];
  const f = 1 + LENS.a * Math.exp(-(dx * dx + dy * dy) / (LENS.R * LENS.R));
  return [LENS.c[0] + dx * f, LENS.c[1] + dy * f];
};
const warpAll = (c) => (typeof c[0] === 'number' ? warp(c) : c.map(warpAll));
const up = (f) => {
  const p = geoProject(f.type === 'Feature' ? { ...f, geometry: rewind(f.geometry) } : rewind(f), proj);
  if (p?.type === 'Feature') { if (p.geometry) p.geometry.coordinates = warpAll(p.geometry.coordinates); }
  else if (p?.coordinates) p.coordinates = warpAll(p.coordinates);
  return p;
};

const dissolved = JSON.parse(fs.readFileSync(`${TMP}/dissolved.json`, 'utf8'));
const scaleUp = (coords) => coords.map((c) => (typeof c[0] === 'number' ? [c[0] * K, c[1] * K] : scaleUp(c)));
const planar = { type: 'FeatureCollection', features: [] };
for (const f of dissolved.features) {
  const p = up(f);
  if (!p.geometry) continue;
  let polys = p.geometry.type === 'Polygon' ? [p.geometry.coordinates] : p.geometry.coordinates;
  // Datumlinjen: Alaskas spillror till höger och Kamtjatkas till vänster tas bort.
  const t = f.properties.t;
  polys = polys.filter((poly) => {
    const cx = ringCentroid(poly[0])[0];
    return !((t === 'alaska' && cx > 0) || (t === 'kamchatka' && cx < 0));
  });
  planar.features.push({ type: 'Feature', properties: { t, c: f.properties.c }, geometry: { type: 'MultiPolygon', coordinates: scaleUp(polys) } });
}
fs.writeFileSync(`${TMP}/planar.json`, JSON.stringify(planar));

// Förenkla plant med bibehållen topologi; ta bort småöar; skriv polygoner och linjer (yttre = kust, inre = gräns).
ms('-i', `${TMP}/planar.json`, '-simplify', 'planar', 'interval=7', 'keep-shapes',
  '-filter-islands', 'min-area=900', '-filter-slivers',
  '-o', `${TMP}/terr.json`, 'format=geojson', 'precision=1');
ms('-i', `${TMP}/terr.json`, '-lines', 'c,t', '-o', `${TMP}/lines.json`, 'format=geojson', 'precision=1');

// Sjöar och floder (dekor): projicera och förenkla likadant.
function decor(shp, filter, out, interval) {
  ms('-i', shp, 'encoding=utf8', '-filter', filter, '-o', `${TMP}/${out}_geo.json`, 'format=geojson', 'precision=0.001');
  const g = JSON.parse(fs.readFileSync(`${TMP}/${out}_geo.json`, 'utf8'));
  const pf = { type: 'FeatureCollection', features: [] };
  for (const f of g.features) {
    const p = up(f);
    if (!p.geometry) continue;
    pf.features.push({ type: 'Feature', properties: { name: f.properties.name }, geometry: { type: p.geometry.type, coordinates: scaleUp(p.geometry.coordinates) } });
  }
  fs.writeFileSync(`${TMP}/${out}_p.json`, JSON.stringify(pf));
  ms('-i', `${TMP}/${out}_p.json`, '-simplify', 'planar', `interval=${interval}`, '-o', `${TMP}/${out}.json`, 'format=geojson', 'precision=1');
  return JSON.parse(fs.readFileSync(`${TMP}/${out}.json`, 'utf8')).features;
}
const lakes = decor(`${SRC}/lakes/ne_10m_lakes.shp`, 'scalerank <= 1', 'lakes', 8);
const rivers = decor(`${SRC}/rivers/ne_50m_rivers_lake_centerlines.shp`, 'scalerank <= 3 && featurecla == "River"', 'rivers', 10);

// ------------------------------------------------------------------ 3. geometri ut

const r3 = (v) => Math.round(v) / K;                     // tillbaka till enheter, 3 decimaler
const flat = (ring) => ring.flatMap(([x, y]) => [r3(x), r3(y)]);
const terr = JSON.parse(fs.readFileSync(`${TMP}/terr.json`, 'utf8'));
const lines = JSON.parse(fs.readFileSync(`${TMP}/lines.json`, 'utf8'));

const shapes = {};
for (const f of terr.features) {
  const t = f.properties.t;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  (shapes[t] ??= []).push(...polys);
}
const missing = TERRITORIES.filter((t) => !shapes[t.id]).map((t) => t.id);
if (missing.length) throw new Error('territorier utan geometri: ' + missing);

const area = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return Math.abs(a / 2); };

// Etikett-/arméplats: polylabel i största delen. Handjusterade platser (enheter) där den hamnar illa.
const ANCHOR = {};
const out = { width: W, height: r3(H * K), center: CENTER, territories: {}, coast: [], borders: [], continentBorders: [], lanes: [], lakes: [], rivers: [], graticule: [] };
for (const t of TERRITORIES) {
  const polys = shapes[t.id].map((p) => p.map((ring) => ring.map(([x, y]) => [x / K, y / K])));
  polys.sort((a, b) => area(b[0]) - area(a[0]));
  const main = polys[0];
  const pl = polylabel(main, 0.005);
  const anchor = ANCHOR[t.id] ?? [pl[0], pl[1]];
  out.territories[t.id] = {
    polys: polys.map((p) => p.map((ring) => ring.flatMap(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]))),
    anchor: [+anchor[0].toFixed(3), +anchor[1].toFixed(3)],
    room: +pl.distance.toFixed(3),            // radie som ryms runt platsen (för arméstapel och etikett)
    area: +polys.reduce((s, p) => s + area(p[0]), 0).toFixed(3),
  };
}

// Linjer: kust (yttre) och territoriegränser (inre). mapshaper -lines ger TYPE = 'outer' | 'inner' (+ 'lines' per fält).
for (const f of lines.features) {
  if (!f.geometry) continue;
  const segs = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const type = f.properties.TYPE;               // outer = kust, c = kontinentgräns, t = territoriegräns
  if (type === 'inner') continue;               // inre linjer inom samma territorium (rester efter sammanslagningen)
  const dst = type === 'outer' ? out.coast : type === 'c' ? out.continentBorders : out.borders;
  for (const s of segs) dst.push(flat(s));
}
for (const f of lakes) {
  if (!f.geometry) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) if (area(p[0]) > 6 * K) out.lakes.push(p.map(flat));
}
for (const f of rivers) {
  if (!f.geometry) continue;
  const segs = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const s of segs) if (s.length > 3) out.rivers.push(flat(s));
}

// Gradnät var 15:e grad (som förprojicerade linjer).
for (let lon = -165; lon <= 180; lon += 15) {
  const g = up({ type: 'LineString', coordinates: Array.from({ length: 29 }, (_, i) => [lon, LAT_S + (i * (LAT_N - LAT_S)) / 28]) });
  if (g?.coordinates?.length) out.graticule.push({ kind: lon === 0 ? 'prime' : 'lon', pts: g.coordinates.flatMap(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]) });
}
for (let lat = -45; lat <= 75; lat += 15) {
  const g = up({ type: 'LineString', coordinates: Array.from({ length: 73 }, (_, i) => [CENTER - 179.99 + i * 4.9997, lat]) });
  if (g?.coordinates?.length) out.graticule.push({ kind: lat === 0 ? 'equator' : 'lat', pts: g.coordinates.flatMap(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]) });
}
for (const [kind, lat] of [['tropic', 23.44], ['tropic', -23.44], ['arctic', 66.56]]) {
  const g = up({ type: 'LineString', coordinates: Array.from({ length: 73 }, (_, i) => [CENTER - 179.99 + i * 4.9997, lat]) });
  out.graticule.push({ kind, pts: g.coordinates.flatMap(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]) });
}

// ------------------------------------------------------------------ 4. grannar: gemensam gräns eller sjöväg

const pts = {};   // alla hörn per territorium (enheter)
for (const t of TERRITORIES) pts[t.id] = out.territories[t.id].polys.flatMap((p) => { const r = p[0]; const a = []; for (let i = 0; i < r.length; i += 2) a.push([r[i], r[i + 1]]); return a; });

function closest(a, b) {
  let best = Infinity, pa, pb;
  for (const p of pts[a]) for (const q of pts[b]) {
    const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d < best) { best = d; pa = p; pb = q; }
  }
  return { d: Math.sqrt(best), pa, pb };
}

// Gemensamma gränspunkter: hörn som finns i båda territoriernas ringar.
const key = (p) => p[0].toFixed(3) + ',' + p[1].toFixed(3);
const sets = Object.fromEntries(TERRITORIES.map((t) => [t.id, new Set(pts[t.id].map(key))]));
out.crossings = {};
const done = new Set();
for (const t of TERRITORIES) for (const n of t.neighbors) {
  const pair = [t.id, n].sort().join('|');
  if (done.has(pair)) continue;
  done.add(pair);
  const [a, b] = pair.split('|');
  const shared = pts[a].filter((p) => sets[b].has(key(p)));
  if (shared.length >= 2) {
    // gränsens mitt: den gemensamma punkt som ligger närmast mittpunkten mellan arméplatserna
    const A = out.territories[a].anchor, B = out.territories[b].anchor;
    const m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    shared.sort((p, q) => ((p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2) - ((q[0] - m[0]) ** 2 + (q[1] - m[1]) ** 2));
    out.crossings[pair] = { kind: 'land', at: shared[0] };
  } else if (pair === 'alaska|kamchatka') {
    // runt jorden: Alaska går ut i vänsterkanten, Kamtjatka kommer in från högerkanten
    const west = pts.alaska.reduce((p, q) => (q[0] < p[0] ? q : p));
    const east = pts.kamchatka.reduce((p, q) => (q[0] > p[0] ? q : p));
    out.crossings[pair] = { kind: 'wrap', a: west, b: east };
    out.lanes.push({ a: 'alaska', b: 'kamchatka', wrap: true, pts: [west, [-W / 2 - 0.3, west[1] + 0.1]] });
    out.lanes.push({ a: 'kamchatka', b: 'alaska', wrap: true, pts: [east, [W / 2 + 0.3, east[1] + 0.1]] });
  } else {
    const c = closest(a, b);
    out.crossings[pair] = { kind: 'sea', a: c.pa, b: c.pb, length: +c.d.toFixed(3) };
    out.lanes.push({ a, b, pts: [c.pa, c.pb] });
  }
}

fs.writeFileSync(OUT, JSON.stringify(out));
const kinds = Object.values(out.crossings).reduce((s, c) => ((s[c.kind] = (s[c.kind] || 0) + 1), s), {});
console.log(`${OUT}: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${W} x ${out.height}, gränser ${JSON.stringify(kinds)}`);
console.log('sjövägar:', out.lanes.map((l) => `${l.a}-${l.b}`).join(' '));
