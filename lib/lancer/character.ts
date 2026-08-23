// Lancer (Massif Press) character derivation engine. Parallel to the D&D / PF2e / Daggerheart / Draw
// Steel engines: a LancerBuild (the player's choices) + frame data -> a computed LancerSheet. Pure and
// deterministic, no I/O, re-derives on every edit.
//
// LICENSING: the frame DATA is used under the Lancer Third Party License (see lib/systems/lancer.ts for
// the required attribution). Only MECHANICS ship (the numbers), never Massif Press's descriptive prose.
//
// Model (Lancer Core Rulebook): a pilot has a license level (0-12) that sets their GRIT, a bonus equal to
// half their level rounded up (0 at LL0, 1 at LL1-2, up to 6 at LL11+). A pilot distributes points across
// four MECH SKILLS (HASE): Hull, Agility, Systems, Engineering. A mech's stats are its frame's printed
// base values improved by those skills and by Grit:
//   HP           = frame HP + Grit + 2 x Hull
//   Repair Cap   = frame Repair Cap + floor(Hull / 2)
//   Evasion      = frame Evasion + Agility
//   Speed        = frame Speed + floor(Agility / 2)
//   E-Defense    = frame E-Defense + Systems
//   Tech Attack  = frame Tech Attack + Systems
//   System Points= frame SP + Grit + floor(Systems / 2)
//   Heat Cap     = frame Heat Cap + Engineering
//   Limited Bonus= floor(Engineering / 2)
//   Save Target  = frame Save (10) + Grit
//   Attack bonus = Grit
// Size, Structure, Reactor Stress, Sensors, and Armor come straight from the frame. The pilot's own body
// has HP = 6 + Grit, Evasion 10, E-Defense 10, Speed 4, Armor 0, and adds Grit to their attacks. A worn
// hardsuit (pilot armor) overrides the pilot's Armor / Evasion / E-Defense / Speed and adds its bonus
// (extra HP, or a Flight / Invisibility flag); pilot weapons and other gear are carried, not derived.

import { coreBonusById } from "./core-bonuses";
import { pilotArmorById } from "./pilot-gear";

export type MechSkill = "hull" | "agility" | "systems" | "engineering";
export const MECH_SKILLS: MechSkill[] = ["hull", "agility", "systems", "engineering"];
export const MECH_SKILL_LABEL: Record<MechSkill, string> = {
  hull: "Hull", agility: "Agility", systems: "Systems", engineering: "Engineering",
};

export const MAX_LEVEL = 12;
export const MAX_MECH_SKILL = 6;    // max points in any single mech skill

// ---- rules-data shapes (populated in the data module) ------------------------------------------

export interface LancerFrameStats {
  size: number; structure: number; stress: number; armor: number; hp: number;
  evasion: number; edef: number; heatCap: number; repCap: number; sensors: number;
  techAttack: number; save: number; speed: number; sp: number;
}

// A frame TRAIT: a named passive/always-available frame ability. MECHANICS ONLY - the name plus a short
// in-house telegraphic summary of what it does; never Massif Press's descriptive prose. Traits are
// reference data carried on the frame (shown read-only in the Forge); they are NOT auto-applied to the
// derived stat block because nearly all are conditional, reactive, or active rather than flat always-on
// modifiers.
export interface LancerFrameTrait {
  name: string;
  note: string;
}

// A frame's CORE SYSTEM: its signature power. Has a system name and up to an active and/or passive power
// (with the activation type and any frequency limit), each with a short in-house telegraphic note.
export interface LancerCoreSystem {
  name: string;
  activeName?: string;
  passiveName?: string;
  activation?: string;   // "Protocol" | "Quick" | "Full" (action needed to activate)
  frequency?: string;    // e.g. "1/scene"
  activeNote?: string;
  passiveNote?: string;
}

export interface LancerFrame {
  id: string;
  name: string;
  manufacturer: string;
  licenseLevel: number;      // the license level at which the frame unlocks (0 for GMS)
  mounts: string[];          // e.g. ["Main", "Flex", "Heavy"]
  base: LancerFrameStats;
  traits?: LancerFrameTrait[];   // named frame traits (reference, not auto-applied)
  coreSystem?: LancerCoreSystem; // the frame's core system (reference)
}

export interface LancerRules {
  frames: LancerFrame[];
}

// ---- the build (player choices) + the derived sheet --------------------------------------------

export interface LancerBuild {
  level: number;                          // license level 0-12
  frameId: string;
  skills: Record<MechSkill, number>;      // HASE, 0-6 each
  weapons: string[];                      // one weapon id per frame mount slot (index-aligned), "" = empty
  mods: string[];                         // one weapon-mod id per mount slot (index-aligned to weapons), "" = none
  systems: string[];                      // equipped mech system ids (bought with SP)
  talents: Record<string, number>;        // talentId -> rank (1..3)
  licenses: Record<string, number>;       // frameId (license line) -> rank (1..3)
  skillTriggers: Record<string, number>;  // skillTriggerId -> rank (1..3); rank N = +2N bonus
  coreBonuses: string[];                   // chosen core-bonus ids (one per 3 license levels)
  pilotArmor: string;                      // one hardsuit id, "" = riding naked
  pilotWeapons: string[];                  // up to two pilot-weapon ids
  pilotGear: string[];                     // up to three other pilot-gear ids
}

export interface LancerPilotStats {
  hp: number; evasion: number; edef: number; speed: number; armor: number; attackBonus: number;
  hardsuit?: string;       // name of the worn hardsuit, if any
  flight?: boolean;        // hardsuit grants Flight
  invisibility?: boolean;  // hardsuit can turn Invisible
}

export interface LancerMechStats {
  hp: number; repCap: number; evasion: number; speed: number; edef: number; techAttack: number;
  sp: number; heatCap: number; limitedBonus: number; saveTarget: number; attackBonus: number;
  sensors: number; armor: number; size: number; structure: number; stress: number;
}

export interface LancerSheet {
  level: number;
  grit: number;
  skills: Record<MechSkill, number>;
  frame: LancerFrame;
  pilot: LancerPilotStats;
  mech: LancerMechStats;
}

export function emptyMechSkills(): Record<MechSkill, number> {
  return { hull: 0, agility: 0, systems: 0, engineering: 0 };
}

export function emptyLancerBuild(): LancerBuild {
  return { level: 0, frameId: "", skills: emptyMechSkills(), weapons: [], mods: [], systems: [], talents: {}, licenses: {}, skillTriggers: {}, coreBonuses: [], pilotArmor: "", pilotWeapons: [], pilotGear: [] };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Raise a mech's size by a number of increments: 0.5 -> 1 -> 2 -> 3, capped at 3 (Fomorian Frame).
function incrementSize(size: number, steps: number): number {
  let s = size;
  for (let i = 0; i < Math.max(0, steps); i++) s = s < 1 ? 1 : Math.min(3, s + 1);
  return s;
}

// Grit: half the pilot's license level, rounded up. 0 at LL0, 1 at LL1-2, ... 6 at LL11-12.
export function gritOf(level: number): number {
  return Math.ceil(clamp(Math.round(level) || 0, 0, MAX_LEVEL) / 2);
}

// Total mech-skill points spent, for the builder's readout (not enforced here).
export function mechSkillSpent(skills: Record<MechSkill, number>): number {
  return MECH_SKILLS.reduce((n, k) => n + Math.max(0, skills[k] || 0), 0);
}

export function deriveLancerSheet(build: LancerBuild, rules: LancerRules): LancerSheet | null {
  const frame = rules.frames.find((f) => f.id === build.frameId);
  if (!frame) return null;

  const level = clamp(Math.round(build.level) || 0, 0, MAX_LEVEL);
  const grit = gritOf(level);

  const sk = emptyMechSkills();
  for (const k of MECH_SKILLS) sk[k] = clamp(Math.round(build.skills[k]) || 0, 0, MAX_MECH_SKILL);
  const { hull, agility, systems, engineering } = sk;

  const b = frame.base;

  // Core-bonus flat mods: sum the always-on stat changes from the chosen core bonuses (Reinforced
  // Frame +5 HP, Sloped Plating +1 Armor, Full Subjectivity Sync +2 Evasion, etc.). Bonuses without a
  // flat mod contribute nothing here; their effects are read off the sheet notes / rulebook.
  const cb = { hp: 0, armor: 0, evasion: 0, edef: 0, heatCap: 0, saveTarget: 0, size: 0 };
  for (const id of build.coreBonuses ?? []) {
    const m = coreBonusById(id)?.mods;
    if (!m) continue;
    cb.hp += m.hp ?? 0; cb.armor += m.armor ?? 0; cb.evasion += m.evasion ?? 0;
    cb.edef += m.edef ?? 0; cb.heatCap += m.heatCap ?? 0; cb.saveTarget += m.saveTarget ?? 0;
    cb.size += m.size ?? 0;
  }

  // Pilot body: bare-body defaults, or the worn hardsuit's Armor / Evasion / E-Defense / Speed plus its
  // bonus (extra HP, or a Flight / Invisibility flag). A pilot always adds Grit to their attacks.
  const suit = build.pilotArmor ? pilotArmorById(build.pilotArmor) : undefined;
  const pilot: LancerPilotStats = suit
    ? {
        hp: 6 + grit + suit.hpBonus,
        evasion: suit.evasion,
        edef: suit.edef,
        speed: suit.speed,
        armor: suit.armor,
        attackBonus: grit,
        hardsuit: suit.name,
        ...(suit.flight ? { flight: true } : {}),
        ...(suit.invisibility ? { invisibility: true } : {}),
      }
    : {
        hp: 6 + grit,
        evasion: 10,
        edef: 10,
        speed: 4,
        armor: 0,
        attackBonus: grit,
      };

  const mech: LancerMechStats = {
    hp: b.hp + grit + 2 * hull + cb.hp,
    repCap: b.repCap + Math.floor(hull / 2),
    evasion: b.evasion + agility + cb.evasion,
    speed: b.speed + Math.floor(agility / 2),
    edef: b.edef + systems + cb.edef,
    techAttack: b.techAttack + systems,
    sp: b.sp + grit + Math.floor(systems / 2),
    heatCap: b.heatCap + engineering + cb.heatCap,
    limitedBonus: Math.floor(engineering / 2),
    saveTarget: b.save + grit + cb.saveTarget,
    attackBonus: grit,
    sensors: b.sensors,
    armor: b.armor + cb.armor,
    size: incrementSize(b.size, cb.size),
    structure: b.structure,
    stress: b.stress,
  };

  return { level, grit, skills: sk, frame, pilot, mech };
}

// Display helper: Lancer size 0.5 prints as "1/2"; whole sizes print as themselves.
export function sizeLabel(size: number): string {
  return size === 0.5 ? "1/2" : `${size}`;
}
