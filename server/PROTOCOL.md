# Theatre of War online — protokoll (kontrakt mellan server och klient)

WebSocket på `/ws` (dev: Vite proxar `/ws` → `ws://localhost:8261`). Alla meddelanden är JSON med fältet `t`, högst 16 KB
(större stänger förbindelsen med kod 1009). GET `/health` ger `{ ok, games, sockets }`.
Servern är auktoritativ: den kör `shared/engine.js` och `shared/ai.js`, äger tärningarna och godkänner varje drag.
Klientbiblioteket är `src/online.js`.

Starta: `npm run server` (`PORT`=8261, `DB`=`server/data/theatre.db`, `AI_DELAY_MS`=400 mellan AI-drag, `TRUST_PROXY`=1 bakom
Caddy/nginx så att hastighetsgränsen läser `X-Forwarded-For`).

## Begrepp
- **spelare**: anonym identitet `{ id, name }` med en hemlig **token** (skickas bara en gång, i `welcome`, när spelaren skapas).
  Klienten sparar `{ token, name, id }` i `localStorage['tow.identity']`. Servern lagrar bara tokenens SHA-256.
- **code**: inbjudningskod, 6 tecken ur `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Skiftlägesokänslig.
  Länkar: `https://<värd>/?join=KOD` (spela), `https://<värd>/?watch=KOD` (titta).
- **seat**: plats 0–5 i partiet, = spelarindex i motorns `state.players`. En plats har `faction`, `kind` (`human`|`ai`), `ai`
  (stil: `aggressive`|`strategist`|`cautious`) och ev. en spelare. En spelare har högst en plats per parti.
- **värd** (host): den som skapade partiet. Startar kriget och kan lämna över platser till AI:n.
- **seq**: antal godkända drag i partiet (0 vid start). Varje `events` har nästa seq. Drag skickas med det seq klienten har sett;
  stämmer det inte avvisas draget (skydd mot dubbletter och mot drag på inaktuellt läge).
- **åskådare**: följer ett parti utan plats (högst 50 per parti). En spelare som tittar på ett parti där hen har plats räknas som spelare.

## Tillståndet klienten ser (`state`)
Motorns state (se CONTRACT.md) med tre skillnader: `rng` och `seed` saknas (tärningarna ska inte gå att förutsäga), `deck` är
ersatt av `deckSize`, och andra spelares kort är `null` (antalet syns, inte vilka). Den egna platsens kort är kortindex.
Klienten ska alltså **inte** köra `apply` själv på serverns state; den visar det och animerar `events`. `decide` (ai.js) fungerar
på den offentliga vyn, så "låt generalerna föreslå"-hjälp kan köras i klienten.

## Klient → server
Alla får `rid` (tal eller kort sträng); svaret på just den förfrågan bär samma `rid`. Allt utom `hello` och `ping` kräver `hello` först.

| t | fält | svar |
|---|---|---|
| `hello` | `token?`, `name?` (≤ 24 tecken) | `welcome`. Okänd/saknad token = ny spelare (med `token` i svaret). `name` byter namn. |
| `create` | `seats: [{kind, faction, ai?}]` (2–6, unika fraktioner), `seat?` (platsen värden tar; standard första människoplatsen; `null` = bara titta), `options?: {victory}` (`'world'` eller 10–42 territorier) | `created` (som `game`) |
| `join` | `code`, `seat?` | `game`. Tar en ledig människoplats i lobbyn. Har man redan plats: samma som `open`. |
| `open` | `code` | `game`. Följ ett parti (efter omladdning/återanslutning). Utan plats = åskådare. |
| `watch` | `code` | `game` utan plats, som åskådare. |
| `leave` | `code` | `left`. I lobbyn lämnas platsen; i ett pågående parti behålls den (man slutar bara följa). |
| `start` | `code` | alla får `start`. Bara värden, bara i lobbyn. Tomma människoplatser blir AI. |
| `act` | `code`, `seq`, `action` | alla får `events`; avsändaren får `reject` om draget inte godkänns. `action` enligt CONTRACT.md (`trade`, `place`, `attack`, `blitz`, `occupy`, `endAttack`, `fortify`, `endTurn`); okända fält tas bort. |
| `handover` | `code`, `seat` | alla får `seats`. Platsen spelas av AI:n ("hand over to the generals"). Värden för vilken plats som helst, annars bara sin egen. Spelaren behåller platsen. |
| `reclaim` | `code` | alla får `seats`. Ta tillbaka befälet över sin överlämnade plats. |
| `list` | – | `lobby` |
| `history` | `code`, `from`, `to?` | `history`: dragen `from < seq ≤ to` (högst 500 per förfrågan) |
| `ping` | – | `pong` (klienten skickar var 20:e s) |

## Server → klient
| t | fält | betydelse |
|---|---|---|
| `welcome` | `player: {id, name}`, `token?` | identiteten; `token` bara när spelaren skapades nu |
| `game` / `created` | `code`, `status` (`lobby`\|`active`\|`over`), `options`, `seq`, `you: {seat, host}`, `seats`, `state` (null i lobbyn), `startEvents` | hela partiet; skickas som svar på `create`/`join`/`open`/`watch` |
| `seats` | `code`, `seats: [{seat, faction, kind, ai, name, open, claimed, online}]` | platserna har ändrats (någon gick med/lämnade, kom/försvann, överlämning) |
| `start` | `code`, `seq: 0`, `events`, `state`, `seats` | kriget börjar. `events` = motorns första `turn` + `income` |
| `events` | `code`, `seq`, `by` (platsen som gjorde draget), `action`, `events`, `state` | ett godkänt drag (människa eller AI), till alla som följer partiet, även avsändaren. `victory` ligger bland `events` när kriget är slut |
| `reject` | `code`, `reason`, `seq`, `state` | draget godkändes inte; synka till `state`/`seq`. `reason`: `not-started`, `over`, `spectator`, `seq`, `not-your-turn`, `handed-over`, `bad-action`, motorns koder (`phase`, `not-yours`, `not-adjacent`, `own-territory`, `too-few`, `dice`, `count`, `no-path`, `not-a-set`, `must-trade`, `unknown-action`) eller `illegal` |
| `lobby` | `open: [summary]`, `mine: [summary]` | öppna partier (lobby med ledig plats) och mina (lobby/pågående + avslutade senaste veckan) |
| `history` | `code`, `from`, `to`, `moves: [{seq, by, action, events}]` | dragloggen, för att spela upp det man missat eller göra repris |
| `left` | `code` | |
| `error` | `code`, `message` (engelska, kan visas) | `hello-first`, `bad-request`, `no-such-game`, `game-full`, `started`, `not-host`, `not-in-game`, `room-full`, `rate-limited`, `server-error` |
| `pong` | – | |

`summary` = `{ code, status, round, seq, seats: [{faction, kind, name, open}], turn: {seat, faction} | null, you, host, yourTurn, winner }`.

## Regler på servern
- Ett drag godkänns bara om partiet pågår, avsändaren har en människoplats, det är den platsens tur, `seq` stämmer och motorn godkänner.
- AI-platser spelas av servern med `AI_DELAY_MS` mellan dragen. Är det en frånkopplad människas tur väntar partiet (långsamma
  partier över dagar är meningen); värden kan lämna över platsen, och spelaren kan ta tillbaka den med `reclaim`.
- Efter omstart laddas alla pågående partier och AI-turerna fortsätter där de var.
- Hastighet: högst 20 meddelanden/s i snitt per förbindelse (skurar till 40), högst 10 nya partier per IP och minut.

## Lagring (SQLite, `server/db.js`)
`players(id, name, token_hash, created, seen)`, `games(id, code, status, host, options, seed, state, start_events, seq, created,
updated)`, `seats(game_id, seat, player, faction, kind, ai, name)`, `actions(game_id, seq, seat, action, events, ts)` (append-only),
`stories(id, game_id, seq, story, created)` (plats för pressens reportage till klippboken; inget protokoll än).
Ett parti kan alltid räknas om ur `seed` + `actions` (`Games.replay(code)`); `games.state` är bara en ögonblicksbild.
