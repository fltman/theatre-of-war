// Ungefärliga etikettpunkter (longitud, latitud) per territorium för pressens kartskisser och journalfilmens
// kartkort. Den riktiga geometrin ligger i public/map/world.json; regin kan rita den via `drawMap`-kroken i reel.js.

export const LONLAT = {
  alaska: [-152, 64], northwest: [-115, 65], greenland: [-42, 73], alberta: [-118, 55], ontario: [-88, 51],
  quebec: [-70, 53], western_us: [-111, 40], eastern_us: [-84, 37], central_america: [-96, 19],
  venezuela: [-66, 6], peru: [-75, -10], brazil: [-50, -10], argentina: [-65, -36],
  iceland: [-19, 65], scandinavia: [16, 63], great_britain: [-2, 54], germany: [13, 52], france: [1, 45],
  italy: [19, 43], ukraine: [40, 52],
  north_africa: [2, 22], egypt: [27, 26], east_africa: [37, 3], congo: [21, -4], south_africa: [25, -27],
  madagascar: [47, -19],
  ural: [64, 58], siberia: [92, 63], yakutsk: [126, 64], kamchatka: [158, 60], irkutsk: [106, 55],
  mongolia: [108, 46], japan: [138, 37], afghanistan: [66, 40], china: [104, 32], middle_east: [46, 30],
  india: [78, 22], siam: [101, 15], indonesia: [113, -2], new_guinea: [143, -6], western_australia: [122, -25],
  eastern_australia: [146, -27],
};

// Miller-lik projektion (samma känsla som bordskartan), centrerad på 11° Ö, till enhetsrutan [0,1]².
const deg = Math.PI / 180;
const millerY = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * deg));
const Y0 = millerY(84);
const Y1 = millerY(-56);
export function project(lon, lat) {
  let x = lon - 11;
  if (x < -180) x += 360;
  if (x > 180) x -= 360;
  return [(x + 180) / 360, (Y0 - millerY(lat)) / (Y0 - Y1)];
}
export const at = (id) => (LONLAT[id] ? project(...LONLAT[id]) : [0.5, 0.5]);
