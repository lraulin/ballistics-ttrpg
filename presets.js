// Baked-in presets from chat.md plus user-saved custom weapons.

import { loadCustomWeapons, saveCustomWeapons } from "./storage.js";

export const BUILTIN_WEAPONS = [
  { id: "pistol",    name: "Pistol (service 9mm/.45)",   dispersion: 11 },
  { id: "carbine",   name: "Carbine / service rifle",    dispersion: 3.5 },
  { id: "precision", name: "Precision rifle (scoped)",   dispersion: 1.25 },
  { id: "slug",      name: "Shotgun slug",               dispersion: 6 },
];

export function getAllWeapons() {
  return [...BUILTIN_WEAPONS, ...loadCustomWeapons()];
}

export function addCustomWeapon({ name, dispersion }) {
  const customs = loadCustomWeapons();
  const id = `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4).toString(36)}`;
  const entry = { id, name: name.trim(), dispersion: Number(dispersion), custom: true };
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
