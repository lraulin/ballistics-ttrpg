// Thin localStorage wrappers. Silently fall back to in-memory if storage is unavailable.

const KEY_CUSTOM = "ballistics.customWeapons.v1";
const KEY_STATE = "ballistics.state.v1";

const memoryStore = new Map();

function safeGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v;
  } catch {
    return memoryStore.get(key) ?? null;
  }
}
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

export function loadCustomWeapons() {
  const raw = safeGet(KEY_CUSTOM);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(w => w && typeof w.name === "string" && typeof w.dispersion === "number");
  } catch {
    return [];
  }
}

export function saveCustomWeapons(list) {
  safeSet(KEY_CUSTOM, JSON.stringify(list));
}

export function loadState() {
  const raw = safeGet(KEY_STATE);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function saveState(state) {
  try {
    safeSet(KEY_STATE, JSON.stringify(state));
  } catch {}
}
