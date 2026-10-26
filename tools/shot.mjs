// Skärmdump av spelet i riktig Chrome (playwright-core + systemets Chrome).
//   node tools/shot.mjs [url] [ut.png] [--w 1440] [--h 900] [--wait 4000] [--eval "js"] [--progress namn]
// --progress kopierar bilden till progress/<datum>_<namn>.png (användaren följer bygget där).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const url = pos[0] ?? 'http://localhost:8260/';
const out = pos[1] ?? 'build/shot.png';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +opt('w', 1440), height: +opt('h', 900) }, deviceScaleFactor: +opt('dpr', 1) });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${r.status()}] ${r.url()}`); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+opt('wait', 4000));
const js = opt('eval', null);
if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r)); await page.waitForTimeout(+opt('after', 1500)); }
fs.mkdirSync(out.replace(/[^/]*$/, '') || '.', { recursive: true });
const frames = +opt('frames', 1), every = +opt('every', 1000);
if (frames > 1) {
  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: out.replace(/\.png$/, `_${String(i).padStart(2, '0')}.png`) });
    await page.waitForTimeout(every);
  }
}
await page.screenshot({ path: out });
const prog = opt('progress', null);
if (prog) {
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const name = `progress/${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}_${prog}.png`;
  fs.copyFileSync(out, name);
  console.log('progress:', name);
}
console.log(out, errors.length ? '\n' + errors.slice(0, 20).join('\n') : '(inga konsolfel)');
await browser.close();
