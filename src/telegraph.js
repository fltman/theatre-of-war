// Telegrafen (online): telegram mellan makterna. Inkommande telegram skrivs ut tecken för tecken på en
// fjärrskrivarremsa i övre vänstra hörnet; "✉ Telegram" öppnar ett formulär på telegrampapper.
//   const tg = mountTelegraph({ net, hud, root, audio });   // audio (src/audio.js) är valfritt
//   tg.open();  tg.unmount();
import { FACTION } from '../shared/factions.js';
import { OnlineError } from './online.js';
import './telegraph.css';

export const PHRASES = [
  'STOP AT ONCE STOP', 'YOUR MOVE GENERAL', 'WELL PLAYED', 'EXPECT NO MERCY', 'PEACE IN OUR TIME',
  'HOLD THE LINE', 'WE SHALL NOT YIELD', 'ACCEPT OUR TERMS', 'REGARDS TO THE FAMILY', 'SEE YOU IN BERLIN',
];
const MAX = 140;
const CPS = 26;                       // tecken per sekund på remsan
const KEEP_MS = 16000;                // remsan ligger kvar så här länge efter utskriften

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function mountTelegraph({ net, hud, root = document.getElementById('overlay'), audio = null }) {
  const box = el('div', 'tg');
  const tapes = el('div', 'tg-tapes');
  box.append(tapes);
  let btn = null;
  if (net.seat !== null) {
    btn = el('button', 'tg-btn', '✉ Telegram');
    btn.title = 'Send a telegram';
    btn.onclick = () => open();
    box.prepend(btn);
  }
  root.append(box);

  // ---------------------------------------------------------------- ljud
  let own = null;
  const tick = (strong) => {
    if (audio?.ctx) { audio.noise({ dur: 0.018, type: 'highpass', f: strong ? 2400 : 3200, q: 0.7, gain: strong ? 0.22 : 0.08 }); return; }
    try {
      own ??= new (window.AudioContext || window.webkitAudioContext)();
      if (own.state === 'suspended') return;
      const t = own.currentTime, n = Math.floor(own.sampleRate * 0.015);
      const b = own.createBuffer(1, n, own.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
      const s = own.createBufferSource(); s.buffer = b;
      const f = own.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = strong ? 2200 : 3200;
      const g = own.createGain(); g.gain.value = strong ? 0.18 : 0.06;
      s.connect(f).connect(g).connect(own.destination); s.start(t);
    } catch { /* inget ljud */ }
  };
  const bell = () => audio?.ctx && audio.tone({ f: 1760, dur: 0.5, type: 'triangle', gain: 0.12 });

  // ---------------------------------------------------------------- remsan
  const who = (seat) => {
    const s = net.seats[seat];
    if (!s) return '?';
    const f = FACTION[s.faction]?.name.toUpperCase() ?? '?';
    return s.kind === 'human' && s.name && s.name !== FACTION[s.faction]?.name ? `${f} (${s.name.toUpperCase()})` : f;
  };

  function tape(t, { instant = false } = {}) {
    const s = net.seats[t.from];
    const strip = el('div', 'tg-tape');
    strip.style.setProperty('--c', FACTION[s?.faction]?.paint ?? '#888');
    const head = el('div', 'tg-head');
    head.append(el('span', 'tg-chip'), el('span', null, `FROM ${who(t.from)} · TO ${t.to === null ? 'ALL POWERS' : who(t.to)}`));
    const body = el('div', 'tg-body');
    strip.append(head, body);
    strip.onclick = () => strip.classList.toggle('pinned');
    tapes.prepend(strip);
    while (tapes.children.length > 4) tapes.lastElementChild.remove();
    requestAnimationFrame(() => strip.classList.add('in'));
    const text = t.text.toUpperCase();
    const done = () => {
      body.textContent = text;
      setTimeout(function fade() {
        if (strip.classList.contains('pinned')) { setTimeout(fade, 4000); return; }
        strip.classList.add('out');
        setTimeout(() => strip.remove(), 700);
      }, KEEP_MS);
    };
    if (instant) { done(); return; }
    bell();
    let i = 0;
    const step = () => {
      if (!strip.isConnected) return;
      i++;
      body.textContent = text.slice(0, i);
      tick(text[i - 1] !== ' ');
      if (i < text.length) setTimeout(step, 1000 / CPS * (0.7 + Math.random() * 0.6));
      else done();
    };
    setTimeout(step, 350);
  }

  // senaste telegrammet syns direkt (utan utskrift) när man kommer in i ett pågående krig
  const recent = (net.telegrams ?? []).filter((t) => Date.now() - t.ts < 10 * 60_000).slice(-1);
  for (const t of recent) tape(t, { instant: true });
  const off = net.on('telegram', (m) => { if (m.code === net.code) tape(m); });

  // ---------------------------------------------------------------- formuläret
  let form = null;
  function open() {
    if (form || net.seat === null) return;
    form = el('div', 'tg-modal');
    const paper = el('div', 'tg-form');
    paper.innerHTML = `
      <div class="tg-co">PAN-CONTINENTAL TELEGRAPH CO.</div>
      <div class="tg-title">TELEGRAM</div>
      <label class="tg-row"><span>TO</span><select data-k="to"></select></label>
      <div class="tg-row tg-msg"><span>TEXT</span><textarea data-k="text" maxlength="${MAX}" rows="3" spellcheck="false" placeholder="YOUR MESSAGE STOP"></textarea></div>
      <div class="tg-count"><span data-k="n">0</span> / ${MAX}</div>
      <div class="tg-phrases"></div>
      <p class="tg-err" hidden></p>
      <div class="tg-actions"><button data-a="cancel">Cancel</button><button data-a="send" class="primary">Send ▸</button></div>`;
    const sel = paper.querySelector('[data-k=to]');
    sel.append(new Option('ALL POWERS', ''));
    for (const s of net.seats) {
      if (s.seat === net.seat) continue;
      const dead = net.state?.players?.[s.seat]?.alive === false;
      sel.append(new Option(`${who(s.seat)}${s.kind === 'ai' ? ' — generals' : ''}${dead ? ' — fallen' : ''}`, String(s.seat)));
    }
    const ta = paper.querySelector('[data-k=text]');
    const n = paper.querySelector('[data-k=n]');
    const err = paper.querySelector('.tg-err');
    const upd = () => { ta.value = ta.value.toUpperCase().replace(/[\r\n]+/g, ' '); n.textContent = ta.value.length; };
    ta.oninput = upd;
    for (const p of PHRASES) {
      const b = el('button', 'tg-phrase', p);
      b.onclick = () => { ta.value = (ta.value ? ta.value.trimEnd() + ' ' : '') + p; ta.value = ta.value.slice(0, MAX); upd(); ta.focus(); };
      paper.querySelector('.tg-phrases').append(b);
    }
    const close = () => { form?.remove(); form = null; };
    paper.querySelector('[data-a=cancel]').onclick = close;
    form.onclick = (e) => { if (e.target === form) close(); };
    const send = paper.querySelector('[data-a=send]');
    send.onclick = async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      send.disabled = true;
      err.hidden = true;
      try {
        await net.telegram(sel.value === '' ? null : +sel.value, text);
        close();
        hud?.stamp?.('SENT', 'small');
      } catch (e) {
        err.hidden = false;
        err.textContent = e instanceof OnlineError ? e.message : 'The wire is down.';
        send.disabled = false;
      }
    };
    form.addEventListener('keydown', (e) => {
      e.stopPropagation();                               // mellanslag i texten ska inte hoppa över strider
      if (e.key === 'Escape') close();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send.click();
    });
    form.append(paper);
    root.append(form);
    ta.focus();
  }

  return {
    open,
    unmount() { off(); form?.remove(); box.remove(); try { own?.close(); } catch { /* */ } },
  };
}
