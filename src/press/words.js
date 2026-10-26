// Små språk- och slumphjälpare för redaktionen. Ren JS (körs i node och webbläsaren).

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

// Talet med ord (radio och journalfilm läses upp): 42 -> "forty-two". Över 999 blir det siffror.
export function words(n) {
  n = Math.round(n);
  if (n < 0) return 'minus ' + words(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) {
    const h = ONES[Math.floor(n / 100)] + ' hundred';
    return n % 100 ? h + ' and ' + words(n % 100) : h;
  }
  return String(n);
}

// Tidningsstil: ett till nio med bokstäver, 10 och uppåt med siffror.
export const num = (n) => (n >= 0 && n < 10 ? ONES[n] : String(n));

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const upper = (s) => s.toUpperCase();
export const plural = (n, one, many) => (n === 1 ? one : many);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Runda 1 = april 1952.
export function monthOf(round) {
  const m = 3 + Math.max(0, round - 1);
  return { year: 1952 + Math.floor(m / 12), month: m % 12 };
}
export const monthName = (round) => MONTHS[monthOf(round).month];
export const monthYear = (round) => `${monthName(round)} ${monthOf(round).year}`;
export function daysIn(round) {
  const { year, month } = monthOf(round);
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
// "Friday, March 14, 1952"
export function dateLine(round, day) {
  const { year, month } = monthOf(round);
  const wd = new Date(Date.UTC(year, month, day)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${MONTHS[month]} ${day}, ${year}`;
}
export const shortDate = (round, day) => `${MONTHS[monthOf(round).month]} ${day}`;

// Deterministisk slump (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Blandpåsar: varje mall används en gång innan någon upprepas, och aldrig två gånger i rad.
export class Bags {
  constructor(random) {
    this.random = random;
    this.bags = new Map();
    this.last = new Map();
  }
  // Väljer ur `list` (funktioner eller strängar) under nyckeln `key`. Funktioner får `ctx` och får svara null
  // när de inte passar (t.ex. kräver en reträttväg som saknas); då provas nästa.
  pick(key, list, ctx) {
    let bag = this.bags.get(key);
    if (!bag || !bag.length) {
      bag = list.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      const last = this.last.get(key);
      if (bag.length > 1 && bag[bag.length - 1] === last) bag.unshift(bag.pop());
      this.bags.set(key, bag);
    }
    for (let k = bag.length - 1; k >= 0; k--) {
      const i = bag[k];
      const v = typeof list[i] === 'function' ? list[i](ctx) : list[i];
      if (v) {
        bag.splice(k, 1);
        this.last.set(key, i);
        return v;
      }
    }
    // Inget i påsen passade: prova hela listan (även redan använda).
    for (const item of list) {
      const v = typeof item === 'function' ? item(ctx) : item;
      if (v) return v;
    }
    return '';
  }
}
