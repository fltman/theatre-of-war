// Startpunkt: världen, kartbordet, figurerna, regin och menyn.
// URL: ?mode=watch|play  &pace=film|brisk|dispatch|headlines  &seed=N  &players=4  &faction=blue
import * as THREE from 'three';
import { World } from './world.js';
import { Board } from './board.js';
import { loadUnits } from './units.js';
import { loadFonts } from './mapcanvas.js';
import { bindWorld, speed } from './anim.js';
import { CameraRig } from './camera.js';
import { FX } from './fx.js';
import { HUD } from './hud.js';
import { Director, PACE } from './director.js';
import { UI } from './ui.js';
import { LocalGame } from './game.js';
import { FACTIONS, FACTION } from '../shared/factions.js';
import { TERRITORY } from '../shared/map.js';
import { Props } from './props.js';
import { Dice } from './dice.js';
import { Broadcast } from './broadcast.js';
import { Audio } from './audio.js';
import { Annotations } from './annotations.js';
import { Music } from './music.js';
import { Attract } from './attract.js';
import { agePaper } from './paper.js';
agePaper();
import { LobbyUI, OnlineGame } from './lobby.js';

const params = new URLSearchParams(location.search);
const world = new World(document.getElementById('scene'));
bindWorld(world);

const [data] = await Promise.all([
  fetch(new URL('map/world.json', document.baseURI)).then((r) => r.json()),
  loadFonts(),
  loadUnits(),
]);
const board = new Board(world, data);
board.build();
const rig = new CameraRig(world);
const fx = new FX(world);
const hud = new HUD(document.getElementById('hud'));
const audio = new Audio();
const music = new Music(audio);
const props = new Props(world, fx);
props.audio = audio;
const dice = new Dice(world, fx, audio);
await Promise.all([props.load(), dice.load()]);
const press = new Broadcast({ world, board, rig, props, hud, data, audio, music });
await press.load();
if (params.get('press') === '0') press.enabled = { paper: false, tv: false, radio: false };
const notes = new Annotations(world, board);
const attract = new Attract({ world, rig, props, press, root: document.getElementById('overlay') });
const director = new Director({ world, board, rig, fx, hud, dice, press, audio, notes, props });
const ui = new UI({ world, board, hud, director });
world.start();

// ---------------------------------------------------------------- tempo

const PACE_LABEL = { film: 'Film', brisk: 'Brisk', dispatch: 'Dispatch', headlines: 'Headlines only' };
function speedButtons() {
  hud.speedBox.replaceChildren();
  for (const k of Object.keys(PACE)) {
    const b = document.createElement('button');
    b.textContent = PACE_LABEL[k];
    b.className = director.paceName === k ? 'on' : '';
    b.onclick = () => { director.setPace(k); speedButtons(); };
    hud.speedBox.append(b);
  }
  const mute = document.createElement('button');
  mute.textContent = audio.muted ? 'Sound off' : 'Sound on';
  mute.onclick = () => { audio.setMuted(!audio.muted); speedButtons(); };
  hud.speedBox.append(mute);
  const skip = document.createElement('button');
  skip.textContent = 'Skip ▸▸';
  skip.onclick = () => director.skip();
  hud.speedBox.append(skip);
}
window.addEventListener('keydown', (e) => { if (e.key === ' ' && e.target === document.body) { e.preventDefault(); director.skip(); } });

// ---------------------------------------------------------------- meny

const STYLES = ['aggressive', 'strategist', 'cautious'];
let game = null;

function leaveMenu() {
  attract.stop();
  document.body.classList.remove('in-menu');
}

function startGame(config) {
  leaveMenu();
  game?.stop();
  document.querySelector('.menu')?.remove();
  director.setPace(config.pace ?? 'brisk');
  speedButtons();
  music.mode('war');
  game = new LocalGame({ director, ui, hud });
  game.onEnd = (st) => armistice(st, config);
  // ny redaktion för varje krig; med exakt en människa vid bordet läser vi den sidans tidning
  const pl = config.players ?? config.resume?.config.players ?? [];
  const humans = pl.map((p, i) => (p.kind === 'human' ? i : -1)).filter((i) => i >= 0);
  press.newWar(humans.length === 1 ? humans[0] : null);
  if (config.resume) game.resume(config.resume);
  else game.start(config);
  window.TW.game = game;
}

function players(n, human = null) {
  const order = FACTIONS.map((f) => f.id);
  if (human) order.splice(order.indexOf(human), 1), order.unshift(human);
  return order.slice(0, n).map((f, i) => ({
    faction: f, name: FACTION[f].name,
    kind: human && i === 0 ? 'human' : 'ai', ai: STYLES[i % 3],
  }));
}

function menu() {
  music.mode('menu');
  document.body.classList.add('in-menu');
  attract.start();
  const saved = LocalGame.saved();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = `
    <div class="sheet"><div class="dossier">
      <div class="stamp-big">TOP SECRET</div>
      <h1>Theatre of War</h1>
      <p class="sub">The world at war · 1952</p>
      <div class="choices">
        <button data-a="watch" class="primary">Watch the war</button>
        <button data-a="play">Take command</button>
        ${saved ? '<button data-a="continue">Continue last war</button>' : ''}
        <button data-a="online">War by wire (online)</button>
      </div>
      <div class="opts">
        <label>Your colours <span class="factions">${FACTIONS.map((f, i) => `<button class="chipbtn ${i === 1 ? 'on' : ''}" data-f="${f.id}" style="--c:${f.paint}" title="${f.name}"></button>`).join('')}</span></label>
        <label>Powers at war <select data-o="n">${[2, 3, 4, 5, 6].map((n) => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
    </div></div>`;
  document.getElementById('overlay').append(m);
  let faction = 'blue';
  m.querySelectorAll('.chipbtn').forEach((b) => (b.onclick = () => { m.querySelectorAll('.chipbtn').forEach((x) => x.classList.remove('on')); b.classList.add('on'); faction = b.dataset.f; }));
  const n = () => +m.querySelector('[data-o=n]').value;
  m.querySelector('[data-a=watch]').onclick = () => startGame({ players: players(Math.max(3, n())), pace: 'film' });
  m.querySelector('[data-a=play]').onclick = () => startGame({ players: players(n(), faction), pace: 'brisk' });
  m.querySelector('[data-a=online]').onclick = () => lobby.home();
  const c = m.querySelector('[data-a=continue]');
  if (c) c.onclick = () => startGame({ resume: saved, pace: 'brisk' });
}

// Vapenstilleståndet: segraren, krigets längd, statistik, nytt krig.
function armistice(state, config) {
  music.mode('victory');
  const w = state.players[state.winner];
  const st = director.stats ?? {};
  const months = state.round;
  const where = st.biggest ? TERRITORY[st.biggest.at].name : '—';
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = `
    <div class="sheet"><div class="dossier">
      <div class="stamp-big">ARMISTICE</div>
      <h1>The War Is Over</h1>
      <p class="sub"><span class="chip" style="--c:${FACTION[w.faction].paint}"></span> ${w.name} is master of the world</p>
      <div class="opts">
        <label>Months of war <b>${months}</b></label>
        <label>Engagements fought <b>${st.battles ?? '—'}</b></label>
        <label>Territories changed hands <b>${st.conquests ?? '—'}</b></label>
        <label>Bloodiest battle <b>${where}${st.biggest ? `, ${st.biggest.losses} divisions lost` : ''}</b></label>
      </div>
      <div class="choices" style="margin-top:20px">
        ${press.scrapbook?.length ? `<button data-a="book" class="primary">The war in headlines (${press.scrapbook.length})</button>` : ''}
        ${config ? '<button data-a="again">Another war</button>' : ''}
        <button data-a="menu">Main menu</button>
      </div>
    </div></div>`;
  setTimeout(() => document.getElementById('overlay').append(m), 4000);
  m.querySelector('[data-a=again]')?.addEventListener('click', () => { const c = { ...config }; delete c.seed; delete c.resume; startGame(c); });
  m.querySelector('[data-a=book]')?.addEventListener('click', async () => { m.style.display = 'none'; await press.showScrapbook(document.getElementById('overlay'), `The War of ${months} Months`); m.style.display = ''; });
  m.querySelector('[data-a=menu]').onclick = () => { m.remove(); menu(); };
}

// ---------------------------------------------------------------- online

const lobby = new LobbyUI({ root: document.getElementById('overlay'), startOnline, back: () => { document.querySelector('.menu')?.remove(); menu(); } });
function startOnline(net, g) {
  leaveMenu();
  game?.stop();
  director.setPace('brisk');
  speedButtons();
  hud.wire?.(g.code);
  press.newWar(g.you?.seat ?? null);
  music.mode('war');
  game = new OnlineGame({ director, ui, hud, net, onEnd: (st) => armistice(st, null) });
  game.begin(g);
  window.TW.game = game;
}

window.TW = { world, board, rig, fx, hud, director, ui, props, dice, press, audio, music, notes, THREE, speed };

const mode = params.get('mode');
if (params.get('join')) lobby.join(params.get('join'));
else if (params.get('watch')) lobby.watch(params.get('watch'));
else if (mode) {
  const n = +(params.get('players') ?? (mode === 'watch' ? 6 : 4));
  startGame({ players: players(n, mode === 'play' ? params.get('faction') ?? 'blue' : null), pace: params.get('pace') ?? (mode === 'watch' ? 'film' : 'brisk'), seed: params.has('seed') ? +params.get('seed') : undefined });
} else {
  // bordet uppställt bakom menyn
  menu();
}
