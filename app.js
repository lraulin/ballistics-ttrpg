import {
  thetaMoa, rangeFactor, angularVelocity, targetMovementMultiplier,
  finalChance, clamp, skillBand,
  distanceToYd, sizeToIn, speedToYps, ydToDisplay, inToDisplay,
} from "./calc.js";
import {
  rollD100, sampleDeviationDice, sampleDeviationNormal, tightnessForShotType,
} from "./dice.js";
import {
  BUILTIN_WEAPONS, getAllWeapons, addCustomWeapon, findWeapon, removeCustomWeapon,
} from "./presets.js";
import { loadState, saveState } from "./storage.js";

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);
const form = $("#calc-form");

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
  targetSize: $("#target-size"),
  thetaOut: $("#theta-out"),
  ratioOut: $("#ratio-out"),
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

  finalPct: $("#final-pct"),
  breakdown: $("#breakdown"),
  rollBtn: $("#roll-btn"),
  rollResult: $("#roll-result"),

  impactMethod: $("#impact-method"),
  deviateBtn: $("#deviate-btn"),
  impactDots: $("#impact-dots"),
  impactLast: $("#impact-last"),
  impactReadout: $("#impact-readout"),
  impactPanel: $("#impact-panel"),
};

// ---- State ----
const defaultState = {
  unitSystem: "imperial",
  skill: 0.55,
  platform: 1.0,
  weaponId: "carbine",
  distance: 50,          // yards
  targetSize: 20,        // inches
  shotType: "flash",
  aimWithin: 0.5,        // 0..1 slider within the shot-type range
  shooterMove: 1.0,
  targetSpeed: 0,        // yd/s
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
  others: [],            // [{id, label, value}]
  impactMethod: "dice",
};

let state = structuredClone(defaultState);

function mergeState(saved) {
  if (!saved || typeof saved !== "object") return;
  // Shallow merge with defaults, preserve nested adv
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

// ---- Derived values (always in imperial internally) ----
function compute() {
  const weapon = findWeapon(state.weaponId);
  const dispersion = weapon.dispersion;

  const distYd = state.distance;       // already stored as yd
  const targetInches = state.targetSize; // already stored as inches
  const theta = thetaMoa(targetInches, distYd);
  const rf = rangeFactor(theta, dispersion);
  const aim = aimingMultiplier();

  const groundYps = state.targetSpeed;  // stored as yd/s
  const av = angularVelocity(groundYps, state.targetAngle, distYd);
  const tmmBase = targetMovementMultiplier(av);
  const erraticMult = state.targetErratic ? 0.78 : 1.0;
  const tmm = tmmBase * erraticMult;

  const advMults = Object.values(state.adv);
  const otherMults = state.others.map(o => o.value);

  const fc = finalChance(state.skill, [
    rf, aim, state.shooterMove, tmm, state.platform,
    ...advMults, ...otherMults,
  ]);

  return { weapon, dispersion, theta, rf, aim, av, tmm, tmmBase, erraticMult, fc };
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
  // Show displayed values converted from internal yd/in.
  els.distance.value  = +ydToDisplay(state.distance, state.unitSystem).toFixed(2);
  els.targetSize.value = +inToDisplay(state.targetSize, state.unitSystem).toFixed(2);
  els.targetSpeed.value = +(state.unitSystem === "metric" ? state.targetSpeed / 1.0936132983 : state.targetSpeed).toFixed(2);
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

function render() {
  // Skill
  els.skillOut.textContent = fmt(state.skill, 2);
  els.skillBand.textContent = skillBand(state.skill);
  els.skill.value = state.skill;

  // Platform
  els.platOut.textContent = `×${fmt(state.platform, 2)}`;
  els.platform.value = state.platform.toFixed(2);

  // Weapon readout (render select handled separately)
  const d = compute();
  els.dispOut.textContent = fmt(d.dispersion, d.dispersion < 2 ? 2 : 1);

  // Range/target derived
  els.thetaOut.textContent = fmt(d.theta, 1);
  els.ratioOut.textContent = fmt(d.theta / d.dispersion, 2);
  els.rfOut.textContent = fmt(d.rf, 3);

  // Aim
  els.aimOut.textContent = `×${fmt(d.aim, 2)}`;
  els.aimSlider.value = state.aimWithin;

  // Shooter move
  els.shooterMove.value = state.shooterMove.toFixed(2);

  // Target move
  els.angleOut.textContent = `${state.targetAngle}°`;
  els.avOut.textContent = fmt(d.av, 1);
  els.tmmOut.textContent = `×${fmt(d.tmm, 2)}`;
  els.targetAngle.value = state.targetAngle;
  els.targetErratic.checked = state.targetErratic;

  // Advanced
  els.advancedCard.classList.toggle("open", state.advancedOpen);
  for (const [key, val] of Object.entries(state.adv)) {
    const sel = document.querySelector(`[data-adv="${key}"]`);
    if (sel) sel.value = val.toFixed(2);
  }

  // Radio buttons
  for (const r of document.querySelectorAll('input[name="shot"]')) {
    r.checked = (r.value === state.shotType);
  }

  // Impact method
  els.impactMethod.value = state.impactMethod;

  // Final chance + breakdown
  els.finalPct.textContent = `${Math.round(d.fc * 100)}%`;
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

// ---- Event wiring ----
function readNumber(el, fallback = 0) {
  const n = parseFloat(el.value);
  return isFinite(n) ? n : fallback;
}

function wire() {
  els.unit.addEventListener("change", () => {
    // Convert current stored (imperial) values back to display; no internal change.
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
    render();
    els.rollResult.textContent = "";
    els.rollResult.className = "roll-result";
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
      // Keep previous weapon selected visually
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

  els.targetSize.addEventListener("input", () => {
    const v = readNumber(els.targetSize, 1);
    state.targetSize = Math.max(0.1, sizeToIn(v, state.unitSystem));
    persist(); render();
  });

  for (const r of document.querySelectorAll('input[name="shot"]')) {
    r.addEventListener("change", () => {
      state.shotType = r.value;
      persist(); render();
    });
  }

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
  els.deviateBtn.addEventListener("click", doDeviate);

  els.impactMethod.addEventListener("change", () => {
    state.impactMethod = els.impactMethod.value;
    persist();
  });
}

// ---- Roll + impact ----
function doRoll() {
  const { fc } = compute();
  const roll = rollD100();
  const pct = Math.round(fc * 100);
  const hit = roll <= pct;
  const margin = Math.abs(roll - pct);
  els.rollResult.textContent = `d100 = ${roll} vs ${pct}% → ${hit ? "HIT" : "MISS"} (by ${margin})`;
  els.rollResult.className = `roll-result ${hit ? "hit" : "miss"}`;
  // Open impact panel so the player can sample where the shot actually landed.
  els.impactPanel.open = true;
  doDeviate();
}

function doDeviate() {
  const { dispersion } = compute();
  const tightness = tightnessForShotType(state.shotType);
  const { xMoa, yMoa } = state.impactMethod === "normal"
    ? sampleDeviationNormal(dispersion, tightness)
    : sampleDeviationDice(dispersion);

  const distYd = state.distance;
  const xIn = (xMoa * distYd) / 95.5;
  const yIn = (yMoa * distYd) / 95.5;
  const xDisp = inToDisplay(xIn, state.unitSystem);
  const yDisp = inToDisplay(yIn, state.unitSystem);
  const sizeUnit = state.unitSystem === "metric" ? "cm" : "in";

  // Plot on SVG: clamp dispersion display to fit ±3σ into the 100-unit viewBox half-width.
  const dispersionForScale = Math.max(dispersion, 0.5);
  const viewHalf = 45;
  const scale = viewHalf / (dispersionForScale * 3); // fits ±3σ of the normal approximation
  const cx = Math.max(-50, Math.min(50, xMoa * scale));
  const cy = Math.max(-50, Math.min(50, -yMoa * scale)); // invert: positive Y in MOA = below POA; SVG y grows downward, so up is negative

  // Move previous "last" dot into persistent dots, cap total to 20.
  const prev = els.impactLast;
  if (+prev.getAttribute("r") > 0) {
    const keep = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    keep.setAttribute("cx", prev.getAttribute("cx"));
    keep.setAttribute("cy", prev.getAttribute("cy"));
    keep.setAttribute("r", "1");
    keep.setAttribute("fill", "var(--muted)");
    keep.setAttribute("opacity", "0.5");
    els.impactDots.appendChild(keep);
    while (els.impactDots.childElementCount > 20) {
      els.impactDots.removeChild(els.impactDots.firstChild);
    }
  }
  prev.setAttribute("cx", cx.toFixed(2));
  prev.setAttribute("cy", cy.toFixed(2));
  prev.setAttribute("r", "2");

  els.impactReadout.textContent =
    `X ${xMoa >= 0 ? "R" : "L"} ${Math.abs(xMoa).toFixed(1)} MOA (${Math.abs(xDisp).toFixed(1)} ${sizeUnit}) · ` +
    `Y ${yMoa >= 0 ? "low" : "high"} ${Math.abs(yMoa).toFixed(1)} MOA (${Math.abs(yDisp).toFixed(1)} ${sizeUnit})`;
}

// ---- Init ----
function init() {
  mergeState(loadState());
  renderUnits();
  renderWeaponSelect();
  renderOthers();
  wire();
  render();

  // Register service worker only on http(s), not file://.
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

init();
