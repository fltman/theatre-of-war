// HUD: månadsrad och vems tur, tärningsbricka, korta meddelanden, hastighet, fraktionslista.
// Stil: maskinskrivna lappar och stämplar på papper (se style.css).
import { FACTION } from '../shared/factions.js';
import { CONTINENT, CARDS, TERRITORY } from '../shared/map.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthOf = (round) => { const m = 3 + (round - 1); return `${MONTHS[m % 12]} ${1952 + Math.floor(m / 12)}`; };

const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };

export class HUD {
  constructor(root) {
    this.root = root;
    this.top = el('div', 'hud-top');
    this.date = el('div', 'hud-date');
    this.turnTag = el('div', 'hud-turn');
    this.top.append(this.date, this.turnTag);
    this.roster = el('div', 'hud-roster');
    this.tray = el('div', 'hud-dice');
    this.toastBox = el('div', 'hud-toasts');
    this.speedBox = el('div', 'hud-speed');
    this.panel = el('div', 'hud-panel hidden');
    this.hover = el('div', 'hud-hover hidden');
    root.append(this.top, this.roster, this.tray, this.toastBox, this.speedBox, this.panel, this.hover);
  }

  // Onlinekod i övre raden.
  wire(code) {
    this.wireTag ??= el('div', 'hud-date hud-wire');
    this.wireTag.textContent = `WIRE ${code}`;
    this.top.append(this.wireTag);
  }

  setTurn(state) {
    this.date.textContent = monthOf(state.round);
    const p = state.players[state.turn];
    const f = FACTION[p.faction];
    this.turnTag.innerHTML = `<span class="chip" style="--c:${f.paint}"></span>${p.name}${p.kind === 'human' ? '' : ' <em>(generals)</em>'}`;
    this.updateRoster(state);
  }

  updateRoster(state) {
    const rows = state.players.map((p, i) => {
      const f = FACTION[p.faction];
      const terr = Object.values(state.owner).filter((o) => o === i).length;
      const arm = Object.keys(state.owner).filter((id) => state.owner[id] === i).reduce((s, id) => s + state.armies[id], 0);
      const allies = (state.pacts ?? []).filter((x) => x.a === i || x.b === i).map((x) => (x.a === i ? x.b : x.a));
      const pact = allies.length ? `<span class="pact" title="pact">🤝${allies.map((q) => `<i class="chip" style="--c:${FACTION[state.players[q].faction].paint}"></i>`).join('')}</span>` : '';
      return `<div class="row ${p.alive ? '' : 'dead'} ${i === state.turn ? 'now' : ''}"><span class="chip" style="--c:${f.paint}"></span><b>${p.name}${pact}</b><span>${terr}</span><span>${arm}</span><span>${p.cards?.length ? '▮'.repeat(Math.min(p.cards.length, 6)) : ''}</span></div>`;
    });
    this.roster.innerHTML = `<div class="row head"><span></span><b>Power</b><span title="Territories">T.</span><span title="Armies">A.</span><span title="Cards">C.</span></div>` + rows.join('');
  }

  // Tärningar: angriparens röda, försvararens elfenben. Förlorande tärningar bleknar.
  dice(a, d, losses, attacker, defender) {
    const pairs = Math.min(a.length, d.length);
    const die = (v, cls, lost) => `<div class="die ${cls} ${lost ? 'lost' : ''}">${pips(v)}</div>`;
    const aw = a.map((v, i) => die(v, 'att', i < pairs && !(v > d[i])));
    const dw = d.map((v, i) => die(v, 'def', i < pairs && v < a[i]));
    const loss = (n) => `<span class="loss">${n ? '−' + n : '·'}</span>`;
    this.tray.innerHTML = `<div class="side"><span class="chip" style="--c:${FACTION[attacker].paint}"></span>${aw.join('')}${loss(losses.a)}</div><div class="vs"><i>vs</i></div><div class="side">${loss(losses.d)}${dw.join('')}<span class="chip" style="--c:${FACTION[defender].paint}"></span></div>`;
    this.tray.classList.remove('roll');
    void this.tray.offsetWidth;
    this.tray.classList.add('roll', 'show');
    clearTimeout(this.trayT);
    this.trayT = setTimeout(() => this.tray.classList.remove('show'), 2600);
  }

  // Order till spelaren när turen börjar (lapp som glider in och ligger kvar en stund).
  orders(html) {
    const o = el('div', 'orders', `<span class="hdr">ORDERS</span>${html}`);
    this.root.append(o);
    requestAnimationFrame(() => o.classList.add('in'));
    setTimeout(() => { o.classList.remove('in'); setTimeout(() => o.remove(), 600); }, 3200);
  }

  // Gummistämpel som smäller ned mitt på skärmen.
  stamp(text, size = '') {
    const s = el('div', 'rubber ' + size, text);
    this.root.append(s);
    setTimeout(() => s.remove(), 1600);
  }

  // Spelarens kort som små papperskort; det föreslagna tretalet markeras.
  hand(cards = [], set = []) {
    this.handBox ??= this.root.appendChild(el('div', 'hud-hand'));
    const ICON = { infantry: '♟', tank: '▰', artillery: '✸', wild: '★' };
    this.handBox.innerHTML = (cards ?? []).filter((i) => i != null).map((i) => {
      const c = CARDS[i];
      return `<div class="card ${set.includes(i) ? 'set' : ''}"><i>${ICON[c.symbol]}</i><b>${c.symbol === 'wild' ? 'Wild' : c.symbol}</b><span>${c.territory ? TERRITORY[c.territory].name : 'any'}</span></div>`;
    }).join('');
  }

  toast(html, { kind = '', ms = 3200 } = {}) {
    const t = el('div', 'toast ' + kind, html);
    this.toastBox.append(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 500); }, ms);
  }

  continent(ev, state) {
    const p = state.players[ev.player];
    const c = CONTINENT[ev.continent];
    this.toast(ev.gained ? `<b>${p.name}</b> holds all of ${c.name} <span class="stamp">+${c.bonus}</span>` : `<b>${p.name}</b> loses ${c.name}`, { kind: ev.gained ? 'big' : '' });
  }

  setHover(text, x, y) {
    if (!text) { this.hover.classList.add('hidden'); return; }
    this.hover.innerHTML = text;
    this.hover.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
    this.hover.classList.remove('hidden');
  }
}

function pips(v) {
  const P = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[v];
  return Array.from({ length: 9 }, (_, i) => `<i class="${P.includes(i + 1) ? 'on' : ''}"></i>`).join('');
}
