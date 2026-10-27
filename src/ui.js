// Spelarens kontroller: hovra/klicka på territorier, panelen längst ned visar vad som går att göra i fasen.
// ask(state) -> Promise<action>; varje klick som blir ett drag löser löftet.
import * as THREE from 'three';
import { TERRITORY, CARDS } from '../shared/map.js';
import { sets, path, pactBetween, canAttack, maxDice } from '../shared/engine.js';
import { incoming, switchboard } from './diplomacy.js';
import { monthOf } from './hud.js';

const SYMBOL = { infantry: 'Infantry', tank: 'Tank', artillery: 'Artillery', wild: 'Wild' };

export class UI {
  constructor({ world, board, hud, director }) {
    Object.assign(this, { world, board, hud, director });
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.sel = null;            // valt utgångsläge
    this.target = null;
    this.resolve = null;
    this.state = null;
    const c = world.canvas;
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    c.addEventListener('pointerup', (e) => {
      if (!this.down) return;
      const d = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      const long = performance.now() - this.down.t > 550;
      this.down = null;
      if (d < 6) this.click(e, long);
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.deselect(); this.render(); }
    });
  }

  pickAt(e) {
    const r = this.world.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.world.camera);
    return this.board.pick(this.ray);
  }

  move(e) {
    if (e.pointerType === 'touch') return;
    const id = this.pickAt(e);
    if (id !== this.hoverId) {
      if (this.hoverId) this.board.mark(this.hoverId, 'hover', false);
      this.hoverId = id;
      if (id && this.resolve) this.board.mark(id, 'hover', true);
    }
    if (!id || !this.state) { this.hud.setHover(null); return; }
    const st = this.director.view;
    const owner = this.state.players.find((p) => p.faction === st.owner[id]);
    const s2 = this.state;
    const deploying = this.resolve && s2.phase === 'reinforce' && s2.owner[id] === s2.turn && !(s2.mustTrade || s2.players[s2.turn].cards.length >= 5);
    const shown = this.director.hidden(id) || st.armies[id] == null ? '?' : st.armies[id];
    this.hud.setHover(`${TERRITORY[id].name} · ${shown} · ${owner?.name ?? ''}${deploying ? ` <b class="plus">+1</b> <small>shift: all ${s2.pending}</small>` : ''}`, e.clientX, e.clientY);
  }

  // Väntar på spelarens nästa drag.
  // Ett paktförslag till spelaren: telefonen har ringt, nu svarar hen i luren.
  askCall(state) {
    this.state = state;
    this.hud.panel.classList.add('hidden');
    return incoming(state, (ms) => this.director.audio?.phoneVoice(ms));
  }

  ask(state) {
    if (state.proposal) return this.askCall(state);
    const newTurn = !this.state || this.state.turn !== state.turn || this.state.round !== state.round || this.state.phase === 'fortify';
    this.state = state;
    const deploying = state.phase === 'reinforce' && !(state.mustTrade || state.players[state.turn].cards.length >= 5);
    for (const id in this.board.meshes) this.board.mark(id, 'deploy', deploying && state.owner[id] === state.turn);
    if (deploying && newTurn && state.pending > 0) this.hud.orders(`Your orders: deploy <b>${state.pending}</b> armies`);
    if (state.phase !== 'attack' && state.phase !== 'fortify') this.deselect();
    if (state.phase === 'attack' && this.sel && (state.owner[this.sel] !== state.turn || state.armies[this.sel] < 2)) this.deselect();
    // löftet måste finnas innan panelen ritas (render() visar bara panelen när spelet väntar på ett drag)
    const promise = new Promise((res) => { this.resolve = res; });
    this.render();
    return promise;
  }

  send(action) {
    const r = this.resolve;
    this.resolve = null;
    for (const id in this.board.meshes) this.board.mark(id, 'deploy', false);
    this.hud.panel.classList.add('hidden');
    if (action && (action.type === 'endTurn' || action.type === 'fortify' || action.type === 'propose')) this.hud.hideHand();
    if (action && (action.type === 'endTurn' || action.type === 'fortify')) this.hud.stamp('ORDERS APPROVED');
    if (action && (action.type === 'endAttack')) this.hud.stamp('CEASE FIRE', 'small');
    r?.(action);
  }

  cancel() { this.send(null); }
  rejected(code) { this.hud.toast(`Order refused: ${code}`); }

  deselect() {
    if (this.sel) this.board.mark(this.sel, 'source', false);
    for (const id in this.board.meshes) this.board.mark(id, 'target', false);
    this.sel = null; this.target = null;
  }

  select(id, targets) {
    this.deselect();
    this.sel = id;
    this.board.mark(id, 'source', true);
    for (const t of targets) this.board.mark(t, 'target', true);
  }

  click(e, long) {
    if (!this.resolve) {
      // inte spelarens tur: ett klick hoppar över pågående animation
      this.director.skip();
      return;
    }
    const id = this.pickAt(e);
    const st = this.state, me = st.turn;
    if (!id) { this.deselect(); this.render(); return; }
    const mine = st.owner[id] === me;
    // telefonen: en paktförfrågan per månad
    const canCall = (st.phase === 'reinforce' || st.phase === 'attack') && me.lastProposal !== st.round
      && st.players.some((x, q) => q !== st.turn && x.alive && !pactBetween(st, st.turn, q));
    const phoneBtn = () => {
      const b = btn('', async () => {
        const a = await switchboard(st, st.turn);
        if (a) this.send(a); else this.render();
      });
      b.innerHTML = '☎ Telephone <small>propose a pact</small>';
      return b;
    };
    if (st.phase === 'reinforce') {
      if (!mine) return;
      if (st.mustTrade || st.players[me].cards.length >= 5) { this.hud.toast('You must turn in cards first'); return; }
      this.last = id;
      this.send({ type: 'place', territory: id, n: long || e.shiftKey ? st.pending : 1 });
      return;
    }
    if (st.phase === 'attack') {
      if (mine) {
        const foes = TERRITORY[id].neighbors.filter((n) => st.owner[n] !== me && canAttack(st, id, n));
        if (st.armies[id] < 2 || !foes.length) { this.deselect(); this.render(); return; }
        this.select(id, foes);
        this.render();
        return;
      }
      if (this.sel && TERRITORY[this.sel].neighbors.includes(id)) {
        if (!canAttack(st, this.sel, id)) { this.hud.toast('Gales at sea: no crossings by sea this month'); return; }
        this.target = id; this.render();
      }
      return;
    }
    if (st.phase === 'fortify') {
      if (!mine) return;
      if (this.sel && this.sel !== id && path(st, this.sel, id)) { this.target = id; this.render(); return; }
      if (st.armies[id] < 2) return;
      const reach = Object.keys(st.owner).filter((t) => t !== id && st.owner[t] === me && path(st, id, t));
      this.select(id, []);
      for (const t of reach) this.board.mark(t, 'target', true);
      this.render();
    }
  }

  // Panelen: text + knappar efter fas.
  render() {
    const st = this.state;
    const P = this.hud.panel;
    if (!this.resolve || !st) { P.classList.add('hidden'); return; }
    const me = st.players[st.turn];
    const btn = (label, fn, cls = '', dis = false) => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.disabled = dis; b.onclick = fn; return b; };
    const row = (...kids) => { const r = document.createElement('div'); r.className = 'row'; r.append(...kids); return r; };
    const title = (html) => { const d = document.createElement('div'); d.className = 'title'; d.innerHTML = html; return d; };
    P.replaceChildren();
    const phaseNo = { reinforce: 0, attack: 1, occupy: 1, fortify: 2 }[st.phase] ?? 0;
    const steps = document.createElement('div');
    steps.className = 'steps';
    steps.innerHTML = ['Deploy', 'Attack', 'Fortify'].map((n, i) => `<span class="${i === phaseNo ? 'on' : i < phaseNo ? 'done' : ''}">${i + 1} ${n}</span>`).join('<i>→</i>');
    P.append(steps);
    const hand = me.cards;
    const sets_ = sets(hand);

    // telefonen: en paktförfrågan per månad
    const canCall = (st.phase === 'reinforce' || st.phase === 'attack') && me.lastProposal !== st.round
      && st.players.some((x, q) => q !== st.turn && x.alive && !pactBetween(st, st.turn, q));
    const phoneBtn = () => {
      const b = btn('', async () => {
        const a = await switchboard(st, st.turn);
        if (a) this.send(a); else this.render();
      });
      b.innerHTML = '☎ Telephone <small>propose a pact</small>';
      return b;
    };
    if (st.phase === 'reinforce') {
      const forced = st.mustTrade || hand.length >= 5;
      if (forced) P.append(title(`<b>You hold ${hand.length} cards</b> — turn in a set first`));
      else {
        const big = document.createElement('div');
        big.className = 'deploy';
        big.innerHTML = `<span class="n">${st.pending}</span><span class="t">armies to deploy<small>Click a glowing territory: +1 · shift-click or hold: all</small></span><span class="men">${'♟'.repeat(Math.min(st.pending, 12))}${st.pending > 12 ? '…' : ''}</span>`;
        P.append(big);
      }
      const kids = [];
      if (sets_.length) kids.push(btn('Turn in cards', () => this.send({ type: 'trade', cards: sets_[0] }), forced ? 'primary' : ''));
      if (canCall && !forced) kids.push(phoneBtn());
      if (this.last && st.owner[this.last] === st.turn && !forced) kids.push(btn(`All ${st.pending} on ${TERRITORY[this.last].name}`, () => this.send({ type: 'place', territory: this.last, n: st.pending })));
      if (kids.length) P.append(row(...kids));
    } else if (st.phase === 'attack') {
      if (this.sel && this.target) {
        const a = st.armies[this.sel], d = this.director.hidden(this.target) ? '?' : st.armies[this.target];
        const dice = Math.min(maxDice(st, this.sel, this.target), a - 1);
        P.append(title(`<b>${TERRITORY[this.sel].name}</b> (${a}) → <b>${TERRITORY[this.target].name}</b> (${d})`));
        const pact = pactBetween(st, st.turn, st.owner[this.target]);
        if (pact) P.append(title(`<span class="betray">⚠ You have a pact with this power until the end of ${monthOf(pact.until)}. Attacking breaks it — the papers will call it betrayal.</span>`));
        const roll = btn('', () => this.send({ type: 'attack', from: this.sel, to: this.target, dice }), pact ? 'danger' : 'primary', a < 2);
        roll.innerHTML = `${pact ? 'Break the pact: roll once' : 'Roll once'} <small>${dice} ${dice === 1 ? 'die' : 'dice'} · one exchange of fire</small>`;
        const blitz = btn('', () => this.send({ type: 'blitz', from: this.sel, to: this.target }), pact ? 'danger' : '', a < 2);
        blitz.innerHTML = `${pact ? 'Break the pact: blitz' : 'Blitz'} <small>keep rolling until taken or spent</small>`;
        P.append(row(roll, blitz, btn('Cancel', () => { this.target = null; this.render(); })));
      } else {
        P.append(title(this.sel ? `Choose a target from <b>${TERRITORY[this.sel].name}</b> <small>(red hatching)</small>` : 'Click one of your territories (2+ armies) to attack from'));
        const fort = btn('', () => { this.deselect(); this.send({ type: 'endAttack' }); });
        fort.innerHTML = 'Fortify → <small>move troops, then end turn</small>';
        const end = btn('', () => { this.deselect(); this.send({ type: 'endTurn' }); }, 'primary');
        end.innerHTML = 'End turn <small>next power moves</small>';
        P.append(canCall ? row(phoneBtn(), fort, end) : row(fort, end));
      }
    } else if (st.phase === 'occupy') {
      const { from, to, min, max } = st.occupy;
      const input = document.createElement('input');
      input.type = 'range'; input.min = min; input.max = max; input.value = max;
      const lab = title(`Move <b>${max}</b> into ${TERRITORY[to].name}`);
      input.oninput = () => { lab.innerHTML = `Move <b>${input.value}</b> into ${TERRITORY[to].name}`; };
      P.append(lab, input, row(btn('Advance', () => this.send({ type: 'occupy', n: +input.value }), 'primary')));
    } else if (st.phase === 'fortify') {
      if (this.sel && this.target) {
        const max = st.armies[this.sel] - 1;
        const input = document.createElement('input');
        input.type = 'range'; input.min = 1; input.max = max; input.value = max;
        const lab = title(`Move <b>${max}</b> from ${TERRITORY[this.sel].name} to ${TERRITORY[this.target].name}`);
        input.oninput = () => { lab.innerHTML = `Move <b>${input.value}</b> from ${TERRITORY[this.sel].name} to ${TERRITORY[this.target].name}`; };
        P.append(lab, input, row(btn('Move and end turn', () => { const a = { type: 'fortify', from: this.sel, to: this.target, n: +input.value }; this.deselect(); this.send(a); }, 'primary'), btn('Cancel', () => { this.deselect(); this.render(); })));
      } else {
        P.append(title('Optional: click one of your territories, then a connected one, to move troops'));
        const end = btn('', () => { this.deselect(); this.send({ type: 'endTurn' }); }, 'primary');
        end.innerHTML = 'End turn <small>next power moves</small>';
        P.append(row(end));
      }
    }
    P.classList.remove('hidden');
    this.hud.hand(hand, sets_[0] ?? []);
  }
}
