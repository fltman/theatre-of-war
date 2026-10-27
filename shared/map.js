// Spelplanen: 42 territorier i sex kontinenter (klassisk topologi). All spelartext är på engelska.
// Delas av motorn, servern, pressen och renderingen. Geometrin ligger i public/map/world.json (tools/build_map.mjs).

export const CONTINENTS = [
  { id: 'north_america', name: 'North America', bonus: 5 },
  { id: 'south_america', name: 'South America', bonus: 2 },
  { id: 'europe', name: 'Europe', bonus: 5 },
  { id: 'africa', name: 'Africa', bonus: 3 },
  { id: 'asia', name: 'Asia', bonus: 7 },
  { id: 'oceania', name: 'Oceania', bonus: 2 },
];

// the: kräver "the" i löptext ("the Middle East"). prep: "in"/"on". poss: genitiv ("Germany's").
const T = (id, name, continent, neighbors, extra = {}) => {
  const t = { id, name, continent, neighbors, the: false, prep: 'in', ...extra };
  t.ref = (t.the ? 'the ' : '') + name;          // så står namnet i löptext
  t.poss = t.ref + "'s";
  return t;
};

export const TERRITORIES = [
  // North America
  T('alaska', 'Alaska', 'north_america', ['northwest', 'alberta', 'kamchatka']),
  T('northwest', 'Northwest Territory', 'north_america', ['alaska', 'alberta', 'ontario', 'greenland'], { the: true }),
  T('greenland', 'Greenland', 'north_america', ['northwest', 'ontario', 'quebec', 'iceland']),
  T('alberta', 'Alberta', 'north_america', ['alaska', 'northwest', 'ontario', 'western_us']),
  T('ontario', 'Ontario', 'north_america', ['northwest', 'alberta', 'western_us', 'eastern_us', 'quebec', 'greenland']),
  T('quebec', 'Quebec', 'north_america', ['ontario', 'eastern_us', 'greenland']),
  T('western_us', 'Western United States', 'north_america', ['alberta', 'ontario', 'eastern_us', 'central_america'], { the: true }),
  T('eastern_us', 'Eastern United States', 'north_america', ['western_us', 'ontario', 'quebec', 'central_america'], { the: true }),
  T('central_america', 'Central America', 'north_america', ['western_us', 'eastern_us', 'venezuela']),
  // South America
  T('venezuela', 'Venezuela', 'south_america', ['central_america', 'peru', 'brazil']),
  T('peru', 'Peru', 'south_america', ['venezuela', 'brazil', 'argentina']),
  T('brazil', 'Brazil', 'south_america', ['venezuela', 'peru', 'argentina', 'north_africa']),
  T('argentina', 'Argentina', 'south_america', ['peru', 'brazil']),
  // Europe
  T('iceland', 'Iceland', 'europe', ['greenland', 'great_britain', 'scandinavia']),
  T('scandinavia', 'Scandinavia', 'europe', ['iceland', 'great_britain', 'germany', 'ukraine']),
  T('great_britain', 'Great Britain', 'europe', ['iceland', 'scandinavia', 'germany', 'france']),
  T('germany', 'Germany', 'europe', ['great_britain', 'scandinavia', 'ukraine', 'italy', 'france']),
  T('france', 'France', 'europe', ['great_britain', 'germany', 'italy', 'north_africa']),
  T('italy', 'Italy', 'europe', ['france', 'germany', 'ukraine', 'middle_east', 'egypt', 'north_africa']),
  T('ukraine', 'Ukraine', 'europe', ['scandinavia', 'germany', 'italy', 'middle_east', 'afghanistan', 'ural']),
  // Africa
  T('north_africa', 'North Africa', 'africa', ['brazil', 'france', 'italy', 'egypt', 'east_africa', 'congo']),
  T('egypt', 'Egypt', 'africa', ['north_africa', 'italy', 'middle_east', 'east_africa']),
  T('east_africa', 'East Africa', 'africa', ['egypt', 'north_africa', 'congo', 'south_africa', 'madagascar', 'middle_east']),
  T('congo', 'Congo', 'africa', ['north_africa', 'east_africa', 'south_africa'], { the: true }),
  T('south_africa', 'South Africa', 'africa', ['congo', 'east_africa', 'madagascar']),
  T('madagascar', 'Madagascar', 'africa', ['east_africa', 'south_africa']),
  // Asia
  T('ural', 'Ural', 'asia', ['ukraine', 'siberia', 'china', 'afghanistan']),
  T('siberia', 'Siberia', 'asia', ['ural', 'yakutsk', 'irkutsk', 'mongolia', 'china']),
  T('yakutsk', 'Yakutsk', 'asia', ['siberia', 'kamchatka', 'irkutsk']),
  T('kamchatka', 'Kamchatka', 'asia', ['yakutsk', 'irkutsk', 'mongolia', 'japan', 'alaska']),
  T('irkutsk', 'Irkutsk', 'asia', ['siberia', 'yakutsk', 'kamchatka', 'mongolia']),
  T('mongolia', 'Mongolia', 'asia', ['siberia', 'irkutsk', 'kamchatka', 'japan', 'china']),
  T('japan', 'Japan', 'asia', ['kamchatka', 'mongolia']),
  T('afghanistan', 'Afghanistan', 'asia', ['ukraine', 'ural', 'china', 'india', 'middle_east']),
  T('china', 'China', 'asia', ['afghanistan', 'ural', 'siberia', 'mongolia', 'siam', 'india']),
  T('middle_east', 'Middle East', 'asia', ['ukraine', 'italy', 'egypt', 'east_africa', 'india', 'afghanistan'], { the: true }),
  T('india', 'India', 'asia', ['middle_east', 'afghanistan', 'china', 'siam']),
  T('siam', 'Siam', 'asia', ['india', 'china', 'indonesia']),
  // Oceania
  T('indonesia', 'Indonesia', 'oceania', ['siam', 'new_guinea', 'western_australia']),
  T('new_guinea', 'New Guinea', 'oceania', ['indonesia', 'western_australia', 'eastern_australia']),
  T('western_australia', 'Western Australia', 'oceania', ['indonesia', 'new_guinea', 'eastern_australia']),
  T('eastern_australia', 'Eastern Australia', 'oceania', ['western_australia', 'new_guinea']),
];

export const TERRITORY = Object.fromEntries(TERRITORIES.map((t) => [t.id, t]));
export const CONTINENT = Object.fromEntries(CONTINENTS.map((c) => [c.id, c]));
export const IDS = TERRITORIES.map((t) => t.id);

for (const c of CONTINENTS) c.territories = TERRITORIES.filter((t) => t.continent === c.id).map((t) => t.id);

// Kortleken: 42 territoriekort med symbol (infantry/tank/artillery, 14 av varje) + 2 jokrar.
export const SYMBOLS = ['infantry', 'tank', 'artillery'];
export const CARDS = [
  ...TERRITORIES.map((t, i) => ({ territory: t.id, symbol: SYMBOLS[i % 3] })),
  { territory: null, symbol: 'wild' },
  { territory: null, symbol: 'wild' },
];

// Sjövägar (grannar utan gemensam landgräns; samma som public/map/world.json:s crossings av slag sea/wrap).
export const SEA_LANES = [
  'alaska|kamchatka', 'greenland|northwest', 'greenland|ontario', 'greenland|quebec', 'greenland|iceland', 'brazil|north_africa',
  'great_britain|iceland', 'iceland|scandinavia', 'great_britain|scandinavia', 'germany|great_britain', 'france|great_britain',
  'france|north_africa', 'egypt|italy', 'italy|north_africa', 'east_africa|madagascar', 'east_africa|middle_east',
  'madagascar|south_africa', 'japan|kamchatka', 'japan|mongolia', 'indonesia|siam', 'indonesia|new_guinea',
  'indonesia|western_australia', 'new_guinea|western_australia', 'eastern_australia|new_guinea',
];
const SEA = new Set(SEA_LANES);
export const bySea = (a, b) => SEA.has([a, b].sort().join('|'));

// Grannskapet måste vara symmetriskt; kontrolleras i test/map.test.mjs.
export const adjacent = (a, b) => TERRITORY[a].neighbors.includes(b);
