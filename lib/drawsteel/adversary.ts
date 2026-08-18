// Draw Steel (MCDM) adversary (monster) stat-block schema for Six Axes' Monster Maker. The parallel to
// the D&D StatBlockDoc, the PF2e PF2Creature, and the Daggerheart DHAdversary: an authored-directly
// stat block (no derivation), so what the GM types IS the monster. Field structure follows the Draw
// Steel monster stat block (Draw Steel Rules Reference / Monster Basics: level, organization, role, EV,
// size, speed, Stamina, stability, free strike, the five characteristics, plus the four secondary rows
// immunity / movement / with captain / weakness, and free-text feature lists).
//
// LICENSING: game MECHANICS only, used under the Draw Steel Creator License (see lib/systems/drawsteel.ts
// for the required in-app attribution). No MCDM descriptive prose or published bestiary content ships
// here, only the empty shape and the per-level design benchmarks derived from the EV tables.
//
// Mirrors the other editors' style so the Monster Maker page reuses its Field / NumInput /
// EntryListPanel: the numbers that matter are structured, and features are free-text {name, desc} lists.
// name lives in the page's own state (like the other three), so it is not on the adversary.

// The six modes of monster organization (Monster Basics). Organization sets the power level and how the
// creature is costed in an encounter: a Minion is bought four at a time; a Solo is a whole fight.
export type DSOrganization = "minion" | "horde" | "platoon" | "elite" | "leader" | "solo";
export const DS_ORGANIZATIONS: [DSOrganization, string][] = [
  ["minion", "Minion"], ["horde", "Horde"], ["platoon", "Platoon"],
  ["elite", "Elite"], ["leader", "Leader"], ["solo", "Solo"],
];

// The nine creature roles, plus "none" for Leaders and Solos (which carry no additional role).
export type DSRole =
  | "none" | "ambusher" | "artillery" | "brute" | "controller"
  | "defender" | "harrier" | "hexer" | "mount" | "support";
export const DS_ROLES: [DSRole, string][] = [
  ["none", "None"], ["ambusher", "Ambusher"], ["artillery", "Artillery"], ["brute", "Brute"],
  ["controller", "Controller"], ["defender", "Defender"], ["harrier", "Harrier"],
  ["hexer", "Hexer"], ["mount", "Mount"], ["support", "Support"],
];

// A free-text stat-block entry (name + description), same shape as the other three editors' entries so
// they all share the EntryListPanel. Kept local to avoid a circular import with stat-blocks.
export type DSEntry = { name: string; desc: string };

export interface DSAdversary {
  level: number;
  organization: DSOrganization;
  role: DSRole;
  ev: number;                          // encounter value; for Minions this is the EV for a group of four
  keywords: string;                    // ancestry / type tags, e.g. "Goblin, Humanoid"
  size: string;                        // "1S" | "1M" | "1L" | "2" ...
  speed: number;
  stamina: number;                     // a Minion's Stamina is its own; a squad pools these
  stability: number;
  freeStrike: number;                  // static free-strike damage
  might: number; agility: number; reason: number; intuition: number; presence: number;
  immunity: string;                    // e.g. "Weakened 5" (the "Immunity" secondary row); "" for none
  movement: string;                    // e.g. "Climb, Fly"; "" for none
  withCaptain: string;                 // Minion "With Captain" bonus; "" for non-minions
  weakness: string;                    // e.g. "Fire 5"; "" for none
  traits: DSEntry[];                   // always-on traits (no action needed)
  abilities: DSEntry[];                // signature ability, main actions, maneuvers
  triggered: DSEntry[];                // triggered actions
  villainActions: DSEntry[];           // for Leaders and Solos (three, used once each per encounter)
  blurb: string;                       // GM notes
}

// The five Draw Steel characteristics, for the editor's characteristic grid.
export const DS_ADV_CHARS: [keyof Pick<DSAdversary, "might" | "agility" | "reason" | "intuition" | "presence">, string][] = [
  ["might", "Might"], ["agility", "Agility"], ["reason", "Reason"], ["intuition", "Intuition"], ["presence", "Presence"],
];

// Per-organization EV benchmark by level, derived from the published EV tables (Monster Basics). Shown
// in the editor as a target the GM can aim for; never auto-applied, since EV is authored, not derived.
//   Minion  = level + 2   (EV for a group of four)
//   Horde   = level + 2
//   Platoon = 2*level + 4
//   Elite   = 4*level + 8
//   Leader  = 4*level + 8
//   Solo    = 12*level + 24
export function dsBenchmarkEV(org: DSOrganization, level: number): number {
  const L = Math.max(1, Math.min(10, Math.round(level) || 1));
  switch (org) {
    case "minion": return L + 2;
    case "horde": return L + 2;
    case "platoon": return 2 * L + 4;
    case "elite": return 4 * L + 8;
    case "leader": return 4 * L + 8;
    case "solo": return 12 * L + 24;
    default: return L + 2;
  }
}

export function blankDSAdversary(): DSAdversary {
  return {
    level: 1, organization: "platoon", role: "brute",
    ev: dsBenchmarkEV("platoon", 1),
    keywords: "", size: "1M", speed: 5, stamina: 20, stability: 0, freeStrike: 2,
    might: 0, agility: 0, reason: 0, intuition: 0, presence: 0,
    immunity: "", movement: "", withCaptain: "", weakness: "",
    traits: [], abilities: [], triggered: [], villainActions: [],
    blurb: "",
  };
}
