# Theatre of War

[![Support me on Patreon](https://img.shields.io/badge/Patreon-Support%20my%20work-FF424D?style=flat&logo=patreon&logoColor=white)](https://www.patreon.com/AndersBjarby)

An animated world-conquest board game on a 1952 war-room table. Painted tin soldiers march and sail across a printed
map, real dice roll beside the front, a croupier's rake sweeps them away — and between the battles the radio crackles,
the television runs a newsreel and the evening paper spins in: **GERMANY HAS FALLEN — YELLOW MASTER ONCE MORE.**

- Watch the generals fight it out, take command yourself, or play friends over the wire.
- Three.js on the table; every model built in Blender with Python.
- A newsroom that writes its own headlines — each side reads its own propaganda.
- A shared rules engine runs in the browser and on the authoritative server (SQLite, move logs, slow games over days).

```bash
npm install
npm run dev      # http://localhost:8260
npm run server   # online play (WebSocket :8261)
npm test
```

## Licence

- **Code:** [MIT](LICENSE).
- **Game media** — models, textures, map artwork, voices, music, newsreel clips and the newsroom's copy:
  [CC BY-NC 4.0](LICENSE-ASSETS.md) — non-commercial use with credit ("Theatre of War by Anders Bjarby").
- **Third-party:** map data from Natural Earth (public domain), source textures from Poly Haven (CC0), fonts under
  their own licences in `public/fonts/`.
- Voices made with ElevenLabs, music with Suno, newsreel footage with Google Flow (Veo).

Theatre of War is an independent game and is not affiliated with Hasbro, Inc. "RISK" is a trademark of Hasbro, Inc.
