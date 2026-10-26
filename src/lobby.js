// Online i klienten: lobbyn (skapa, gå med, öppna krig, mina krig) och partiet som följer servern.
// Servern är auktoritativ (server/PROTOCOL.md); klienten spelar upp händelserna i ordning och svarar när det är dess tur.
import { Online, inviteLink, OnlineError } from './online.js';
import { FACTIONS, FACTION } from '../shared/factions.js';

const STYLES = ['strategist', 'aggressive', 'cautious'];
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export class OnlineGame {
  constructor({ director, ui, hud, net, onEnd }) {
    Object.assign(this, { director, ui, hud, net, onEnd });
    this.chain = Promise.resolve();
    this.asking = false;
    this.stopped = false;
    this.offs = [
      net.on('start', (m) => this.enqueue(() => this.started(m))),
      net.on('events', (m) => this.enqueue(() => this.director.play(m.events, m.state))),
      net.on('resync', (m) => this.enqueue(() => this.resync(m))),
      net.on('seats', () => this.hud.updateRoster?.(this.net.state ?? this.director.lastState ?? { players: [], owner: {} })),
      net.on('status', (s) => this.hud.toast(s === 'online' ? 'Wire restored' : s === 'offline' ? 'Wire cut — reconnecting…' : 'Connecting…', { ms: 2000 })),
    ];
  }

  enqueue(fn) {
    this.chain = this.chain.then(fn).catch((e) => console.error(e)).then(() => this.maybeAsk());
    return this.chain;
  }

  begin(game) {
    if (game.startMsg) { this.enqueue(() => this.started(game.startMsg)); return; }
    if (game.status === 'lobby' || !game.state) return;
    this.enqueue(() => this.director.setup(game.state));
  }

  started(m) {
    const before = structuredClone(m.state);
    this.director.setup(m.state);
    return this.director.play(m.events ?? [], before);
  }

  resync(m) { if (m.state) this.director.setup(m.state); }

  async maybeAsk() {
    if (this.stopped || this.asking || !this.net.myTurn) return;
    this.asking = true;
    try {
      const action = await this.ui.ask(this.net.state);
      if (action && !this.stopped) {
        try { await this.net.act(action); }
        catch (e) { this.ui.rejected(e instanceof OnlineError ? e.code : 'error'); }
      }
    } finally { this.asking = false; }
    if (this.net.state?.phase !== 'over') this.enqueue(() => {});
    else this.onEnd?.(this.net.state);
  }

  stop() { this.stopped = true; for (const off of this.offs) off(); this.ui.cancel(); }
}

// ------------------------------------------------------------------ lobbyn

export class LobbyUI {
  constructor({ root, startOnline, back }) {
    Object.assign(this, { root, startOnline, back });
    this.net = null;
  }

  async connect() {
    if (this.net?.status === 'online') return this.net;
    this.net = this.net ?? new Online({ name: this.name() });
    await this.net.connect();
    return this.net;
  }

  name() { try { return JSON.parse(localStorage.getItem('tow.identity'))?.name ?? ''; } catch { return ''; } }

  show(html) {
    this.root.querySelector('.menu')?.remove();
    const m = el(`<div class="menu"><div class="sheet"><div class="dossier online">${html}</div></div></div>`);
    this.root.append(m);
    return m;
  }

  error(m, e) {
    const box = m.querySelector('.err') ?? m.querySelector('.dossier').appendChild(el('<p class="err"></p>'));
    box.textContent = e?.message ?? String(e);
  }

  // Huvudvyn: namn, skapa, gå med, öppna krig, mina krig.
  async home() {
    const m = this.show(`
      <div class="stamp-big">WIRE</div>
      <h2>War by Wire</h2>
      <p class="sub">Play across the world</p>
      <label class="field">Your name <input data-k="name" maxlength="24" placeholder="General …" value="${esc(this.name())}"></label>
      <div class="choices">
        <button data-a="create" class="primary">Declare a war</button>
        <div class="joinrow"><input data-k="code" maxlength="6" placeholder="CODE"><button data-a="join">Join</button></div>
      </div>
      <h3>Open wars</h3><div class="list" data-l="open"><p class="muted">Contacting headquarters…</p></div>
      <h3>Your wars</h3><div class="list" data-l="mine"></div>
      <button data-a="back" class="link">← Back</button>`);
    m.querySelector('[data-a=back]').onclick = () => this.back();
    const nameIn = m.querySelector('[data-k=name]');
    // knapparna fungerar direkt; anslutningen (som kan ta en stund mot servern) väntas in i varje handling
    const connecting = this.connect().catch((e) => { this.error(m, e); throw e; });
    // namnet följer med i hello: byts det, anslut om så att servern får det nya
    const setName = async () => {
      await connecting;
      const n = nameIn.value.trim();
      if (!n || n === this.net.player?.name) return;
      this.net.name = n;
      try { const id = JSON.parse(localStorage.getItem('tow.identity')) ?? {}; localStorage.setItem('tow.identity', JSON.stringify({ ...id, name: n })); } catch { /* */ }
      this.net.close();
      await this.net.connect();
    };
    m.querySelector('[data-a=create]').onclick = async () => { await setName(); this.create(); };
    m.querySelector('[data-a=join]').onclick = async () => { await setName(); this.join(m.querySelector('[data-k=code]').value); };
    try {
      await connecting;
      const lobby = await this.net.list();
      const row = (g, btn) => `<div class="game"><span class="code">${g.code}</span><span class="chips">${g.seats.map((s) => `<i class="chip ${s.open ? 'open' : ''}" style="--c:${FACTION[s.faction].paint}" title="${esc(s.name ?? s.kind)}"></i>`).join('')}</span><span class="st">${g.status === 'lobby' ? 'mustering' : g.status === 'over' ? 'over' : `month ${g.round}`}${g.yourTurn ? ' <b class="stamp">YOUR MOVE</b>' : ''}</span>${btn}</div>`;
      m.querySelector('[data-l=open]').innerHTML = lobby.open.length ? lobby.open.map((g) => row(g, `<button data-j="${g.code}">Join</button>`)).join('') : '<p class="muted">No wars are mustering right now.</p>';
      m.querySelector('[data-l=mine]').innerHTML = lobby.mine.length ? lobby.mine.map((g) => row(g, `<button data-o="${g.code}">${g.status === 'over' ? 'Review' : 'Resume'}</button>`)).join('') : '<p class="muted">None yet.</p>';
      m.querySelectorAll('[data-j]').forEach((b) => (b.onclick = async () => { await setName(); this.join(b.dataset.j); }));
      m.querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => this.open(b.dataset.o)));
    } catch (e) { this.error(m, e); }
  }

  // Skapa: antal makter, hur många platser för människor, din färg.
  create() {
    const m = this.show(`
      <h2>Declare a war</h2>
      <p class="sub">Muster the powers</p>
      <label class="field">Your colours <span class="factions">${FACTIONS.map((f, i) => `<button class="chipbtn ${i === 1 ? 'on' : ''}" data-f="${f.id}" style="--c:${f.paint}" title="${f.name}"></button>`).join('')}</span></label>
      <label class="field">Powers at war <select data-k="n">${[2, 3, 4, 5, 6].map((n) => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field">Seats for people <select data-k="h">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <p class="muted">Remaining powers are played by the generals. Empty seats are handed to the generals when you start.</p>
      <div class="choices"><button data-a="go" class="primary">Issue the orders</button></div>
      <button data-a="back" class="link">← Back</button>`);
    let mine = 'blue';
    m.querySelectorAll('.chipbtn').forEach((b) => (b.onclick = () => { m.querySelectorAll('.chipbtn').forEach((x) => x.classList.remove('on')); b.classList.add('on'); mine = b.dataset.f; }));
    m.querySelector('[data-a=back]').onclick = () => this.home();
    m.querySelector('[data-a=go]').onclick = async () => {
      const n = +m.querySelector('[data-k=n]').value;
      const h = Math.min(n, +m.querySelector('[data-k=h]').value);
      const order = [mine, ...FACTIONS.map((f) => f.id).filter((f) => f !== mine)].slice(0, n);
      const seats = order.map((f, i) => (i < h ? { kind: 'human', faction: f } : { kind: 'ai', faction: f, ai: STYLES[i % 3] }));
      try { const g = await this.net.create({ seats, seat: 0 }); this.muster(g); } catch (e) { this.error(m, e); }
    };
  }

  async join(code) {
    code = String(code ?? '').trim().toUpperCase();
    if (!code) return;
    try { await this.connect(); const g = await this.net.join(code); g.status === 'lobby' ? this.muster(g) : this.enter(g); }
    catch (e) { const m = this.show(`<h2>No such war</h2><p class="err">${esc(e.message)}</p><button data-a="back" class="link">← Back</button>`); m.querySelector('[data-a=back]').onclick = () => this.home(); }
  }

  async open(code) {
    try { await this.connect(); const g = await this.net.open(code); g.status === 'lobby' ? this.muster(g) : this.enter(g); }
    catch (e) { this.home(); }
  }

  async watch(code) {
    try { await this.connect(); const g = await this.net.watch(String(code).toUpperCase()); this.enter(g); }
    catch (e) { const m = this.show(`<h2>No such war</h2><p class="err">${esc(e.message)}</p><button data-a="back" class="link">← Back</button>`); m.querySelector('[data-a=back]').onclick = () => this.home(); }
  }

  // Mönstringen: platserna fylls, värden startar.
  muster(g) {
    const link = inviteLink(g.code);
    const m = this.show(`
      <h2>Mustering</h2>
      <p class="sub">War code <b class="code">${g.code}</b></p>
      <div class="invite"><input readonly value="${link}"><button data-a="copy">Copy</button></div>
      <div class="list" data-l="seats"></div>
      <div class="choices">${g.you.host ? '<button data-a="start" class="primary">Start the war</button>' : '<p class="muted">Waiting for the host to start the war…</p>'}</div>
      <button data-a="leave" class="link">← Leave</button>`);
    const render = (seats) => {
      m.querySelector('[data-l=seats]').innerHTML = seats.map((s) => `<div class="game"><i class="chip" style="--c:${FACTION[s.faction].paint}"></i><b>${FACTION[s.faction].name}</b><span class="st">${s.kind === 'ai' ? `generals (${s.ai})` : s.open ? 'open seat' : `${esc(s.name ?? 'commander')}${s.online ? '' : ' (away)'}`}</span></div>`).join('');
    };
    render(g.seats);
    const off = this.net.on('seats', (x) => render(x.seats));
    const offStart = this.net.on('start', (msg) => { off(); offStart(); this.enter({ ...g, status: 'active', startMsg: msg }); });
    m.querySelector('[data-a=copy]').onclick = () => navigator.clipboard?.writeText(link);
    m.querySelector('[data-a=start]')?.addEventListener('click', () => this.net.start());
    m.querySelector('[data-a=leave]').onclick = async () => { off(); offStart(); try { await this.net.leave(); } catch { /* */ } this.home(); };
  }

  // In i kriget: stäng menyn och låt spelet följa servern.
  enter(g) {
    this.root.querySelector('.menu')?.remove();
    this.startOnline(this.net, g);
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
