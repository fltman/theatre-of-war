// Krigsmenyn (≡ uppe till vänster eller Esc): paus, kriget i rubriker (klippboken hittills), repris av senaste slaget,
// fotoläge, hur man spelar, ljud, online-val (överlämning m.m.) och tillbaka till huvudmenyn. Medan menyn är öppen står
// tiden still på bordet.
import { CONTINENTS } from '../shared/map.js';

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export class WarMenu {
  constructor({ root, hud, world, director, press, audio, photo, onMainMenu, onlineItems = () => [] }) {
    Object.assign(this, { root, hud, world, director, press, audio, photo, onMainMenu, onlineItems });
    this.button = el('<button class="war-menu-btn" title="Menu (Esc)">≡ Menu</button>');
    this.button.onclick = () => this.open();
    hud.root.append(this.button);
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.body.classList.contains('in-menu')) return;
      if (document.querySelector('.np-root, .sb-root, .phone-card, .photo-bar')) return;   // andra överlägg har egna Esc
      if (this.el) this.close(); else if (this.active) this.open();
    });
    this.active = false;
  }

  // Bara under ett pågående krig.
  setActive(on) { this.active = on; this.button.style.display = on ? '' : 'none'; if (!on) this.close(); }

  pause(on) {
    this.paused = on;
    this.world.timeScale = on ? 0 : 1;
  }

  open(page = 'main') {
    this.close(true);
    this.pause(true);
    const body = page === 'help' ? this.helpPage() : page === 'sound' ? this.soundPage() : this.mainPage();
    this.el = el(`<div class="menu war-menu"><div class="sheet"><div class="dossier">${body}</div></div></div>`);
    this.root.append(this.el);
    this.wire(page);
  }

  close(keepPaused = false) {
    this.el?.remove();
    this.el = null;
    if (!keepPaused) this.pause(false);
  }

  mainPage() {
    const book = this.press.scrapbook?.length ?? 0;
    const replay = !!this.director.lastBattle;
    const online = this.onlineItems();
    return `
      <div class="stamp-big">PAUSED</div>
      <h1>War Council</h1>
      <p class="sub">The clocks on the wall have stopped</p>
      <div class="choices">
        <button data-a="resume" class="primary">Resume the war</button>
        <button data-a="book" ${book ? '' : 'disabled'}>The war in headlines${book ? ` (${book})` : ''}</button>
        <button data-a="replay" ${replay ? '' : 'disabled'}>Replay the last battle</button>
        <button data-a="photo">Photo mode</button>
        <button data-a="help">How to play</button>
        <button data-a="sound">Sound</button>
        ${online.map((o, i) => `<button data-o="${i}">${o.label}</button>`).join('')}
        <button data-a="quit">Leave the war — main menu</button>
      </div>`;
  }

  helpPage() {
    const bonus = CONTINENTS.map((c) => `<tr><td>${c.name}</td><td>+${c.bonus}</td></tr>`).join('');
    return `
      <h1>How to Play</h1>
      <div class="help">
        <h3>The aim</h3>
        <p>Conquer the world: every territory on the map. Powers that lose their last territory are out of the war.</p>
        <h3>Your month: three steps</h3>
        <p><b>1 Deploy.</b> You receive armies: one for every three territories (at least three), plus the bonus of every continent you hold entirely, plus cards turned in. Click your glowing territories to place them (shift-click or hold: all at once).</p>
        <p><b>2 Attack.</b> Click one of your territories with two or more armies, then a neighbouring enemy (red hatching). <i>Roll once</i> is a single exchange of fire; <i>Blitz</i> keeps rolling until the territory falls or you are spent. Dashed lines across the sea are sea routes.</p>
        <p><b>3 Fortify.</b> Optionally move troops once between two of your connected territories. <i>End turn</i> hands over to the next power.</p>
        <h3>Dice</h3>
        <p>Attacker rolls up to three dice (one fewer than the armies in the attacking territory), defender up to two. Highest against highest: the higher die wins, ties go to the defender. Each lost comparison costs one army.</p>
        <h3>Cards</h3>
        <p>Conquer at least one territory in a month and you draw a card. Three of a kind, or one of each, or any set with a wild card, can be turned in for armies: 4, 6, 8, 10, 12, 15 and then five more each time. With five cards you must turn in a set.</p>
        <h3>Continents</h3>
        <table>${bonus}</table>
        <h3>Telephone diplomacy</h3>
        <p>Once a month you may telephone another power (☎ in the panel) and propose a non-aggression pact for three or six months. Attacking a partner breaks the pact — the papers will call it betrayal, and the generals remember.</p>
        <h3>Events of the month</h3>
        <p>Some months bring news that changes the rules for that month — winter in the east, gales at sea, strikes, harvests. The evening paper tells you what applies.</p>
        <h3>Fog of war</h3>
        <p>If chosen, you only see enemy strength next to your own territories and those of your pact partners; elsewhere a flag shows “?”.</p>
        <h3>Camera</h3>
        <p>Drag to move across the map, right-drag to tilt and turn, scroll or pinch to zoom. Arrow keys or WASD move, Q/E turn, R returns to the overview. Space or a click on the map skips an animation; Esc opens this menu.</p>
      </div>
      <div class="choices"><button data-a="back" class="primary">Back</button></div>`;
  }

  soundPage() {
    const L = this.audio.levels;
    const row = (k, label) => `<label class="slider">${label}<input type="range" min="0" max="1" step="0.05" value="${L[k]}" data-k="${k}"></label>`;
    return `
      <h1>Sound</h1>
      <div class="opts">
        ${row('master', 'Everything')}${row('music', 'Music')}${row('voices', 'Voices')}${row('effects', 'Effects')}
        <label class="slider">Mute <input type="checkbox" data-mute ${this.audio.muted ? 'checked' : ''}></label>
      </div>
      <div class="choices"><button data-a="back" class="primary">Back</button></div>`;
  }

  wire(page) {
    const q = (s) => this.el.querySelector(s);
    const on = (a, fn) => { const b = q(`[data-a=${a}]`); if (b) b.onclick = fn; };
    on('resume', () => this.close());
    on('back', () => this.open('main'));
    on('help', () => this.open('help'));
    on('sound', () => this.open('sound'));
    on('book', async () => { this.el.style.display = 'none'; await this.press.showScrapbook(this.root, 'The War So Far'); this.el.style.display = ''; });
    on('replay', async () => { this.close(); await this.director.replay(); });
    on('photo', () => { this.close(true); this.photo.start(() => this.pause(false)); });
    on('quit', () => { this.close(); this.onMainMenu(); });
    this.el.querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => { const it = this.onlineItems()[+b.dataset.o]; this.close(); it?.action(); }));
    this.el.querySelectorAll('input[type=range]').forEach((r) => (r.oninput = () => this.audio.setLevel(r.dataset.k, +r.value)));
    const mute = q('[data-mute]');
    if (mute) mute.onchange = () => this.audio.setMuted(mute.checked);
  }
}
