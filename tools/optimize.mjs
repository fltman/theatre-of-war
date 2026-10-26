// Komprimerar Blender-exporterna: tar bort dummybilderna (uvkeep), behåller riktiga texturer, kvantiserar
// normaler/tangenter/UV/färg och komprimerar med meshopt.
// node tools/optimize.mjs in.glb out.glb [--lod ratio]  (--lod förenklar meshen, för mobilversionen *_lo.glb)
//
// POSITION kvantiseras ALDRIG: gltf-transform lägger då kvantiseringens skala/förskjutning i noderna – pivoter
// (torn, eldrör) flyttas och noder med barn får en namnlös barnnod för meshen. Spelet roterar och placerar noder
// på namn, så positionerna måste vara orörda floats.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, weld, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [src, dst] = process.argv.slice(2);
const lodIdx = process.argv.indexOf('--lod');
const lod = lodIdx > 0 ? parseFloat(process.argv[lodIdx + 1]) : 0;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
// dummybilderna som bara finns för att Blender ska exportera UV:er (lib.keep_uvs)
for (const tex of doc.getRoot().listTextures()) {
  const size = tex.getSize();
  if (tex.getName().startsWith('uvkeep') || (size && size[0] <= 8 && size[1] <= 8)) tex.dispose();
}
// keepUniqueNames: material med samma egenskaper men olika namn får inte slås ihop (spelet byter material på namn)
await doc.transform(dedup({ keepUniqueNames: true }), prune({ keepAttributes: true, keepLeaves: true }));
if (lod > 0) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: lod, error: 0.03, lockBorder: false }));
await doc.transform(
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  // TEXCOORD utanför [0,1] (bandets V, tilande tyg) hoppas över av quantize och förblir float
  quantize({ quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8,
             pattern: /^(NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+)$/ }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(dst, doc);
