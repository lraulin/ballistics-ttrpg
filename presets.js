// Baked-in presets from chat.md plus user-saved custom weapons.

import { loadCustomWeapons, saveCustomWeapons } from "./storage.js";

// Default fire modes for a weapon if its preset omits the field. Mirrors a
// typical semi-automatic small-arm (single shot + deliberate or rapid pairs);
// burst and full-auto are explicitly opt-in per weapon.
export const DEFAULT_MODES = ["single", "controlled", "aggressive"];

export const BUILTIN_WEAPONS = [
  { id: "pistol",    name: "Pistol (service 9mm/.45)",   dispersion: 11,   recoilClass: 1.3,
    modes: ["single", "controlled", "aggressive"] },
  { id: "carbine",   name: "Carbine / service rifle",    dispersion: 3.5,  recoilClass: 1.0,
    modes: ["single", "controlled", "aggressive", "burst", "fullauto"] },
  { id: "precision", name: "Precision rifle (scoped)",   dispersion: 1.25, recoilClass: 0.75,
    modes: ["single", "controlled"] },
  { id: "slug",      name: "Shotgun slug",               dispersion: 6,    recoilClass: 1.4,
    modes: ["single", "controlled"] },
];

export function modesForWeapon(weapon) {
  return weapon?.modes ?? DEFAULT_MODES;
}

export function getAllWeapons() {
  return [...BUILTIN_WEAPONS, ...loadCustomWeapons()];
}

export function addCustomWeapon({ name, dispersion, recoilClass = 1.0 }) {
  const customs = loadCustomWeapons();
  const id = `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`;
  const entry = { id, name: name.trim(), dispersion: Number(dispersion), recoilClass: Number(recoilClass), custom: true };
  customs.push(entry);
  saveCustomWeapons(customs);
  return entry;
}

export function removeCustomWeapon(id) {
  const customs = loadCustomWeapons().filter(w => w.id !== id);
  saveCustomWeapons(customs);
}

export function findWeapon(id) {
  return getAllWeapons().find(w => w.id === id) ?? BUILTIN_WEAPONS[1];
}
