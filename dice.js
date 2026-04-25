// Dice and deviation sampling. Uses crypto.getRandomValues for fairness.

function randFloat() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // 0 ≤ r < 1
  return buf[0] / 0x100000000;
}

function randInt(min, maxInclusive) {
  const range = maxInclusive - min + 1;
  // Rejection sampling for exact uniformity
  const limit = Math.floor(0x100000000 / range) * range;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return min + (x % range);
}

export function rollD100() {
  return randInt(1, 100);
}

export function roll3d6() {
  return randInt(1, 6) + randInt(1, 6) + randInt(1, 6);
}

// Box–Muller transform: standard-normal sample.
function standardNormal() {
  let u = 0, v = 0;
  while (u === 0) u = randFloat();
  while (v === 0) v = randFloat();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Dice-based deviation (chat.md Method 1):
// Deviation_MOA = (3d6_sum − 10.5) × dispersion/3
export function sampleDeviationDice(dispersionMoa) {
  const x = (roll3d6() - 10.5) * (dispersionMoa / 3);
  const y = (roll3d6() - 10.5) * (dispersionMoa / 3);
  return { xMoa: x, yMoa: y };
}

// Normal-distribution deviation (chat.md Method 2):
// σ = dispersionMOA × tightness
// tightness: Point 2.0, Flash 1.3, Deliberate 0.9
export function sampleDeviationNormal(dispersionMoa, tightness = 1.0) {
  const sigma = dispersionMoa * tightness;
  return {
    xMoa: standardNormal() * sigma,
    yMoa: standardNormal() * sigma,
  };
}

export function tightnessForShotType(shotType) {
  switch (shotType) {
    case "point": return 2.0;
    case "deliberate": return 0.9;
    default: return 1.3;
  }
}

// Per-shot recoil-degradation multipliers for each fire mode. Index 0 is the
// first shot in the string (always 1.00 — full Final Chance). Subsequent shots
// degrade per real burst-fire data: aggressive double-taps lose more between
// shots than a controlled pair, full-auto loses fastest. Strings longer than
// the table use the last value (steady-state fully-degraded shot).
export const RECOIL_PROFILES = {
  single:     [1.00],
  controlled: [1.00, 0.85, 0.72, 0.60, 0.50, 0.42, 0.35],
  aggressive: [1.00, 0.70, 0.55, 0.40, 0.30, 0.22, 0.15],
  burst:      [1.00, 0.65, 0.45, 0.30, 0.20, 0.13, 0.08],
  fullauto:   [1.00, 0.55, 0.35, 0.20, 0.10, 0.07, 0.05],
};

export const FIRE_MODE_LABELS = {
  single:     "Single shot",
  controlled: "Controlled rapid",
  aggressive: "Aggressive rapid",
  burst:      "Burst",
  fullauto:   "Full auto",
};

// Round-count constraints per cadence. Single is locked at 1; pairs are 2–4;
// double-tap is 2–3; military burst is the classic 3–5; full-auto stays
// suppression-realistic (bounded above by likely mag size, not cyclic rate).
export const FIRE_MODE_RANGES = {
  single:     { min: 1, max: 1,  default: 1 },
  controlled: { min: 2, max: 4,  default: 2 },
  aggressive: { min: 2, max: 3,  default: 2 },
  burst:      { min: 3, max: 5,  default: 3 },
  fullauto:   { min: 3, max: 20, default: 5 },
};

// Returns the per-shot degradation multiplier on Final Chance for shot N
// (zero-indexed) in the given fire mode, scaled by weapon recoilClass.
// recoilClass scales the *loss* portion (1 − base): pistol 1.3 makes shots
// drop faster, precision 0.75 makes them drop slower.
export function recoilMultiplier(mode, shotIndex, recoilClass = 1.0) {
  const profile = RECOIL_PROFILES[mode] || RECOIL_PROFILES.single;
  const base = profile[Math.min(shotIndex, profile.length - 1)];
  const scaled = 1 - (1 - base) * recoilClass;
  return Math.max(0.05, Math.min(1.0, scaled));
}

// Visual σ widens as recoil mounts so the impact group spreads in step with
// the falling hit chance. Capped at 2× to keep dots on-canvas.
export function sigmaScaleForRecoil(recoilMult) {
  return 1 + (1 - recoilMult);
}
