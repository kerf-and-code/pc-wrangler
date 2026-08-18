// Draw Steel (MCDM) character derivation engine. The Forge's D&D side feeds a Build to deriveSheet;
// PF2e and Daggerheart have their own engines; this is the Draw Steel parallel: a DSBuild (the player's
// choices) + rules data -> a computed DSSheet. Pure and deterministic, no I/O, re-derives on every edit.
//
// LICENSING: the rules DATA is used under the Draw Steel Creator License (see lib/systems/drawsteel.ts
// for the required attribution). Only MECHANICS ship (the numbers), never MCDM's descriptive prose.
//
// Model (Draw Steel Rules Reference): five characteristics (Might, Agility, Reason, Intuition, Presence)
// assigned at creation from the class's fixed values plus a chosen array. Base hero stats are size 1M,
// speed 5, stability 0, disengage 1. Stamina = class starting Stamina + (level-1) * class per-level gain
// + the kit's Stamina bonus, which is "per echelon" and so scales as (kit value * echelon). Recoveries
// come from the class; a Recovery restores 1/3 of maximum Stamina; a hero is Winded at 1/2. Speed and
// stability and disengage and the weapon damage/distance bonuses come from the kit. Potency (weak /
// average / strong) is the class's key characteristic minus 2 / minus 1 / itself.

export type DSChar = "might" | "agility" | "reason" | "intuition" | "presence";
export const DS_CHARS: DSChar[] = ["might", "agility", "reason", "intuition", "presence"];
export const DS_CHAR_LABEL: Record<DSChar, string> = {
  might: "Might", agility: "Agility", reason: "Reason", intuition: "Intuition", presence: "Presence",
};

export type DSEchelon = 1 | 2 | 3 | 4;
// Echelons: 1st = levels 1-3, 2nd = 4-6, 3rd = 7-9, 4th = 10.
export function echelonOf(level: number): DSEchelon {
  if (level <= 3) return 1;
  if (level <= 6) return 2;
  if (level <= 9) return 3;
  return 4;
}

// ---- rules-data shapes (populated in the data module) ------------------------------------------

export interface DSKit {
  id: string;
  name: string;
  armor: string;
  weapon: string;
  staminaPerEchelon: number;                 // added to max Stamina as (value * echelon)
  speed: number;
  stability: number;
  meleeDamage: [number, number, number];     // bonus to tier 1 / 2 / 3 melee ability damage
  rangedDamage: [number, number, number];    // bonus to tier 1 / 2 / 3 ranged ability damage
  meleeDistance: number;
  rangedDistance: number;
  disengage: number;
}

export interface DSClass {
  id: string;
  name: string;
  fixed: Partial<Record<DSChar, number>>;    // characteristics preset at creation (e.g. Might 2)
  arrays: number[][];                        // array options to distribute across the non-fixed traits
  keyChar: DSChar;                           // the characteristic that drives Potency
  baseStamina: number;                       // starting Stamina at 1st level
  staminaPerLevel: number;                   // Stamina gained at 2nd and higher levels
  recoveries: number;
}

export interface DSAncestry {
  id: string;
  name: string;
  size: string;                              // "1M" default; e.g. "1L" (Hakaan), "1S" (Polder)
  speed: number;                             // 5 default; e.g. 7 (Memonek)
}

export interface DSRules {
  classes: Record<string, DSClass>;
  kits: Record<string, DSKit>;
  ancestries: Record<string, DSAncestry>;
}

// ---- the build (player choices) + the derived sheet --------------------------------------------

export interface DSBuild {
  level: number;                             // 1-10
  classId: string;
  ancestryId: string;
  kitId: string;                             // "" for no kit (casters may run kitless)
  characteristics: Record<DSChar, number>;   // the five assigned scores
}

export interface DSSheet {
  level: number;
  echelon: DSEchelon;
  characteristics: Record<DSChar, number>;
  stamina: number;
  winded: number;                            // floor(stamina / 2)
  recoveries: number;
  recoveryValue: number;                     // floor(stamina / 3), restored per Recovery spent
  speed: number;
  stability: number;
  size: string;
  disengage: number;
  meleeDamage: [number, number, number];
  rangedDamage: [number, number, number];
  meleeDistance: number;
  rangedDistance: number;
  potency: { weak: number; average: number; strong: number };
  keyChar: DSChar;
}

export function emptyDSChars(): Record<DSChar, number> {
  return { might: 0, agility: 0, reason: 0, intuition: 0, presence: 0 };
}

export function emptyDSBuild(): DSBuild {
  return { level: 1, classId: "", ancestryId: "", kitId: "", characteristics: emptyDSChars() };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function deriveDrawSteelSheet(build: DSBuild, rules: DSRules): DSSheet | null {
  const cls = rules.classes[build.classId];
  if (!cls) return null;
  const level = clamp(Math.round(build.level) || 1, 1, 10);
  const echelon = echelonOf(level);
  const anc = build.ancestryId ? rules.ancestries[build.ancestryId] : undefined;
  const kit = build.kitId ? rules.kits[build.kitId] : undefined;

  const characteristics = emptyDSChars();
  for (const c of DS_CHARS) characteristics[c] = build.characteristics[c] ?? 0;

  // Stamina: class base + per-level gains + the kit's per-echelon bonus (value * echelon).
  const kitStamina = kit ? kit.staminaPerEchelon * echelon : 0;
  const stamina = cls.baseStamina + (level - 1) * cls.staminaPerLevel + kitStamina;
  const winded = Math.floor(stamina / 2);
  const recoveryValue = Math.floor(stamina / 3);

  const speed = (anc?.speed ?? 5) + (kit?.speed ?? 0);
  const stability = 0 + (kit?.stability ?? 0);
  const size = anc?.size ?? "1M";
  const disengage = 1 + (kit?.disengage ?? 0);

  const meleeDamage: [number, number, number] = kit ? [...kit.meleeDamage] : [0, 0, 0];
  const rangedDamage: [number, number, number] = kit ? [...kit.rangedDamage] : [0, 0, 0];

  const key = characteristics[cls.keyChar];
  const potency = { weak: key - 2, average: key - 1, strong: key };

  return {
    level,
    echelon,
    characteristics,
    stamina,
    winded,
    recoveries: cls.recoveries,
    recoveryValue,
    speed,
    stability,
    size,
    disengage,
    meleeDamage,
    rangedDamage,
    meleeDistance: kit?.meleeDistance ?? 0,
    rangedDistance: kit?.rangedDistance ?? 0,
    potency,
    keyChar: cls.keyChar,
  };
}
