// Lancer core bonuses (from the public lancer-data / COMP-CON data set, used under the Lancer Third
// Party License). MECHANICS ONLY: each core bonus's name, its manufacturer, and any FLAT, always-on
// mech-stat modifier it grants (e.g. Reinforced Frame +5 HP, Sloped Plating +1 Armor). Core bonuses
// whose effect is an action, a conditional, or a rules change (extra mounts, weapon bonuses, resistances)
// carry no mods and ship as a name only - the full effect text stays in the rulebook. See
// lib/systems/lancer.ts for the required in-app attribution.
//
// Rules (Lancer Core Rulebook): a pilot gains one core bonus every third license level, so the number
// available is floor(level / 3), to a maximum of 4 at LL12. GMS core bonuses are always available; a
// core bonus from any other manufacturer requires 3 license ranks in that manufacturer per bonus taken
// (3 for the first, 6 for the second, cumulative).

// Manufacturer strings match the frame manufacturer values in rules-data.ts, so license ranks can be
// tallied per manufacturer for the gating rule.
export const GMS = "GENERAL MASSIVE SYSTEMS";

// Flat, always-on mech-stat mods a core bonus can grant. Only set for core bonuses that are a plain
// stat change; everything else is name-only.
export interface LancerCbMods {
  hp?: number;
  armor?: number;
  evasion?: number;
  edef?: number;
  heatCap?: number;
  saveTarget?: number;
  size?: number;        // number of size INCREMENTS to raise the mech (0.5 -> 1 -> 2 -> 3, capped at 3)
}

export interface LancerCoreBonus {
  id: string;
  name: string;
  manufacturer: string;   // matches a frame manufacturer; GMS is always available
  mods?: LancerCbMods;
}

const cb = (id: string, name: string, manufacturer: string, mods?: LancerCbMods): LancerCoreBonus =>
  ({ id, name, manufacturer, ...(mods ? { mods } : {}) });

export const LANCER_CORE_BONUSES: LancerCoreBonus[] = [
  // GMS - always available
  cb("cb_improved_armament", "Improved Armament", GMS),
  cb("cb_integrated_weapon", "Integrated Weapon", GMS),
  cb("cb_mount_retrofitting", "Mount Retrofitting", GMS),
  cb("cb_universal_compatibility", "Universal Compatibility", GMS),
  cb("cb_auto_stabilizing_hardpoints", "Auto-Stabilizing Hardpoints", GMS),
  cb("cb_overpower_caliber", "Overpower Caliber", GMS),

  // IPS-Northstar - durability & melee
  cb("cb_briareos_frame", "Briareos Frame", "IPS-NORTHSTAR"),
  cb("cb_fomorian_frame", "Fomorian Frame", "IPS-NORTHSTAR", { size: 1 }),
  cb("cb_gyges_frame", "Gyges Frame", "IPS-NORTHSTAR"),
  cb("cb_reinforced_frame", "Reinforced Frame", "IPS-NORTHSTAR", { hp: 5 }),
  cb("cb_sloped_plating", "Sloped Plating", "IPS-NORTHSTAR", { armor: 1 }),
  cb("cb_titanomachy_mesh", "Titanomachy Mesh", "IPS-NORTHSTAR"),

  // Smith-Shimano Corpro - speed, evasion, ranged
  cb("cb_all_theater_movement", "All-Theater Movement Suite", "SMITH-SHIMANO CORPRO"),
  cb("cb_full_subjectivity_sync", "Full Subjectivity Sync", "SMITH-SHIMANO CORPRO", { evasion: 2 }),
  cb("cb_ghostweave", "Ghostweave", "SMITH-SHIMANO CORPRO"),
  cb("cb_integrated_nerveweave", "Integrated Nerveweave", "SMITH-SHIMANO CORPRO"),
  cb("cb_kai_bioplating", "Kai Bioplating", "SMITH-SHIMANO CORPRO"),
  cb("cb_neurolink_targeting", "Neurolink Targeting", "SMITH-SHIMANO CORPRO"),

  // HORUS - electronic warfare, AIs
  cb("cb_lesson_disbelief", "The Lesson of Disbelief", "HORUS", { edef: 2 }),
  cb("cb_lesson_open_door", "The Lesson of the Open Door", "HORUS", { saveTarget: 2 }),
  cb("cb_lesson_held_image", "The Lesson of the Held Image", "HORUS"),
  cb("cb_lesson_thinking_tomorrow", "The Lesson of Thinking-Tomorrow's-Thought", "HORUS"),
  cb("cb_lesson_transubstantiation", "The Lesson of Transubstantiation", "HORUS"),
  cb("cb_lesson_shaping", "The Lesson of Shaping", "HORUS"),

  // Harrison Armory - heat, Limited, Overcharge
  cb("cb_adaptive_reactor", "Adaptive Reactor", "HARRISON ARMORY"),
  cb("cb_armory_sculpted_chassis", "Armory-Sculpted Chassis", "HARRISON ARMORY"),
  cb("cb_heatfall_coolant", "Heatfall Coolant System", "HARRISON ARMORY"),
  cb("cb_integrated_ammo_feeds", "Integrated Ammo Feeds", "HARRISON ARMORY"),
  cb("cb_stasis_shielding", "Stasis Shielding", "HARRISON ARMORY"),
  cb("cb_superior_by_design", "Superior by Design", "HARRISON ARMORY", { heatCap: 2 }),
];

export const coreBonusById = (id: string): LancerCoreBonus | undefined =>
  LANCER_CORE_BONUSES.find((c) => c.id === id);

// A pilot gains one core bonus every third level, capped at 4 (LL 3/6/9/12).
export function coreBonusSlots(level: number): number {
  return Math.min(4, Math.floor(Math.max(0, Math.min(12, Math.round(level) || 0)) / 3));
}

// License ranks a pilot holds with one manufacturer, summed across that manufacturer's license lines.
export function ranksForManufacturer(
  licenses: Record<string, number>,
  frames: Array<{ id: string; manufacturer: string }>,
  manufacturer: string,
): number {
  return Object.entries(licenses).reduce((n, [frameId, rank]) => {
    const f = frames.find((x) => x.id === frameId);
    return f && f.manufacturer === manufacturer ? n + Math.max(0, rank || 0) : n;
  }, 0);
}

// How many core bonuses a pilot may take from a manufacturer: GMS is unlimited (by slots); every other
// manufacturer allows one per 3 license ranks in it.
export function coreBonusesAllowedFromManufacturer(manufacturer: string, ranksInManufacturer: number): number {
  if (manufacturer === GMS) return Infinity;
  return Math.floor(Math.max(0, ranksInManufacturer) / 3);
}

// A short label for a core bonus's flat mod, e.g. "+5 HP", "+1 Armor", "+1 size".
export function coreBonusModLabel(m: LancerCbMods | undefined): string {
  if (!m) return "";
  const parts: string[] = [];
  if (m.hp) parts.push(`+${m.hp} HP`);
  if (m.armor) parts.push(`+${m.armor} Armor`);
  if (m.evasion) parts.push(`+${m.evasion} Evasion`);
  if (m.edef) parts.push(`+${m.edef} E-Defense`);
  if (m.heatCap) parts.push(`+${m.heatCap} Heat Cap`);
  if (m.saveTarget) parts.push(`+${m.saveTarget} Save`);
  if (m.size) parts.push(`+${m.size} size`);
  return parts.join(", ");
}
