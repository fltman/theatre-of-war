// Generalernas tänkande i en egen tråd (Monte Carlo-framåtblicken tar 30–200 ms per beslut; animationerna ska inte hacka).
import { decide } from '../shared/ai.js';

self.onmessage = (e) => {
  const { id, state, think } = e.data;
  let action = null, error = null;
  try { action = decide(state, { think }); } catch (err) { error = String(err?.message ?? err); }
  self.postMessage({ id, action, error });
};
