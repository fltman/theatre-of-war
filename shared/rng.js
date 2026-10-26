// Seedad slump (mulberry32). Tillståndet är ett heltal som sparas i spelets state, så servern och klienten
// får samma tärningar ur samma logg.
export function next(s) {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { s, v: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

// Hjälpare som muterar ett state-objekts rng-fält.
export const rand = (st) => { const r = next(st.rng); st.rng = r.s; return r.v; };
export const die = (st) => 1 + Math.floor(rand(st) * 6);
export const int = (st, n) => Math.floor(rand(st) * n);
export function shuffle(st, a) {
  for (let i = a.length - 1; i > 0; i--) { const j = int(st, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const seedFrom = (str) => {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
