// Lancer loadout model: mech WEAPONS (constrained by the frame's mounts, no SP cost) and mech SYSTEMS
// (bought with System Points). Parallel split to character.ts / rules-data.ts: this file is the types +
// rules (mount fittings, SP maths); loadout-data.ts is the item data. Pure, no I/O.
//
// LICENSING: item DATA is used under the Lancer Third Party License (see lib/systems/lancer.ts). Only
// MECHANICS ship (stats, tags, SP), never Massif Press's effect prose.
//
// Mounts and fittings (Lancer Core Rulebook): a weapon's SIZE (Auxiliary, Main, Heavy, Superheavy) must
// fit the MOUNT it goes in. An Auxiliary mount takes an Auxiliary weapon; a Main mount takes a Main or
// Auxiliary; a Flex mount takes a Main or Auxiliary (or two Auxiliary, not modelled here); a Heavy mount
// takes up to a Superheavy. Weapons cost no SP; only systems (and weapon mods, not modelled yet) do.

export type WeaponSize = "Auxiliary" | "Main" | "Heavy" | "Superheavy";
export type MountType = "Auxiliary" | "Main" | "Flex" | "Heavy";

export interface LancerWeapon {
  id: string;
  name: string;
  size: string;           // WeaponSize; kept as string to match the generated data verbatim
  type: string;           // Rifle, CQB, Cannon, Launcher, Melee, Nexus, ...
  damage: string[];       // e.g. ["2d6 Kinetic"]
  range: string[];        // e.g. ["Range 20"], ["Threat 1"]
  tags: string[];         // mechanical keyword labels, values substituted (e.g. "Reliable 2")
  manufacturer: string;
  license: string;        // "GMS", "IPS-N", "HA", "SSC", "HORUS", or "" for integrated weapons
  licenseLevel: number;
}

export interface LancerSystem {
  id: string;
  name: string;
  type: string;           // AI, Deployable, Drone, Flight System, Shield, Tech
  sp: number;             // System Point cost
  tags: string[];
  manufacturer: string;
  license: string;
  licenseLevel: number;
}

// Which weapon sizes each mount type accepts (Lancer core mount-fitting table).
export const MOUNT_FITTINGS: Record<string, string[]> = {
  Auxiliary: ["Auxiliary"],
  Main: ["Main", "Auxiliary"],
  Flex: ["Main", "Auxiliary"],
  Heavy: ["Superheavy", "Heavy", "Main", "Auxiliary"],
};

// Can a weapon of this size be mounted in this mount type? Unknown mounts accept anything (fail open).
export function fitsMount(size: string, mount: string): boolean {
  const allowed = MOUNT_FITTINGS[mount];
  return allowed ? allowed.includes(size) : true;
}

// Total System Points consumed by a list of equipped system ids.
export function systemsSpUsed(ids: string[], systems: LancerSystem[]): number {
  return ids.reduce((n, id) => {
    const s = systems.find((x) => x.id === id);
    return n + (s ? s.sp : 0);
  }, 0);
}

// A weapon mod attaches to a single mounted weapon and costs SP from the same pool as systems. A mod is
// restricted to certain weapon TYPES (Melee, Rifle, ...) and may exclude certain SIZES (e.g. Superheavy).
export interface LancerMod {
  id: string;
  name: string;
  sp: number;
  allowedTypes: string[];    // weapon types this mod can attach to; empty = any type
  restrictedSizes: string[]; // weapon sizes this mod cannot attach to; empty = no size restriction
  addedTags: string[];       // tags the mod grants the weapon
  addedRange: string[];      // range profiles the mod grants (e.g. "Range 5")
  license: string;
  licenseLevel: number;
}

// Can this mod be applied to this weapon? Type must be allowed (if the mod restricts types) and the
// weapon's size must not be restricted.
export function modFits(mod: LancerMod, weapon: LancerWeapon): boolean {
  if (mod.allowedTypes.length && !mod.allowedTypes.includes(weapon.type)) return false;
  if (mod.restrictedSizes.length && mod.restrictedSizes.includes(weapon.size)) return false;
  return true;
}

// Total SP consumed by a list of applied mod ids.
export function modsSpUsed(ids: string[], mods: LancerMod[]): number {
  return ids.reduce((n, id) => {
    const m = mods.find((x) => x.id === id);
    return n + (m ? m.sp : 0);
  }, 0);
}
