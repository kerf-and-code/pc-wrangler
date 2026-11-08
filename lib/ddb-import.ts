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
//
// Phase 5i.1 (Terry, 2026-11-08, Bobertas Vox, Paladin 11): "make sure the character sheets reflect
// the uploaded D&D Beyond PDFs accurately". The parse already held everything; the mapper dropped it.
// It now also carries, all of it stated on the sheet rather than guessed:
//   * skill proficiencies as the engine's skill KEYS ("stealth", "animal"); they were saved as the
//     printed names ("Stealth"), which the engine never matched, so only background skills showed;
//   * gear quantities (Javelin 6, Ball Bearings 1,000), and which weapons are in use: a weapon is
//     equipped when D&D Beyond lists it under attacks, armor and shields always (they make its AC);
//   * coins, languages, resistances and immunities, and the bio (characteristics and notes);
//   * the Fighting Style feat and the Weapon Mastery picks, as the Forge's class choices;
//   * the flat all-saves bonus WITHOUT what the engine already adds (a worn Cloak of Protection, the
//     paladin's Aura of Protection), which it used to count a second time.
// ---------------------------------------------------------------------------

import { SKILLS, type Ability, type Build, type GearEntry, type ImportAdjust, type RulesContext } from "./srd/derive-sheet";
import { aliasPairs } from "./name-aliases";

// ---------------------------------------------------------------------------
// The parser's output shape (parse_ddb_sheet.py). Everything is optional-ish because a sheet for
// a non-caster has no spell page, a level-1 character has no additional-equipment page, and so on.
// ---------------------------------------------------------------------------

export type DdbClass = { class: string; level: number };

export type DdbSheet = {
  /** Present on the FIELD path: D&D Beyond states save proficiency outright. Absent on the
   *  coordinate path, where it has to be inferred from the modifiers. */
  save_prof?: Ability[];
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
  equipment: { name: string; detail: string | null; attuned: boolean; qty?: number | null; weight?: string | null }[];
  /** Field path only: the coin ledger, and the DEFENSES box split into lists. */
  currency?: Partial<Record<"cp" | "sp" | "ep" | "gp" | "pp", number | null>>;
  defenses?: { raw?: string | null; resistances?: string[]; immunities?: string[]; senses?: string | null; save_modifiers?: string | null };
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
  /** Phase 5i.1, all optional (an older caller just gets the old behaviour for each):
   *  feats of the Fighting Style category; weapon and armor item names (a magic weapon counts);
   *  and items that add a flat bonus to every save while worn (Cloak of Protection: 1). */
  fightingStyles?: string[];
  weapons?: string[];
  armor?: string[];
  saveBonusItems?: Record<string, number>;
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
  /** The alignment printed on the sheet, for the caller to store on the character. */
  alignment: string | null;
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

  // A magic weapon or armor written with its base item (phase 5i.2): "Holy Avenger Rapier", "Luck
  // Blade Rapier", "Moon-Touched Sword, Shortsword". The magic item is the name, the base is kept so
  // the sheet can attack with it.
  {
    const comma = s.match(/^(.+?),\s*([^,]+)$/);
    const words = s.split(/\s+/);
    const tries: [string, string][] = comma ? [[comma[1], comma[2]]] : [];
    for (let i = words.length - 1; i >= 1; i--) tries.push([words.slice(0, i).join(" "), words.slice(i).join(" ")]);
    for (const [head, tail] of tries) {
      const base = lookup(ix, tail);
      let item = lookup(ix, head);
      // "Moon-Touched Quarterstaff": the data names the item for one weapon ("Moon-Touched Sword") while
      // D&D Beyond allows any; take the one item that starts with the same words
      if (!item && base) {
        const h = norm(head) + " ";
        const starts = [...new Set([...ix.entries()].filter(([k]) => k.startsWith(h)).map(([, v]) => v))];
        if (starts.length === 1) item = starts[0];
      }
      if (item && base && item !== base) {
        const entry: GearEntry = { n: item, base };
        if (mod !== undefined) entry.mod = mod;
        return { entry, matched: item };
      }
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
// D&D Beyond tags a subclass with its book: "Circle of Spores (TCoE)", "Echo Knight (EGtW)", "The
// Undead (VRGtR)". Phase 5i.2: only five tags were known, so most book subclasses never matched; any
// short book code in a trailing bracket is now dropped.
export function stripLegacy(raw: string): string {
  return raw.replace(/\s*\((?:Legacy|[A-Z][A-Za-z0-9]{1,7}(?:-\d{4})?)\)\s*$/, "").trim();
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
  // D&D Beyond prints the full Player's Handbook names ("Tasha's Hideous Laughter"); the SRD list
  // has "Hideous Laughter". Point each alternate name at the SRD name when that name is present.
  for (const [alias, canonical] of aliasPairs("spells")) {
    const hit = spellIx.get(norm(canonical));
    if (hit && !spellIx.has(norm(alias))) spellIx.set(norm(alias), hit);
  }
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
    notes.push(`Multiclass (${classes.map((c) => `${c.class} ${c.level}`).join(" / ")}): ${primary?.class ?? "the highest class"} is the main class, and the others come in as its multiclass levels.`);
  }

  const rawSpecies = sheet.identity.species ?? "";
  let sp = splitSpecies(rawSpecies);
  let speciesMatch = lookup(speciesIx, rawSpecies) ?? lookup(speciesIx, sp.base);
  // Any lineage written before the species ("Rock Gnome", "Forest Gnome", "Sea Elf"), not only the
  // known prefixes: drop leading words until the rest is a species (phase 5i.2).
  if (!speciesMatch) {
    const words = rawSpecies.trim().split(/\s+/);
    for (let i = 1; i < words.length && !speciesMatch; i++) {
      const hit = lookup(speciesIx, words.slice(i).join(" "));
      if (hit) { speciesMatch = hit; sp = { base: hit, variant: words.slice(0, i).join(" ") }; }
    }
  }
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
    notes.push(`Species "${rawSpecies}" is not one Six Axes has traits for, so its traits will not show. The name is kept as typed.`);
  }

  const rawBackground = sheet.identity.background ?? "";
  const backgroundRes: Resolution = { raw: rawBackground, matched: lookup(backgroundIx, rawBackground) };

  const rawClass = primary?.class ?? "";
  const classRes: Resolution = { raw: rawClass, matched: lookup(classIx, rawClass) };

  // The subclass is the body of the "<Class> Subclass" feature ("Fighter Subclass" -> "Battle Master").
  // A multiclass character has one per class, so the primary class's own is taken first.
  const subclassOf = (cls: string) => sheet.features.find((f) => norm(f.name) === norm(`${cls} Subclass`) && f.desc);
  const subclassFeature = (primary ? subclassOf(primary.class) : undefined)
    ?? (classes.length > 1 ? undefined : sheet.features.find((f) => /\bsubclass\b/i.test(f.name) && f.desc));
  const rawSubclass = subclassFeature ? stripLegacy(subclassFeature.desc) : "";
  const subclassRes: Resolution = { raw: subclassFeature?.desc ?? "", matched: rawSubclass ? lookup(subclassIx, rawSubclass) : null };
  if (rawSubclass && !subclassRes.matched) {
    notes.push(`Subclass "${rawSubclass}" is not one Six Axes has features for, so its features will not show. The name is kept as typed.`);
  }

  // --- abilities and saves --------------------------------------------------
  const abilities = {} as Record<Ability, number>;
  for (const a of ABILITIES) abilities[a] = Number(sheet.abilities[a] ?? 10);

  const pb = sheet.combat.proficiency_bonus ?? 0;
  // Prefer what the sheet STATES. The field path reads <Abil>Prof directly, so no arithmetic is
  // needed; inferSaves stays for the coordinate path, which only has the modifiers. The two were
  // cross-checked against each other on all three test sheets and agreed exactly, so this is a
  // simplification rather than a behaviour change. The flat all-saves bonus still has to be
  // inferred either way, since nothing on the sheet names it.
  const inferredSaves = inferSaves(sheet.abilities, sheet.saves, pb);
  const inferred = sheet.save_prof && sheet.save_prof.length
    ? { saveProf: sheet.save_prof, saveBonusAll: inferredSaves.saveBonusAll }
    : { ...inferredSaves };
  // What the engine adds to every save by itself is taken out of the flat bonus, or it counts twice:
  // a worn save item (Cloak of Protection +1) and the paladin's Aura of Protection (CHA mod, at least
  // 1, from Paladin 6). Whatever is left is a bonus the engine does not model, carried as before.
  {
    const paladinLv = classes.find((c) => norm(c.class) === "paladin")?.level ?? 0;
    const aura = paladinLv >= 6 ? Math.max(1, abilityMod(Number(sheet.abilities.cha ?? 10))) : 0;
    // Only ATTUNED items count (a Cloak of Protection does nothing until attuned), each name once, looked
    // up as the engine looks it up ("Stone of Good Luck (Luckstone)" is a Stone of Good Luck). Phase
    // 5i.2: unattuned cloaks and bracketed names put five of 31 test sheets one off on every save.
    let fromItems = 0;
    const counted = new Set<string>();
    for (const row of sheet.equipment) {
      if (!row.attuned) continue;
      const { entry } = matchItem(itemIx, row.name);
      const key = [entry.n, entry.n.replace(/\s*\(.*\)\s*$/, "")].find((k) => ctx.saveBonusItems?.[k]);
      if (!key || counted.has(key)) continue;
      counted.add(key);
      fromItems += ctx.saveBonusItems![key];
    }
    if (inferred.saveBonusAll && (aura || fromItems)) {
      // phase 5i.2: plain words for the import screen ("magic items (+1) is worked out" read badly)
      const parts = [aura ? `Aura of Protection (+${aura})` : "", fromItems ? `attuned magic items (+${fromItems})` : ""].filter(Boolean).join(" and ");
      notes.push(`D&D Beyond's +${inferred.saveBonusAll} to every save comes from ${parts}. The sheet works that out itself, so it is not added twice.`);
    }
    inferred.saveBonusAll = inferred.saveBonusAll - aura - fromItems;
  }
  if (inferred.saveBonusAll) {
    notes.push(`Detected a flat ${inferred.saveBonusAll > 0 ? "+" : ""}${inferred.saveBonusAll} to all saving throws the sheet does not model, and carried it as saveBonusAll.`);
  }

  // --- skills ---------------------------------------------------------------
  // The engine keys skills by its own short names ("animal", "sleight"), not the printed ones.
  const skillKey = (printed: string) => {
    const n = norm(printed);
    return SKILLS.find(([k, label]) => norm(label) === n || norm(k) === n)?.[0] ?? null;
  };
  const keysOf = (rank: "proficient" | "expertise") =>
    [...new Set(sheet.skills.filter((s) => s.prof === rank).map((s) => skillKey(s.skill)).filter((k): k is string => !!k))];
  const skillProf = keysOf("proficient");
  const skillExpert = keysOf("expertise");

  // --- gear -----------------------------------------------------------------
  const items: GearEntry[] = [];
  const gearMatched: Resolution[] = [];
  const gearUnmatched: Resolution[] = [];
  const attuned: string[] = [];
  const abilityEffectWarnings: string[] = [];

  // Which weapons are in use: the ones D&D Beyond lists as attacks.
  const attackNames = new Set((sheet.attacks ?? []).map((a) => norm(a.name)));
  const weaponIx = ctx.weapons ? new Set(ctx.weapons.map(norm)) : null;
  const armorIx = ctx.armor ? new Set(ctx.armor.map(norm)) : null;
  for (const row of sheet.equipment) {
    const { entry, matched } = matchItem(itemIx, row.name);
    const qty = typeof row.qty === "number" && row.qty > 0 ? row.qty : 1;
    if (qty > 1) entry.qty = qty;
    // D&D Beyond prints the weight of the whole row ("Ball Bearings 1,000, 2 lb."), and weighs items the
    // rules data leaves blank (Saddlebags, potions). Keep its weight per piece, so the total carried
    // matches the sheet; a row printed without a weight ("--") keeps the data's own.
    const w = parseFloat(String(row.weight ?? "").replace(/,/g, ""));
    if (Number.isFinite(w) && w > 0) entry.wt = Math.round((w / qty) * 10000) / 10000;
    if (weaponIx && weaponIx.has(norm(entry.n))) entry.eq = attackNames.has(norm(row.name)) || attackNames.has(norm(entry.n));
    else if (armorIx && armorIx.has(norm(entry.n))) entry.eq = true;
    if (row.attuned) { entry.eq = true; entry.att = true; }
    items.push(entry);
    (matched ? gearMatched : gearUnmatched).push({ raw: row.name, matched });
    if (row.attuned) attuned.push(entry.n);
    if (lookup(effectIx, entry.n)) abilityEffectWarnings.push(entry.n);
  }
  if (abilityEffectWarnings.length) {
    notes.push(
      `${abilityEffectWarnings.join(", ")} change ability scores. D&D Beyond's scores already include them, so the sheet does not add them again.`,
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
  // Multiclass (phase 5i.2): Build keeps the PRIMARY class and ITS level in meta and level, and every
  // other class in build.multiclass, each with its own subclass when the sheet names one. It used to
  // keep only the total level, so a Paladin 6 / Bard 10 derived as a level 16 bard: no Aura of
  // Protection, bard hit dice for every level.
  const others = primary && classes.length > 1 ? classes.filter((c) => c !== primary) : [];
  const multiclass = others.map((c) => {
    const f = subclassOf(c.class);
    const raw = f ? stripLegacy(f.desc) : "";
    return { className: lookup(classIx, c.class) ?? c.class, level: c.level, ...(raw ? { subclass: lookup(subclassIx, raw) ?? raw } : {}) };
  });
  const build: Build = {
    level: others.length && primary ? primary.level : sheet.identity.total_level ?? 1,
    ...(multiclass.length ? { multiclass } : {}),
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

  // --- what the sheet states beyond the engine's inputs (phase 5i.1) ----------
  const extra = build as unknown as Record<string, unknown>;
  const cur = sheet.currency;
  if (cur) {
    const coins: Record<string, number> = {};
    for (const k of ["pp", "gp", "ep", "sp", "cp"] as const) { const v = Number(cur[k] ?? 0); if (v > 0) coins[k] = v; }
    extra.coins = coins;
  }
  const langs = (sheet.proficiencies?.languages ?? "").split(/,|;/).map((x) => x.trim()).filter(Boolean);
  if (langs.length) extra.languages = [...new Set(langs)];
  const def = sheet.defenses;
  if (def && ((def.resistances ?? []).length || (def.immunities ?? []).length)) {
    extra.customDefenses = {
      ...((def.resistances ?? []).length ? { resist: [...new Set(def.resistances)] } : {}),
      ...((def.immunities ?? []).length ? { immune: [...new Set(def.immunities)] } : {}),
    };
  }
  const bio = sheet.bio ?? {};
  const txt = (k: string) => { const v = bio[k]; return typeof v === "string" && v.trim() ? v.trim() : undefined; };
  // "=== Allies === ... === Organizations === ..." comes as one box; split it into the two notes.
  const ao = txt("allies_organizations") ?? "";
  const section = (label: string) => {
    const m = new RegExp(`===\\s*${label}\\s*===([\\s\\S]*?)(?====|$)`, "i").exec(ao);
    return m ? m[1].trim() || undefined : undefined;
  };
  const allies = section("Allies") ?? (ao && !/===/.test(ao) ? ao : undefined);
  const organizations = section("Organizations");
  const charNotes: Record<string, string> = {};
  const put = (k: string, v: string | undefined) => { if (v) charNotes[k] = v; };
  for (const k of ["gender", "age", "size", "height", "weight", "eyes", "hair", "skin", "faith", "personality", "ideals", "bonds", "flaws", "backstory"]) put(k, txt(k));
  put("allies", allies); put("organizations", organizations);
  put("other", [txt("appearance") ? `Appearance: ${txt("appearance")}` : "", txt("notes") ?? ""].filter(Boolean).join("\n\n") || undefined);
  if (Object.keys(charNotes).length) extra.notes = charNotes;

  // Class choices the sheet names: the Fighting Style feat, and the Weapon Mastery weapons
  // ("Longbow (Slow)" in the Weapon Mastery feature's text). Keys follow lib/class-choices choiceKey.
  const classChoices: Record<string, string[]> = {};
  const cls = build.meta.className;
  const styleSet = new Set((ctx.fightingStyles ?? []).map(norm));
  const styles = sheet.features.map((f) => f.name).filter((n) => styleSet.has(norm(n)));
  const STYLE_LEVEL: Record<string, number> = { Fighter: 1, Paladin: 2, Ranger: 2 };
  if (styles.length && STYLE_LEVEL[cls]) classChoices[`${cls}:-:${STYLE_LEVEL[cls]}:Fighting Style`] = [...new Set(styles)];
  const wm = sheet.features.find((f) => /^weapon mastery$/i.test(f.name.trim()));
  if (wm?.desc) {
    const picks = [...wm.desc.matchAll(/([A-Z][A-Za-z ,'-]{1,40}?) \((Cleave|Graze|Nick|Push|Sap|Slow|Topple|Vex)\)/g)].map((m) => m[1].trim());
    if (picks.length) classChoices[`${cls}:-:1:Weapon Mastery`] = [...new Set(picks)];
  }
  if (Object.keys(classChoices).length) extra.classChoices = classChoices;

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
    level: sheet.identity.total_level ?? build.level,
    classes,
    species: speciesRes,
    background: backgroundRes,
    className: classRes,
    subclass: subclassRes,
    gear: { matched: gearMatched, unmatched: gearUnmatched },
    spells: { known, cantrips, parked, unmatched: spellsUnmatched },
    abilityEffectWarnings,
    inferred,
    alignment: typeof sheet.bio?.alignment === "string" && sheet.bio.alignment.trim() ? sheet.bio.alignment.trim() : null,
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

// ---------------------------------------------------------------------------
// Reconciliation into adjustments (phase 5i.2)
// ---------------------------------------------------------------------------
// Terry, 2026-11-08, after 31 test characters: an imported sheet must match the PDF it came from. The
// Forge works out every number itself; wherever that differs from what D&D Beyond printed (a feat,
// item or subclass feature not modelled yet, or a 2014 rule), the difference is stored once as
// build.importAdjust and added on top. The engine still does the arithmetic, so a later change (a
// level, a new item) moves the number, and the sheet lists each adjustment so nothing is hidden.

/** An attack row as the sheet builds it (lib/play/attacks AttackRow, the fields compared here). */
export type ReconcileAttack = { name: string; toHit: number; damage: string };

const firstInt = (v: unknown): number | null => {
  const m = /[-+]?\d+/.exec(String(v ?? ""));
  return m ? Number(m[0]) : null;
};
// "1d8+5" -> { dice: "1d8", mod: 5 }; "7" -> { dice: "", mod: 7 }
const splitDamage = (d: string): { dice: string; mod: number } => {
  const t = d.replace(/\s+/g, "");
  const m = /^((?:\d*d\d+)(?:\+\d*d\d+)*)?([+-]\d+)?$/i.exec(t);
  if (!m) return { dice: t, mod: 0 };
  if (!m[1]) return { dice: "", mod: Number(t) || 0 };
  return { dice: m[1].toLowerCase(), mod: m[2] ? Number(m[2]) : 0 };
};
/** Names as both sides write them: "Rapier, +2" and "Rapier +2" are one weapon. */
export const attackKey = (n: string) => n.toLowerCase().replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();

export function reconcileImport(
  sheet: DdbSheet,
  derived: {
    ac: number; hpMax: number; initiative: number; speed: number; isCaster: boolean; spellDC: number; spellAttack: number;
    saves: Record<Ability, number>; skills: Record<string, { val: number }>;
  },
  attacks: ReconcileAttack[],
): ImportAdjust {
  const out: ImportAdjust = {};
  const diff = (printed: number | null, ours: number) => (printed === null || !Number.isFinite(printed) ? 0 : printed - ours);
  const c = sheet.combat;
  const set = <K extends "ac" | "hp" | "init" | "speed" | "spellDC" | "spellAttack">(k: K, d: number) => { if (d) out[k] = d; };
  set("ac", diff(firstInt(c.armor_class), derived.ac));
  set("hp", diff(firstInt(c.max_hp), derived.hpMax));
  set("init", diff(firstInt(c.initiative), derived.initiative));
  set("speed", diff(firstInt(c.speed), derived.speed));
  if (derived.isCaster) {
    set("spellDC", diff(firstInt(sheet.spells?.save_dc), derived.spellDC));
    set("spellAttack", diff(firstInt(sheet.spells?.attack_bonus), derived.spellAttack));
  }
  for (const a of ABILITIES) {
    const d = diff(firstInt(sheet.saves[a]), derived.saves[a]);
    if (d) (out.saves ??= {})[a] = d;
  }
  for (const s of sheet.skills) {
    const k = SKILLS.find(([key, label]) => norm(label) === norm(s.skill) || norm(key) === norm(s.skill))?.[0];
    if (!k || !derived.skills[k]) continue;
    const d = diff(firstInt(s.modifier), derived.skills[k].val);
    if (d) (out.skills ??= {})[k] = d;
  }
  for (const a of sheet.attacks ?? []) {
    const row = attacks.find((r) => attackKey(r.name) === attackKey(a.name));
    if (!row) continue;
    const hit = diff(firstInt(a.hit), row.toHit);
    const printed = splitDamage(String(a.damage ?? "").split(/\s+/)[0] ?? "");
    const ours = splitDamage(row.damage);
    // a flat difference is carried as one; different dice (a class's bigger unarmed die) take D&D
    // Beyond's damage as printed
    const sameDice = printed.dice === ours.dice;
    const dmg = sameDice ? printed.mod - ours.mod : 0;
    const damage = !sameDice && printed.dice ? `${printed.dice}${printed.mod ? (printed.mod > 0 ? `+${printed.mod}` : `${printed.mod}`) : ""}` : undefined;
    if (hit || dmg || damage) (out.attacks ??= {})[a.name] = { ...(hit ? { hit } : {}), ...(dmg ? { dmg } : {}), ...(damage ? { damage } : {}) };
  }
  // Passive scores: D&D Beyond's passive minus 10 and its own printed skill, which the sheet now
  // matches; anything left is a bonus to the passive alone (Observant's +5).
  const printedSkill = (label: string) => firstInt(sheet.skills.find((s) => norm(s.skill) === norm(label))?.modifier);
  for (const [k, field, label] of [["perception", "passive_perception", "Perception"], ["insight", "passive_insight", "Insight"], ["investigation", "passive_investigation", "Investigation"]] as const) {
    const pv = firstInt((c as Record<string, unknown>)[field]), sk = printedSkill(label);
    if (pv !== null && sk !== null && pv - 10 - sk) (out.passives ??= {})[k] = pv - 10 - sk;
  }
  out.at = new Date().toISOString();
  return out;
}
