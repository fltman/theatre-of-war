// Fraktionerna är färger ("GERMANY HAS FALLEN — YELLOW MASTER ONCE MORE").
// name: rubrikform. army: "the Yellow Army". adj: attributivt ("Yellow troops"). plural: "the Yellows".
// paint: tennsoldaternas färg. wash: kartans lavering. Utseendet kan ändras fritt här; id:n är kontrakt.

export const FACTIONS = [
  { id: 'red', name: 'Red', army: 'the Red Army', adj: 'Red', plural: 'the Reds', paint: '#a3302a', wash: '#b8564a' },
  { id: 'blue', name: 'Blue', army: 'the Blue Army', adj: 'Blue', plural: 'the Blues', paint: '#2d4f86', wash: '#5a7aa6' },
  { id: 'green', name: 'Green', army: 'the Green Army', adj: 'Green', plural: 'the Greens', paint: '#4d6b35', wash: '#7d9460' },
  { id: 'yellow', name: 'Yellow', army: 'the Yellow Army', adj: 'Yellow', plural: 'the Yellows', paint: '#c99a2e', wash: '#d6b25c' },
  { id: 'black', name: 'Black', army: 'the Black Army', adj: 'Black', plural: 'the Blacks', paint: '#26262a', wash: '#5b5a5c' },
  { id: 'purple', name: 'Purple', army: 'the Purple Army', adj: 'Purple', plural: 'the Purples', paint: '#6a3f78', wash: '#8f6c9c' },
];

export const FACTION = Object.fromEntries(FACTIONS.map((f) => [f.id, f]));

// AI-personligheter (motorn läser parametrarna, pressen beskriver dem).
export const AI_STYLES = {
  aggressive: { name: 'aggressive', margin: 0.9, keep: 1, desc: 'ruthless' },
  cautious: { name: 'cautious', margin: 1.8, keep: 3, desc: 'cautious' },
  strategist: { name: 'strategist', margin: 1.25, keep: 2, desc: 'calculating' },
};
