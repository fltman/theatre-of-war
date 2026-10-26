// Redaktionens mallar: all spelartext på idiomatisk engelska i tidig 50-talsstil.
// Allt är fiktivt: tidningen, radiostationen, journalfilmen och nyhetsbyrån finns inte på riktigt.
// Mallar är funktioner av ett sammanhang `c` (se newsdesk.js `ctx`) och får svara null när de inte passar.

import { num, words, cap, plural } from './words.js';

export const PAPER = {
  masthead: 'The Evening Clarion',
  motto: 'First with the news — last to retreat',
  price: 'Five Cents',
  priceExtra: 'Five Cents',
  volume: 'Vol. LXIV',
};
export const WIRE = { name: 'Amalgamated Wire', short: 'AW' };
export const STATION = 'Pan-Continental Radio';
export const NEWSREEL = 'Atlas Newsreel';

// Tidningens hemort: faller den blir det en egen sorts rubrik.
export const HOME = 'eastern_us';

// Hur känt ett territorium är (3 = tidning, 2 = radio, 1 = bara i notisspalten).
export const FAME = {
  germany: 3, france: 3, great_britain: 3, japan: 3, egypt: 3, china: 3, eastern_us: 3, india: 3, italy: 3,
  brazil: 2, ukraine: 2, south_africa: 2, western_us: 2, eastern_australia: 2, argentina: 2, middle_east: 2,
  iceland: 2, alaska: 2, kamchatka: 2, central_america: 2, north_africa: 2, scandinavia: 2, ural: 2, siberia: 2,
};

// Huvudstad/stad för datumraden (1952 års namn).
export const CITY = {
  alaska: 'Anchorage', northwest: 'Yellowknife', greenland: 'Godthaab', alberta: 'Edmonton', ontario: 'Toronto',
  quebec: 'Montreal', western_us: 'San Francisco', eastern_us: 'New York', central_america: 'Mexico City',
  venezuela: 'Caracas', peru: 'Lima', brazil: 'Rio de Janeiro', argentina: 'Buenos Aires', iceland: 'Reykjavik',
  scandinavia: 'Stockholm', great_britain: 'London', germany: 'Berlin', france: 'Paris', italy: 'Rome',
  ukraine: 'Kiev', north_africa: 'Algiers', egypt: 'Cairo', east_africa: 'Nairobi', congo: 'Leopoldville',
  south_africa: 'Cape Town', madagascar: 'Tananarive', ural: 'Sverdlovsk', siberia: 'Novosibirsk', yakutsk: 'Yakutsk',
  kamchatka: 'Petropavlovsk', irkutsk: 'Irkutsk', mongolia: 'Ulan Bator', japan: 'Tokyo', afghanistan: 'Kabul',
  china: 'Peking', middle_east: 'Baghdad', india: 'New Delhi', siam: 'Bangkok', indonesia: 'Djakarta',
  new_guinea: 'Port Moresby', western_australia: 'Perth', eastern_australia: 'Sydney',
};

// Platser att strida vid, med preposition ("on the Rhine").
export const PLACES = {
  alaska: ['along the Bering Strait', 'in the Yukon valley', 'outside Anchorage'],
  northwest: ['on the frozen tundra', 'by Great Slave Lake'],
  greenland: ['on the ice cap', 'off Cape Farewell'],
  alberta: ['in the Rocky Mountains', 'on the open prairie'],
  ontario: ['along the Great Lakes', 'on the shores of Hudson Bay'],
  quebec: ['along the St. Lawrence', 'in the forests of Labrador'],
  western_us: ['in the Sierra Nevada', 'across the Texas plains', 'on the California coast'],
  eastern_us: ['along the Mississippi', 'in the Appalachians', 'on the Atlantic seaboard'],
  central_america: ['at the Panama Canal', 'in the jungles of Yucatán'],
  venezuela: ['along the Orinoco', 'in the northern Andes'],
  peru: ['high in the Andes', 'near Lake Titicaca'],
  brazil: ['along the Amazon', 'in the Mato Grosso'],
  argentina: ['on the pampas', 'in Patagonia'],
  iceland: ['outside Reykjavik', 'on the lava fields'],
  scandinavia: ['in the Norwegian fjords', 'in the Lapland snows', 'along the Swedish coast'],
  great_britain: ['on the cliffs of Dover', 'in the Midlands', 'on the Scottish moors'],
  germany: ['on the Rhine', 'along the Elbe', 'in the Ruhr'],
  france: ['along the Seine', 'in Normandy', 'in the Pyrenees'],
  italy: ['in the Alps', 'in the Balkans', 'on the Po plain'],
  ukraine: ['on the Dnieper', 'across the steppe', 'along the Volga'],
  north_africa: ['in the Sahara', 'in the Atlas Mountains', 'at the Strait of Gibraltar'],
  egypt: ['near Suez', 'along the Nile', 'in the Sinai'],
  east_africa: ['beneath Kilimanjaro', 'in the Abyssinian highlands'],
  congo: ['along the Congo River', 'deep in the rain forest'],
  south_africa: ['at the Cape of Good Hope', 'in the Transvaal'],
  madagascar: ['in the central highlands', 'on the Mozambique Channel'],
  ural: ['in the Ural Mountains', 'along the Ob'],
  siberia: ['on the Siberian tundra', 'along the Yenisei'],
  yakutsk: ['along the Lena', 'in the permafrost'],
  kamchatka: ['among the volcanoes', 'on the Sea of Okhotsk'],
  irkutsk: ['at Lake Baikal', 'along the Trans-Siberian Railway'],
  mongolia: ['in the Gobi Desert', 'on the Mongolian steppe'],
  japan: ['in the shadow of Mount Fuji', 'on the Inland Sea'],
  afghanistan: ['in the Khyber Pass', 'in the Hindu Kush'],
  china: ['on the Yangtze', 'along the Great Wall', 'on the Yellow River'],
  middle_east: ['in Mesopotamia', 'on the Bosporus', 'in the Arabian desert'],
  india: ['along the Ganges', 'in the Himalayan foothills'],
  siam: ['along the Mekong', 'in the teak forests'],
  indonesia: ['on Java', 'among the Spice Islands'],
  new_guinea: ['in the Owen Stanley Range', 'near Port Moresby'],
  western_australia: ['in the Outback', 'outside Perth'],
  eastern_australia: ['along the Great Barrier Reef', 'in New South Wales'],
};

// Grannskap över vatten (landstigning i stället för vanlig erövring).
const SEA = [
  ['alaska', 'kamchatka'], ['greenland', 'iceland'], ['greenland', 'quebec'], ['greenland', 'northwest'],
  ['greenland', 'ontario'], ['iceland', 'great_britain'], ['iceland', 'scandinavia'],
  ['great_britain', 'scandinavia'], ['great_britain', 'germany'], ['great_britain', 'france'],
  ['brazil', 'north_africa'], ['north_africa', 'italy'], ['egypt', 'italy'], ['east_africa', 'madagascar'],
  ['south_africa', 'madagascar'], ['east_africa', 'middle_east'], ['japan', 'kamchatka'], ['japan', 'mongolia'],
  ['siam', 'indonesia'], ['indonesia', 'new_guinea'], ['indonesia', 'western_australia'],
  ['new_guinea', 'eastern_australia'], ['new_guinea', 'western_australia'],
];
const SEA_SET = new Set(SEA.flatMap(([a, b]) => [a + '|' + b, b + '|' + a]));
export const bySea = (a, b) => SEA_SET.has(a + '|' + b);

// ---------------------------------------------------------------- hjälpare i mallarna

const retreat = (c) => (c.retreat ? ` toward ${c.retreat.ref}` : '');
const daysOf = (c) => `${num(c.days)} ${plural(c.days, 'day', 'days')}`;
const divs = (n) => `${num(n)} ${plural(n, 'division', 'divisions')}`;
const Divs = (n) => cap(`${words(n)} ${plural(n, 'division', 'divisions')}`);
const heldFor = (c) => (c.held <= 0 ? 'barely a month' : c.held === 1 ? 'a single month' : `${words(c.held)} months`);

// ---------------------------------------------------------------- krigsutbrottet

export const START = {
  headline: ['World at War', 'War!', 'Guns Roar on Every Front', 'All Armies Mobilize', 'The Peace Is Over'],
  kicker: ['Extra', 'Flash', 'Bulletin'],
  deck: [
    (c) => `${cap(words(c.nPlayers))} armies take the field; public urged to remain calm and renew subscriptions`,
    (c) => `Forty-two territories divided among ${words(c.nPlayers)} powers — reserves called up overnight`,
    (c) => `${c.lead.Army} strongest at the outbreak, holding ${c.leadCount} territories`,
  ],
  body: [
    [
      (c) => `${c.homeCity}, ${c.mday} (${WIRE.short}) — What the world has feared has come to pass. At dawn today ${c.armyList} marched up to their frontiers, and by noon the first reports of fighting were coming in over the wires. The world is at war.`,
      (c) => `${c.homeCity}, ${c.mday} (${WIRE.short}) — The guns spoke at first light. Within the hour ${c.armyList} were reported on the move, and the long, uneasy peace was over.`,
    ],
    [
      (c) => `According to ${WIRE.name}, all ${words(c.nPlayers)} armies have called up their reserves. ${c.lead.Army}, which holds the most ground, is rated the favorite by observers, though seasoned officers warn against hasty conclusions.`,
      (c) => `Military observers give the early edge to ${c.lead.army}, which holds ${c.leadCount} territories at the outbreak. ${c.last.Army}, with only ${c.lastCount}, is said to be “in excellent spirits.”`,
    ],
    [
      (c) => `“This war will be short,” a spokesman for ${c.some.army} told the Clarion. The same thing was said in 1914.`,
      (c) => `“We have no quarrel with anyone who stays out of our way,” said a statement from ${c.some.armyPoss} high command, which then declared war on everyone.`,
    ],
    [
      'Civil defense authorities ask the public to remain calm, to hoard only in moderation, and to keep reading their evening paper.',
      'Theaters and dance halls will remain open until further notice. Blackout regulations take effect at sundown.',
    ],
  ],
  caption: [
    'Troops on the way to the front. The picture was taken last night.',
    'The general staff gathered around the map table.',
    'First photograph from the front, passed by the censor.',
  ],
};

// ---------------------------------------------------------------- territorium faller

export const FALL = {
  headline: [
    (c) => `${c.T.name} Has Fallen`,
    (c) => `${c.T.name} Falls`,
    (c) => `${c.F.armyBare} Takes ${c.T.name}`,
    (c) => `${c.D.adj} Line Breaks ${c.T.place}`,
    (c) => `${c.T.name} in ${c.F.adj} Hands`,
    (c) => `${c.D.pluralBare} Routed ${c.T.place}`,
    (c) => `${c.T.name} Capitulates`,
    (c) => `${c.F.adj} Troops Enter ${c.T.city}`,
    (c) => `Breakthrough ${c.T.place}`,
  ],
  reconquest: [
    (c) => `${c.T.name} Has Fallen — ${c.F.name} Master Once More`,
    (c) => `${c.F.armyBare} Retakes ${c.T.name}`,
    (c) => `${c.F.pluralBare} Back in ${c.T.name}`,
    (c) => `${c.T.name} Changes Hands Again`,
    (c) => `${c.F.name} Regains ${c.T.name}`,
  ],
  home: [
    (c) => `${c.F.adj} Troops in ${c.T.city}`,
    (c) => `${c.T.name} Occupied`,
    (c) => `${c.F.armyBare} Marches Down Broadway`,
    (c) => `${c.T.city} Falls — Clarion Stays Open`,
    (c) => `Enemy at Our Door: ${c.F.pluralBare} Take ${c.T.city}`,
  ],
  kicker: [
    'Late News', 'Flash', 'Bulletin', 'From the Front',
    (c) => `War in ${c.C.name}`,
    (c) => `Crisis in ${c.C.name}`,
  ],
  deck: [
    (c) => `${c.F.Army} broke through ${c.T.place} at dawn — ${c.D.adj} troops in full retreat${retreat(c)}`,
    (c) => (c.lossD >= 2 ? `${c.F.Plural} storm ${c.T.ref} after ${daysOf(c)} of shelling; ${c.D.plural} leave ${divs(c.lossD)} on the field` : null),
    (c) => `${c.F.adj} flags fly over ${c.T.city} as ${c.D.army} pulls back`,
    (c) => `Attack from ${c.from.ref} caught ${c.D.plural} completely by surprise`,
    (c) => `${c.F.Plural} now hold ${c.owned} of the world’s 42 territories`,
  ],
  deckReconquest: [
    (c) => `${c.F.name} master once more — ${c.D.adj} troops in flight${retreat(c)}`,
    (c) => `${c.F.Plural} return to ${c.T.ref}; ${c.D.plural} held it for ${heldFor(c)}`,
    (c) => `${c.F.adj} columns march back ${c.T.place} to a hero’s welcome`,
  ],
  deckHome: [
    'The Clarion will appear as usual — editorial staff relocated to the basement',
    (c) => `${c.F.adj} patrols on Fifth Avenue; the Clarion’s presses keep rolling`,
    (c) => `${c.D.Plural} abandon the city overnight; subway service suspended until further notice`,
    (c) => `Ticker tape for the new arrivals — Clarion reporters count ${c.F.adj} tanks on Times Square`,
  ],
  lead: [
    (c) => `${c.T.CITY}, ${c.mday} (${WIRE.short}) — ${c.T.Ref} has fallen. Late last night ${c.D.armyPoss} headquarters confirmed that its last units had withdrawn, leaving ${c.F.army} in full control of ${c.T.ref}.`,
    (c) => `${c.T.CITY}, ${c.mday} (${WIRE.short}) — After ${daysOf(c)} of unbroken bombardment ${c.T.place}, it became clear yesterday that ${c.D.plural} could no longer hold ${c.T.ref}. ${c.F.adj} columns rolled in shortly after dawn.`,
    (c) => `${c.T.CITY}, ${c.mday} (${WIRE.short}) — The ${c.F.adj} flag was raised over ${c.T.city} early this morning, ending ${c.D.armyPoss} rule of ${c.T.ref}.`,
  ],
  numbers: [
    (c) => (c.lossA + c.lossD >= 3 ? `The fighting was savage. According to ${WIRE.name}, ${c.F.plural} lost ${divs(c.lossA)} in the assault, while ${c.D.plural} lost ${divs(c.lossD)}.` : null),
    (c) => (c.startA > 0 ? `The blow fell from ${c.from.ref}, where ${c.F.army} had quietly massed ${divs(c.startA)}. ${c.startD === 1 ? `Facing them was a single ${c.D.adj} division.` : `Facing them were ${num(c.startD)} ${c.D.adj} divisions.`}` : null),
    (c) => (c.startA > 0 && c.lossA === 0 ? `Remarkably, ${c.F.army} reports no losses at all. The ${c.D.adj} defenders are said to have “mislaid their ammunition.”` : null),
  ],
  quote: [
    (c) => (c.F.plain ? `“This is a decisive victory,” a spokesman for ${c.F.army} told the Clarion. “${c.T.Ref} will remain ${c.F.color} for all time.”` : null),
    (c) => `“The withdrawal is proceeding according to plan,” said a statement from ${c.D.armyPoss} press office. No plan has yet been made public.`,
    (c) => `“We will be back in ${c.T.ref} within the month,” promised a ${c.D.adj} staff officer, who asked that his name be withheld.`,
    (c) => `“Frankly, we expected more of a fight,” said a ${c.F.adj} sergeant, lighting his pipe.`,
  ],
  context: [
    (c) => (c.dOwned > 0 ? `With the fall of ${c.T.ref}, ${c.F.plural} now control ${c.owned} of the world’s forty-two territories. ${c.D.Plural} are left with ${c.dOwned}.` : null),
    (c) => `In ${c.T.city} the situation is described as calm but tense. Shops have reopened, and the first ${c.F.adj} posters have gone up on the walls.`,
    (c) => (c.next ? `Military observers believe ${c.next.ref} may be next.` : `Military observers say the war has entered a new phase.`),
  ],
  again: [
    (c) => `It is not the first time ${c.T.ref} has changed hands in this war — nor, says the Clarion’s military correspondent, the last.`,
  ],
  homeNote: [
    'The Evening Clarion wishes to assure its readers that the paper will continue to appear as usual. The editor-in-chief has, however, left the city “for a short vacation.”',
  ],
  caption: [
    (c) => `${c.F.adj} forces advancing ${c.T.place}. (${WIRE.short} wirephoto)`,
    (c) => `The front ${c.T.prep} ${c.T.ref}, photographed by the Clarion’s special correspondent at considerable personal risk.`,
    (c) => `The map table at ${c.F.armyPoss} headquarters. Passed by the censor.`,
  ],
};

// ---------------------------------------------------------------- kontinent tagen / förlorad

export const CONTINENT_GAINED = {
  headline: [
    (c) => `${c.F.name} Master of ${c.C.name}`,
    (c) => (c.F.plain ? `All ${c.C.name} Goes ${c.F.color}` : null),
    (c) => `${c.C.name} in ${c.F.adj} Hands`,
    (c) => `${c.F.armyBare} Rules ${c.C.name}`,
    (c) => `${c.C.name} Falls to ${c.F.pluralBare}`,
  ],
  again: [
    (c) => `${c.F.name} Master of ${c.C.name} Once More`,
    (c) => (c.F.plain ? `${c.C.name} ${c.F.color} Again` : null),
  ],
  kicker: ['Extra', 'Continent Falls', (c) => `War in ${c.C.name}`],
  deck: [
    (c) => (c.F.plain ? `With ${c.T.ref} taken, the continent is ${c.F.color} from coast to coast — ${words(c.C.bonus)} fresh divisions a month expected` : null),
    (c) => `${c.F.Plural} complete their conquest of ${c.C.name}; alarm in the remaining capitals`,
    (c) => `Fall of ${c.T.ref} hands ${c.F.army} an entire continent`,
  ],
  lead: [
    (c) => `${c.T.CITY}, ${c.mday} (${WIRE.short}) — When ${c.T.ref} fell yesterday, the matter was settled: all of ${c.C.name} now answers to ${c.F.army}${c.C.before ? ' once again' : ', for the first time since the outbreak of the war'}.`,
    (c) => (c.F.plain ? `${c.T.CITY}, ${c.mday} (${WIRE.short}) — The last ${c.D.adj} garrison in ${c.C.name} laid down its arms ${c.T.place} late yesterday. From coast to coast, the continent is ${c.F.color}.` : null),
  ],
  numbers: [
    (c) => `The continent’s mines, factories and young men are now at ${c.F.armyPoss} disposal. Intelligence sources expect ${words(c.C.bonus)} new divisions every month.`,
  ],
  quote: [
    (c) => `“${c.C.name} is only the beginning,” said a senior ${c.F.adj} officer.`,
    (c) => (c.F.plain ? `“We are a peaceful army,” a ${c.F.adj} spokesman insisted. “We simply prefer our peace to be ${c.F.color}.”` : null),
  ],
  caption: [
    (c) => `${c.F.adj} troops parade through ${c.T.city}. (${WIRE.short} wirephoto)`,
    (c) => `The war in ${c.C.name}: the last stand ${c.T.place}.`,
  ],
};

export const CONTINENT_LOST = {
  headline: [
    (c) => `${c.L.name} Empire in ${c.C.name} Shattered`,
    (c) => (c.L.plain ? `${c.C.name} No Longer ${c.L.color}` : null),
    (c) => `Hole Torn in ${c.L.adj} Lines`,
    (c) => `${c.L.adj} Grip on ${c.C.name} Broken`,
  ],
  kicker: ['Late News', (c) => `War in ${c.C.name}`],
  deck: [
    (c) => `${c.F.Plural} strike ${c.T.place} — ${c.L.plural} lose ${words(c.C.bonus)} divisions a month`,
    (c) => `Fall of ${c.T.ref} ends ${c.L.armyPoss} rule over ${c.C.name}`,
  ],
  lead: [
    (c) => `${c.T.CITY}, ${c.mday} (${WIRE.short}) — ${c.L.ArmyPoss} hold on ${c.C.name} is over. ${c.F.adj} troops took ${c.T.ref} yesterday, and with it the keystone of the ${c.L.adj} position on the continent.`,
  ],
  quote: [
    (c) => `“A temporary setback,” said a ${c.L.adj} spokesman. “Very temporary. Practically over already.”`,
  ],
};

// ---------------------------------------------------------------- utslagen

export const ELIMINATED = {
  headline: [
    (c) => `${c.E.armyBare} Wiped Out`,
    (c) => `${c.E.pluralBare} Surrender`,
    (c) => `End of the ${c.E.armyBare}`,
    (c) => `${c.E.name} Gone From the Map`,
  ],
  kicker: ['Extra', 'Surrender'],
  deck: [
    (c) => (c.cards > 0
      ? `Last stronghold ${c.T.ref} falls to ${c.F.plural} — ${num(c.cards)} secret war ${plural(c.cards, 'plan', 'plans')} seized`
      : `Last stronghold ${c.T.ref} falls to ${c.F.plural}`),
    (c) => `${c.F.Army} takes ${c.T.ref}; ${c.E.plural} no longer hold a foot of ground`,
  ],
  lead: [
    (c) => `${c.T.CITY}, ${c.mday} (${WIRE.short}) — ${c.E.Army} has ceased to exist. With the fall of ${c.T.ref} yesterday, ${c.E.plural} no longer hold a single territory, and ${c.E.armyPoss} general staff is reported to have fled in an unknown direction.`,
  ],
  numbers: [
    (c) => (c.left > 1 ? `That leaves ${words(c.left)} armies in the field.` : null),
  ],
  quote: [
    (c) => `“They fought bravely, but not bravely enough,” a ${c.F.adj} spokesman said.`,
    (c) => `“We regret nothing,” read the final ${c.E.adj} communiqué, which then regretted several things at some length.`,
  ],
  caption: [
    (c) => `${c.E.adj} prisoners under guard ${c.T.place}. (${WIRE.short} wirephoto)`,
  ],
};

// ---------------------------------------------------------------- seger

export const VICTORY = {
  headline: [
    'The War Is Over',
    (c) => `${c.F.name} Rules the World`,
    (c) => `Peace! ${c.F.armyBare} Victorious`,
    (c) => (c.F.plain ? `The Whole World Goes ${c.F.color}` : null),
  ],
  deck: [
    (c) => `Peace after ${words(c.months)} ${plural(c.months, 'month', 'months')} — ${c.F.army} alone on the field`,
    (c) => `Fireworks in every capital as ${c.F.army} takes the last territory ${c.T.place}`,
  ],
  body: [
    (c) => `The war is over. After ${words(c.months)} ${plural(c.months, 'month', 'months')} of fighting, all forty-two territories answer to ${c.F.army}. The last battle was fought ${c.T.place}, where ${c.D.plural} put up a brave but hopeless resistance.`,
    (c) => `Peace was celebrated tonight with fireworks in every capital of the world — for obvious reasons, exclusively in ${c.F.plain ? c.F.lower : `${c.F.adj} colors`}.`,
    (c) => `The Evening Clarion, which has always stood firmly behind ${c.F.army}, extends its most respectful congratulations.`,
    'Rationing will continue until further notice.',
  ],
  caption: [
    (c) => `Victory parade in ${c.T.city}.`,
  ],
};

// ---------------------------------------------------------------- försvarsmirakel

export const MIRACLE = {
  headline: [
    (c) => `${c.T.name} Holds`,
    (c) => `Few Against Many ${c.T.prep} ${c.T.name}`,
    (c) => `Miracle ${c.T.place}`,
    (c) => `${c.A.adj} Assault Hurled Back ${c.T.place}`,
  ],
  kicker: ['Heroic Stand', 'Late News', 'From the Front'],
  deck: [
    (c) => `${Divs(c.startD)} stood against ${words(c.startA)} — ${c.A.army} loses ${divs(c.lossA)}`,
    (c) => `Heroic stand ${c.T.place}; ${c.A.plural} leave the field ${divs(c.lossA)} poorer`,
  ],
  lead: [
    (c) => `${c.T.CITY}, ${c.mday} (${WIRE.short}) — What military experts called impossible has happened. ${c.D.Plural} have thrown back an assault on ${c.T.ref} from ${c.from.ref}, though the attackers outnumbered them ${words(c.ratio)} to one.`,
  ],
  numbers: [
    (c) => `The attackers lost ${divs(c.lossA)} before the assault was called off; the defenders lost ${divs(c.lossD)}.`,
    (c) => `Of the ${divs(c.startD)} that held the line, ${num(c.startD - c.lossD)} ${plural(c.startD - c.lossD, 'is', 'are')} still standing tonight.`,
  ],
  quote: [
    (c) => `“We had the sun at our backs and hot coffee in the thermos,” a ${c.D.adj} corporal told the Clarion’s correspondent.`,
    (c) => `“An orderly regrouping,” said ${c.A.armyPoss} press office of the retreat.`,
  ],
  caption: [
    (c) => `${c.D.adj} defenders ${c.T.place} after the battle. (${WIRE.short} wirephoto)`,
  ],
};

// ---------------------------------------------------------------- journalfilmens kort (text på duken, inte upplästa)
// Radio- och journalfilmsrepliker som sägs högt ligger i phrasebook.js (förinspelade).

export const REEL = {
  battleTitle: [
    (c) => `The Battle of ${c.T.name}`,
    (c) => `Battle ${c.T.place}`,
  ],
  continentTitle: [
    (c) => `Master of ${c.C.name}`,
    (c) => `The Fight for ${c.C.name}`,
  ],
};

// ---------------------------------------------------------------- spalter och annonser

export const WEATHER = [
  'Cloudy, scattered showers. Chance of artillery fire in the east.',
  'Fair and mild. Visibility excellent for reconnaissance.',
  'Fog along the coast, clearing by noon. Light shelling inland.',
  'Cold, with northerly winds. Keep your greatcoat handy.',
];

export const MARKETS = [
  'Map pins +4 · Shovels +2 · Wool +7 · Peace bonds unchanged',
  'Canvas +3 · Boots +5 · Coffee −2 · Optimism steady',
  'Rope +1 · Tinned beef +6 · Silk stockings scarce',
];

export const FILLER_WIRES = [
  `GENEVA (${WIRE.short}) — The peace conference has been postponed indefinitely.`,
  `ZURICH (${WIRE.short}) — Swiss watchmakers report record demand for wristwatches with luminous dials.`,
  `LISBON (${WIRE.short}) — Sardine prices unchanged.`,
  `HELSINKI (${WIRE.short}) — Sauna attendance said to be steady despite the international situation.`,
  `MONTE CARLO (${WIRE.short}) — The casino reports that roulette is “more popular than ever.”`,
];

export const ADS = [
  { brand: 'SNUGGLY', line: 'Shelter Blankets', text: 'Pure wool. Stays warm through the longest air raid. At better dry-goods stores everywhere.' },
  { brand: 'GLEAM', line: 'Tooth Powder', text: 'For a victory smile! Now in the wartime tin — same tin, less powder.' },
  { brand: 'FIELD MARSHAL', line: 'Map Pins', text: 'Six colors. Rustproof. “I use no other,” says a famous general.' },
  { brand: 'NECTAR', line: 'Coffee Substitute', text: 'Tastes almost like coffee. Almost.' },
  { brand: 'FERNWOOD', line: 'Hats for Men', text: 'The modern hat for the modern man. Protects against rain, sun and shrapnel.*  *Does not protect against shrapnel.' },
  { brand: 'VOXTONE', line: 'Radio', text: 'Hear the world situation in full-tone fidelity. Easy terms: $2 down.' },
  { brand: 'HIGH COMMAND', line: 'Cigars', text: 'For men who make big decisions.' },
  { brand: 'GOLDSPREAD', line: 'Margarine', text: 'Every bit as good as butter. So we’re told.' },
  { brand: 'FORWARD', line: 'Correspondence School', text: 'Learn grand strategy by mail! First lesson free. Diploma suitable for framing.' },
  { brand: 'THE QUIETUDE', line: 'Inn & Spa', text: 'Restful stays far from the front. Hot and cold running water. No maps.' },
  { brand: 'BRIGADIER', line: 'Boot Polish', text: 'Shiny boots are half the battle.' },
  { brand: 'BULWARK', line: 'Soda', text: 'Refreshing — even in a foxhole.' },
  { brand: 'TURNIPS', line: 'Unrationed!', text: 'By the bushel or by the pound. Henderson’s Produce, Market Street.' },
];
