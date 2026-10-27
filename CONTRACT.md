# CONTRACT.md — gränssnitten mellan delarna (bibeln)

Arbetsnamn: **Theatre of War** (tidigare Världsläget). Ett animerat världskrigsspel (klassisk Risk-topologi) på ett krigsrumsbord ca 1952:
tennsoldater på en tryckt världskarta, en radio och en tv som står vid bordet (kameran åker fram till dem),
och kvällstidningar som snurrar in med rubriker som "GERMANY HAS FALLEN — YELLOW MASTER ONCE MORE".
**All text som spelaren ser är på engelska** (tidig 50-talsstil). Kod, kommentarer och dokumentation får vara på svenska. Utseendet (palett, typsnitt) får ändras; id:n, händelser och nodnamn nedan är kontrakt.

## Kataloger

| sökväg | innehåll | ägare |
|---|---|---|
| `shared/` | ren JS utan DOM: `map.js` (territorier, grannar, kontinenter, kort), `factions.js`, `engine.js` (regler), `ai.js`, `rng.js` | motor |
| `server/` | onlineservern (WebSocket, rum, servern kör motorn auktoritativt) | motor |
| `src/` | klienten (Vite + three r186): scen, regi, kamera, ljud, UI | scen |
| `src/press/` | nyhetsredaktionen: rubriker/radiomanus/journalfilmskort ur händelser + tidningen som DOM | press |
| `blender/` | Python-modeller (headless Blender 5.2) | modeller |
| `public/models/` | färdiga `.glb` (efter `tools/optimize.mjs`) | modeller |
| `public/map/world.json` | projicerad kartgeometri (`tools/build_map.mjs`) | scen |
| `test/` | `node --test` | alla |

Ändra inte en annan ägares filer; behövs en ändring, skriv den under "Önskemål" sist i den här filen.

## Världen (three.js)

- 1 enhet = 1 dm på bordet. Y upp. Kartan ligger i XZ-planet på y = 0, centrerad i origo, **norr = −Z**, öster = +X.
- Kartan: Millerprojektion, latitud −56…84, centrerad på 11° Ö (Alaska vid vänsterkanten, Tjuktjerhalvön vid högerkanten).
  Bredd 24 enheter, höjd ≈ 11,8.
- Bordet (trä) är ca 36 × 24 enheter, ovansidan på y = −0,01. Radion och tv:n står på bordet bakom kartans övre hörn.
- Modeller: Blender-meter = three-enheter. Origo mitt under föremålet (står på y = 0). Föremålen tittar mot **+Z** i three
  (= −Y i Blender; glTF-exporten vänder). Vänster sida = +X i Blender.

## Modeller (`public/models/*.glb`)

Spelet byter material efter **namn**: `Paint` får fraktionens färg; övriga får spelets egna material (namnen är kontrakt).
Gemensamma materialnamn: `Paint` (fraktionsfärg), `Metal` (gunmetal/tenn), `Brass`, `Skin`, `Leather`, `Dark`, `Base`
(figurfotens jordfärg), `Wood`, `Bakelite`, `Glass`.

| fil | storlek (ca) | noder (namn är kontrakt) | särskilt |
|---|---|---|---|
| `infantry.glb` | höjd 0,26, fot Ø 0,10 | – | tennsoldat på rund fot, gevär på axeln. Stel figur (leksaksrörelse i spelet). ≤ 1,5k tris |
| `tank.glb` | l 0,32, b 0,17, h 0,14 | `hull`, `turret` (pivot = tornringens mitt), `barrel` (barn till `turret`, pivot i manteln, pekar +Z), `tracks` | material `Tread` med UV där **V löper längs bandet** (spelet rullar V). ≤ 2,5k tris |
| `artillery.glb` | l 0,30 | `carriage`, `barrel` (pivot i tappen, pekar +Z) | fältkanon med sköld. ≤ 2k tris |
| `ship.glb` | l 0,70 | `hull`, `funnel`, tom nod `smoke` (skorstenens topp) | trupptransport; `Paint` på skorstensbandet. ≤ 4k tris |
| `flag.glb` | nål 0,35 | `pin`, `flag` | material `FlagPaper`: UV 0…1 över flaggans framsida (u höger, v upp); spelet ritar siffra + färg |
| `radio.glb` | b 4,2, h 2,8, dj 1,8 | `dial` (mesh, material `DialGlass`, UV 0…1 över skalan, u höger, v upp), `needle` (rör sig längs X), `knob_l`, `knob_r`, tom nod `cam` (bra kameraplats framför skalan) | skandinavisk 50-talsradio i trä/bakelit, tygklädd högtalare (`Grille`) |
| `tv.glb` | b 5,5, h 5,0, dj 4,5 | `screen` (mesh, material `Screen`, UV 0…1 över bildytan, u höger, v upp, lätt välvd), `knob_*`, tom nod `cam` | 50-talets tv i träkabinett, rundad bildruta 4:3 |
| `props.glb` | – | `lamp` (+ tom nod `bulb`), `ashtray` (+ tom nod `smoke`), `phone`, `cup`, `rake` (krupiärräfsa), `inkwell` | stämning runt kartan; varje rekvisita som egen rotnod, origo under sig själv |

UV:er som spelet ritar på (`Screen`, `DialGlass`, `FlagPaper`, `Tread`) måste överleva exporten: Blenders glTF-export skriver
bara UV:er som en textur använder, ge materialet en dummybild (`tools/optimize.mjs` tar bort bilderna men behåller UV:erna).
Förhandsbilder: `build/previews/<namn>.png`.
glTF har UV-origo **upptill** (Blender-exporten vänder v): CanvasTexture på en glTF-mesh ska ha `flipY = false`.

## Spelmotorn (`shared/engine.js`)

Ren, deterministisk (seedad RNG i tillståndet), JSON-serialiserbar. Samma kod i webbläsaren och på servern.

```js
import { newGame, apply, income, canTrade } from '../shared/engine.js';
let state = newGame({ seed, players: [{ faction: 'yellow', name: 'Yellow', kind: 'ai', ai: 'aggressive' }, ...],
                      setup: 'random' });           // 'random': territorier delas ut och arméer placeras automatiskt
const { state: next, events } = apply(state, action); // kastar Error vid otillåtet drag
```

Tillstånd: `{ seed, rng, players: [{ faction, name, kind: 'human'|'ai', ai, alive, cards: [kortindex] }],
owner: { [territorium]: spelarindex }, armies: { [territorium]: n }, turn, round, phase, pending, conquered,
occupy: { from, to, min, max } | null, deck, discard, trades, winner }`.
Faser: `reinforce` → `attack` (↔ `occupy`) → `fortify` → nästa spelare. `over` när någon äger allt.

Diplomati: `propose {partner, months: 3|6}` (den som har turen, i förstärkning eller anfall, ett samtal per månad) och
`answer {accept}` (från mottagaren – `actor(state)` säger vem som ska agera: mottagaren av ett obesvarat förslag,
annars den som har turen). Pakter i `state.pacts: [{a, b, made, until}]` (gäller t.o.m. runda `until`), förslaget i
`state.proposal`. Anfall mot en partner är tillåtet men är svek: pakten bryts och `players[p].betrayals` räknas upp.

Drag (`action.type`): `trade {cards: [i,j,k]}`, `place {territory, n}`, `attack {from, to, dice}` (ett kast),
`blitz {from, to, stopAt?}` (kastar tills erövrat eller angriparen har ≤ stopAt, standard 1), `occupy {n}`,
`endAttack`, `fortify {from, to, n}` (avslutar turen), `endTurn`.

Händelser (i ordning; spelare = index):

| type | fält |
|---|---|
| `turn` | `player`, `round` |
| `income` | `player`, `total`, `territories` (antal), `continents: [{id, bonus}]` |
| `trade` | `player`, `cards: [{territory, symbol}]`, `value`, `bonus: [territorium]` (+2 vardera) |
| `place` | `player`, `territory`, `n` |
| `battle` | `player`, `defender`, `from`, `to`, `dice: {a: [..], d: [..]}` (sjunkande), `losses: {a, d}`, `armies: {from, to}` (efter kastet) |
| `conquer` | `player`, `defender`, `from`, `to` |
| `occupy` | `player`, `from`, `to`, `n` |
| `continent` | `continent`, `player`, `gained` (true = tog den, false = förlorade den), `by` (vid förlust) |
| `eliminated` | `player`, `by`, `cards` (antal övertagna) |
| `card` | `player` (fick ett kort efter en tur med erövring) |
| `fortify` | `player`, `from`, `to`, `n`, `path: [territorium]` |
| `victory` | `player`, `round` |
| `proposal` | `from`, `to`, `months` (telefonsamtal med paktförslag) |
| `pact` | `a`, `b`, `months`, `until` |
| `declined` | `from`, `to`, `months` |
| `betrayal` | `player`, `victim`, `made` (före slagets `battle`) |
| `pactExpired` | `a`, `b` (vid månadsskiftet) |

`round` börjar på 1 och ökar när turen går tillbaka till första levande spelaren. Pressen räknar 1 runda = 1 månad från
April 1952.

## Pressen (`src/press/`)

```js
import { Newsdesk } from './press/newsdesk.js';      // ren, utan DOM, testbar i node
const desk = new Newsdesk({ players, seed, perspective });  // perspective: spelarindex (propaganda) eller null (neutral)
const stories = desk.feed(events, state);            // nya reportage (kan vara tom lista); desk.flush(state) vid slutet
```

Ett reportage: `{ id, kind, medium: 'paper'|'radio'|'tv', priority (0–100), round, date, focus: { territories: [mål, ursprung],
players: [angripare, försvarare] }, perspective, relation, paper?, radio?, tv? }`

- `paper`: `{ masthead, edition, price, headline, deck, kicker?, body, photoCaption, columns, ads, motto, number, dateline, accent? }`
  — vinklad efter `perspective` (siffror och ägare alltid sanna).
- `radio`: `{ station, lines: [{ id, speaker: 'announcer'|'reporter', text }] }` — bara repliker ur frasboken (röstade).
- `tv`: `{ title, subtitle?, clipTags: [terräng, …], cards: [{ kind: 'countdown'|'title'|'text'|'map'|'footage', text, duration, line? }],
  narration }` — varje kort utom ledaren har sin replik i `line` (`{ id, speaker: 'narrator', text }`).
- Frasboken `src/press/phrasebook.js`: id, röst, text; `voiceUrl(id)` → `audio/voice/<id>.mp3`. Inspelning: `tools/gen_voice.py`
  (eleven_v4) → `public/audio/voice/<id>.mp3` + `manifest.json` (`{ [id]: { file, seconds, speaker, hash } }`).
- Journalfilmsklipp: `public/reel/clips.json` = `[{ id, file ('reel/<id>.mp4'), seconds, tags }]` (Google Flow, svartvitt 4:3).

```js
showNewspaper(story, { photo, world, hold, signal })  // DOM-överlägg, snurrar in/ut; klick/mellanslag hoppar fram
renderPage(story, { photo, world, scale })             // statisk sida (klippboken)
showScrapbook(entries, { container, world, title })   // entries = scrapbookEntry(story, photoCanvas)
drawReelCard(ctx, card, t, { world, footage })         // journalfilmskort (4:3) på canvas; footage = video/canvas
showSubtitle(text, { speaker, style: 'radio'|'tv', station, duration })   // undertext; hideSubtitle()
```

`src/broadcast.js` visar reportagen: tidning (fotot = rendering av striden), radio (kameran till radion), tv (kameran till tv:n,
Flow-klipp + direktbild från bordet). Små radioinslag visas bara som remsa.

## Världshändelser (månadens händelse)

När en ny månad börjar (runda ≥ 2) drar motorn ur den seedade slumpen med ~55 % sannolikhet en händelse som gäller
hela månaden: `state.world = { id, round, continent?, player?, territory? }` och händelsen
`worldEvent { id, round, continent?, player?, territory? }` (före månadens första `turn`). `null` = ingen händelse.

| id | regel |
|---|---|
| `winter` | Hård vinter i öster: anfall MOT ural, siberia, yakutsk, irkutsk, kamchatka, mongolia slår högst 2 tärningar |
| `heat` | Hetta i Afrika: anfall mot Afrikas territorier slår högst 2 tärningar |
| `gales` | Storm till havs: inga anfall över sjövägar (`SEA_LANES` i map.js) denna månad |
| `harvest` | Rekordskörd i `continent`: +2 arméer till varje makt som äger minst ett territorium där |
| `strike` | Strejk i krigsindustrin hos `player` (den som äger flest territorier): −3 i inkomst (minst 3) |
| `oil` | Olja i `territory` (middle_east eller venezuela): ägaren får +4 |
| `volunteers` | Frivilliga strömmar till: alla får +2 |

`income()` tar med `world` i sin uppdelning (`{ total, territories, continents, world }`). `canAttack(st, from, to)` och
`maxDice(st, from, to)` i engine.js – AI och UI ska fråga dem.

## Krigsdimma

`newGame({ ..., fog: true })` → `state.fog = true`. Motorn räknar som vanligt; dimman är en VY: en spelare ser arméerna
i egna territorier, grannarna till egna, och pakt-partners territorier (`visibleTo(st, seat)` i engine.js). Ägaren
(färgen) syns överallt. Online redigerar servern `publicState` och händelserna per mottagare: dolda territoriers
`armies` blir `null`, och händelsernas antal (`place.n`, `battle.armies`, `occupy.n`, `fortify.n`) blir `null` när
mottagaren inte ser dem. Klienten visar `null` som "?".

## Generalerna (`src/generals.js`)

`GENERALS[faction] = { name, title, short, portrait: 'img/generals/<faction>.webp', bio, voice?, lines: { propose, accept,
decline, betray, betrayed, taunt, defeat, victory } }` – fiktiva fältmarskalkar, en per fraktion. Telefonkortet och
listan visar porträtt och namn.

## Online (`server/PROTOCOL.md`)

Servern är auktoritativ och kör `shared/engine.js` + `shared/ai.js` (AI-platser körs på servern). Klienterna skickar drag och
får händelser, som de animerar precis som i ett lokalt parti. Rum med 6-teckenskod, `?join=KOD`, återanslutning med token.

## Önskemål

(tom)
