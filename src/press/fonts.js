// Pressens typsnitt (självhostade i public/fonts). Laddas via FontFace så att sökvägen följer sidans bas
// (fungerar även med base './' i bygget) och så att canvas-korten kan vänta på dem.

const FACES = [
  ['UnifrakturMaguntia', 'unifrakturmaguntia-latin-400-normal', '400', 'normal'],
  ['Anton', 'anton-latin-400-normal', '400', 'normal'],
  ['Playfair Display', 'playfair-display-latin-700-normal', '700', 'normal'],
  ['Playfair Display', 'playfair-display-latin-700-italic', '700', 'italic'],
  ['Playfair Display', 'playfair-display-latin-900-normal', '900', 'normal'],
  ['Playfair Display', 'playfair-display-latin-900-italic', '900', 'italic'],
  ['Old Standard TT', 'old-standard-tt-latin-400-normal', '400', 'normal'],
  ['Old Standard TT', 'old-standard-tt-latin-400-italic', '400', 'italic'],
  ['Old Standard TT', 'old-standard-tt-latin-700-normal', '700', 'normal'],
  ['Special Elite', 'special-elite-latin-400-normal', '400', 'normal'],
  ['Limelight', 'limelight-latin-400-normal', '400', 'normal'],
  ['Poiret One', 'poiret-one-latin-400-normal', '400', 'normal'],
  ['Oswald', 'oswald-latin-500-normal', '500', 'normal'],
  ['Oswald', 'oswald-latin-700-normal', '700', 'normal'],
];

let ready = null;

export function loadPressFonts(base = 'fonts/') {
  if (ready) return ready;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return (ready = Promise.resolve());
  ready = Promise.all(FACES.map(([family, file, weight, style]) => {
    const url = new URL(base + file + '.woff2', document.baseURI).href;
    const face = new FontFace(family, `url(${url}) format('woff2')`, { weight, style, display: 'block' });
    document.fonts.add(face);
    return face.load().catch((e) => console.warn('[press] typsnitt saknas', file, e));
  })).then(() => document.fonts.ready);
  return ready;
}
