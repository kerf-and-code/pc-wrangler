// Draw Steel subclasses (MCDM Draw Steel Rules Reference, via the Steel Compendium data set, used under
// the Draw Steel Creator License). MECHANICS ONLY at the creation level: each class's subclass concept,
// its selectable options, and the skill each option grants at 1st level (a specific skill, or one chosen
// from a skill group). The deeper per-level subclass features (abilities, triggered actions, resource
// tables, domain/tradition effects) are prose and active rules; they stay in the SRD, not here. No MCDM
// prose is stored. See lib/systems/drawsteel.ts for the required in-app attribution.
//
// Shape notes: most classes pick ONE subclass option. The Conduit's subclass is TWO domains, so it uses
// picks = 2. A few options grant no skill (Elementalist specializations, Talent traditions, Conduit
// domains) - they shape features instead. Options that grant "one skill from a group" set grantsSkillFrom
// and the player chooses the actual skill in the Forge.

import type { DSSkillGroup } from "./careers";

export interface DSSubclassOption {
  id: string;
  name: string;
  grantsSkill?: string;            // a specific skill granted at 1st level
  grantsSkillFrom?: DSSkillGroup;  // OR the player chooses one skill from this group
}

export interface DSSubclass {
  concept: string;                 // the class's name for its subclass (e.g. "Primordial Aspect")
  picks: number;                   // how many options to select (Conduit = 2, otherwise 1)
  options: DSSubclassOption[];
  quick: string[];                 // quick-build option id(s), length = picks
  quickSkill?: string;             // quick-build skill when the quick option grants a group skill
}

const opt = (id: string, name: string, grantsSkill?: string, grantsSkillFrom?: DSSkillGroup): DSSubclassOption =>
  ({ id, name, ...(grantsSkill ? { grantsSkill } : {}), ...(grantsSkillFrom ? { grantsSkillFrom } : {}) });

const DOMAINS = [
  "Creation", "Death", "Fate", "Knowledge", "Life", "Love",
  "Nature", "Protection", "Storm", "Sun", "Trickery", "War",
];

const SUBCLASSES: Record<string, DSSubclass> = {
  censor: {
    concept: "Censor Order", picks: 1,
    options: [
      opt("exorcist", "Exorcist", "Read Person"),
      opt("oracle", "Oracle", "Magic"),
      opt("paragon", "Paragon", "Lead"),
    ],
    quick: ["paragon"],
  },

  // The Conduit's subclass is two domains from their deity's portfolio. Domains shape later features and
  // grant no creation-time skill, so they ship as names only.
  conduit: {
    concept: "Domains", picks: 2,
    options: DOMAINS.map((d) => opt(d.toLowerCase(), d)),
    quick: ["life", "protection"],
  },

  elementalist: {
    concept: "Elemental Specialization", picks: 1,
    options: [
      opt("earth", "Earth"), opt("fire", "Fire"), opt("green", "Green"), opt("void", "Void"),
    ],
    quick: ["fire"],
  },

  fury: {
    concept: "Primordial Aspect", picks: 1,
    options: [
      opt("berserker", "Berserker", "Lift"),
      opt("reaver", "Reaver", "Hide"),
      opt("stormwight", "Stormwight", "Track"),
    ],
    quick: ["berserker"],
  },

  null_: {
    concept: "Null Tradition", picks: 1,
    options: [
      opt("chronokinetic", "Chronokinetic", undefined, "lore"),
      opt("cryokinetic", "Cryokinetic", undefined, "crafting"),
      opt("metakinetic", "Metakinetic", undefined, "exploration"),
    ],
    quick: ["chronokinetic"], quickSkill: "Monsters",
  },

  shadow: {
    concept: "Shadow College", picks: 1,
    options: [
      opt("black-ash", "College of Black Ash", "Magic"),
      opt("caustic-alchemy", "College of Caustic Alchemy", "Alchemy"),
      opt("harlequin-mask", "College of the Harlequin Mask", "Lie"),
    ],
    quick: ["black-ash"],
  },

  tactician: {
    concept: "Tactical Doctrine", picks: 1,
    options: [
      opt("insurgent", "Insurgent", undefined, "intrigue"),
      opt("mastermind", "Mastermind", undefined, "lore"),
      opt("vanguard", "Vanguard", undefined, "interpersonal"),
    ],
    quick: ["vanguard"], quickSkill: "Intimidate",
  },

  talent: {
    concept: "Talent Tradition", picks: 1,
    options: [
      opt("chronopathy", "Chronopathy"), opt("telekinesis", "Telekinesis"), opt("telepathy", "Telepathy"),
    ],
    quick: ["telekinesis"],
  },

  troubadour: {
    concept: "Troubadour Class Act", picks: 1,
    options: [
      opt("auteur", "Auteur", "Brag"),
      opt("duelist", "Duelist", "Gymnastics"),
      opt("virtuoso", "Virtuoso", "Music"),
    ],
    quick: ["virtuoso"],
  },
};

export const DS_SUBCLASSES: Record<string, DSSubclass> = SUBCLASSES;
