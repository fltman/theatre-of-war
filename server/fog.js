// Krigsdimma online (CONTRACT.md "Krigsdimma"): motorn räknar som vanligt, servern redigerar vyn per mottagare.
// En spelare ser arméerna i egna territorier, deras grannar och pakt-partners territorier (visibleTo i motorn).
// Åskådare ser bara ägandet (färgerna) så länge kriget pågår. När kriget är slut syns allt för alla.
import { visibleTo } from '../shared/engine.js';

// Synliga territorier för en mottagare, eller null = allt syns (ingen dimma, eller kriget är slut).
export function sight(state, seat) {
  if (!state?.fog || state.phase === 'over') return null;
  if (seat == null || !state.players[seat]) return new Set();
  return visibleTo(state, seat);
}

// Vad man ser i en händelse: det man såg före draget eller ser efter det (en erövrad gräns syntes ju när slaget stod).
export function eventSight(pre, post, seat) {
  const a = sight(pre, seat), b = sight(post, seat);
  if (!a || !b) return null;
  return new Set([...a, ...b]);
}

export function fogArmies(armies, vis) {
  if (!vis) return armies;
  const out = {};
  for (const t in armies) out[t] = vis.has(t) ? armies[t] : null;
  return out;
}

// Pågående erövring: min/max avslöjar arméerna i utgångsläget.
export function fogOccupy(occupy, vis) {
  if (!vis || !occupy || vis.has(occupy.from)) return occupy;
  return { ...occupy, min: null, max: null };
}

// Antalen i händelserna blir null när mottagaren inte ser territoriet (place.n, battle.armies, occupy.n, fortify.n).
export function fogEvents(events, vis, skip = null) {
  if (!vis) return events;
  const see = (t) => vis.has(t);
  return events.map((e) => {
    switch (e.type) {
      case 'place': return see(e.territory) ? e : { ...e, n: null };
      case 'battle':
        if (skip === 'battle') return e;
        return { ...e, armies: { from: see(e.from) ? e.armies.from : null, to: see(e.to) ? e.armies.to : null } };
      case 'occupy':
      case 'fortify': return see(e.from) || see(e.to) ? e : { ...e, n: null };
      default: return e;
    }
  });
}
