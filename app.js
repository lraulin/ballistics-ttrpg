import {
    angularVelocity,
    clamp,
    distanceToYd,
    finalChance,
    inToDisplay,
    sizeToIn,
    skillBand,
    speedToYps,
    targetMovementMultiplier,
    thetaMoa,
    ydToDisplay,
} from "./calc.js";
import {
    FIRE_MODE_LABELS,
    FIRE_MODE_RANGES,
    recoilMultiplier,
    rollD100,
    tightnessForShotType,
} from "./dice.js";
import {
    addCustomWeapon, findWeapon,
    getAllWeapons,
    modesForWeapon,
} from "./presets.js";
import {
    getSilhouette,
    loadSilhouette,
    monteCarloRF,
    POA_PRESETS,
    sampleImpactForOutcome,
    ZONE_DEFS,
} from "./silhouette.js";
import { loadState, saveState } from "./storage.js";

const SILHOUETTE_URL = "./assets/silhouette_transparent_packground.png";

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);

const els = {
  unit: $("#unit-system"),
  reset: $("#reset-btn"),

  skill: $("#skill"),
  skillOut: $("#skill-out"),
  skillBand: $("#skill-band"),

  platform: $("#platform"),
  platOut: $("#plat-out"),

  weaponSelect: $("#weapon-select"),
  customRow: $("#custom-weapon-row"),
  customName: $("#custom-name"),
  customMoa: $("#custom-moa"),
  saveWeapon: $("#save-weapon"),
  dispOut: $("#disp-out"),

  distance: $("#distance"),
  figureHeight: $("#figure-height"),
  widthScale: $("#width-scale"),
  widthOut: $("#width-out"),
  poaPreset: $("#poa-preset"),

  silhouetteStage: $("#silhouette-stage"),
  silhouetteImg: $("#silhouette-img"),
  silhouetteOverlay: $("#silhouette-overlay"),
  poaMarker: $("#poa-marker"),
  zoneOutline: $("#zone-outline"),
  impactDots: $("#impact-dots"),
  impactLast: $("#impact-last"),

  thetaOut: $("#theta-out"),
  rfOut: $("#rf-out"),

  aimSlider: $("#aim-slider"),
  aimOut: $("#aim-out"),

  shooterMove: $("#shooter-move"),

  targetSpeed: $("#target-speed"),
  targetAngle: $("#target-angle"),
  angleOut: $("#angle-out"),
  targetErratic: $("#target-erratic"),
  avOut: $("#av-out"),
  tmmOut: $("#tmm-out"),

  advancedCard: $("#advanced-card"),
  advancedToggle: $("#advanced-toggle"),

  otherMultipliers: $("#other-multipliers"),
  addOther: $("#add-other"),

  fireMode: $("#fire-mode"),
  roundCount: $("#round-count"),
  fireModeReadout: $("#fire-mode-readout"),

  finalPct: $("#final-pct"),
  breakdown: $("#breakdown"),
  rollBtn: $("#roll-btn"),
  rollResult: $("#roll-result"),
  impactReadout: $("#impact-readout"),
};

// ---- State ----
const defaultState = {
  unitSystem: "imperial",
  skill: 0.55,
  platform: 1.0,
  weaponId: "carbine",
  distance: 50,          // yards (internal)
  figureHeight: 70,      // inches (internal) — ~average adult male
  widthScale: 1.0,       // multiplier on figure width from image aspect
  poaPreset: "chest",
  shotType: "flash",
  fireMode: "single",
  roundCount: 1,
  aimWithin: 0.5,
  shooterMove: 1.0,
  targetSpeed: 0,
  targetAngle: 90,
  targetErratic: false,
  advancedOpen: false,
  adv: {
    supported: 1.0,
    acquisition: 1.0,
    lighting: 1.0,
    cover: 1.0,
    stress: 1.0,
    encumbrance: 1.0,
    predictability: 1.0,
  },
  others: [],
};

let state = structuredClone(defaultState);

function mergeState(saved) {
  if (!saved || typeof saved !== "object") return;
  state = {
    ...state,
    ...saved,
    adv: { ...state.adv, ...(saved.adv || {}) },
  };
}

// ---- Shot-type mapping ----
const SHOT_RANGES = {
  point:      [0.55, 0.70],
  flash:      [1.40, 1.70],
  deliberate: [1.80, 2.50],
};
function aimingMultiplier() {
  const [lo, hi] = SHOT_RANGES[state.shotType] || SHOT_RANGES.flash;
  return lo + state.aimWithin * (hi - lo);
}

// ---- Derived values ----
function compute() {
  const weapon = findWeapon(state.weaponId);
  const dispersion = weapon.dispersion;

  const distYd = state.distance;
  const theta = thetaMoa(state.figureHeight, distYd);
  const aim = aimingMultiplier();

  const av = angularVelocity(state.targetSpeed, state.targetAngle, distYd);
  const tmmBase = targetMovementMultiplier(av);
  const erratic = state.targetErratic ? 0.78 : 1.0;
  const tmm = tmmBase * erratic;

  const silh = getSilhouette();
  const zoneMask = silh?.zones?.[state.poaPreset] || null;
  const rf = silh ? monteCarloRF(silh, {
    figureHeightIn: state.figureHeight,
    widthScale: state.widthScale,
    distanceYd: distYd,
    dispersionMoa: dispersion,
    poaNorm: POA_PRESETS[state.poaPreset] || POA_PRESETS.chest,
  }, zoneMask) : 0;

  const advMults = Object.values(state.adv);
  const otherMults = state.others.map(o => o.value);

  // Shooter-control product (everything except RF). Drives both Final Chance
  // and dynamic dispersion: when control drops, σ widens so misses fly wide
  // instead of clipping the silhouette edge.
  const controlMults = [aim, state.shooterMove, tmm, state.platform, ...advMults, ...otherMults];
  let control = state.skill;
  for (const m of controlMults) {
    if (typeof m === "number" && isFinite(m) && m > 0) control *= m;
  }

  const fc = finalChance(state.skill, [rf, ...controlMults]);

  return { weapon, dispersion, theta, rf, aim, av, tmm, fc, control, zoneMask };
}

// ---- Rendering ----
function fmt(v, digits = 2) {
  if (!isFinite(v)) return "—";
  return v.toFixed(digits);
}

function renderUnits() {
  const metric = state.unitSystem === "metric";
  document.querySelectorAll('[data-unit]').forEach(el => {
    const kind = el.dataset.unit;
    if (kind === "dist")  el.textContent = metric ? "m" : "yd";
    if (kind === "size")  el.textContent = metric ? "cm" : "in";
    if (kind === "speed") el.textContent = metric ? "m/s" : "yd/s";
  });
  els.distance.value = +ydToDisplay(state.distance, state.unitSystem).toFixed(2);
  els.figureHeight.value = +inToDisplay(state.figureHeight, state.unitSystem).toFixed(1);
  els.targetSpeed.value = +(metric ? state.targetSpeed / 1.0936132983 : state.targetSpeed).toFixed(2);
}

function renderWeaponSelect() {
  const selected = state.weaponId;
  const all = getAllWeapons();
  els.weaponSelect.innerHTML = "";
  for (const w of all) {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = `${w.name} — ${w.dispersion} MOA${w.custom ? " ✦" : ""}`;
    els.weaponSelect.appendChild(opt);
  }
  const customOpt = document.createElement("option");
  customOpt.value = "__custom__";
  customOpt.textContent = "+ Add custom weapon…";
  els.weaponSelect.appendChild(customOpt);

  els.weaponSelect.value = all.some(w => w.id === selected) ? selected : "carbine";
}

function renderOthers() {
  els.otherMultipliers.innerHTML = "";
  for (const o of state.others) {
    const row = document.createElement("div");
    row.className = "other-row";
    row.innerHTML = `
      <input type="text" placeholder="Label (e.g. wind)" value="${escapeHtml(o.label)}">
      <input type="number" step="0.01" min="0.01" max="5" value="${o.value}">
      <button type="button" class="remove" aria-label="Remove">×</button>
    `;
    const [labelInput, valueInput, removeBtn] = row.children;
    labelInput.addEventListener("input", () => { o.label = labelInput.value; persist(); render(); });
    valueInput.addEventListener("input", () => {
      const n = parseFloat(valueInput.value);
      o.value = isFinite(n) && n > 0 ? n : 1;
      persist(); render();
    });
    removeBtn.addEventListener("click", () => {
      state.others = state.others.filter(x => x.id !== o.id);
      persist(); renderOthers(); render();
    });
    els.otherMultipliers.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function renderFireModeOptions(weapon) {
  const allowed = modesForWeapon(weapon);
  const current = els.fireMode.value;
  els.fireMode.innerHTML = "";
  for (const m of allowed) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = FIRE_MODE_LABELS[m];
    els.fireMode.appendChild(opt);
  }
  // If the previously-selected mode isn't allowed on this weapon, fall back
  // and reset round count to the new mode's default. Otherwise leave both alone.
  if (!allowed.includes(state.fireMode)) {
    state.fireMode = allowed[0];
    state.roundCount = FIRE_MODE_RANGES[state.fireMode].default;
  } else if (current !== state.fireMode) {
    els.fireMode.value = state.fireMode;
  }
}

function clampRoundsToMode(mode, n) {
  const r = FIRE_MODE_RANGES[mode] || FIRE_MODE_RANGES.single;
  return Math.max(r.min, Math.min(r.max, n | 0));
}

function renderPoaMarker() {
  const poa = POA_PRESETS[state.poaPreset] || POA_PRESETS.chest;
  const xPct = poa.x * 100;
  const yPct = poa.y * 100;
  const marker = els.poaMarker;
  const [ring, vLine, hLine] = marker.children;
  ring.setAttribute("cx", xPct.toFixed(2));
  ring.setAttribute("cy", yPct.toFixed(2));
  vLine.setAttribute("x1", xPct);       vLine.setAttribute("x2", xPct);
  vLine.setAttribute("y1", yPct - 4);   vLine.setAttribute("y2", yPct + 4);
  hLine.setAttribute("x1", xPct - 4);   hLine.setAttribute("x2", xPct + 4);
  hLine.setAttribute("y1", yPct);       hLine.setAttribute("y2", yPct);

  // Show the called-shot zone outline. Chest = no zone, so collapse the ellipse.
  const zone = ZONE_DEFS[state.poaPreset];
  if (zone) {
    els.zoneOutline.setAttribute("cx", (zone.cx * 100).toFixed(2));
    els.zoneOutline.setAttribute("cy", (zone.cy * 100).toFixed(2));
    els.zoneOutline.setAttribute("rx", (zone.rx * 100).toFixed(2));
    els.zoneOutline.setAttribute("ry", (zone.ry * 100).toFixed(2));
  } else {
    els.zoneOutline.setAttribute("rx", "0");
    els.zoneOutline.setAttribute("ry", "0");
  }
}

function render() {
  els.skillOut.textContent = fmt(state.skill, 2);
  els.skillBand.textContent = skillBand(state.skill);
  els.skill.value = state.skill;

  els.platOut.textContent = `×${fmt(state.platform, 2)}`;
  els.platform.value = state.platform.toFixed(2);

  const d = compute();
  els.dispOut.textContent = fmt(d.dispersion, d.dispersion < 2 ? 2 : 1);

  els.thetaOut.textContent = fmt(d.theta, 1);
  els.rfOut.textContent = fmt(d.rf, 3);

  els.aimOut.textContent = `×${fmt(d.aim, 2)}`;
  els.aimSlider.value = state.aimWithin;

  els.widthOut.textContent = `×${fmt(state.widthScale, 2)}`;
  els.widthScale.value = state.widthScale;
  els.poaPreset.value = state.poaPreset;

  els.shooterMove.value = state.shooterMove.toFixed(2);

  els.angleOut.textContent = `${state.targetAngle}°`;
  els.avOut.textContent = fmt(d.av, 1);
  els.tmmOut.textContent = `×${fmt(d.tmm, 2)}`;
  els.targetAngle.value = state.targetAngle;
  els.targetErratic.checked = state.targetErratic;

  els.advancedCard.classList.toggle("open", state.advancedOpen);
  for (const [key, val] of Object.entries(state.adv)) {
    const sel = document.querySelector(`[data-adv="${key}"]`);
    if (sel) sel.value = val.toFixed(2);
  }

  for (const r of document.querySelectorAll('input[name="shot"]')) {
    r.checked = (r.value === state.shotType);
  }

  renderFireModeOptions(d.weapon);
  els.fireMode.value = state.fireMode;
  const range = FIRE_MODE_RANGES[state.fireMode] || FIRE_MODE_RANGES.single;
  els.roundCount.min = range.min;
  els.roundCount.max = range.max;
  els.roundCount.value = state.roundCount;
  els.roundCount.disabled = range.min === range.max;
  els.fireModeReadout.textContent = describeFireMode(state.fireMode, state.roundCount, d.weapon);

  renderPoaMarker();

  els.finalPct.textContent = getSilhouette() ? `${Math.round(d.fc * 100)}%` : "…";
  els.breakdown.textContent = buildBreakdown(d);
}

function buildBreakdown(d) {
  const parts = [
    ["Skill", state.skill],
    ["RF", d.rf],
    ["Aim", d.aim],
    ["ShMv", state.shooterMove],
    ["TgtMv", d.tmm],
    ["Plat", state.platform],
  ];
  for (const [k, v] of Object.entries(state.adv)) {
    if (Math.abs(v - 1) > 1e-6) parts.push([k.slice(0, 4), v]);
  }
  for (const o of state.others) {
    if (Math.abs(o.value - 1) > 1e-6) parts.push([o.label || "other", o.value]);
  }
  const body = parts.map(([k, v]) => `${k} ${(+v).toFixed(2)}`).join(" × ");
  return `${body} → ${(d.fc * 100).toFixed(1)}%`;
}

// ---- Persistence ----
let saveTimer = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(state), 150);
}

// ---- Events ----
function readNumber(el, fallback = 0) {
  const n = parseFloat(el.value);
  return isFinite(n) ? n : fallback;
}

function wire() {
  els.unit.addEventListener("change", () => {
    state.unitSystem = els.unit.value;
    persist();
    renderUnits();
    render();
  });

  els.reset.addEventListener("click", () => {
    if (!confirm("Reset all inputs to defaults? (Saved custom weapons will be kept.)")) return;
    state = structuredClone(defaultState);
    persist();
    renderUnits();
    renderWeaponSelect();
    renderOthers();
    clearImpacts();
    render();
    els.rollResult.textContent = "";
    els.rollResult.className = "roll-result";
    els.impactReadout.textContent = "";
  });

  els.skill.addEventListener("input", () => {
    state.skill = clamp(readNumber(els.skill, 0.5));
    persist(); render();
  });

  els.platform.addEventListener("change", () => {
    state.platform = readNumber(els.platform, 1);
    persist(); render();
  });

  els.weaponSelect.addEventListener("change", () => {
    const val = els.weaponSelect.value;
    if (val === "__custom__") {
      els.customRow.hidden = false;
      els.customName.focus();
      els.weaponSelect.value = state.weaponId;
      return;
    }
    state.weaponId = val;
    els.customRow.hidden = true;
    persist(); render();
  });

  els.saveWeapon.addEventListener("click", () => {
    const name = els.customName.value.trim();
    const moa = parseFloat(els.customMoa.value);
    if (!name) { els.customName.focus(); return; }
    if (!(moa > 0 && moa < 100)) { els.customMoa.focus(); return; }
    const entry = addCustomWeapon({ name, dispersion: moa });
    state.weaponId = entry.id;
    els.customName.value = "";
    els.customMoa.value = "";
    els.customRow.hidden = true;
    persist();
    renderWeaponSelect();
    render();
  });

  els.distance.addEventListener("input", () => {
    const v = readNumber(els.distance, 1);
    state.distance = Math.max(0.1, distanceToYd(v, state.unitSystem));
    persist(); render();
  });

  els.figureHeight.addEventListener("input", () => {
    const v = readNumber(els.figureHeight, 70);
    state.figureHeight = Math.max(6, sizeToIn(v, state.unitSystem));
    persist(); render();
  });

  els.widthScale.addEventListener("input", () => {
    state.widthScale = readNumber(els.widthScale, 1);
    persist(); render();
  });

  els.poaPreset.addEventListener("change", () => {
    state.poaPreset = els.poaPreset.value;
    clearImpacts();
    persist(); render();
  });

  for (const r of document.querySelectorAll('input[name="shot"]')) {
    r.addEventListener("change", () => {
      state.shotType = r.value;
      persist(); render();
    });
  }

  els.fireMode.addEventListener("change", () => {
    state.fireMode = els.fireMode.value;
    state.roundCount = clampRoundsToMode(state.fireMode, state.roundCount || FIRE_MODE_RANGES[state.fireMode].default);
    persist(); render();
  });

  els.roundCount.addEventListener("input", () => {
    const n = parseInt(els.roundCount.value, 10);
    state.roundCount = clampRoundsToMode(state.fireMode, isFinite(n) ? n : FIRE_MODE_RANGES[state.fireMode].default);
    persist(); render();
  });

  els.aimSlider.addEventListener("input", () => {
    state.aimWithin = readNumber(els.aimSlider, 0.5);
    persist(); render();
  });

  els.shooterMove.addEventListener("change", () => {
    state.shooterMove = readNumber(els.shooterMove, 1);
    persist(); render();
  });

  els.targetSpeed.addEventListener("input", () => {
    const v = readNumber(els.targetSpeed, 0);
    state.targetSpeed = Math.max(0, speedToYps(v, state.unitSystem));
    persist(); render();
  });

  els.targetAngle.addEventListener("input", () => {
    state.targetAngle = readNumber(els.targetAngle, 90);
    persist(); render();
  });

  els.targetErratic.addEventListener("change", () => {
    state.targetErratic = els.targetErratic.checked;
    persist(); render();
  });

  els.advancedToggle.addEventListener("click", () => {
    state.advancedOpen = !state.advancedOpen;
    persist(); render();
  });

  document.querySelectorAll("[data-adv]").forEach(sel => {
    sel.addEventListener("change", () => {
      const key = sel.dataset.adv;
      state.adv[key] = parseFloat(sel.value) || 1;
      persist(); render();
    });
  });

  els.addOther.addEventListener("click", () => {
    state.others.push({
      id: `o_${Date.now().toString(36)}`,
      label: "",
      value: 1.0,
    });
    persist(); renderOthers(); render();
  });

  els.rollBtn.addEventListener("click", doRoll);
}

// ---- Roll + impact ----
function clearImpacts() {
  els.impactDots.innerHTML = "";
  els.impactLast.setAttribute("r", "0");
  els.impactLast.setAttribute("cx", "-10");
  els.impactLast.setAttribute("cy", "-10");
  els.impactLast.classList.remove("miss");
}

function describeFireMode(mode, rounds, weapon) {
  if (mode === "single") return "Single shot — full Final Chance.";
  const cls = weapon?.recoilClass ?? 1.0;
  const sample = [];
  for (let i = 0; i < Math.min(rounds, 5); i++) {
    sample.push(`×${recoilMultiplier(mode, i, cls).toFixed(2)}`);
  }
  return `${FIRE_MODE_LABELS[mode]}, ${rounds} rd · per-shot FC: ${sample.join(" → ")}${rounds > 5 ? " …" : ""}`;
}

function doRoll() {
  const silh = getSilhouette();
  if (!silh) return;
  const { fc, dispersion, weapon, control, zoneMask } = compute();
  const tightness = tightnessForShotType(state.shotType);
  const recoilCls = weapon?.recoilClass ?? 1.0;
  const rounds = state.fireMode === "single" ? 1 : Math.max(1, state.roundCount);
  const zoneLabel = zoneMask ? state.poaPreset : null;

  clearImpacts();

  const lines = [];
  let zoneHits = 0;
  let bodyHits = 0;
  let lastHit = false;

  for (let i = 0; i < rounds; i++) {
    const recoil = recoilMultiplier(state.fireMode, i, recoilCls);
    const shotFc = clamp(fc * recoil);
    const pct = Math.round(shotFc * 100);
    const roll = rollD100();
    const hit = roll <= pct;
    lastHit = hit;

    // Effective dispersion = base / control^0.65. Recoil for this shot is
    // folded into the control product so later shots in a string both lose
    // hit chance AND visibly spray wider.
    const shotControl = Math.max(0.05, control * recoil);
    const effectiveDispersion = dispersion / Math.pow(shotControl, 0.65);

    const impact = sampleImpactForOutcome(silh, {
      figureHeightIn: state.figureHeight,
      widthScale: state.widthScale,
      distanceYd: state.distance,
      dispersionMoa: effectiveDispersion,
      poaNorm: POA_PRESETS[state.poaPreset] || POA_PRESETS.chest,
    }, tightness, hit, zoneMask);

    if (impact.onZone) zoneHits++;
    if (impact.onBody) bodyHits++;

    plotShot(impact, hit, i === rounds - 1);
    lines.push(formatShotLine(i + 1, roll, pct, impact, zoneLabel));
  }

  if (rounds === 1) {
    const pct = Math.round(fc * 100);
    els.rollResult.textContent = `d100 vs ${pct}% → ${lastHit ? "HIT" : "MISS"}`;
    els.rollResult.className = `roll-result ${lastHit ? "hit" : "miss"}`;
    els.impactReadout.textContent = lines[0];
  } else {
    const cls = zoneHits === 0 ? "miss" : (zoneHits === rounds ? "hit" : "");
    const summary = zoneLabel
      ? `${zoneHits}/${rounds} on ${zoneLabel}, ${bodyHits}/${rounds} on body`
      : `${zoneHits}/${rounds} hit${zoneHits === 1 ? "" : "s"}`;
    els.rollResult.textContent = `${rounds}-rd ${FIRE_MODE_LABELS[state.fireMode]}: ${summary}`;
    els.rollResult.className = `roll-result ${cls}`;
    els.impactReadout.innerHTML = lines.map(l =>
      `<span class="shot-line">${escapeHtml(l)}</span>`
    ).join("");
  }
}

function formatShotLine(n, roll, pct, impact, zoneLabel) {
  const sizeUnit = state.unitSystem === "metric" ? "cm" : "in";
  const xDisp = inToDisplay(impact.xIn, state.unitSystem);
  const yDisp = inToDisplay(impact.yIn, state.unitSystem);
  const pos =
    `${impact.xMoa >= 0 ? "R" : "L"} ${Math.abs(xDisp).toFixed(1)} ${sizeUnit}, ` +
    `${impact.yMoa >= 0 ? "low" : "high"} ${Math.abs(yDisp).toFixed(1)} ${sizeUnit}`;

  let outcome;
  if (impact.onZone) {
    outcome = zoneLabel ? `HIT ${zoneLabel}` : `HIT`;
  } else if (impact.onBody) {
    outcome = zoneLabel ? `MISS ${zoneLabel} — hit body` : `MISS`;
  } else {
    outcome = `MISS — off`;
  }
  return `Shot ${n}: ${outcome} (d100=${roll} vs ${pct}%) · ${pos}`;
}

function plotShot(impact, isHit, isLatest) {
  const silh = getSilhouette();
  if (!silh) return;
  const xPct = (impact.xPx / silh.width) * 100;
  const yPct = (impact.yPx / silh.height) * 100;

  if (isLatest) {
    const last = els.impactLast;
    last.setAttribute("cx", xPct.toFixed(2));
    last.setAttribute("cy", yPct.toFixed(2));
    last.setAttribute("r", "1.4");
    last.classList.toggle("miss", !isHit);
  } else {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", xPct.toFixed(2));
    dot.setAttribute("cy", yPct.toFixed(2));
    dot.setAttribute("r", "1.0");
    if (!isHit) dot.classList.add("miss");
    els.impactDots.appendChild(dot);
  }
}

// ---- Init ----
async function init() {
  mergeState(loadState());
  renderUnits();
  renderWeaponSelect();
  renderOthers();
  wire();
  render();

  // Service worker (skip on file://).
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  // Async: load silhouette, then recompute RF.
  try {
    const silh = await loadSilhouette(SILHOUETTE_URL, 360);
    els.silhouetteImg.src = silh.displayUrl;
    // Set the overlay viewBox to percent space (already 0..100), image fills 100% × 100%.
    render();
  } catch (err) {
    els.impactReadout.textContent = `Could not load silhouette: ${err.message}`;
    els.finalPct.textContent = "—";
  }
}

init();
