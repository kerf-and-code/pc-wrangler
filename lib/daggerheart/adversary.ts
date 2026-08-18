// Daggerheart adversary (NPC) stat-block schema for Six Axes' Monster Maker. The parallel to the D&D
// StatBlockDoc and the PF2e PF2Creature: an authored-directly stat block (no derivation), so what the
// GM types IS the adversary. Field structure follows the Daggerheart SRD 1.0 adversary stat block
// (game MECHANICS, open under the Darrington Press Community Gaming License); no Darrington Press
// bestiary content ships here, only the empty shape and the per-tier design benchmarks.
//
// Mirrors the other two editors' style so the Monster Maker page reuses its local Field / NumInput /
// EntryListPanel: the numbers that matter are structured (tier, difficulty, thresholds, HP, Stress,
// ATK), the standard attack is three small fields, and features are free-text {name, desc} lists.
// name lives in the page's own state (like StatBlockDoc / PF2Creature), so it is not on the adversary.

export type DHAdversaryType =
  | "standard" | "bruiser" | "horde" | "leader" | "minion"
  | "ranged" | "skulk" | "social" | "solo" | "support";

// [value, label] tuples for the picker, Standard first (the default role).
export const DH_ADVERSARY_TYPES: [DHAdversaryType, string][] = [
  ["standard", "Standard"], ["bruiser", "Bruiser"], ["horde", "Horde"], ["leader", "Leader"],
  ["minion", "Minion"], ["ranged", "Ranged"], ["skulk", "Skulk"], ["social", "Social"],
  ["solo", "Solo"], ["support", "Support"],
];

export type DHAdvTier = 1 | 2 | 3 | 4;
export const DH_ADV_TIERS: DHAdvTier[] = [1, 2, 3, 4];

// A free-text stat-block entry (name + description), same shape as the D&D NamedEntry and PF2Entry, so
// all three editors share the EntryListPanel. Kept local to avoid a circular import with stat-blocks.
export type DHEntry = { name: string; desc: string };

export interface DHAdversary {
  tier: DHAdvTier;
  type: DHAdversaryType;
  description: string;                 // appearance and demeanor
  motives: string;                     // motives & tactics
  difficulty: number;                  // Difficulty of rolls made against the adversary
  thresholdMajor: number;              // Major damage threshold
  thresholdSevere: number;             // Severe damage threshold
  hp: number;
  stress: number;
  atk: number;                         // attack modifier applied to the standard attack
  attackName: string;                  // e.g. "Claws"
  attackRange: string;                 // e.g. "Very Close"
  attackDamage: string;                // e.g. "1d12+2 phy"
  experiences: string;                 // free text, e.g. "Tremor Sense +2, Hunt +3"
  actions: DHEntry[];
  reactions: DHEntry[];
  passives: DHEntry[];
  fearFeatures: DHEntry[];             // high-impact features that cost a Fear to activate
  blurb: string;                       // GM notes
}

// Per-tier design benchmarks from the SRD adversary stat block benchmarks table. Shown in the editor
// as targets the GM can aim for; never auto-applied (adversaries are authored, not derived).
export interface DHBenchmark {
  atk: number;
  difficulty: number;
  major: number;
  severe: number;
  damageDice: string;
}
export const DH_BENCHMARKS: Record<DHAdvTier, DHBenchmark> = {
  1: { atk: 1, difficulty: 11, major: 7,  severe: 12, damageDice: "1d6+2 to 1d12+4" },
  2: { atk: 2, difficulty: 14, major: 10, severe: 20, damageDice: "2d6+3 to 2d12+4" },
  3: { atk: 3, difficulty: 17, major: 20, severe: 32, damageDice: "3d8+3 to 3d12+5" },
  4: { atk: 4, difficulty: 20, major: 25, severe: 45, damageDice: "4d8+10 to 4d12+15" },
};

export function blankDHAdversary(): DHAdversary {
  return {
    tier: 1, type: "standard",
    description: "", motives: "",
    difficulty: 11, thresholdMajor: 7, thresholdSevere: 12, hp: 4, stress: 3,
    atk: 1, attackName: "", attackRange: "Melee", attackDamage: "",
    experiences: "",
    actions: [], reactions: [], passives: [], fearFeatures: [],
    blurb: "",
  };
}
