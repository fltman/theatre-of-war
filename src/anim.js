// Små animationshjälpare ovanpå världens uppdateringsloop (följer world.timeScale och regins hastighet).
export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t * t,
  back: (t) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  bounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

let world = null;
export const speed = { factor: 1 };          // regins tempo (1×, 2×, 4×); "bara rubriker" sätter mycket högt
export function bindWorld(w) { world = w; }

// tween(sek, t => ..., easing) -> Promise. Med speed.factor >= 50 hoppar den direkt till slutet.
export function tween(sec, fn, e = ease.inOut) {
  return new Promise((resolve) => {
    if (!world || sec <= 0 || speed.factor >= 50) { fn(1); resolve(); return; }
    let t = 0;
    const off = world.addUpdater((dt) => {
      t += (dt * speed.factor) / sec;
      if (t >= 1) { fn(1); off(); resolve(); return; }
      fn(e(t));
    });
  });
}

export function wait(sec) { return tween(sec, () => {}, ease.linear); }

// Kör fn(dt, t) varje bild tills den returnerar true.
export function every(fn) {
  return new Promise((resolve) => {
    let t = 0;
    const off = world.addUpdater((dt) => { t += dt * speed.factor; if (fn(dt * speed.factor, t)) { off(); resolve(); } });
  });
}

export const lerp = (a, b, t) => a + (b - a) * t;
