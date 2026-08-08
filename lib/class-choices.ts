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

export type ChoiceKind = "skill" | "weapon" | "tool" | "spell" | "feat" | "option";

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
    /**
     * A named list that exists nowhere in the data - Divine Order, Metamagic and friends. Held as
     * NAME plus a one-line summary of what it does, in our own words: the names are facts and the
     * summary is what a picker needs to be usable, but the rules text itself stays in the book.
     * Anything longer than a line belongs on the class page, not in a dropdown.
     */
    named?: {
      name: string;
      summary: string;
      /** Minimum character level. Options above the character's level are not offered at all. */
      minLevel?: number;
      /** Another option that must be taken first, by name. Shown, but not enforced. */
      requires?: string;
    }[];
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
/**
 * The 2024 Eldritch Invocations. Names and prerequisites are facts about the rules; the summaries
 * are one-line paraphrases written so the picker is usable. The rules text itself stays in the book.
 *
 * NOTE FOR ANYONE UPDATING THIS: it is the 2024 list, which differs substantially from 2014. The
 * older list is NOT a fallback for a 2014 warlock - it is a different set with different names, and
 * offering one for the other would be wrong rather than approximate.
 */
const INVOCATIONS_2024: NonNullable<ClassChoice["filter"]>["named"] = [
  { name: "Agonizing Blast", summary: "Add Charisma to a damaging cantrip's damage", minLevel: 2 },
  { name: "Armor of Shadows", summary: "Cast Mage Armor on yourself for free" },
  { name: "Ascendant Step", summary: "Cast Levitate on yourself for free", minLevel: 5 },
  { name: "Devil's Sight", summary: "See in dim light and darkness out to 120 feet", minLevel: 2 },
  { name: "Devouring Blade", summary: "Thirsting Blade grants two extra attacks", minLevel: 12, requires: "Thirsting Blade" },
  { name: "Eldritch Mind", summary: "Advantage on Constitution saves for Concentration" },
  { name: "Eldritch Smite", summary: "Spend a slot for extra Force damage and knock Prone", minLevel: 5, requires: "Pact of the Blade" },
  { name: "Eldritch Spear", summary: "A cantrip's range grows by 30 feet per Warlock level", minLevel: 2 },
  { name: "Fiendish Vigor", summary: "Cast False Life on yourself free, always at maximum", minLevel: 2 },
  { name: "Gaze of Two Minds", summary: "See through a willing creature's senses", minLevel: 5 },
  { name: "Gift of the Depths", summary: "Breathe underwater and gain a Swim Speed", minLevel: 5 },
  { name: "Gift of the Protectors", summary: "Named creatures drop to 1 HP instead of 0", minLevel: 9, requires: "Pact of the Tome" },
  { name: "Investment of the Chain Master", summary: "Your familiar gains speed, attacks and your save DC", minLevel: 5, requires: "Pact of the Chain" },
  { name: "Lessons of the First Ones", summary: "Gain an Origin feat of your choice", minLevel: 2 },
  { name: "Lifedrinker", summary: "Extra damage on a pact weapon hit, and heal from a Hit Die", minLevel: 9, requires: "Pact of the Blade" },
  { name: "Mask of Many Faces", summary: "Cast Disguise Self for free", minLevel: 2 },
  { name: "Master of Myriad Forms", summary: "Cast Alter Self for free", minLevel: 5 },
  { name: "Misty Visions", summary: "Cast Silent Image for free", minLevel: 2 },
  { name: "One with Shadows", summary: "Cast Invisibility on yourself in dim light or darkness", minLevel: 5 },
  { name: "Otherworldly Leap", summary: "Cast Jump on yourself for free", minLevel: 2 },
  { name: "Pact of the Blade", summary: "Conjure a pact weapon and use Charisma to attack with it" },
  { name: "Pact of the Chain", summary: "Find Familiar for free, with extra familiar forms" },
  { name: "Pact of the Tome", summary: "Three cantrips and two ritual spells from any class" },
  { name: "Repelling Blast", summary: "Push a target 10 feet on a cantrip attack hit", minLevel: 2 },
  { name: "Thirsting Blade", summary: "Attack twice with your pact weapon", minLevel: 5, requires: "Pact of the Blade" },
  { name: "Visions of Distant Realms", summary: "Cast Arcane Eye for free", minLevel: 9 },
  { name: "Whispers of the Grave", summary: "Cast Speak with Dead for free", minLevel: 7 },
  { name: "Witch Sight", summary: "Truesight out to 30 feet", minLevel: 15 },
];

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

  // --- named lists, authored because they exist in no machine-readable source -----------------
  {
    className: "Cleric", level: 7, feature: "Blessed Strikes", choose: 1, kind: "option",
    filter: { named: [
      { name: "Divine Strike", summary: "Once a turn, +1d8 Necrotic or Radiant on a weapon hit" },
      { name: "Potent Spellcasting", summary: "Add Wisdom to your Cleric cantrip damage" },
    ] },
  },
  //
  // 2024 only. Each is a short, closed list, and each summary is a one-line paraphrase written to
  // make the picker usable rather than to reproduce the rules. The full text stays in the book.
  {
    className: "Cleric", level: 1, feature: "Divine Order", choose: 1, kind: "option",
    filter: { named: [
      { name: "Protector", summary: "Martial weapon proficiency and Heavy armor training" },
      { name: "Thaumaturge", summary: "An extra cantrip, plus Wisdom to Arcana and Religion checks" },
    ] },
  },
  {
    className: "Druid", level: 1, feature: "Primal Order", choose: 1, kind: "option",
    filter: { named: [
      { name: "Magician", summary: "An extra cantrip, plus Wisdom to Arcana and Nature checks" },
      { name: "Warden", summary: "Martial weapon proficiency and Medium armor training" },
    ] },
  },
  {
    className: "Druid", level: 7, feature: "Elemental Fury", choose: 1, kind: "option",
    filter: { named: [
      { name: "Potent Spellcasting", summary: "Add Wisdom to your Druid cantrip damage" },
      { name: "Primal Strike", summary: "Once a turn, +1d8 elemental damage on a weapon or Beast form hit" },
    ] },
  },
  // Sorcerer picks two here and two more at 10 and 17, so the same list appears three times with
  // distinct keys rather than one entry with a growing count - a level 10 sorcerer choosing four at
  // once would not know which two were the level 2 pair.
  ...[2, 10, 17].map((lv) => ({
    className: "Sorcerer", level: lv, feature: `Metamagic (level ${lv})`, choose: 2,
    kind: "option" as const,
    filter: { named: [
      { name: "Careful Spell", summary: "1 point: chosen creatures auto-succeed and take no damage" },
      { name: "Distant Spell", summary: "1 point: double the range, or Touch becomes 30 feet" },
      { name: "Empowered Spell", summary: "1 point: reroll damage dice up to your Charisma modifier" },
      { name: "Extended Spell", summary: "1 point: double the duration, up to 24 hours" },
      { name: "Heightened Spell", summary: "2 points: the target has Disadvantage on its save" },
      { name: "Quickened Spell", summary: "2 points: cast an action spell as a Bonus Action" },
      { name: "Seeking Spell", summary: "1 point: reroll a missed spell attack" },
      { name: "Subtle Spell", summary: "1 point: cast with no verbal, somatic or material components" },
      { name: "Transmuted Spell", summary: "1 point: swap the damage type for another elemental one" },
      { name: "Twinned Spell", summary: "1 point: cast at one level higher to reach a second creature" },
    ] },
  })),

  // Eldritch Invocations, 2024. The warlock gains them in increments - one at level 1, two more at
  // 2 and at 5, then one each at 7, 9, 12, 15 and 18 - so each grant is its own entry rather than
  // one entry with a growing count. A level 18 warlock choosing ten at once would have no idea
  // which were which, and the prerequisites only make sense against the level they were taken at.
  ...([[1, 1], [2, 2], [5, 2], [7, 1], [9, 1], [12, 1], [15, 1], [18, 1]] as [number, number][])
    .map(([lv, n]) => ({
      className: "Warlock", level: lv, feature: `Eldritch Invocations (level ${lv})`,
      choose: n, kind: "option" as const,
      filter: { named: INVOCATIONS_2024 },
      note: lv === 1 ? "You can swap one invocation whenever you gain a Warlock level." : undefined,
    })),

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
  /** The character's level, so options with a prerequisite above it are not offered. */
  characterLevel?: number;
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

  if (choice.kind === "option") {
    const lvl = data.characterLevel ?? 20;
    return (f.named || [])
      // Hidden rather than greyed. A level 2 Warlock scrolling past eight invocations they cannot
      // take is reading a list that is mostly noise, and the level is not their decision to make.
      .filter((o) => (o.minLevel ?? 1) <= lvl)
      .map((o) => ({
        value: o.name,
        label: `${o.name} \u2014 ${o.summary}${o.requires ? ` (needs ${o.requires})` : ""}`,
      }));
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
