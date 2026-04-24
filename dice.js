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
