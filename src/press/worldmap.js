// Riktig kartgeometri (public/map/world.json) i pressens kartor: journalfilmens kartkort och tidningens kartskiss.
// world.json ligger i bordsenheter (x öster, z söder, centrerat i origo); enhetskoordinaterna i geo.js är
// ((x + width/2) / width, (z + height/2) / height).

let cache = null;
export function loadWorld(url = 'map/world.json') {
  cache ??= fetch(new URL(url, document.baseURI)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache;
}

const paths = new WeakMap();

// Diagonala linjer över vyn, klippta till området.
function hatch(ctx, path, box, step, lw, color, dir = 1) {
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  const d = box.z1 - box.z0;
  ctx.beginPath();
  for (let k = box.x0 - d; k < box.x1 + d; k += step) {
    ctx.moveTo(k, dir > 0 ? box.z0 : box.z1);
    ctx.lineTo(k + d, dir > 0 ? box.z1 : box.z0);
  }
  ctx.stroke();
  ctx.restore();
}
function ring(p, flat) {
  p.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
  p.closePath();
}
function line(p, flat) {
  p.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
}
function build(world) {
  if (paths.has(world)) return paths.get(world);
  const terr = {};
  const land = new Path2D();
  for (const [id, t] of Object.entries(world.territories || {})) {
    const p = new Path2D();
    for (const poly of t.polys || []) for (const r of poly) ring(p, r);
    terr[id] = p;
    land.addPath(p);
  }
  const coast = new Path2D();
  for (const l of world.coast || []) line(coast, l);
  const borders = new Path2D();
  for (const l of world.borders || []) line(borders, l);
  const lakes = new Path2D();
  for (const l of world.lakes || []) ring(lakes, l);
  const out = { terr, land, coast, borders, lakes };
  paths.set(world, out);
  return out;
}

// view: { w, h, x0, y0, x1, y1 } i enhetskoordinater. style: 'reel' (gråskala) eller 'ink' (tidningstusch).
export function drawWorld(ctx, world, view, { highlight = [], strong = [], style = 'reel', u = 1 } = {}) {
  if (!world) return false;
  const P = build(world);
  const W = world.width;
  const H = world.height;
  const sx = view.w / ((view.x1 - view.x0) * W);
  const sy = view.h / ((view.y1 - view.y0) * H);
  ctx.save();
  ctx.transform(sx, 0, 0, sy, -(view.x0 * W - W / 2) * sx, -(view.y0 * H - H / 2) * sy);
  const px = 1 / sx;
  const box = { x0: view.x0 * W - W / 2, x1: view.x1 * W - W / 2, z0: view.y0 * H - H / 2, z1: view.y1 * H - H / 2 };
  if (style === 'reel') {
    ctx.fillStyle = '#e6e2d8';
    ctx.fill(P.land);
    for (const id of highlight) if (P.terr[id]) { ctx.fillStyle = '#9d988c'; ctx.fill(P.terr[id]); }
    for (const id of strong) if (P.terr[id]) {
      ctx.fillStyle = '#5d5950';
      ctx.fill(P.terr[id]);
      hatch(ctx, P.terr[id], box, 9 * px * u, 2.2 * px * u, 'rgba(20,18,16,0.55)');
    }
    ctx.fillStyle = '#a9a59b';
    ctx.fill(P.lakes);
    ctx.strokeStyle = 'rgba(25,23,20,0.55)';
    ctx.lineWidth = 1.2 * px * u;
    ctx.setLineDash([4 * px * u, 3 * px * u]);
    ctx.stroke(P.borders);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#1d1b18';
    ctx.lineWidth = 1.8 * px * u;
    ctx.stroke(P.coast);
  } else {
    // tusch: skrafferade fokusområden, prickade gränser, kustlinje
    for (const id of strong) if (P.terr[id]) hatch(ctx, P.terr[id], box, 5 * px, 1.1 * px, 'rgba(29,26,21,0.85)');
    for (const id of highlight) if (P.terr[id]) hatch(ctx, P.terr[id], box, 7 * px, 0.8 * px, 'rgba(29,26,21,0.45)', -1);
    ctx.strokeStyle = 'rgba(29,26,21,0.7)';
    ctx.lineWidth = 0.9 * px;
    ctx.setLineDash([2 * px, 3 * px]);
    ctx.stroke(P.borders);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#1d1a15';
    ctx.lineWidth = 1.5 * px;
    ctx.stroke(P.coast);
  }
  ctx.restore();
  return true;
}
