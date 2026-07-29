// ---------------------------------------------------------------------------
// lib/ddb-import.ts
//
// Maps a parsed D&D Beyond character-sheet PDF onto the Forge's Build shape.
//
// PURE by design, exactly like deriveSheet: every lookup table is passed in as an
// ImportContext rather than imported, so this file can be unit-tested against saved parser JSON
// with no app, no Supabase and no SRD import graph.
//
// What this is FOR (Terry, 2026-07-29): encounter balancing and giving the player build ideas.
// The authoritative sheet still lives in D&D Beyond. So the mapper is deliberately conservative:
// it maps what it is confident about, PARKS everything else verbatim under build.imported, and
// REPORTS what it could not place rather than guessing.
//
// The four calls that shape this file:
//   1. Abilities are imported as PRINTED. D&D Beyond prints FINAL scores, but Build.abilities is
//      "base before gear" and deriveSheet applies ITEM_EFFECTS on top. Importing both would apply
//      an item twice (the Rogue test sheet carries Manual of Bodily Health AND Manual of Quickness
//      of Action, both in the effects table). We do NOT try to back the effects out; instead the
//      caller derives imported characters through suppressItemEffects(ctx). See below.
//   2. The HIGHEST-level class becomes meta.className. The full breakdown is parked.
//   3. Only CLASS-sourced spells go into build.spells. Feat, subclass, lineage and magic-item
//      grants are parked, because spells.known is a flat name list with no provenance and the
//      Forge would otherwise treat "Wish from a Ring of Three Wishes" as a known wizard spell.
//   4. Reconciliation REPORTS the delta between DDB's printed numbers and deriveSheet's computed
//      ones. It does NOT auto-fill armorMisc / saveBonusAll, because the divergence IS the signal.
// ---------------------------------------------------------------------------

import type { Ability, Build, GearEntry, RulesContext } from "./srd/derive-sheet";

// ---------------------------------------------------------------------------
// The parser's output shape (parse_ddb_sheet.py). Everything is optional-ish because a sheet for
// a non-caster has no spell page, a level-1 character has no additional-equipment page, and so on.
// ---------------------------------------------------------------------------

export type DdbClass = { class: string; level: number };

export type DdbSheet = {
  identity: {
    name: string | null;
    class_level_raw: string | null;
    classes: DdbClass[];
    primary_class: string | null;
    total_level: number | null;
    species: string | null;
    background: string | null;
    player_name: string | null;
    experience: string | null;
  };
  abilities: Partial<Record<Ability, number | null>>;
  saves: Partial<Record<Ability, number | null>>;
  skills: { skill: string; modifier: number | null; prof: "proficient" | "expertise" | null }[];
  combat: {
    armor_class: number | null;
    initiative: number | null;
    proficiency_bonus: number | null;
    speed: string | null;
    max_hp: number | null;
    hit_dice: string | null;
    passive_perception: number | null;
    passive_insight: number | null;
    passive_investigation: number | null;
  };
  proficiencies: Record<string, string>;
  attacks: { name: string; hit: string | null; damage: string | null; notes: string | null }[];
  features: { name: string; source: string | null; desc: string }[];
  bio: Record<string, string | null>;
  spells: {
    save_dc: number | null;
    attack_bonus: string | null;
    slots: Record<string, number>;
    list: {
      name: string;
      level: number | null;
      source: string | null;
      always_prepared: boolean;
      ritual: boolean;
      detail: string | null;
    }[];
  };
  equipment: { name: string; detail: string | null; attuned: boolean }[];
  _meta?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Lookup tables, passed in so this stays pure. The caller builds these from loadSrd() plus the
// catalog. Names go in raw; the matcher does its own normalisation.
// ---------------------------------------------------------------------------

export type ImportContext = {
  items: string[];        // SRD equipment + magic-item names
  spells: string[];       // SRD spell names
  species: string[];      // catalog species names (NOT just SRD: the catalog carries the partnered ones)
  subclasses: string[];
  backgrounds: string[];
  classes: string[];
  /** Names in RULES_DATA.ITEM_EFFECTS / ITEM_VARIANTS. Used only to WARN about double-counting. */
  abilityEffectItems: string[];
};

export type Resolution = { raw: string; matched: string | null; variant?: string; note?: string };

export type ImportReport = {
  characterName: string | null;
  level: number;
  /** The multiclass breakdown as printed. Length > 1 means the Forge is showing only the primary. */
  classes: DdbClass[];
  species: Resolution;
  background: Resolution;
  className: Resolution;
  subclass: Resolution;
  gear: { matched: Resolution[]; unmatched: Resolution[] };
  spells: { known: string[]; cantrips: string[]; parked: { name: string; source: string | null }[]; unmatched: string[] };
  /** Gear that would double-count ability scores if ITEM_EFFECTS were left on. */
  abilityEffectWarnings: string[];
  inferred: { saveProf: Ability[]; saveBonusAll: number };
  /** Human-readable notes for the import UI. */
  notes: string[];
};

export type ImportResult = { build: Build; report: ImportReport };

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

function norm(s: string): string {
  return s.replace(/\u2019/g, "'").split(/\s+/).filter(Boolean).join(" ").trim().toLowerCase();
}

/**
 * Index a name list for lookup. D&D Beyond and the SRD disagree about word order on comma-style
 * names: the SRD writes "Lantern, Hooded" where DDB writes "Hooded Lantern" (and DDB itself is
 * inconsistent, writing "Crossbow, Hand"). So every comma name is indexed BOTH ways.
 */
function indexNames(names: string[]): Map<string, string> {
  const ix = new Map<string, string>();
  for (const n of names) {
    ix.set(norm(n), n);
    const i = n.indexOf(",");
    if (i > 0) {
      const inverted = `${n.slice(i + 1).trim()} ${n.slice(0, i).trim()}`;
      if (!ix.has(norm(inverted))) ix.set(norm(inverted), n);
    }
  }
  return ix;
}

function lookup(ix: Map<string, string>, raw: string): string | null {
  return ix.get(norm(raw)) ?? null;
}

/**
 * Match an inventory line to an SRD item, pulling the two decorations D&D Beyond bakes into the
 * NAME back out into the fields Build already has for them:
 *   "Shield, +2"                  -> { n: "Shield", mod: 2 }
 *   "Potion of Healing (Greater)" -> { n: "Potion of Healing", variant: "Greater" }
 *
 * ORDERING MATTERS: try the FULL string first. "Rope, Silk (50 feet)" is a real SRD name, and
 * stripping "(50 feet)" as a variant turns a hit into a miss.
 */
export function matchItem(ix: Map<string, string>, raw: string): { entry: GearEntry; matched: string | null } {
  const direct = lookup(ix, raw);
  if (direct) return { entry: { n: direct }, matched: direct };

  let s = raw;
  let mod: number | undefined;
  let variant: string | undefined;

  const plus = s.match(/,\s*\+(\d+)\s*$/);
  if (plus) {
    mod = Number(plus[1]);
    s = s.slice(0, plus.index).trim();
    const hit = lookup(ix, s);
    if (hit) return { entry: { n: hit, mod }, matched: hit };
  }

  const paren = s.match(/\s*\(([^)]+)\)\s*$/);
  if (paren) {
    variant = paren[1];
    s = s.slice(0, paren.index).trim();
  }

  // Singular/plural: DDB writes "Arrows"/"Bolts", the SRD writes "Arrow"/"Bolt".
  for (const cand of [s, s.replace(/s$/, ""), s.replace(/es$/, "")]) {
    const hit = lookup(ix, cand);
    if (hit) {
      const entry: GearEntry = { n: hit };
      if (mod !== undefined) entry.mod = mod;
      if (variant !== undefined) entry.variant = variant;
      return { entry, matched: hit };
    }
  }

  // No match. Keep the item under its printed name rather than dropping it: the residue is almost
  // entirely homebrew and non-SRD published content, and losing a player's gear silently is worse
  // than carrying a name the engine has no rules for. This is the same honest degradation the
  // Forge already does for partnered species.
  const entry: GearEntry = { n: raw };
  if (mod !== undefined) entry.mod = mod;
  return { entry, matched: null };
}

/** "Variant Human" -> { base: "Human", variant: "Variant" }; "Elf" -> { base: "Elf" }. */
export function splitSpecies(raw: string): { base: string; variant?: string } {
  const m = raw.match(/^(Variant|High|Wood|Hill|Mountain|Drow|Forest|Deep|Lightfoot|Stout)\s+(.+)$/i);
  return m ? { base: m[2].trim(), variant: m[1] } : { base: raw.trim() };
}

/** D&D Beyond marks pre-2024 subclasses "(Legacy)": "Bladesinging (Legacy)" -> "Bladesinging". */
export function stripLegacy(raw: string): string {
  return raw.replace(/\s*\((?:Legacy|SCAG|XGtE|TCE|PHB)\)\s*$/i, "").trim();
}

// ---------------------------------------------------------------------------
// Save proficiency inference
// ---------------------------------------------------------------------------

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * D&D Beyond prints save MODIFIERS but never says which saves are proficient, and Build needs the
 * proficiency list. Recover both that list AND any flat all-saves bonus from the six numbers:
 *
 *   delta_i = save_i - abilityMod_i  is either  B  (not proficient)  or  B + PB  (proficient),
 *   where B is the character's global save bonus (a Cloak of Protection, a feat, and so on).
 *
 * So B is the minimum delta, and a save is proficient when its delta is B + PB. Verified exact on
 * all three test sheets, including the Rogue's B = +1 and its Slippery Mind WIS/CHA proficiencies,
 * which are a level-15 class feature the Forge does not otherwise model.
 */
export function inferSaves(
  abilities: Partial<Record<Ability, number | null>>,
  saves: Partial<Record<Ability, number | null>>,
  pb: number,
): { saveProf: Ability[]; saveBonusAll: number } {
  const deltas = new Map<Ability, number>();
  for (const a of ABILITIES) {
    const score = abilities[a];
    const save = saves[a];
    if (typeof score === "number" && typeof save === "number") deltas.set(a, save - abilityMod(score));
  }
  if (deltas.size === 0 || !pb) return { saveProf: [], saveBonusAll: 0 };
  const bonus = Math.min(...deltas.values());
  const saveProf = ABILITIES.filter((a) => deltas.get(a) === bonus + pb);
  return { saveProf, saveBonusAll: bonus };
}

// ---------------------------------------------------------------------------
// ITEM_EFFECTS suppression (decision 1)
// ---------------------------------------------------------------------------

/**
 * A RulesContext with the ability-score item tables emptied. Derive an IMPORTED character through
 * this: its Build.abilities already contain every item bonus, because that is what D&D Beyond
 * prints, so letting deriveSheet apply ITEM_EFFECTS again would double-count.
 *
 * Nothing else changes, so AC, HP, saves, skills and spell numbers all still derive normally, and
 * the items themselves stay in gear where the player can see them.
 */
export function suppressItemEffects(ctx: RulesContext): RulesContext {
  return { ...ctx, itemEffects: {}, itemVariants: {} };
}

/** True when this build was produced by the importer and its abilities are already final. */
export function hasPrintedAbilities(build: Build): boolean {
  const imported = (build as unknown as { imported?: { abilitiesArePrinted?: boolean } }).imported;
  return Boolean(imported?.abilitiesArePrinted);
}

// ---------------------------------------------------------------------------
// The mapper
// ---------------------------------------------------------------------------

export function ddbToBuild(sheet: DdbSheet, ctx: ImportContext): ImportResult {
  const notes: string[] = [];
  const itemIx = indexNames(ctx.items);
  const spellIx = indexNames(ctx.spells);
  const speciesIx = indexNames(ctx.species);
  const subclassIx = indexNames(ctx.subclasses);
  const backgroundIx = indexNames(ctx.backgrounds);
  const classIx = indexNames(ctx.classes);
  const effectIx = indexNames(ctx.abilityEffectItems);

  // --- identity -------------------------------------------------------------
  const classes = sheet.identity.classes ?? [];
  // Decision 2: the highest-level class is the one the Forge shows. Ties keep sheet order, which is
  // the order D&D Beyond prints, and that puts the character's primary class first.
  const primary = classes.length
    ? classes.reduce((best, c) => (c.level > best.level ? c : best), classes[0])
    : null;
  if (classes.length > 1) {
    notes.push(
      `Multiclass (${classes.map((c) => `${c.class} ${c.level}`).join(" / ")}). ` +
        `The Forge models ${primary?.class ?? "the primary class"} only; the full breakdown is kept in the import record.`,
    );
  }

  const rawSpecies = sheet.identity.species ?? "";
  const sp = splitSpecies(rawSpecies);
  const speciesMatch = lookup(speciesIx, rawSpecies) ?? lookup(speciesIx, sp.base);
  // D&D Beyond folds the lineage into the species name ("Variant Human", "High Elf"). The Forge
  // keeps the variant OUTSIDE Build, as its own speciesVariant state and denorm column, so hand it
  // back on the report for the caller to apply rather than dropping it.
  const speciesRes: Resolution = {
    raw: rawSpecies,
    matched: speciesMatch,
    variant: sp.variant,
    note: speciesMatch ? undefined : "not in the catalog; kept as typed",
  };
  if (!speciesMatch && rawSpecies) {
    notes.push(`Species "${rawSpecies}" is not in the catalog, so its traits will not compute. The name is kept as typed.`);
  }

  const rawBackground = sheet.identity.background ?? "";
  const backgroundRes: Resolution = { raw: rawBackground, matched: lookup(backgroundIx, rawBackground) };

  const rawClass = primary?.class ?? "";
  const classRes: Resolution = { raw: rawClass, matched: lookup(classIx, rawClass) };

  // The subclass is the body of the "<Class> Subclass" feature ("Fighter Subclass" -> "Battle Master").
  const subclassFeature = sheet.features.find((f) => /\bsubclass\b/i.test(f.name) && f.desc);
  const rawSubclass = subclassFeature ? stripLegacy(subclassFeature.desc) : "";
  const subclassRes: Resolution = { raw: subclassFeature?.desc ?? "", matched: rawSubclass ? lookup(subclassIx, rawSubclass) : null };
  if (rawSubclass && !subclassRes.matched) {
    notes.push(`Subclass "${rawSubclass}" is not in the catalog, so its features will not compute. The name is kept as typed.`);
  }

  // --- abilities and saves --------------------------------------------------
  const abilities = {} as Record<Ability, number>;
  for (const a of ABILITIES) abilities[a] = Number(sheet.abilities[a] ?? 10);

  const pb = sheet.combat.proficiency_bonus ?? 0;
  const inferred = inferSaves(sheet.abilities, sheet.saves, pb);
  if (inferred.saveBonusAll) {
    notes.push(`Detected a flat +${inferred.saveBonusAll} to all saving throws and carried it as saveBonusAll.`);
  }

  // --- skills ---------------------------------------------------------------
  const skillProf = sheet.skills.filter((s) => s.prof === "proficient").map((s) => s.skill);
  const skillExpert = sheet.skills.filter((s) => s.prof === "expertise").map((s) => s.skill);

  // --- gear -----------------------------------------------------------------
  const items: GearEntry[] = [];
  const gearMatched: Resolution[] = [];
  const gearUnmatched: Resolution[] = [];
  const attuned: string[] = [];
  const abilityEffectWarnings: string[] = [];

  for (const row of sheet.equipment) {
    const { entry, matched } = matchItem(itemIx, row.name);
    items.push(entry);
    (matched ? gearMatched : gearUnmatched).push({ raw: row.name, matched });
    if (row.attuned) attuned.push(entry.n);
    if (lookup(effectIx, entry.n)) abilityEffectWarnings.push(entry.n);
  }
  if (abilityEffectWarnings.length) {
    notes.push(
      `${abilityEffectWarnings.join(", ")} change ability scores, and the imported scores already include them. ` +
        `Derive this character through suppressItemEffects() so they are not applied twice.`,
    );
  }
  if (gearUnmatched.length) {
    notes.push(`${gearMatched.length} of ${sheet.equipment.length} items matched the SRD. The rest are kept under their printed names.`);
  }

  // --- spells (decision 3) --------------------------------------------------
  // Only spells whose SOURCE is one of this character's classes go into the build. A source of
  // "Fey Touched", "Mage Hand Legerdemain", "Elven Lineage Spells" or "Ring of Three Wishes" is a
  // grant from a feat, subclass, lineage or magic item; spells.known has no room to say so, so
  // those are parked instead of being passed off as class spells.
  const classNames = new Set(classes.map((c) => norm(c.class)));
  const cantrips: string[] = [];
  const known: string[] = [];
  const parked: { name: string; source: string | null }[] = [];
  const spellsUnmatched: string[] = [];

  for (const s of sheet.spells.list ?? []) {
    const canonical = lookup(spellIx, s.name);
    if (!canonical) spellsUnmatched.push(s.name);
    const name = canonical ?? s.name;
    if (s.source && classNames.has(norm(s.source))) {
      if (s.level === 0) {
        if (!cantrips.includes(name)) cantrips.push(name);
      } else if (!known.includes(name)) {
        known.push(name);
      }
    } else {
      parked.push({ name, source: s.source });
    }
  }
  if (parked.length) {
    notes.push(`${parked.length} ${parked.length === 1 ? "spell comes" : "spells come"} from feats, subclass features, lineage or magic items rather than the class list, and ${parked.length === 1 ? "is" : "are"} kept in the import record only.`);
  }

  // --- assemble -------------------------------------------------------------
  const build: Build = {
    level: sheet.identity.total_level ?? 1,
    abilities,
    meta: {
      species: speciesRes.matched ?? sp.base,
      className: classRes.matched ?? rawClass,
      subclass: subclassRes.matched ?? rawSubclass,
      background: backgroundRes.matched ?? rawBackground,
    },
    // Left at the unarmoured baseline on purpose. Worn armour drives AC through the gear list, and
    // any leftover difference from D&D Beyond's printed AC is surfaced by reconcile() rather than
    // being quietly stuffed into armorMisc (decision 4).
    armorBase: 10,
    armorMisc: 0,
    saveProf: inferred.saveProf,
    saveBonusAll: inferred.saveBonusAll,
    skillProf,
    skillExpert,
    gear: { items, attuned },
    effects: [],
    epicChoices: {},
    spells: { cantrips, known },
  };

  // Park the ENTIRE parse. app/me/forge/page.tsx round-trips unknown build keys (normalizeBuild
  // spreads the raw object, edits deep-clone it, save writes the whole thing), so nothing here is
  // lost by opening the character in the Forge and editing it.
  (build as unknown as Record<string, unknown>).imported = {
    source: "dndbeyond_pdf",
    abilitiesArePrinted: true,
    importedAt: new Date().toISOString(),
    sheet,
  };

  const report: ImportReport = {
    characterName: sheet.identity.name,
    level: build.level,
    classes,
    species: speciesRes,
    background: backgroundRes,
    className: classRes,
    subclass: subclassRes,
    gear: { matched: gearMatched, unmatched: gearUnmatched },
    spells: { known, cantrips, parked, unmatched: spellsUnmatched },
    abilityEffectWarnings,
    inferred,
    notes,
  };

  return { build, report };
}

// ---------------------------------------------------------------------------
// Reconciliation (decision 4: report, never auto-fill)
// ---------------------------------------------------------------------------

export type Divergence = { field: string; ddb: number | string; derived: number | string; delta?: number };

/**
 * Compare what D&D Beyond printed against what deriveSheet computes for the mapped build. Every
 * agreement says the Forge models that part of the character correctly; every divergence locates
 * something it does not yet model, with a number attached. Feed the caller's deriveSheet output in.
 */
export function reconcile(
  sheet: DdbSheet,
  derived: {
    ac: number; hpMax: number; initiative: number; proficiencyBonus: number;
    saves: Record<Ability, number>; speed: number;
  },
): Divergence[] {
  const out: Divergence[] = [];
  const num = (field: string, ddb: number | null, got: number) => {
    if (typeof ddb === "number" && ddb !== got) out.push({ field, ddb, derived: got, delta: got - ddb });
  };
  num("armor_class", sheet.combat.armor_class, derived.ac);
  num("max_hp", sheet.combat.max_hp, derived.hpMax);
  num("initiative", sheet.combat.initiative, derived.initiative);
  num("proficiency_bonus", sheet.combat.proficiency_bonus, derived.proficiencyBonus);
  for (const a of ABILITIES) {
    const ddb = sheet.saves[a];
    if (typeof ddb === "number" && derived.saves[a] !== ddb) {
      out.push({ field: `save_${a}`, ddb, derived: derived.saves[a], delta: derived.saves[a] - ddb });
    }
  }
  return out;
}
