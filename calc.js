// Pure calculations. All internal math in yards/inches. Formulas from chat.md.

export const MIN_CHANCE = 0.01;
export const MAX_CHANCE = 0.99;

// θ_MOA = (target_size_in × 95.5) / distance_yd
export function thetaMoa(targetIn, distanceYd) {
  if (!(distanceYd > 0) || !(targetIn > 0)) return 0;
  return (targetIn * 95.5) / distanceYd;
}

// Range Factor = 1 − exp(−0.11 × (θ/dispersion)²)
export function rangeFactor(thetaMoaValue, dispersionMoa) {
  if (!(dispersionMoa > 0)) return 0;
  const ratio = thetaMoaValue / dispersionMoa;
  return 1 - Math.exp(-0.11 * ratio * ratio);
}

// AV_MOA_per_s = (lateral_speed_yps × 3438) / distance_yd
// lateral_speed = ground_speed × sin(angle in degrees)
export function angularVelocity(groundSpeedYps, angleDeg, distanceYd) {
  if (!(distanceYd > 0) || !(groundSpeedYps > 0)) return 0;
  const lateral = groundSpeedYps * Math.sin((angleDeg * Math.PI) / 180);
  return (lateral * 3438) / distanceYd;
}

// TMM = 1 / (1 + 0.012 × angularVelocityMoaPerSec)
export function targetMovementMultiplier(angVelMoaPerSec) {
  return 1 / (1 + 0.012 * Math.max(0, angVelMoaPerSec));
}

export function clamp(v, lo = MIN_CHANCE, hi = MAX_CHANCE) {
  return Math.max(lo, Math.min(hi, v));
}

// Combine any number of multipliers with the base skill.
export function finalChance(skill, multipliers) {
  let result = skill;
  for (const m of multipliers) {
    if (typeof m === "number" && isFinite(m) && m > 0) result *= m;
  }
  return clamp(result);
}

// Skill band name from decimal value (chat.md Army qual tie-in).
export function skillBand(skill) {
  if (skill >= 0.90) return "Master";
  if (skill >= 0.75) return "Expert";
  if (skill >= 0.55) return "Sharpshooter";
  if (skill >= 0.35) return "Marksman";
  return "Novice";
}

// Unit conversions (display only; internals stay imperial).
export const YD_PER_M = 1.0936132983;
export const IN_PER_CM = 0.3937007874;

export function distanceToYd(value, unitSystem) {
  return unitSystem === "metric" ? value * YD_PER_M : value;
}
export function sizeToIn(value, unitSystem) {
  return unitSystem === "metric" ? value / IN_PER_CM : value;
}
export function speedToYps(value, unitSystem) {
  // metric input is m/s, imperial input is yd/s
  return unitSystem === "metric" ? value * YD_PER_M : value;
}

export function ydToDisplay(yd, unitSystem) {
  return unitSystem === "metric" ? yd / YD_PER_M : yd;
}
export function inToDisplay(inches, unitSystem) {
  return unitSystem === "metric" ? inches * 2.54 : inches;
}
