// lib/apply-choices.ts
//
// The route from a recorded choice to an applied effect.
//
// THE PROBLEM
//   The Forge now records four kinds of decision - background ability scores, background grants,
//   species trait choices, class choices - and until this file, three of them moved no numbers. A
//   player picked Black draconic ancestry, saw "recorded, not applied", and reasonably wondered what
//   the point was. Every panel said so honestly, which was the right stopgap and a bad destination.
//
// WHY IT IS AN OVERLAY AND NOT AN ENGINE CHANGE
//   deriveSheet already reads everything needed: skillProf and skillExpert come straight off the
//   Build, and resistances come off the species entry in the rules context. So this produces a
//   PATCHED build and a PATCHED context and hands both to the engine unchanged. That keeps the
//   derivation in one place, keeps this testable without a React tree, and means a wrong rule here
//   can never corrupt the maths - only what is fed into it.
//
// WHAT IT DELIBERATELY DOES NOT APPLY
//   Weapon mastery, and granted feats. Mastery has no representation in the engine at all, and a
//   feat is a whole object with its own effects rather than a name to graft on. Both stay recorded
//   and visible. Applying half a feat would be worse than applying none, because the sheet would
//   then be confidently wrong rather than plainly incomplete.

export type ChoiceInputs = {
  /** The background record, for its granted skill proficiencies. */
  background?: { skill_proficiencies?: string } | undefined;
  /** Species traits, so a choice can be matched to the trait that asked for it. */
  speciesTraits?: { name: string; desc: string }[];
  /** trait name -> chosen option name */
  speciesChoices?: Record<string, string>;
  /** The option lists, so a choice can be resolved back to its detail column. */
  speciesOptions?: Record<string, { name: string; detail?: string }[]>;
  /** choice key -> chosen values, from lib/class-choices. */
  classChoices?: Record<string, string[]>;
  /** Which of those keys are expertise, so only those reach skillExpert. */
  expertiseKeys?: string[];
};

export type ChoiceEffects = {
  skillProf: string[];
  skillExpert: string[];
  resist: string[];
  /** For showing the player what actually landed, rather than making them infer it. */
  applied: string[];
  /** Recorded but with nowhere to go. Named so the UI can say which, not just that some exist. */
  unapplied: string[];
};

// The engine keys skills by short id; background data names them in prose.
const SKILL_KEYS: Record<string, string> = {
  acrobatics: "acrobatics", "animal handling": "animal", arcana: "arcana", athletics: "athletics",
  deception: "deception", history: "history", insight: "insight", intimidation: "intimidation",
  investigation: "investigation", medicine: "medicine", nature: "nature", perception: "perception",
  performance: "performance", persuasion: "persuasion", religion: "religion",
  "sleight of hand": "sleight", stealth: "stealth", survival: "survival",
};

const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

function skillKey(label: string): string | null {
  const t = label.trim().toLowerCase().replace(/^skill:\s*/, "");
  return SKILL_KEYS[t] ?? null;
}

/** A trait grants a resistance if it says so. Checked on the TRAIT, not guessed from the option. */
function traitGrantsResistance(desc: string): boolean {
  return /resistance to|damage resistance/i.test(desc || "");
}

export function choiceEffects(input: ChoiceInputs): ChoiceEffects {
  const skillProf: string[] = [];
  const skillExpert: string[] = [];
  const resist: string[] = [];
  const applied: string[] = [];
  const unapplied: string[] = [];

  // --- background granted skills ---------------------------------------------------------
  for (const raw of String(input.background?.skill_proficiencies || "").split(/[,;]|\band\b/)) {
    const key = skillKey(raw);
    if (!key) continue;
    if (!skillProf.includes(key)) {
      skillProf.push(key);
      applied.push(`${raw.trim()} proficiency from your background`);
    }
  }

  // --- species trait choices ---------------------------------------------------------------
  for (const [traitName, picked] of Object.entries(input.speciesChoices || {})) {
    if (!picked) continue;
    const trait = (input.speciesTraits || []).find((t) => t.name === traitName);
    const opts = input.speciesOptions?.[traitName] || [];
    const opt = opts.find((o) => o.name === picked);

    if (trait && traitGrantsResistance(trait.desc) && opt?.detail) {
      // The detail column of a resistance table IS the damage type - "Black | Acid". Matched
      // against a known list rather than trusted, so a table whose second column holds something
      // else entirely cannot inject nonsense into the sheet.
      const found = DAMAGE_TYPES.find((d) => opt.detail!.toLowerCase().includes(d));
      if (found) {
        const label = found[0].toUpperCase() + found.slice(1);
        if (!resist.includes(label)) {
          resist.push(label);
          applied.push(`${label} resistance from ${traitName}`);
        }
        continue;
      }
    }
    unapplied.push(`${traitName}: ${picked}`);
  }

  // --- class choices -------------------------------------------------------------------------
  const expertise = new Set(input.expertiseKeys || []);
  for (const [key, values] of Object.entries(input.classChoices || {})) {
    for (const v of values) {
      if (expertise.has(key)) {
        const sk = skillKey(v) ?? v;
        if (!skillExpert.includes(sk)) {
          skillExpert.push(sk);
          applied.push(`Expertise in ${v}`);
        }
      } else {
        unapplied.push(v);
      }
    }
  }

  return { skillProf, skillExpert, resist, applied, unapplied };
}

/**
 * Fold the effects into a build. Additive and duplicate-safe: a skill the character already had is
 * not added twice, and nothing already on the build is removed - these are GRANTS on top of the
 * player's own picks, not a replacement for them.
 */
export function applyToBuild<T extends { skillProf: string[]; skillExpert: string[] }>(
  build: T, fx: ChoiceEffects,
): T {
  const prof = [...build.skillProf];
  for (const k of fx.skillProf) if (!prof.includes(k)) prof.push(k);
  const exp = [...build.skillExpert];
  for (const k of fx.skillExpert) if (!exp.includes(k)) exp.push(k);
  return { ...build, skillProf: prof, skillExpert: exp };
}
