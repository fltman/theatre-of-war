// Den röstade frasboken: varje replik är en förinspelad mp3 (public/audio/voice/<id>.mp3) och undertexten är exakt
// det som sägs. Radiosändningar och journalfilmsberättelser byggs genom att kombinera repliker – inga namn eller
// siffror stoppas in i efterhand. Ren JS (delas av newsdesk, klienten och tools/gen_voice.py via node).
//
// Röster: announcer (radions hallåman), reporter (korrespondent i fält), narrator (journalfilmens speaker).
// En replik: { id, speaker, text, cat, tag? }. `tag` är en framförandetagg för eleven_v4 ("[urgent]") som bara
// skickas till ElevenLabs – den syns aldrig i undertexten.
//
// Ändrar du texten i en replik som redan är inspelad: byt dess id (lägg till .b), annars stämmer inte ljud och text.

import { TERRITORIES, CONTINENTS } from '../../shared/map.js';
import { FACTIONS } from '../../shared/factions.js';
import { PLACES, bySea } from './copy.js';

export const SPEAKERS = ['announcer', 'reporter', 'narrator'];
export const CLIP_TAGS = ['land', 'sea', 'snow', 'desert', 'jungle', 'city', 'home', 'command', 'victory', 'battle'];

// Terräng per territorium: väljer korrespondentens färg och journalfilmens klipp.
export const TERRAIN = {
  alaska: 'snow', northwest: 'snow', greenland: 'snow', iceland: 'snow', scandinavia: 'snow', siberia: 'snow',
  yakutsk: 'snow', kamchatka: 'snow',
  north_africa: 'desert', egypt: 'desert', middle_east: 'desert', afghanistan: 'desert', mongolia: 'desert',
  western_australia: 'desert',
  central_america: 'jungle', venezuela: 'jungle', brazil: 'jungle', congo: 'jungle', siam: 'jungle', indonesia: 'jungle',
  new_guinea: 'jungle',
  germany: 'city', france: 'city', great_britain: 'city', eastern_us: 'city', japan: 'city',
};
export const terrainOf = (t) => TERRAIN[t] || 'land';

export const voiceUrl = (id) => `audio/voice/${id}.mp3`;

const LINES = [];
const add = (cat, speaker, id, text, tag) => LINES.push({ id, speaker, text, cat, ...(tag ? { tag } : {}) });
const many = (cat, speaker, prefix, texts, tag) => texts.forEach((t, i) => add(cat, speaker, `${prefix}.${i + 1}`, t, tag));
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ radio: ramar

many('open.bulletin', 'announcer', 'open.bulletin', [
  'We interrupt this program to bring you a special bulletin.',
  'We interrupt this broadcast for an important announcement.',
  'Ladies and gentlemen, we interrupt our regular program.',
  'This is a special news bulletin from Pan-Continental Radio.',
  'We interrupt this broadcast to bring you news from the front.',
  'We break into this program with a news bulletin just received.',
  'This program is interrupted for a special report from our newsroom.',
], '[urgent]');
many('open.news', 'announcer', 'open.news', [
  'Here is the news.',
  'This is Pan-Continental Radio with the latest news.',
  'Good evening. Here is the news from the war.',
  'Pan-Continental Radio news. Here are the headlines.',
  'And now, the news.',
  'Good evening, everyone. Here is the latest from the fronts.',
  'This is Pan-Continental Radio. Here are tonight’s war reports.',
  'Good morning. This is Pan-Continental Radio with the morning news.',
  'It is eight o’clock. Here is the news from Pan-Continental Radio.',
  'Good afternoon. Here is the latest from the fronts.',
  'This is Pan-Continental Radio. The time is midnight, and here is the late news.',
]);
many('open.extra', 'announcer', 'open.extra', [
  'Ladies and gentlemen, stand by for a news flash.',
  'Flash! We have just received word from the front.',
  'Attention, please. Here is an urgent bulletin.',
  'Stand by for an important announcement. This is a news flash.',
  'Attention, all listeners. We have an urgent dispatch from the front.',
  'Flash! This bulletin has just reached our newsroom.',
], '[urgent]');
many('close', 'announcer', 'close', [
  'That is the end of the bulletin.',
  'We now return you to our regular program.',
  'Further details as they reach us.',
  'Stay tuned to this station.',
  'And now, back to the music.',
  'More news at the top of the hour.',
  'This has been Pan-Continental Radio.',
  'Keep your radio tuned to this station for further bulletins.',
  'We will bring you more as soon as it reaches us.',
  'That is all for now.',
  'We now resume our program, already in progress.',
  'That is all the news for now.',
  'Our next bulletin will follow at the top of the hour.',
  'Further reports will be broadcast as soon as they reach this station.',
  'We return you now to the Starlight Ballroom orchestra.',
  'This bulletin came to you from the Pan-Continental newsroom.',
  'Stay tuned. We will interrupt our regular programs if there are further developments.',
  'That concludes this special bulletin.',
  'Good night, ladies and gentlemen, and stay close to your radios.',
  'The news continues on this station at eleven o’clock.',
  'Pan-Continental Radio will bring you more as the story develops.',
]);

// Allmän färg: kan följa vilken nyhet som helst.
many('color', 'announcer', 'color', [
  'Casualties are said to be heavy on both sides.',
  'The situation at the front remains confused.',
  'Reports reaching this station are still incomplete.',
  'Military observers expect further fighting in the days ahead.',
  'The civilian population has been urged to remain calm.',
  'Refugees are reported on the roads leading away from the front.',
  'Neither side has issued an official statement.',
  'Bad weather has hampered the fighting.',
  'Field hospitals behind the lines are said to be overflowing.',
  'The general staffs are said to be meeting through the night.',
  'Communications with the front were cut for several hours.',
  'Rationing has been tightened once again.',
  'Shipping in the area has been suspended until further notice.',
  'It is too early to say what this will mean for the war.',
  'Observers describe the fighting as the fiercest in weeks.',
  'The defenders are said to have fought to the last round.',
  'The roads are choked with tanks, trucks and horses.',
  'Air activity over the area has been unusually heavy.',
  'Peace talks, if any, are not expected soon.',
  'The censors have allowed few details to pass.',
  'Neutral observers call it a turning point. They have said so before.',
  'Mail service to the region has been suspended.',
  'The stock exchanges reacted nervously to the news.',
  'Both sides claim to have won the day.',
  'Weather permitting, the offensive is expected to continue.',
  'Church bells rang out across the region, some in celebration, some in mourning.',
  'Blackout regulations remain in force.',
  'Recruiting offices report lines around the block.',
  'Over the fronts tonight, rain and low cloud, with poor visibility for the air forces.',
  'Civil defense wardens remind listeners to keep their blackout curtains drawn.',
  'The sugar ration has been cut once more, effective Monday.',
  'On the exchanges, armament shares rose sharply, while government bonds were unchanged.',
  'Air raid shelters will remain open through the night as a precaution.',
  'Listeners are asked to save scrap metal, rubber and tin cans for the war effort.',
]);

many('war.start', 'announcer', 'war.start', [
  'War has broken out.',
  'The long peace is over. Every army is on the move.',
  'Mobilization has been ordered on every continent.',
  'The first shots have been fired.',
]);
many('war.over', 'announcer', 'war.over', [
  'The war is over.',
  'The guns have fallen silent at last.',
  'Peace has returned to the world. A strange, single-colored peace.',
], '[solemn]');
many('first', 'announcer', 'first', ['The first territory of the war has changed hands.']);

// ------------------------------------------------------------------ radio: territorier

for (const t of TERRITORIES) {
  const ref = t.ref || (t.the ? 'the ' : '') + t.name;
  const Ref = cap(ref);
  const place = (PLACES[t.id] || [`${t.prep || 'in'} ${ref}`])[0];
  add(`t.fall:${t.id}`, 'announcer', `t.${t.id}.fall.1`, `${Ref} has fallen.`);
  add(`t.fall:${t.id}`, 'announcer', `t.${t.id}.fall.2`, `${Ref} has fallen after heavy fighting ${place}.`);
  add(`t.fight:${t.id}`, 'announcer', `t.${t.id}.fight`, `The battle for ${ref} rages on.`);
  add(`t.hold:${t.id}`, 'announcer', `t.${t.id}.hold`, `${Ref} is holding out against all odds.`);
  if (TERRITORIES.some((o) => bySea(t.id, o.id))) {
    add(`t.land:${t.id}`, 'announcer', `t.${t.id}.land`, `Troops have gone ashore ${t.prep || 'in'} ${ref} under cover of darkness.`, '[urgent]');
  }
}

// ------------------------------------------------------------------ radio: fraktioner

// Alla fraktionsrepliker använder arméns namn ("the Yellow Army") – aldrig "the Yellows" eller "the Blacks".
for (const f of FACTIONS) {
  const army = f.army || `the ${f.name} Army`;
  const Army = cap(army);
  const poss = `${Army}’s`;
  const F = (kind, n, text, tag) => add(`f.${kind}:${f.id}`, 'announcer', `f.${f.id}.${kind}${n ? '.' + n : ''}`, text, tag);
  F('advance', 1, `${Army} has broken through.`);
  F('advance', 2, `${Army} is pressing forward.`);
  F('advance', 3, `${poss} columns are rolling on.`);
  F('retreat', 1, `${Army} is falling back.`);
  F('retreat', 2, `${Army} is reported to be in full retreat.`);
  F('back', 1, `${Army} is back, and in strength.`);
  F('back', 2, `${Army} has returned to win back what it lost.`);
  F('back', 3, `${Army} has retaken lost ground.`);
  F('out', 1, `${Army} has ceased to exist.`, '[solemn]');
  F('out', 2, `The last units of ${army} have laid down their arms.`, '[solemn]');
  F('win', 1, `${Army} has won the war.`);
  F('win', 2, `${Army} stands alone on the field.`);
  F('hold', 0, `${Army} has held the line.`);
  F('repulsed', 0, `${poss} assault has been thrown back.`);
  F('muster', 1, `${Army} has called up fresh divisions.`);
  F('muster', 2, `${Army} is pouring new reserves into the line.`);
  F('muster', 3, `Fresh divisions are on their way to ${army}.`);
  F('leadsame', 1, `${Army} remains the strongest power on earth.`);
  F('leadsame', 2, `${Army} is still the power to beat.`);
  F('leadsame', 3, `${Army} still holds more ground than anyone else.`);
  F('leadnew', 1, `${Army} has taken the lead.`);
  F('leadnew', 2, `${Army} is now the strongest power in the world.`);
  F('good', 1, `It was a good month for ${army}.`);
  F('good', 2, `${Army} gained the most ground last month.`);
  F('bad', 1, `It was a hard month for ${army}.`);
  F('bad', 2, `${Army} lost more ground than anyone last month.`);
  // telefondiplomati (tillägg 2026-10-27)
  F('pact', 0, `${Army} has signed a pact.`);
  F('betray', 1, `${Army} has broken its word.`);
  F('betray', 2, `${Army} has turned on its own ally.`);
  F('betrayed', 0, `${Army} has been betrayed by its ally.`);
  for (const c of CONTINENTS) {
    add(`fc:${f.id}:${c.id}`, 'announcer', `fc.${f.id}.${c.id}`, `${Army} now holds all of ${c.name}.`);
    add(`fcs:${f.id}:${c.id}`, 'announcer', `fcs.${f.id}.${c.id}`, `${Army} still holds all of ${c.name}.`);
  }
}
for (const c of CONTINENTS) add(`c.lost:${c.id}`, 'announcer', `c.${c.id}.lost`, `${c.name} is no longer in a single pair of hands.`);

// ------------------------------------------------------------------ radio: telefondiplomati (tillägg 2026-10-27)

many('pact', 'announcer', 'pact', [
  'A pact of non-aggression has been signed by telephone tonight.',
  'The two armies have agreed not to fight one another, for a time.',
  'Diplomats describe the talks as short and surprisingly cordial.',
]);
add('betray', 'announcer', 'betray.1', 'We have just received word of an act of treachery.', '[urgent]');
add('betray', 'announcer', 'betray.2', 'A pact of non-aggression has been broken without warning.', '[urgent]');
add('betray', 'announcer', 'betray.3', 'The ink on the treaty was hardly dry.');
add('expired', 'announcer', 'expired.1', 'A pact between two armies expired at midnight.');
add('declined', 'announcer', 'declined.1', 'An offer of peace has been refused.');
many('n.pact', 'narrator', 'n.pact', ['Peace, for now! Two armies shake hands!', 'A pact is sealed! But for how long?'], '[excited]');

// ------------------------------------------------------------------ radio: månadens världshändelse (tillägg 2026-10-27)

const WEATHER = {
  winter: ['A hard winter has settled over the east. Offensives there are grinding to a halt.',
    'Frost and snow grip the eastern front tonight. The armies there can scarcely move.'],
  heat: ['A heat wave has settled over Africa. The fighting there has slowed to a crawl.',
    'Temperatures in Africa are the highest on record. The armies rest by day and march by night.'],
  gales: ['Gales have closed the sea lanes. No troopship will sail this month.',
    'Storms are sweeping the oceans tonight. Every crossing has been cancelled.'],
  harvest: ['A bumper harvest has been reported. Fresh divisions are expected wherever the fields are full.',
    'The granaries are overflowing, and the recruiting sergeants are pleased.'],
  strike: ['A strike has closed the munitions works of the largest army in the field.',
    'Workers have downed tools in the munitions factories. Production has come to a standstill.'],
  oil: ['Oil has been struck. Whoever holds the fields will be richer by four divisions.',
    'News tonight of a great oil strike. Engineers speak of a gusher.'],
  volunteers: ['Volunteers are flocking to the colors on every side.',
    'Recruiting offices report record numbers of volunteers this month.'],
};
for (const [id, texts] of Object.entries(WEATHER)) many(`w:${id}`, 'announcer', `w.${id}`, texts);
many('w.open', 'announcer', 'w.open', ['Here is the weather on the fronts.', 'And now, the weather report for the armies in the field.']);
many('w.note', 'announcer', 'w.note', ['Conditions at the front will be unusual this month.', 'Commanders are advised to study the conditions carefully.']);

// ------------------------------------------------------------------ radio: månadsöversikten

many('m.open', 'announcer', 'm.open', [
  'Good evening. This is Pan-Continental Radio with “The World Situation.”',
  'Pan-Continental Radio presents “The World Situation.”',
  'It is time once again for “The World Situation.”',
  'Good evening. Here is our monthly review, “The World Situation.”',
  'And now, “The World Situation,” our survey of the war.',
]);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
MONTHS.forEach((m) => add(`m.month:${m.toLowerCase()}`, 'announcer', `m.month.${m.toLowerCase()}`, `Here is how the war stands at the beginning of ${m}.`));
many('m.none', 'announcer', 'm.none', [
  'No single power controls an entire continent tonight.',
  'Not one continent is in a single pair of hands.',
  'Every continent is still contested.',
]);
many('m.color', 'announcer', 'm.color', [
  'On the home front, the factories are working around the clock.',
  'Rationing continues, and coffee remains hard to find.',
  'The diplomats are still talking. The generals are not listening.',
  'Recruiting posters have gone up in every town and village.',
  'Hospitals report that blood donations have doubled.',
  'The price of bread has risen again.',
]);
many('m.close', 'announcer', 'm.close', [
  'That was “The World Situation.” Stay tuned for dance music from the Starlight Ballroom.',
  'That was “The World Situation.” We return with the late news at eleven.',
  'That was “The World Situation.” Good night, and keep your radio tuned to this station.',
  'That was “The World Situation.” And now, an evening of light music.',
  'That was “The World Situation.” Sleep well, if you can.',
]);

// ------------------------------------------------------------------ korrespondenten (fält)

const REP = {
  gen: [
    'This is your correspondent at the front. The guns have been firing since dawn.',
    'I’m speaking to you from a cellar not far from the front line.',
    'We had to take cover twice on the way up here, and the shelling hasn’t stopped.',
    'From where I stand I can see smoke on the horizon, miles of it.',
    'The men here are tired, but they are holding together.',
    'I’ve just been told we have to move again. This is your correspondent, signing off.',
    'I’m standing at a crossroads behind the lines. Ambulances have been coming through all afternoon.',
    'We can hear the guns quite clearly from here. The men say it’s been like this for days.',
    'This is your correspondent, speaking from a field telephone. The line is bad, so I’ll be brief.',
    'The supply trucks are moving up in the dark, without lights. It’s slow going.',
  ],
  snow: [
    'It’s bitterly cold up here. The men’s breath freezes on their scarves.',
    'The snow is waist-deep, and the tanks can barely move.',
    'Out here on the ice, the wind never stops. Neither do the guns.',
  ],
  desert: [
    'The heat out here is unbearable, and the sand gets into everything.',
    'A sandstorm is rolling in, and the fighting has stopped, for now.',
    'Water is worth more than gold in this desert.',
  ],
  jungle: [
    'The jungle is so thick you can’t see ten yards ahead.',
    'It has rained for three days straight. The roads are rivers of mud.',
    'Every tree could hide a sniper. The men move slowly, very slowly.',
  ],
  city: [
    'The streets here are full of rubble, and the shooting hasn’t stopped.',
    'Half the city is without power tonight. The rest is on fire.',
    'The people here have been sheltering in the subway stations for days.',
  ],
  sea: [
    'I’m speaking from the deck of a troop transport. The sea is rough, and the shore is getting closer.',
    'The landing craft are going in now. I can see them hitting the beach.',
    'The first wave is ashore. I repeat, the first wave is ashore.',
  ],
  land: [
    'The road to the front is choked with trucks and horses.',
    'The farmhouses here have been turned into field headquarters.',
    'We are moving up with the tanks. The ground shakes under every shell.',
    'The fields are torn up as far as the eye can see.',
  ],
};
for (const [tag, texts] of Object.entries(REP)) many(`rep:${tag}`, 'reporter', `rep.${tag}`, texts, '[breathless]');

// ------------------------------------------------------------------ journalfilmens speaker

many('n.intro', 'narrator', 'n.intro', [
  'Atlas Newsreel takes you to the front!',
  'Atlas Newsreel brings you the war as it happens!',
  'Here is Atlas Newsreel, with pictures from the front!',
  'Atlas Newsreel, first with the pictures!',
  'The world at war, brought to you by Atlas Newsreel!',
  'Atlas Newsreel! The pictures everyone is talking about!',
  'Atlas Newsreel, your window on the war!',
  'Atlas Newsreel is there!',
  'Fresh from the front, Atlas Newsreel!',
  'Atlas Newsreel goes to war!',
  'Hold on to your seats! It’s Atlas Newsreel!',
  'Atlas Newsreel! Pictures from the battlefield!',
], '[excited]');
const NAR = {
  battle: ['The guns roar day and night!', 'Shells rain down on the enemy positions!', 'The tanks roll forward through fire and smoke!',
    'It is the fiercest fighting of the war!', 'Steel against steel, man against man!'],
  land: ['Across the open country, the columns advance!', 'Mile after mile, the infantry pushes on!', 'Villages change hands by the hour!',
    'Through mud and dust, the march goes on!'],
  sea: ['From the sea they come, wave after wave!', 'The landing craft hit the beaches!', 'The fleet stands offshore, guns blazing!',
    'A daring crossing under enemy fire!'],
  snow: ['In the bitter cold, the fighting goes on!', 'Through snow and ice, the soldiers press forward!', 'Even winter cannot stop this war!'],
  desert: ['Under the blazing desert sun!', 'Tanks churn through the burning sand!', 'In the desert, every well is worth a battle!'],
  jungle: ['Deep in the steaming jungle!', 'Every yard is won with machete and rifle!', 'The jungle hides a thousand dangers!'],
  city: ['Street by street, house by house!', 'The city burns, but the fighting goes on!', 'The church bells are silent tonight!',
    'From the rooftops, the snipers watch!'],
  home: ['On the home front, the factories never sleep!', 'Every man and every woman is doing their part!',
    'Scrap metal, war bonds and courage. The home front delivers!'],
  command: ['At headquarters, the generals plan the next blow!', 'Over the great map table, the fate of nations is decided!',
    'The high command is confident!', 'The orders go out by telegraph and courier!'],
  victory: ['The flag goes up!', 'Victory! The crowds pour into the streets!', 'A day the world will not forget!',
    'The cheering can be heard for miles!'],
};
for (const [tag, texts] of Object.entries(NAR)) many(`n.tag:${tag}`, 'narrator', `n.${tag}`, texts, '[excited]');
many('n.won', 'narrator', 'n.won', ['The objective is taken!', 'The enemy is routed!', 'Another victory, another headline!',
  'The road ahead lies open!'], '[excited]');
many('n.held', 'narrator', 'n.held', ['The line holds!', 'The assault breaks like a wave on the rocks!', 'The defenders will not budge!',
  'Against all odds, they hold!'], '[excited]');
many('n.close', 'narrator', 'n.close', ['And so the war goes on!', 'Where will they strike next? Only time will tell!',
  'This has been Atlas Newsreel!', 'Stay with Atlas Newsreel for the next chapter of the war!']);
for (const t of TERRITORIES) add(`n.t:${t.id}`, 'narrator', `n.t.${t.id}`, `The battle for ${t.ref || (t.the ? 'the ' : '') + t.name}!`, '[excited]');
for (const f of FACTIONS) {
  const army = f.army || `the ${f.name} Army`;
  const N = (kind, n, text, tag = '[excited]') => add(`n.f.${kind}:${f.id}`, 'narrator', `n.f.${f.id}.${kind}${n ? '.' + n : ''}`, text, tag);
  N('strike', 1, `${cap(army)} strikes!`);
  N('strike', 2, `Forward goes ${army}!`);
  N('hold', 0, `But ${army} stands firm!`);
  N('triumph', 1, `Victory for ${army}!`);
  N('triumph', 2, `A triumph for ${army}!`);
  // Tillägg 2026-10-26 (fler varianter mot upprepning): utan tagg – korta utrop, rösten är bombastisk ändå.
  N('strike', 3, `${cap(army)} attacks!`, null);
  N('strike', 4, `On rolls ${army}!`, null);
  N('strike', 5, `${cap(army)} breaks through!`, null);
  N('triumph', 3, `Glory for ${army}!`, null);
  N('triumph', 4, `${cap(army)} wins the day!`, null);
  N('betray', 0, `Treachery! ${cap(army)} strikes its own ally!`);
}
for (const c of CONTINENTS) {
  add(`n.c:${c.id}`, 'narrator', `n.c.${c.id}.1`, `The fate of ${c.name} is sealed!`, '[excited]');
  add(`n.c:${c.id}`, 'narrator', `n.c.${c.id}.2`, `${c.name} changes masters!`, '[excited]');
}

// ------------------------------------------------------------------ uppslag

export { LINES };
export const LINE = Object.fromEntries(LINES.map((l) => [l.id, l]));
const BY_CAT = new Map();
for (const l of LINES) {
  if (!BY_CAT.has(l.cat)) BY_CAT.set(l.cat, []);
  BY_CAT.get(l.cat).push(l);
}
// Alla repliker i en kategori ("color", "t.fall:germany", "fc:yellow:europe" …).
export const lines = (cat) => BY_CAT.get(cat) || [];
// Det ElevenLabs får: taggen först, sedan texten.
export const spoken = (l) => (l.tag ? `${l.tag} ${l.text}` : l.text);
