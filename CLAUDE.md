# Theatre of War (repo: RISK)

Animerat Risk på ett krigsrumsbord ca 1952: tennsoldater på en tryckt världskarta, radio och tv vid bordet (kameran åker
fram), kvällstidningar som snurrar in. All spelartext på engelska; kod, kommentarer och dokument på svenska.
**CONTRACT.md är bibeln** för gränssnitten (id:n, händelser, nodnamn). Idéer och beslut: `vault/Home.md` (gitignorerad).
Skärmdumpar till användaren: `progress/` med datumprefix (`node tools/shot.mjs … --progress namn`).

## Kör

```bash
npm install
npm run dev            # http://localhost:8260  (?mode=watch|play &pace=film|brisk|dispatch|headlines &seed=N &players=N &faction=blue &quality=low)
npm run server         # onlineservern (WebSocket :8261, Vite proxar /ws)
npm test               # node --test 'test/*.test.mjs'  (OBS: `node --test test/` kraschar i Node 25)
npm run map            # bygger public/map/world.json ur Natural Earth
npm run assets         # Blender -> public/models (tools/build_assets.sh)
node tools/shot.mjs URL ut.png [--w 390 --h 844 --dpr 2] [--wait ms] [--eval js] [--frames N --every ms] [--progress namn]
```

Konsolen: `window.TW` (world, board, rig, fx, hud, director, ui, props, dice, press, audio, game, speed).
`TW.director.setPace('headlines')`, `TW.press.enabled.paper = false`, `TW.game.stop()`.

## Delarna

- `shared/` – ren JS, delas av klient, server och test: `map.js` (42 territorier, grannar, kort), `factions.js`,
  `engine.js` (regler: `newGame` -> `{state, events}`, `apply(state, action)` -> `{state, events}`, kastar vid otillåtet drag,
  seedad slump i `state.rng`), `ai.js` (generalerna: `heuristic(state)` = regelbaserad policy; `decide(state)` = Monte Carlo-
  framåtblick vid förstärkning och anfall: de bästa alternativen + "sluta" spelas framåt med olika tärningar till generalens
  nästa tur och slutlägena värderas med `evaluate`; deterministisk, ~30 ms/beslut; `decide(s, { think: false })` = snabbt.
  I webbläsaren körs den i `src/aiworker.js`. Turnering 16 partier: tänkande 15 – regelbaserade 1), `rng.js`.
- `src/world.js` – renderare, ljus (taklampa, fönster, motljus), bord, efterbehandling (N8AO, skärpedjup, bloom, AgX, korn).
- `src/mapcanvas.js` – den tryckta kartan som canvastextur (8192 px; mobil 4096). `src/board.js` – laveringen per territorium
  (shader, multiplicerad över papperet; erövring flyter ut från anfallspunkten; markeringar: streck/korsstreck), garnisoner
  (artilleri 10, stridsvagn 5, infanteri 1) och flaggor (växer med kameraavståndet, vrids och lutar mot kameran).
- `src/director.js` – regin: händelser -> scener. Eget visat läge (`view`), strider rangordnas (`importance`), filmbehandling
  för viktiga och mänskliga strider, expeditioner som marscherar/seglar (`Expedition`), `pending` håller en erövring tills
  occupy-draget kommer. Tempo i `PACE`.
- `src/dice.js` – riktiga tärningar (cannon-es): kastet simuleras först, sedan vrids sidorna så att motorns värde hamnar uppåt.
  Sidmappning +Y=1, −Y=6, +X=3, −X=4, +Z=2, −Z=5.
- `src/broadcast.js` – sändningen: tidning (halvtonsfoto = rendering av striden), journalfilm på tv:n (kort + Flow-klipp +
  direktbild från bordet), radio (kameran till radion, skalan, remsan, röst). `src/press/` = redaktionen (pressgaffelns kod).
- `src/props.js` – tv (rutans shader, CRT-uppvärmning, direktsändning till `footCanvas`), radio (skala, nål, magiskt öga),
  lampa med ljus, askkopp som ryker. `src/camera.js` – flygningar med jobbtoken, strid, rekvisita, stående översikt.
- `src/game.js` – lokalt parti, sparas som frö + draglogg i localStorage (`tow.lastGame`). `src/ui.js` – spelarens klick/panel.
- `src/audio.js` – syntetiska effekter (WebAudio), röstuppspelning med radiofilter (`speak`), loopar (`static`, `projector`).

## Kartan (tools/build_map.mjs)

Natural Earth 10m admin-1 + sjöar + 50m floder i `assets/src/ne/` (gitignorerat; hämta med
`curl -sSL -o admin1.zip https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip` m.fl.).
Varje provins-polygondel klassas till ett territorium (`classify`, landskoder + specialfall för USA, Kanada, Ryssland,
Kina, Australien, Indonesien, Malaysia, Kazakstan, Frankrike), mapshaper löser upp per territorium, d3 projicerar (Miller,
mitt 11° Ö), Europalinsen förstorar mjukt (monoton radiell förvrängning), mapshaper förenklar plant och ger kust/gränser/
kontinentgränser. Grannpar utan gemensam gräns blir sjövägar (närmaste punkter); Alaska–Kamtjatka går runt kartkanten.
`node tools/preview_map.mjs` ritar en kontrollbild.

## Fällor (upplevda)

- d3 vill ha **medurs** yttre ringar; mapshaper skriver moturs (RFC 7946). Fel varv = "hela jorden utom formen" (alla
  territorier blev kartans rektangel). `rewind()` i build_map.
- mapshaper tror att små koordinater är grader: projicerade koordinater skalas ×1000 under förenklingen.
- Papperskantens låda låg 0,1 mm under kartan -> z-fighting i band på avstånd. Håll ≥ 4 mm.
- glTF har UV-origo upptill: CanvasTexture på en glTF-mesh (flaggduken, tv-rutan, radioskalan) ska ha `flipY = false`.
- Modellerna har bakad AO i vertexfärgen: spelets ersättningsmaterial måste ha `vertexColors` (annars försvinner AO:n);
  ersättare utan COLOR_0 får inte ha det (blir svarta).
- Nya ljuskällor tvingar omkompilering av alla shaders: effektljusen ligger i en fast pool (`fx.lights`).
- Kameraflygningar har jobbtoken; användaren som drar i kameran avbryter flygningen.
- Syntetiska pekarhändelser i test ger "setPointerCapture"-fel från OrbitControls (ofarligt).
- Tärningarnas osynliga väggar: kasten måste starta innanför dem, annars studsar tärningarna iväg.

## Driftsättning

**LIVE: https://theatreofwar.bjarby.com** — `npm run deploy` (`tools/deploy.sh`): Vultr-boxen 70.34.220.159 (delas med
audioworld, geo, torget, mayhem), Caddy framför (automatisk HTTPS, blocket läggs till i `/etc/caddy/Caddyfile` en gång),
statiska filer i `/opt/theatre-of-war/dist`, onlineservern som systemd-tjänsten `theatre-of-war` (användare `theatre`,
port 8263, SQLite i `/var/lib/theatre-of-war/theatre.db`, AI_DELAY_MS 900, MemoryMax 400M). DNS: A-post `theatreofwar`
hos one.com (Domän → DNS-inställningar → DNS-post → A). Boxen har Node 22.22 (node:sqlite utan flagga).
Prova online mot den skarpa servern: `node build/online_e2e_live.mjs` (två webbläsare, ändra URL i skriptet).

## Kostnader (fråga först)

ElevenLabs (eleven_v4; nyckeln i ~/.zprofile utan export: `zsh -c 'source ~/.zprofile; export ELEVENLABS_API_KEY; …'`),
Google Flow (journalfilmsklipp), Suno (via officiella UI:t; nedladdning kostar kredit). Generera aldrig om utan ok.
