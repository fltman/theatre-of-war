// Kontroll av modellerna mot CONTRACT.md: nodnamn, material, texturer (storlek), UV där spelet ritar,
// vertexfärgens kanaler (R = AO, G = krökning, B = kavitet), tris och mått.
// node tools/inspect_models.mjs [katalog=public/models] [--verbose]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'public/models';
const verbose = process.argv.includes('--verbose');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// Kontraktet: noder som måste finnas, material som måste ha UV, vertexfärg, tris-tak.
const NEED = {
  infantry: { nodes: ['infantry', 'moustache'], uv: ['Base'], colors: true, max: 3000 },
  tank: { nodes: ['hull', 'turret', 'barrel', 'tracks'], uv: ['Tread'], parent: { barrel: 'turret' }, colors: true, max: 5000 },
  artillery: { nodes: ['carriage', 'barrel'], uv: [], colors: true, max: 4000 },
  ship: { nodes: ['hull', 'funnel', 'smoke'], uv: [], colors: true, max: 7000 },
  flag: { nodes: ['pin', 'flag'], uv: ['FlagPaper'], colors: true },
  dice: { nodes: ['dice'], mats: ['DiceBody', 'Pip'] },
  radio: { nodes: ['dial', 'needle', 'knob_l', 'knob_r', 'cam'], uv: ['DialGlass'], max: 30000 },
  tv: { nodes: ['screen', 'cam'], uv: ['Screen'], prefix: ['knob_'], max: 30000 },
  props: { nodes: ['lamp', 'bulb', 'ashtray', 'smoke', 'phone', 'dial', 'handset', 'cup', 'rake', 'inkwell'], uv: [],
           parent: { dial: 'phone', handset: 'phone' } },
};

let fail = 0;
let totalKB = 0;
const files = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort();
for (const f of files) {
  const name = f.replace('.glb', '');
  const lo = name.endsWith('_lo');
  const doc = await io.read(join(dir, f));
  const root = doc.getRoot();
  const nodes = root.listNodes();
  const names = nodes.map((n) => n.getName());
  let tris = 0;
  const mats = new Set();
  const uvMats = new Set();
  const col = { n: 0, sum: [0, 0, 0], min: [1, 1, 1], max: [0, 0, 0] };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += (idx ? idx.getCount() : pos.getCount()) / 3;
      const m = prim.getMaterial()?.getName() ?? '(inget)';
      mats.add(m);
      if (prim.getAttribute('TEXCOORD_0')) uvMats.add(m);
      const c = prim.getAttribute('COLOR_0');
      if (c) {
        const v = [0, 0, 0, 0];
        for (let i = 0; i < c.getCount(); i++) {
          c.getElement(i, v);
          for (let k = 0; k < 3; k++) { col.sum[k] += v[k]; col.min[k] = Math.min(col.min[k], v[k]); col.max[k] = Math.max(col.max[k], v[k]); }
          col.n++;
        }
      }
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const w = [0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r]);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
      }
    }
  }
  const need = NEED[name.replace(/_lo$/, '')] ?? { nodes: [], uv: [] };
  const problems = [];
  for (const n of need.nodes ?? []) if (!names.includes(n)) problems.push(`saknar nod ${n}`);
  for (const p of need.prefix ?? []) if (!names.some((n) => n.startsWith(p))) problems.push(`saknar nod ${p}*`);
  for (const m of need.uv ?? []) if (!uvMats.has(m)) problems.push(`material ${m} saknar UV`);
  for (const m of need.mats ?? []) if (!mats.has(m)) problems.push(`saknar material ${m}`);
  for (const [c, p] of Object.entries(need.parent ?? {})) {
    const cn = nodes.find((n) => n.getName() === c);
    if (cn && cn.getParentNode()?.getName() !== p) problems.push(`${c} är inte barn till ${p}`);
  }
  if (need.colors && !col.n) problems.push('saknar vertexfärg (COLOR_0)');
  if (need.max && !lo && tris > need.max) problems.push(`${Math.round(tris)} tris > ${need.max}`);
  const unnamed = nodes.filter((n) => !n.getName()).length;
  if (unnamed) problems.push(`${unnamed} namnlösa noder (kvantiserad POSITION?)`);
  const size = max.map((x, i) => (x - min[i]).toFixed(3));
  const kb = statSync(join(dir, f)).size / 1024;
  totalKB += kb;
  console.log(`${problems.length ? '✗' : '✓'} ${name.padEnd(12)} ${String(Math.round(tris)).padStart(6)} tris  ` +
    `${kb.toFixed(0).padStart(5)} KB  mått ${size.join(' × ')}  min y ${min[1].toFixed(3)}`);
  if (!lo || verbose) {
    console.log(`    noder: ${names.join(', ')}`);
    console.log(`    material: ${[...mats].join(', ')}   UV: ${[...uvMats].join(', ') || '–'}`);
    const tex = root.listTextures().map((t) => {
      const s = t.getSize();
      return `${t.getName() || '?'} ${s ? s.join('×') : '?'} ${t.getMimeType().replace('image/', '')} ${(t.getImage().byteLength / 1024).toFixed(0)} KB`;
    });
    if (tex.length) console.log(`    texturer: ${tex.join('; ')}`);
    if (col.n) {
      const mean = col.sum.map((s) => (s / col.n).toFixed(2));
      console.log(`    vertexfärg: R (AO) ${col.min[0].toFixed(2)}–${col.max[0].toFixed(2)} medel ${mean[0]}  ` +
        `G (krökning) ${col.min[1].toFixed(2)}–${col.max[1].toFixed(2)} medel ${mean[1]}  ` +
        `B (kavitet) ${col.min[2].toFixed(2)}–${col.max[2].toFixed(2)} medel ${mean[2]}`);
    }
  }
  if (verbose) {
    for (const n of nodes) {
      const t = n.getTranslation().map((x) => x.toFixed(3));
      console.log(`      ${n.getName()}  förälder=${n.getParentNode()?.getName() ?? '–'}  pos=${t.join(',')}  ` +
        `rot=${n.getRotation().map((x) => x.toFixed(3)).join(',')}`);
    }
  }
  for (const p of problems) console.log(`    ✗ ${p}`);
  if (problems.length) fail++;
}
console.log(`totalt ${(totalKB / 1024).toFixed(1)} MB i ${dir}`);
process.exit(fail ? 1 : 0);
