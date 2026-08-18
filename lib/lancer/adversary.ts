// Lancer NPC (adversary) stat-block schema for Six Axes' Monster Maker. The parallel to the D&D
// StatBlockDoc, PF2e PF2Creature, Daggerheart DHAdversary, and Draw Steel DSAdversary: an
// authored-directly stat block (no derivation), so what the GM types IS the NPC. Field structure follows
// the Lancer NPC stat block (tier, class, role, the mech-scale defensive/offensive stats, and typed
// feature lists).
//
// LICENSING: this ships only the empty SHAPE and generic role labels, never Massif Press's NPC class
// stats or feature prose (that content lives in the Core Rulebook / supplements and is not in the public
// data set). A GM authors their own NPCs here. Used under the Lancer Third Party License; see
// lib/systems/lancer.ts for the required in-app attribution.

export type LancerNPCRole =
  | "striker" | "artillery" | "controller" | "defender" | "support" | "biological" | "other";
// [value, label] tuples for the picker; Striker first (a common default).
export const LANCER_NPC_ROLES: [LancerNPCRole, string][] = [
  ["striker", "Striker"], ["artillery", "Artillery"], ["controller", "Controller"],
  ["defender", "Defender"], ["support", "Support"], ["biological", "Biological"], ["other", "Other"],
];

export type LancerNPCTier = 1 | 2 | 3;
export const LANCER_NPC_TIERS: LancerNPCTier[] = [1, 2, 3];

// Lancer sizes, as [value, label] (0.5 prints as "1/2").
export const LANCER_NPC_SIZES: [number, string][] = [
  [0.5, "1/2"], [1, "1"], [2, "2"], [3, "3"], [4, "4"],
];

// A free-text stat-block entry (name + description), same shape as the other editors' entries so they
// share the EntryListPanel. Kept local to avoid a circular import with stat-blocks.
export type LancerEntry = { name: string; desc: string };

export interface LancerNPC {
  tier: LancerNPCTier;
  className: string;          // the NPC class name, e.g. "Assault", "Ronin" (GM-authored)
  role: LancerNPCRole;
  size: number;              // 0.5, 1, 2, 3, 4
  structure: number;
  hp: number;
  armor: number;
  evasion: number;
  edef: number;              // E-Defense
  heatcap: number;           // Heat Capacity
  speed: number;
  sensors: number;
  saveTarget: number;
  activations: number;       // usually 1; Ultras/Vets differ
  traits: LancerEntry[];
  systems: LancerEntry[];
  reactions: LancerEntry[];
  weapons: LancerEntry[];    // name + damage/range/tags as free text
  blurb: string;             // GM notes
}

export function blankLancerNPC(): LancerNPC {
  return {
    tier: 1, className: "", role: "striker",
    size: 1, structure: 1, hp: 10, armor: 0,
    evasion: 8, edef: 8, heatcap: 6, speed: 4, sensors: 10, saveTarget: 10, activations: 1,
    traits: [], systems: [], reactions: [], weapons: [],
    blurb: "",
  };
}
