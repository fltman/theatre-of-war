// Undertexter till radion (fjärrskrivarremsa som skrivs ut) och journalfilmen (vit filmtext med kontur).
//
//   await showSubtitle(text, { speaker: 'announcer'|'reporter', duration, style: 'radio'|'tv', station })
//
// En ny undertext ersätter den som visas (den förras promise löses). duration i ms; standard efter textlängd.
// instant: true skriver ut hela texten direkt (skärmbilder). hideSubtitle() tar bort den som visas.

import './subtitles.css';
import { loadPressFonts } from './fonts.js';

const LABEL = { announcer: 'Announcer', reporter: 'Correspondent' };
let current = null;

export const subtitleDuration = (text) => Math.max(2400, 1000 + text.length * 58);

export function hideSubtitle() {
  if (!current) return;
  current.close();
  current = null;
}

export function showSubtitle(text, { speaker = 'announcer', duration, style = 'radio', station, container = document.body, instant = false } = {}) {
  hideSubtitle();
  loadPressFonts();
  const ms = duration ?? subtitleDuration(text);
  const root = document.createElement('div');
  root.className = `sub-root sub-${style}`;
  const strip = document.createElement('div');
  strip.className = 'sub-strip';
  if (style === 'radio') {
    const head = document.createElement('div');
    head.className = 'sub-head';
    const who = document.createElement('span');
    who.className = 'sub-who';
    who.textContent = LABEL[speaker] || speaker;
    head.append(who);
    if (station) {
      const st = document.createElement('span');
      st.className = 'sub-station';
      st.textContent = station;
      head.append(st);
    }
    strip.append(head);
  }
  const body = document.createElement('div');
  body.className = 'sub-text';
  strip.append(body);
  root.append(strip);
  container.append(root);

  let timer;
  let typer;
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const me = {
    close() {
      clearTimeout(timer);
      clearInterval(typer);
      root.classList.add('sub-out');
      setTimeout(() => root.remove(), 350);
      resolve();
    },
  };
  current = me;
  requestAnimationFrame(() => root.classList.add('sub-in'));

  if (style === 'radio' && !instant) {
    // Fjärrskrivaren: texten skrivs fram, ungefär i talets takt men klar efter halva tiden.
    const per = Math.min(38, (ms * 0.5) / Math.max(1, text.length));
    let i = 0;
    const caret = document.createElement('span');
    caret.className = 'sub-caret';
    const shown = document.createTextNode('');
    body.append(shown, caret);
    typer = setInterval(() => {
      i = Math.min(text.length, i + 1 + (text[i] === ' ' ? 1 : 0));
      shown.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(typer);
        caret.remove();
      }
    }, per);
  } else body.textContent = text;

  if (Number.isFinite(ms)) timer = setTimeout(() => current === me && hideSubtitle(), ms);
  return done;
}
