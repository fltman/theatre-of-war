// Kvalitetsnivåer: 'high' för datorer, 'low' för mobiler. ?quality=low|high tvingar fram en nivå.
export const TIERS = {
  high: { name: 'high', dprMax: 2, dprMin: 1, shadow: 4096, ao: 'Medium', aoHalf: false, dof: true, smaa: 'HIGH', map: 8192 },
  low: { name: 'low', dprMax: 1.5, dprMin: 0.75, shadow: 2048, ao: 'Low', aoHalf: true, dof: false, smaa: 'MEDIUM', map: 4096 },
};

export function detectTier() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q && TIERS[q]) return TIERS[q];
  const ua = navigator.userAgent;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const ipadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const small = Math.min(screen.width, screen.height) < 820;
  return mobileUA || ipadOS || (navigator.maxTouchPoints > 1 && small) ? TIERS.low : TIERS.high;
}

export const tier = detectTier();
export const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
