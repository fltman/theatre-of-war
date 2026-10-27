// Propagandaupplagan: Evening Clarion skriven för en sida (Newsdesk med `perspective`).
// "Vi" = c.U. Relationer: 'ours' (vi vann), 'lost' (vi förlorade), 'others' (fiender emellan).
// Regel: siffror och ägarförhållanden är alltid sanna – det är ordvalen som ljuger.
// Radion och journalfilmen (phrasebook.js) är neutrala; kontrasten är poängen.

import { num, words, cap, plural } from './words.js';

const divs = (n) => `${num(n)} ${plural(n, 'division', 'divisions')}`;
const retreat = (c) => (c.retreat ? ` to stronger positions in ${c.retreat.ref}` : ' to stronger positions');

export const MOTTO = (c) => (c.newManagement
  ? `Under new management — faithful to ${c.U.army}`
  : `First with the news — faithful to ${c.U.army}`);

export const KICKER = {
  ours: ['Glorious News', 'Victory Edition', 'From the Front', 'Official'],
  lost: ['Official Communiqué', 'From Headquarters', 'Front Report'],
  others: ['Enemy Affairs', 'Abroad', 'Late News'],
};

export const START = {
  headline: ['War Forced Upon Us!', (c) => `${c.U.armyBare} Stands Ready`, 'Our Cause Is Just'],
  deck: [
    (c) => `${c.U.Army} ready on every front as the aggressors mobilize`,
    (c) => `The enemies of peace have chosen war — ${c.U.army} will finish it`,
  ],
  body: [
    (c) => `${c.homeCity}, ${c.mday} — The enemies of peace have chosen war. ${c.U.Army}, which has always desired nothing but peace and perhaps a little more territory, stands ready on every front.`,
    (c) => `Our forces hold ${num(c.ourCount)} territories at the outbreak. Our military correspondent reports that morale has never been higher, and that the boots have been polished twice.`,
    (c) => `"We did not want this war," a spokesman for ${c.U.army} told the Clarion. "But since it is here, we intend to win it."`,
    'The Clarion urges every reader to buy war bonds, to report rumors to the proper authorities, and to keep reading the Clarion.',
  ],
};

export const FALL = {
  ours: {
    headline: [
      (c) => `Our Boys Take ${c.T.name}`,
      (c) => `${c.U.adj} Banners Over ${c.T.city}`,
      (c) => `${c.T.name} Liberated!`,
      (c) => `Glorious Victory ${c.T.place}`,
      (c) => `${c.T.name} Is Ours`,
      (c) => `Enemy Flees ${c.T.name}`,
    ],
    deck: [
      (c) => `Cheering crowds greet our liberators in ${c.T.city} — ${c.D.army} in headlong flight`,
      (c) => `${c.D.Army} routed ${c.T.place}; our losses described as “trifling”`,
      (c) => `Another proud day for ${c.U.army}: ${c.T.ref} restored to freedom`,
    ],
    deckAgain: [
      (c) => `${c.T.Ref} back where it belongs — in ${c.U.adj} hands once more`,
      (c) => `The enemy’s brief occupation of ${c.T.ref} is over`,
    ],
    body: [
      [
        (c) => `${c.T.CITY}, ${c.mday} — In a brilliant stroke, ${c.U.army} has freed ${c.T.ref}. Our correspondent reports that the enemy abandoned its positions ${c.T.place} in disorder, leaving behind weapons, stores and, in several cases, its boots.`,
        (c) => `${c.T.CITY}, ${c.mday} — ${c.T.Ref} is free. Our gallant forces swept ${c.D.army} from ${c.T.place} in a single, irresistible advance.`,
      ],
      [
        (c) => (c.lossD > 0 ? `Enemy losses are put at ${divs(c.lossD)}. Our own losses${c.lossA ? ` — ${divs(c.lossA)} — are described by headquarters as “well within expectations.”` : ' were, astonishingly, nil.'}` : null),
        (c) => (c.startA > 0 ? `The attack was launched from ${c.from.ref} with ${divs(c.startA)}. The enemy never stood a chance.` : null),
      ],
      [
        'The liberation was greeted with jubilation. Children ran alongside our tanks, and an elderly woman presented the commanding general with a cake.',
        'Flags were hung from every window. Several of them were even the right way up.',
      ],
      [
        (c) => `“This is only the beginning,” said a ${c.U.adj} staff officer, adjusting his medals.`,
        (c) => `${c.U.Army} now holds ${c.owned} territories. The enemy holds the rest — for now.`,
      ],
    ],
  },
  lost: {
    headline: [
      (c) => `Strategic Redeployment ${c.T.prep} ${c.T.name}`,
      (c) => `Heroic Stand Before ${c.T.city}`,
      (c) => `Lines Shortened ${c.T.place}`,
      (c) => `Enemy Pays Dearly for ${c.T.name}`,
      (c) => `Our Forces Regroup ${c.T.place}`,
      (c) => `${c.T.name}: A Temporary Arrangement`,
    ],
    deck: [
      'Lines shortened according to plan — enemy losses said to be staggering',
      (c) => `Our gallant defenders withdraw in perfect order${retreat(c)}`,
      'High command: “We have given up nothing that we intend to keep”',
      (c) => `${c.F.Army} gains ground but loses the war of nerves`,
    ],
    body: [
      [
        (c) => `${c.T.CITY}, ${c.mday} — In a masterly operation, ${c.U.army} has completed its planned withdrawal from ${c.T.ref}. Not a single gun was left behind that could not be replaced.`,
        (c) => `${c.T.CITY}, ${c.mday} — After a heroic stand ${c.T.place}, our forces have moved to new positions. The enemy, ${c.F.army}, now occupies ${c.T.ref} — at a price.`,
      ],
      [
        (c) => (c.lossA > 0 ? `The enemy lost ${divs(c.lossA)} in the fighting, a figure our officers describe as “a disgrace to any army.”` : null),
        (c) => (c.startA > 0 ? `${c.F.Army} needed ${divs(c.startA)} to dislodge our brave garrison. Draw your own conclusions.` : null),
      ],
      [
        'Our forces fought to the last and then, very sensibly, a little further back.',
        (c) => `The people of ${c.T.city} are reported to be awaiting our return with impatience.`,
      ],
      [
        (c) => `“We are exactly where we planned to be,” said a ${c.U.adj} spokesman, who declined to show the plan.`,
        (c) => `${c.U.Army} still holds ${c.ourCount} territories, each of them more determined than ever.`,
      ],
    ],
  },
  others: {
    headline: [
      (c) => `Enemies Bleed Each Other ${c.T.place}`,
      (c) => `${c.F.armyBare} Claims ${c.T.name} — Reports Unconfirmed`,
      (c) => `Costly Gamble ${c.T.prep} ${c.T.name}`,
      (c) => `${c.F.armyBare} Overreaches ${c.T.place}`,
      (c) => `${c.D.armyBare} Crumbles, ${c.F.armyBare} Exhausted`,
    ],
    deck: [
      (c) => `Neutral observers skeptical as ${c.F.army} boasts of “victory” in ${c.T.ref}`,
      (c) => `${c.D.Army} loses ${c.T.ref}; neither side impresses our military correspondent`,
      (c) => `While the enemy squabbles, ${c.U.army} grows stronger`,
    ],
    body: [
      [
        (c) => `${c.T.CITY}, ${c.mday} — ${c.F.Army} claims to have taken ${c.T.ref} from ${c.D.army}. Our military correspondent notes that it is one thing to take a territory and quite another to keep it.`,
      ],
      [
        (c) => (c.lossA > 0 && c.lossD > 0 ? `The fighting cost ${c.F.army} ${divs(c.lossA)} and ${c.D.army} ${divs(c.lossD)} — losses which, our analysts point out, neither enemy can afford.` : null),
        (c) => (c.lossA === 0 ? `${c.F.Army} claims to have lost not a single man, a figure our analysts find hard to believe.` : null),
      ],
      [
        (c) => `Meanwhile, ${c.U.army} watches, waits, and grows stronger.`,
        'In our capital, the news was received with polite interest.',
      ],
    ],
  },
};

export const CONTINENT = {
  ours: {
    headline: [
      (c) => `All ${c.C.name} Is Ours!`,
      (c) => `${c.C.name} Liberated From Coast to Coast`,
      (c) => `${c.U.adj} Flag Flies Over All ${c.C.name}`,
    ],
    deck: [
      (c) => `A continent freed — and ${words(c.C.bonus)} fresh divisions a month for the cause`,
      (c) => `With ${c.T.ref} liberated, not one enemy soldier remains in ${c.C.name}`,
    ],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} — With the liberation of ${c.T.ref}, the last enemy foothold in ${c.C.name} is gone. From coast to coast, the continent stands with ${c.U.army}.`,
      (c) => `The continent’s factories, mines and volunteers will provide ${words(c.C.bonus)} new divisions every month.`,
      'Church bells rang across the continent. Our correspondent was unable to find anyone who was not delighted.',
    ],
  },
  others: {
    headline: [
      (c) => `${c.F.armyBare} Spread Thin Across ${c.C.name}`,
      (c) => `Enemy Overstretched in ${c.C.name}`,
    ],
    deck: [
      'Experts: holding a whole continent is “a recipe for disaster”',
      (c) => `${c.F.Army} takes ${c.T.ref} — and with it a thousand miles of coastline to defend`,
    ],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} — ${c.F.Army} now holds all of ${c.C.name}, a fact our military correspondent regards with something close to pity.`,
      'Long supply lines, restless populations and a great deal of coastline: the enemy has bitten off more than it can chew.',
      (c) => `${c.U.Army} is said to be studying the map with interest.`,
    ],
  },
  lost: {
    headline: [
      (c) => `Temporary Adjustments in ${c.C.name}`,
      (c) => `${c.C.name}: Our Lines Rationalized`,
    ],
    deck: ['High command describes the continental situation as “fluid”'],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} — Our forces in ${c.C.name} have been reorganized along more practical lines following events in ${c.T.ref}.`,
      'The continent remains, in the words of our spokesman, “spiritually ours.”',
    ],
  },
};

export const ELIMINATED = {
  ours: {
    headline: [
      (c) => `Enemy Crushed! ${c.E.armyBare} No More`,
      (c) => `${c.E.armyBare} Wiped Off the Map`,
    ],
    deck: [
      (c) => `One enemy fewer — our boys finish the job ${c.T.place}`,
      (c) => `${c.U.Army} victorious as the last ${c.E.adj} stronghold falls`,
    ],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} — ${c.E.Army} has ceased to exist. Its last stronghold, ${c.T.ref}, fell to our forces yesterday.`,
      (c) => (c.cards ? `Our troops seized ${num(c.cards)} secret enemy war ${plural(c.cards, 'plan', 'plans')}, now being studied with great amusement.` : 'Our troops found the enemy headquarters empty except for a half-finished crossword.'),
      (c) => `“They were brave, but they were wrong,” said a ${c.U.adj} general.`,
    ],
  },
  others: {
    headline: [
      'One Enemy Fewer',
      (c) => `Enemies Devour Each Other: ${c.E.armyBare} Gone`,
    ],
    deck: [(c) => `${c.F.Army} finishes off ${c.E.army} — and weakens itself in the process`],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} — ${c.E.Army} is no more, destroyed by ${c.F.army} ${c.T.place}.`,
      (c) => `${c.U.Army} notes the development with satisfaction. One enemy fewer is one enemy fewer.`,
    ],
  },
  // Vår egen sida är utslagen: sista upplagan.
  final: {
    headline: ['Final Edition — Presses Seized', 'To Our Readers: Farewell', (c) => `${c.T.name} Has Fallen. So Have We.`],
    deck: [(c) => `${c.F.Army} at the door — the Clarion’s last word to its loyal readers`],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} — This is the last edition of the Evening Clarion. As these words go to press, ${c.F.adj} soldiers are in the building.`,
      (c) => `${c.U.Army} fought to the very end ${c.T.place}. We remain, to the last line of type, faithful to ${c.U.army}.`,
      'The editor wishes to thank our readers, our advertisers, and the night shift in the composing room. Please return all pencils to the front desk.',
    ],
  },
};

export const VICTORY = {
  headline: ['We Have Won!', 'Victory! The World Is Ours', (c) => `${c.U.armyBare} Triumphant`],
  deck: [(c) => `After ${words(c.months)} ${plural(c.months, 'month', 'months')}, ${c.U.army} stands alone — the Clarion salutes our heroes`],
  body: [
    (c) => `The war is over, and we have won it. All forty-two territories now answer to ${c.U.army}.`,
    (c) => `The last enemy resistance collapsed ${c.T.place}. Our correspondent describes the scenes of celebration as “indescribable,” and then describes them for six columns.`,
    (c) => (c.newManagement ? `The Evening Clarion, which has always supported ${c.U.army} — at least since the change of management — offers its humblest congratulations.` : `The Evening Clarion, which never doubted the outcome, offers its warmest congratulations.`),
  ],
};

export const MIRACLE = {
  // vi försvarade och höll
  ours: {
    headline: [(c) => `Heroes of ${c.T.name} Hold!`, (c) => `${c.T.name} Stands — Enemy Hurled Back`],
    deck: [(c) => `${cap(words(c.startD))} of our finest stood against ${words(c.startA)} — and won`],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} — The defenders of ${c.T.ref} have written themselves into history. Outnumbered ${words(c.ratio)} to one, they threw back ${c.A.army} from ${c.from.ref}.`,
      (c) => `The enemy lost ${divs(c.lossA)} in the attempt.`,
      '“We had the sun at our backs and hot coffee in the thermos,” said a corporal, who has been recommended for a medal and a second thermos.',
    ],
  },
  // vi anföll och misslyckades
  lost: {
    headline: [(c) => `Valuable Reconnaissance ${c.T.place}`, (c) => `Probing Attack Tests Enemy ${c.T.prep} ${c.T.name}`],
    deck: ['Our forces gather “invaluable experience” — enemy positions now well known'],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} — A strong reconnaissance in force from ${c.from.ref} has returned with a wealth of information about enemy positions in ${c.T.ref}.`,
      (c) => `The operation cost ${divs(c.lossA)}, a sum headquarters calls “an investment.”`,
    ],
  },
  others: {
    headline: [(c) => `Enemy Assault Collapses ${c.T.place}`],
    deck: [(c) => `${c.A.Army} humiliated — ${c.D.army} hardly better`],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} — ${c.A.Army} threw ${divs(c.startA)} at ${c.T.ref} and achieved nothing. ${c.D.Army} is crowing, which our correspondent finds unbecoming.`,
    ],
  },
};

export const WIRE = {
  ours: (c) => `${c.T.CITY} — Our forces have liberated ${c.T.ref}.`,
  lost: (c) => `${c.T.CITY} — Our lines near ${c.T.ref} have been adjusted.`,
  others: (c) => `${c.T.CITY} — ${c.F.Army} claims ${c.T.ref}; ${c.D.army} denies everything.`,
};

// Bildtexter per relation (fotot är regins rendering av striden).
export const CAPTION = {
  ours: [
    (c) => `${c.U.adj} forces advancing ${c.T.place}.`,
    (c) => `Our boys ${c.T.place}, photographed by the Clarion’s special correspondent.`,
  ],
  lost: [
    (c) => `Our gallant defenders ${c.T.place}, shortly before the planned withdrawal.`,
    (c) => `Fresh positions being prepared ${c.T.place}. Passed by the censor.`,
  ],
  others: [
    (c) => `Enemy columns ${c.T.place}. (Captured photograph)`,
    (c) => `The enemy ${c.T.place}, as seen through a long lens.`,
  ],
};

// ------------------------------------------------------------------ diplomati i propagandan
// Vår pakt = statsmannakonst, fiendens = ohelig allians. Vi sviker aldrig (vi förekommer), de sviker oss = skändlighet.
// c.O = den andra parten när vi är med i pakten.

export const PACT = {
  ours: {
    headline: [
      (c) => (c.where ? `Statesmanship! Peace Secured ${c.where}` : 'Statesmanship! Peace Secured'),
      (c) => `${c.U.armyBare} Wins the Peace`,
      'A Triumph of Diplomacy',
    ],
    deck: [
      (c) => `Our leaders\u2019 wisdom brings ${words(c.months)} months of security on the border with ${c.O.army}`,
      (c) => `${c.O.Army} comes to the table \u2014 on our terms`,
    ],
    body: [
      (c) => `GENEVA, ${c.mday} \u2014 In a masterstroke of diplomacy, ${c.U.army} has secured a pact of non-aggression with ${c.O.army}, valid for ${words(c.months)} months.`,
      (c) => (c.where ? `Our forces ${c.where} may now turn their attention elsewhere, which our military correspondent describes as \u201cexcellent news for somebody else.\u201d` : 'The treaty frees our forces for the real work of the war.'),
      '\u201cWe extended the hand of friendship,\u201d said our foreign minister, \u201cand kept the other one on the holster.\u201d',
    ],
  },
  others: {
    headline: ['Unholy Alliance', (c) => `${c.A.armyBare} and ${c.B.armyBare} Plot Together`, 'Enemies Join Hands'],
    deck: ['Enemy powers sign a pact of convenience \u2014 the Clarion warns its readers', (c) => `What are ${c.A.army} and ${c.B.army} hiding?`],
    body: [
      (c) => `GENEVA, ${c.mday} \u2014 Two of our enemies have found each other. ${c.A.Army} and ${c.B.army} have signed a so-called pact of non-aggression.`,
      'Our diplomatic correspondent gives the arrangement weeks, not months. Thieves, he notes, rarely trust one another for long.',
      (c) => `${c.U.Army} is watching closely.`,
    ],
  },
};

export const BETRAYAL = {
  // vi bröt pakten – enligt vår tidning förekom vi bara ett svek
  ours: {
    headline: ['Pre-emptive Action Forestalls Treachery', (c) => `Our Forces Strike First ${c.T.place}`, 'Enemy Plot Foiled'],
    deck: [
      (c) => `Intelligence revealed that ${c.V.army} was preparing to break the pact \u2014 our boys acted first`,
      (c) => (c.conquered ? `${c.T.Ref} secured before the enemy could strike` : 'A timely blow against a faithless partner'),
    ],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} \u2014 Acting on information of the gravest kind, ${c.U.army} has moved against ${c.V.army} ${c.T.place}, forestalling an attack that our intelligence service describes as \u201cimminent and dastardly.\u201d`,
      (c) => (c.conquered ? `${c.T.Ref} is now safely in our hands.` : 'Our forces have taken up strong positions and await developments.'),
      'The so-called pact, which the enemy never intended to honor, is regrettably at an end.',
    ],
  },
  // de svek oss
  lost: {
    headline: ['Infamy!', (c) => `Stabbed in the Back ${c.T.place}`, (c) => `${c.P.armyBare} Treachery`],
    deck: [(c) => `${c.P.Army} breaks its sacred word \u2014 the nation will remember`, (c) => `A pact signed in good faith, betrayed after ${c.held <= 1 ? 'barely a month' : `${words(c.held)} months`}`],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} \u2014 In an act of infamy without parallel, ${c.P.army} has attacked our forces ${c.T.place} in violation of its solemn pact with ${c.U.army}.`,
      (c) => (c.conquered ? `Our gallant defenders of ${c.T.ref}, who had trusted the treaty, have withdrawn under fire.` : 'Our forces, though taken by surprise, are holding firm.'),
      (c) => `${c.P.Army} has shown the world what its word is worth.`,
    ],
  },
  // fiender emellan
  others: {
    headline: ['Thieves Fall Out', (c) => `Enemy Alliance Collapses ${c.T.place}`],
    deck: [(c) => `${c.P.Army} turns on its partner \u2014 exactly as our leaders predicted`],
    body: [
      (c) => `${c.T.CITY}, ${c.mday} \u2014 The unholy alliance between ${c.P.army} and ${c.V.army} is over. ${c.P.Army} attacked its partner ${c.T.place}.`,
      (c) => `${c.U.Army} notes the development with quiet satisfaction.`,
    ],
  },
};

export const DIPLO_WIRE = {
  declined: {
    ours: (c) => `GENEVA \u2014 ${c.B.Army} has rejected our generous offer of peace. History will judge.`,
    lost: (c) => `GENEVA \u2014 Our government has rejected an insolent proposal from ${c.A.army}.`,
    others: (c) => `GENEVA \u2014 Enemy diplomacy fails: ${c.B.army} snubs ${c.A.army}.`,
  },
  expired: {
    ours: (c) => `GENEVA \u2014 Our treaty with ${c.O.army} has run its course. Our forces stand ready.`,
    others: (c) => `GENEVA \u2014 The enemy pact between ${c.A.army} and ${c.B.army} has lapsed, to no one\u2019s surprise.`,
  },
};
