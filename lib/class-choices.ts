// lib/class-choices.ts
//
// The decisions a class asks you to make, as data the app can resolve into a picker.
//
// THE PROBLEM THIS SOLVES
//   218 class feature entries in the 2024 data, 98 of which ask the player to choose something, and
//   not one of them structured - every option list is a sentence. But when those 98 were actually
//   read, almost all of them turned out to have the same shape:
//
//       "choose N of <a list the app already holds>"
//
//   Weapon Mastery is two weapons. Primal Knowledge is a skill. Magical Secrets is spells. The
//   lists are the app's own weapons, skills, tools and spells tables. So this is NOT 98 transcribed
//   option lists - it is a small vocabulary of choice KINDS plus a filter, and one resolver.
//
// WHY THIS FILE IS SHORT AND WILL STAY SHORT
//   Only entries that are certainly correct belong here. A wrong entry is worse than a missing one:
//   a missing entry shows the rules text and asks the player to decide, which is what the app does
//   today and is honest; a wrong entry silently offers the wrong options and looks authoritative.
//   Anything not listed here falls back to prose, so growing this file is safe and leaving a gap is
//   safe. Guessing is not.

export type ChoiceKind = "skill" | "weapon" | "tool" | "spell" | "feat";

export type ClassChoice = {
  className: string;
  /** Undefined means it comes from the class itself rather than a subclass. */
  subclass?: string;
  level: number;
  feature: string;
  choose: number;
  kind: ChoiceKind;
  /** Narrowing applied by the resolver. Absent keys mean "no restriction". */
  filter?: {
    weaponCategory?: ("Simple" | "Martial")[];
    weaponRange?: ("Melee" | "Ranged")[];
    /** Only skills the character is already proficient in - Expertise. */
    proficientOnly?: boolean;
    /** Feat category, e.g. "Fighting Style". The feats catalog already carries these. */
    featCategory?: string;
    /** Spell level bounds, inclusive. 0 is a cantrip. */
    spellLevelMin?: number;
    spellLevelMax?: number;
    /**
     * An explicit option list, for choices whose set is stated in the data rather than derived from
     * a filter - the level 1 skill grant reads its ten skills straight off the class's core traits
     * table, and inventing a filter that happened to select those ten would be a worse description
     * of the same fact.
     */
    options?: string[];
  };
  /** Shown under the picker. The rules text stays visible either way. */
  note?: string;
};

/**
 * Deliberately conservative. Each of these was read off the feature's own description in
 * classes-2024-structured.json rather than recalled, and anything whose wording left room for
 * doubt was left out to fall back to prose.
 */
export const CLASS_CHOICES: ClassChoice[] = [
  // --- resolvable from data already in lib/srd, no option list authored -----------------------
  // Fighting Style is a FEAT CATEGORY in feats-2024.json - twelve of them - so these three need no
  // list of their own. The class text says so outright: "you gain a Fighting Style feat of your
  // choice (see Feats)".
  { className: "Fighter", level: 1, feature: "Fighting Style", choose: 1, kind: "feat",
    filter: { featCategory: "Fighting Style" } },
  { className: "Paladin", level: 2, feature: "Fighting Style", choose: 1, kind: "feat",
    filter: { featCategory: "Fighting Style" } },
  { className: "Ranger", level: 2, feature: "Fighting Style", choose: 1, kind: "feat",
    filter: { featCategory: "Fighting Style" } },

  // The class text names its own six skills, so this is transcribed from the feature's own
  // description rather than looked up anywhere.
  { className: "Wizard", level: 2, feature: "Scholar", choose: 1, kind: "skill",
    filter: { proficientOnly: true,
      options: ["Arcana", "History", "Investigation", "Medicine", "Nature", "Religion"] },
    note: "One you already have proficiency in." },

  { className: "Ranger", level: 2, feature: "Deft Explorer", choose: 1, kind: "skill",
    filter: { proficientOnly: true }, note: "Gains Expertise in the chosen skill." },

  // Spell picks with a level band. The spell catalog does the rest.
  { className: "Warlock", level: 11, feature: "Mystic Arcanum", choose: 1, kind: "spell",
    filter: { spellLevelMin: 6, spellLevelMax: 6 } },
  { className: "Wizard", level: 18, feature: "Spell Mastery (level 1)", choose: 1, kind: "spell",
    filter: { spellLevelMin: 1, spellLevelMax: 1 } },
  { className: "Wizard", level: 18, feature: "Spell Mastery (level 2)", choose: 1, kind: "spell",
    filter: { spellLevelMin: 2, spellLevelMax: 2 } },
  { className: "Wizard", level: 20, feature: "Signature Spells", choose: 2, kind: "spell",
    filter: { spellLevelMin: 3, spellLevelMax: 3 } },

  // --- the originals -------------------------------------------------------------------------
  {
    className: "Barbarian", level: 1, feature: "Weapon Mastery",
    choose: 2, kind: "weapon",
    filter: { weaponCategory: ["Simple", "Martial"], weaponRange: ["Melee"] },
    note: "Changeable after any Long Rest.",
  },
  {
    className: "Barbarian", level: 3, feature: "Primal Knowledge",
    choose: 1, kind: "skill",
    note: "From the skills available to Barbarians at level 1.",
  },
  {
    className: "Bard", level: 2, feature: "Expertise",
    choose: 2, kind: "skill", filter: { proficientOnly: true },
  },
  {
    className: "Bard", level: 9, feature: "Expertise",
    choose: 2, kind: "skill", filter: { proficientOnly: true },
  },
  {
    className: "Rogue", level: 1, feature: "Expertise",
    choose: 2, kind: "skill", filter: { proficientOnly: true },
  },
  {
    className: "Rogue", level: 6, feature: "Expertise",
    choose: 2, kind: "skill", filter: { proficientOnly: true },
  },
  {
    className: "Fighter", level: 1, feature: "Weapon Mastery",
    choose: 3, kind: "weapon",
    filter: { weaponCategory: ["Simple", "Martial"] },
    note: "Changeable after any Long Rest.",
  },
  {
    className: "Ranger", level: 1, feature: "Weapon Mastery",
    choose: 2, kind: "weapon",
    filter: { weaponCategory: ["Simple", "Martial"] },
    note: "Changeable after any Long Rest.",
  },
  {
    className: "Rogue", level: 1, feature: "Weapon Mastery",
    choose: 2, kind: "weapon",
    filter: { weaponCategory: ["Simple", "Martial"] },
    note: "Changeable after any Long Rest.",
  },
  {
    className: "Paladin", level: 1, feature: "Weapon Mastery",
    choose: 2, kind: "weapon",
    filter: { weaponCategory: ["Simple", "Martial"] },
    note: "Changeable after any Long Rest.",
  },
];

export type ResolveInput = {
  skills: { key: string; label: string }[];
  weapons: { name: string; weapon_category?: string; weapon_range?: string; mastery?: string }[];
  tools: { name: string }[];
  spells: { name: string; level: string }[];
  /** Skill keys the character is already proficient in, for Expertise. */
  proficientSkills: string[];
  feats: { name: string; category?: string }[];
};

/**
 * Turn a choice into the option list it means.
 *
 * Returns [] when the filter matches nothing, which the caller must treat as "show the prose"
 * rather than "show an empty dropdown" - an empty picker under a feature that asks for a decision
 * reads as broken rather than as unsupported.
 */
export function resolveChoice(choice: ClassChoice, data: ResolveInput): { value: string; label: string }[] {
  const f = choice.filter || {};

  if (choice.kind === "skill") {
    let pool = f.proficientOnly
      ? data.skills.filter((s) => data.proficientSkills.includes(s.key))
      : data.skills;
    if (f.options?.length) {
      const want = f.options.map((o) => o.trim().toLowerCase());
      pool = pool.filter((s) => want.includes(s.label.toLowerCase()));
    }
    return pool.map((s) => ({ value: s.key, label: s.label }));
  }

  if (choice.kind === "weapon") {
    return data.weapons
      .filter((w) => {
        if (f.weaponCategory && !f.weaponCategory.includes((w.weapon_category || "") as "Simple" | "Martial")) return false;
        if (f.weaponRange && !f.weaponRange.includes((w.weapon_range || "") as "Melee" | "Ranged")) return false;
        return true;
      })
      .map((w) => ({ value: w.name, label: w.mastery ? `${w.name} (${w.mastery})` : w.name }));
  }

  if (choice.kind === "feat") {
    const want = f.featCategory?.toLowerCase();
    return data.feats
      .filter((ft) => !want || (ft.category || "").toLowerCase() === want)
      .map((ft) => ({ value: ft.name, label: ft.name }));
  }

  if (choice.kind === "tool") {
    return data.tools.map((t) => ({ value: t.name, label: t.name }));
  }

  // spell
  const lo = f.spellLevelMin ?? 0;
  const hi = f.spellLevelMax ?? 9;
  return data.spells
    .filter((sp) => {
      const n = parseInt(String(sp.level ?? ""), 10);
      return Number.isFinite(n) && n >= lo && n <= hi;
    })
    .map((sp) => ({ value: sp.name, label: sp.name }));
}

/** The choices this character faces at or below its level. */
export function choicesFor(className: string, subclass: string, level: number): ClassChoice[] {
  return CLASS_CHOICES
    .filter((c) => c.className === className && c.level <= level)
    .filter((c) => !c.subclass || c.subclass === subclass)
    .sort((a, b) => a.level - b.level || a.feature.localeCompare(b.feature));
}

/** A stable key for storing a pick, so two Expertise grants at different levels do not collide. */
export const choiceKey = (c: ClassChoice) =>
  `${c.className}:${c.subclass || "-"}:${c.level}:${c.feature}`;
