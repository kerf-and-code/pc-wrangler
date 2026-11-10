// lib/srd/derive-sheet.ts
//
// The character-sheet derivation engine, extracted from dnd-forge.html's derive() and its
// ~18 helpers and made pure: it reads nothing from module globals. Given a build (the stored
// INPUTS: base ability scores, equipped gear, chosen features, level, epic choices) plus the
// rules context (class/species/subclass tables and the ruleset), it computes the EFFECTIVE
// sheet: ability modifiers with gear applied, AC, HP max, saves, skills, spell DC / attack,
// initiative, speed, sneak dice, and so on.
//
// WHY PURE. In the forge these numbers were computed against a single global character C, so
// there could only ever be one sheet in memory. Pulling the logic into deriveSheet(build,
// ctx) lets the PC creator, the encounter builder, and any server route all derive a sheet
// from a stored build with no shared state. The design principle from the forge holds:
// changing gear flows into every derived number with no rebuild, because gear effects are
// resolved here, at derive time, not baked into the stored scores.
//
// EPIC (levels 21-30) is a PLUGGABLE TABLE (the EpicTable argument). The forge shipped its
// own house values for past-20 progression; those live in DEFAULT_EPIC below and can be
// replaced with the Epic Legacy published tables by passing a different EpicTable, without
// touching any of the derivation logic.

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

export const SKILLS: [string, string, Ability][] = [
  ["acrobatics", "Acrobatics", "dex"], ["animal", "Animal Handling", "wis"],
  ["arcana", "Arcana", "int"], ["athletics", "Athletics", "str"],
  ["deception", "Deception", "cha"], ["history", "History", "int"],
  ["insight", "Insight", "wis"], ["intimidation", "Intimidation", "cha"],
  ["investigation", "Investigation", "int"], ["medicine", "Medicine", "wis"],
  ["nature", "Nature", "int"], ["perception", "Perception", "wis"],
  ["performance", "Performance", "cha"], ["persuasion", "Persuasion", "cha"],
  ["religion", "Religion", "int"], ["sleight", "Sleight of Hand", "dex"],
  ["stealth", "Stealth", "dex"], ["survival", "Survival", "wis"],
];

export type Ruleset = "2024" | "2014";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

// A single carried item. `mod` is the plus-bonus of magic armor/weapons (+1, +2...).
// `variant` names a chosen sub-option (e.g. which Belt of Giant Strength).
//
// Phase 5c: `eq` (equipped) and `att` (attuned) say whether the item's effects apply. An entry
// stored before 5c has neither, and keeps counting exactly as it did (worn, and attuned when the
// item needs it), so no existing sheet changes. `qty` is a count for stackable gear (default 1);
// `custom` marks an item the player typed in, with an optional weight `wt` and a `note`.
export type GearEntry = {
  n: string; mod?: number; variant?: string;
  eq?: boolean; att?: boolean; qty?: number;
  custom?: boolean; wt?: number; note?: string;
  /** Phase 5i.2: the base weapon or armor of a magic item named with it ("Holy Avenger Rapier"). */
  base?: string;
  /** Phase 5g: containers. A container entry carries an `id`; an item stored in it carries that id as `in`. */
  id?: string; in?: string;
};

// The stored character build: the INPUTS a derivation runs over.
export type Build = {
  level: number;
  abilities: Record<Ability, number>;   // base scores before gear
  meta: { species: string; className: string; subclass: string; background: string };
  armorBase: number;                      // 10, or the base of worn body armor
  armorMisc: number;                      // misc AC adjustments the sheet tracks
  saveProf: Ability[];                     // save proficiencies from class
  saveBonusAll?: number;
  skillProf: string[];
  skillExpert: string[];
  featMods?: Record<string, number>;
  /**
   * The 2024 background ability-score assignment: the player's own +2/+1 or +1/+1/+1 across the
   * three abilities that background offers. Stored SEPARATELY from featMods, which the Forge builds
   * fresh from the species table on every derive - putting both in one bag would mean whichever was
   * spread last silently won, so a species +2 CON and a background +1 CON would come out as +2
   * rather than +3. They are merged additively at derive time instead.
   */
  bgAsi?: Record<string, number>;
  /**
   * Additional classes beyond the primary one in `meta`.
   *
   * DELIBERATELY ADDITIVE. meta.className and build.level stay the PRIMARY class and its level,
   * so every existing character and every part of this file that reads them keeps working
   * untouched. A single-class character has no `multiclass` key and derives exactly as before.
   *
   * The alternative - replacing meta with an array of classes - would have been cleaner on paper
   * and would have rewritten the meaning of `build.level` in twelve places at once, several of
   * which are subtly different: proficiency bonus wants the TOTAL, Sneak Attack wants the ROGUE
   * level, and subclass availability wants the level in the class granting it. Conflating those is
   * how a multiclass sheet ends up plausible and wrong.
   */
  multiclass?: { className: string; subclass?: string; level: number }[];
  gear: { budget?: string; items: GearEntry[]; attuned?: string[] };
  effects: string[];                       // active effect ids (conditions, buffs)
  epicChoices: Record<number, EpicChoice[]>; // per-level 21-30 boon/feat picks
  spells: { cantrips: string[]; known: string[] };
  slotsUsed?: Record<number, number>;
  /**
   * Phase 5e, the character sheet's overrides. An ability override replaces the final score (after
   * every bonus and the cap); hpMaxMod adds to the computed maximum HP; hpMaxOverride replaces it.
   * None of them is stored unless the player sets it, so every existing sheet derives as before.
   */
  abilityOverride?: Partial<Record<Ability, number>>;
  hpMaxMod?: number;
  hpMaxOverride?: number | null;
  /**
   * Species traits the player keeps on the character: for a homebrew species, a book the app has no
   * data for, or anything the bundled summaries miss. A D&D Beyond import fills it from the player's own
   * sheet (from: "sheet"). Shown with the species' built-in traits; one with the same name replaces it.
   * Kept with the character, never shipped as app data.
   */
  speciesTraits?: { name: string; desc: string; from?: "sheet" | "player" }[];
  /**
   * Standing numbers for a species the rules data does not know (no speed, darkvision or resistances
   * otherwise). Only used when the species has no entry in the rules context, so it can never fight a
   * known species' own figures.
   */
  speciesMech?: { speed?: number; darkvision?: number; resist?: string[] };
  /**
   * Labels only, for the ability breakdown: where featMods' points came from (background, species,
   * choices). The engine still adds featMods itself; when these do not add up to it per ability, the
   * breakdown shows featMods as one line instead.
   */
  featModSources?: { label: string; mods: Record<string, number> }[];
  /** Phase 5f: defenses the player records by hand (a curse, a boon, a blessing), added to the derived ones. */
  customDefenses?: { resist?: string[]; immune?: string[]; vuln?: string[] };
  /**
   * Phase 5i.2, an imported character's reconciliation with D&D Beyond: what D&D Beyond printed minus
   * what this engine works out, per number, stored once right after an import (components/forge
   * forge-app reconcile) and added on top from then on. So the sheet matches the PDF on the day it
   * comes in, even where a feat, item or subclass feature is not modelled yet, and later changes
   * (a level, a new item) still move the numbers. The sheet lists every adjustment, and the player can
   * clear them. Attack adjustments are applied where the attacks are built (lib/play/attacks).
   */
  importAdjust?: ImportAdjust;
  /**
   * The character's feats by name, for the ones the engine models (Alert, Tough). Filled at derive
   * time by the Forge from the chosen feats, the feats a D&D Beyond import lists, and the background's
   * origin feat; not something the player edits here.
   */
  feats?: string[];
};

export type ImportAdjust = {
  ac?: number; hp?: number; init?: number; speed?: number; spellDC?: number; spellAttack?: number;
  saves?: Partial<Record<Ability, number>>;
  skills?: Record<string, number>;
  /** By the attack's name as D&D Beyond prints it: to-hit and flat damage differences, or D&D
   *  Beyond's damage itself when its dice differ (a class's bigger unarmed die). */
  attacks?: Record<string, { hit?: number; dmg?: number; damage?: string }>;
  /** Passive scores beyond 10 + the skill (Observant's +5), applied by the sheet's Senses box. */
  passives?: { perception?: number; insight?: number; investigation?: number };
  /** When it was worked out (an ISO time), and from which D&D Beyond export. */
  at?: string;
  /**
   * Which engine it was worked out against (lib/ddb-import RECONCILE_VERSION). When the engine learns
   * something new (a feat it now models), an older adjustment would count that thing twice, so the
   * Forge works the adjustment out again.
   */
  v?: number;
};

export type EpicChoice = {
  name?: string; feature?: string; desc?: string; src?: string;
  mods?: Record<string, number>;
  grants?: {
    allSkillProf?: boolean; advConc?: boolean;
    saveProf?: Ability[]; senses?: string[]; resist?: string[];
  };
  asi?: Record<string, number>;
  saveProfFromAsi?: boolean;
  expertiseSkills?: string[];
  profSkills?: string[];
  chosenTypes?: string[];
  bonusCantrips?: number;
  bonusKnown?: number;
  optionId?: string;
  grantKind?: string;
  isFeat?: boolean;   // UI tag (Forge picker): distinguishes a feat pick from an ASI. Engine ignores it.
};

// Item-effect tables (from the forge's ITEM_EFFECTS / ITEM_VARIANTS). A gear item can bump a
// score (+2 STR) or set it to a floor (Belt of Giant Strength sets STR to 21/23/25/27/29).
export type ItemEffect =
  | { type: "bumpScore"; abil: Ability; value: number }
  | { type: "setScore"; abil: Ability; value: number };
export type ItemVariant = { options: { name: string; effect: ItemEffect | null }[] };

// Static rules context: the tables the forge kept as module constants, now passed in so the
// engine stays pure and the caller controls which ruleset/data is in force.
export type RulesContext = {
  ruleset: Ruleset;
  classes: Record<string, ClassRule>;
  species: Record<string, SpeciesRule>;
  subclasses: Record<string, SubclassRule>;
  itemEffects: Record<string, ItemEffect>;
  itemVariants: Record<string, ItemVariant>;
  items: Record<string, ItemDef>;          // name -> { kind, sub, rarity }
  epic?: EpicTable;                         // defaults to DEFAULT_EPIC
};

export type ClassRule = {
  hitDie?: number;
  sneakAttack?: boolean;
  sneakByLevel?: Record<number, number>;
  saveProfAt?: Record<number, Ability[]>;
  casting?: CastRule | null;
  features?: Record<number, [string, string][]>;
};
export type SpeciesRule = {
  speed?: number; mods?: Record<string, number>; resist?: string[];
  // Standing species effects (lib/srd/species-mechanics.ts). Optional, so a context built without
  // them derives exactly as before.
  immune?: string[];
  darkvision?: number;
  senses?: { blindsight?: number; tremorsense?: number; truesight?: number };
  speeds?: { fly?: number | "speed"; swim?: number | "speed"; climb?: number | "speed"; burrow?: number | "speed" };
  advAgainst?: string[];
  advSaves?: Ability[];
  advSavesVs?: string;
  acBonus?: number;
  naturalArmor?: { base: number; addDex: boolean; addAbil?: Ability };
};
export type SubclassRule = { casting?: CastRule | null };
export type CastRule = { ability: Ability };
export type ItemDef = { kind: string; sub?: string; rarity?: string; baseAC?: number; dexCap?: number | null; attune?: boolean };

// The pluggable epic (21-30) progression table. DEFAULT_EPIC below now carries the OFFICIAL
// Epic Legacy Core Rulebook (2CGaming, v1.0) progression, verified from the player-version
// PDF. Pass a different EpicTable to override (e.g. a house ruleset), no logic changes needed.
export type EpicTable = {
  pbByLevel: Record<number, number>;
  sneakByLevel?: Record<number, number>;
  hitDieAvg?: number | null;
  // Ability score maximum at epic levels. Epic Legacy raises the cap to 30 (from 20).
  abilityCap?: number;
  // The levels at which an Ability Score Improvement is granted (Epic Legacy: 21,23,25,27,29).
  asiLevels?: number[];
  // The levels at which an Epic Feat is granted (Epic Legacy: 21,25,29).
  epicFeatLevels?: number[];
};

// Epic Legacy Core Rulebook (2CGaming) official progression for levels 21-30, verified across
// every Epic prestige-class table (Ascendant, Overlord, Truespeaker, Primordial...) and the
// multiclassing rule: proficiency bonus is +6 at 21-22, +7 at 23-26, +8 at 27-30; the ability
// cap rises to 30; ASIs land at 21/23/25/27/29 and Epic Feats at 21/25/29. (The forge's earlier
// house PB values happened to match this exactly.) sneakByLevel past 20 is not defined by Epic
// Legacy for the SRD rogue, so the forge's smooth continuation is kept as a reasonable default.
export const DEFAULT_EPIC: EpicTable = {
  pbByLevel: { 20: 6, 21: 6, 22: 6, 23: 7, 24: 7, 25: 7, 26: 7, 27: 8, 28: 8, 29: 8, 30: 8 },
  sneakByLevel: { 20: 10, 21: 10, 22: 11, 23: 11, 24: 12, 25: 12, 26: 13, 27: 13, 28: 14, 29: 14, 30: 15 },
  hitDieAvg: null,
  abilityCap: 30,
  asiLevels: [21, 23, 25, 27, 29],
  epicFeatLevels: [21, 25, 29],
};

// ---------------------------------------------------------------------------
// Small helpers (pure)
// ---------------------------------------------------------------------------

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

function proficiencyBonus(level: number, epic: EpicTable): number {
  const t = epic.pbByLevel[level];
  if (typeof t === "number") return t;
  return level >= 17 ? 6 : level >= 13 ? 5 : level >= 9 ? 4 : level >= 5 ? 3 : 2;
}

function gearName(e: GearEntry | string): string {
  return typeof e === "string" ? e : e?.n || "";
}
function gearMod(e: GearEntry | string): number {
  return typeof e === "object" && e?.mod ? e.mod : 0;
}

// ---- equipped and attuned (phase 5c) ----

/** Does this item need attunement before its magic works? From the item data. */
export function needsAttunement(name: string, ctx: Pick<RulesContext, "items">): boolean {
  return !!ctx.items[name]?.attune;
}
/** Is this entry equipped? An entry stored before equipping existed counts as worn. */
export function gearEquipped(e: GearEntry): boolean {
  return e.eq !== false;
}
/**
 * Is this entry attuned? An explicit `att` wins. Otherwise a D&D Beyond import's attuned list
 * (gear.attuned) decides, and a build with no such list counts the item as attuned, which is how
 * every sheet derived before 5c treated it.
 */
export function gearAttuned(e: GearEntry, gear: Build["gear"] | undefined): boolean {
  if (typeof e.att === "boolean") return e.att;
  if (Array.isArray(gear?.attuned)) return gear!.attuned!.includes(e.n);
  return true;
}
/** Do this entry's effects apply: equipped, and attuned when the item needs it. */
export function gearActive(e: GearEntry, gear: Build["gear"] | undefined, ctx: Pick<RulesContext, "items">): boolean {
  if (!gearEquipped(e)) return false;
  return needsAttunement(e.n, ctx) ? gearAttuned(e, gear) : true;
}
function activeGear(build: Build, ctx: RulesContext): GearEntry[] {
  return (build.gear?.items || []).filter((e) => gearActive(e, build.gear, ctx));
}

/**
 * Fixed bonuses from common magic items, by name (both SRDs word these the same way). These sit
 * beside ITEM_EFFECTS (which raise or set ability scores) and cover the rest of what an item adds
 * to the numbers on a sheet:
 *   ac            to Armor Class, always
 *   acUnarmored   to Armor Class only with no body armor and no shield (Bracers of Defense)
 *   acBaseNoArmor a base AC used with no body armor when it beats the usual one (Robe of the Archmagi)
 *   saves, checks to every saving throw, to every ability check (skills and initiative included)
 *   spellDC, spellAttack
 *   resist, immune   damage types
 * Anything an item does that is not a flat number (advantage, charges, spells) stays in its
 * description, which the inventory shows.
 */
export type ItemBonus = {
  ac?: number; acUnarmored?: number; acBaseNoArmor?: number; saves?: number; checks?: number;
  spellDC?: number; spellAttack?: number; resist?: string[]; immune?: string[];
};
const RESIST_RINGS = ["Acid", "Cold", "Fire", "Force", "Lightning", "Necrotic", "Poison", "Psychic", "Radiant", "Thunder"];
export const ITEM_BONUSES: Record<string, ItemBonus> = {
  "Ring of Protection": { ac: 1, saves: 1 },
  "Cloak of Protection": { ac: 1, saves: 1 },
  "Bracers of Defense": { acUnarmored: 2 },
  "Stone of Good Luck": { saves: 1, checks: 1 },
  "Ioun Stone of Protection": { ac: 1 },
  "Luck Blade": { saves: 1 },
  "Robe of the Archmagi": { acBaseNoArmor: 15, spellDC: 2, spellAttack: 2 },
  "Wand of the War Mage, +1": { spellAttack: 1 },
  "Wand of the War Mage, +2": { spellAttack: 2 },
  "Wand of the War Mage, +3": { spellAttack: 3 },
  "Periapt of Proof against Poison": { immune: ["Poison"] },
  ...Object.fromEntries(RESIST_RINGS.map((t) => [`Ring of ${t} Resistance`, { resist: [t] }])),
};
/** The fixed bonus an item gives, if any. "Stone of Good Luck (Luckstone)" finds "Stone of Good Luck". */
export function itemBonusOf(name: string): ItemBonus | null {
  return ITEM_BONUSES[name] ?? ITEM_BONUSES[name.replace(/\s*\(.*\)\s*$/, "")] ?? null;
}
const sgn = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
/** One line for what an item changes on the sheet ("+1 AC, +1 to saves"), or null when nothing. */
export function itemEffectSummary(e: GearEntry, ctx: Pick<RulesContext, "items" | "itemEffects" | "itemVariants">): string | null {
  const bits: string[] = [];
  const eff = gearEffectOf(e, ctx as RulesContext);
  if (eff) bits.push(eff.type === "setScore" ? `${eff.abil.toUpperCase()} becomes ${eff.value}` : `${sgn(eff.value)} ${eff.abil.toUpperCase()}`);
  const it = ctx.items[e.n], md = gearMod(e);
  if (it?.kind === "Armor" && it.sub === "Shield") bits.push("+2 AC");
  else if (it?.kind === "Armor" && typeof it.baseAC === "number") bits.push(`AC ${it.baseAC}${it.dexCap === 0 ? "" : it.dexCap ? ` plus DEX (max ${it.dexCap})` : " plus DEX"}`);
  if (it && md) bits.push(it.kind === "Armor" ? `${sgn(md)} AC` : it.kind === "Weapon" ? `${sgn(md)} to attack and damage` : `${sgn(md)}`);
  const b = itemBonusOf(e.n);
  if (b) {
    if (b.ac) bits.push(`${sgn(b.ac)} AC`);
    if (b.acUnarmored) bits.push(`${sgn(b.acUnarmored)} AC with no armor or shield`);
    if (b.acBaseNoArmor) bits.push(`AC ${b.acBaseNoArmor} plus DEX with no armor`);
    if (b.saves) bits.push(`${sgn(b.saves)} to saves`);
    if (b.checks) bits.push(`${sgn(b.checks)} to ability checks`);
    if (b.spellDC) bits.push(`${sgn(b.spellDC)} spell save DC`);
    if (b.spellAttack) bits.push(`${sgn(b.spellAttack)} spell attacks`);
    if (b.resist?.length) bits.push(`${b.resist.join(", ")} resistance`);
    if (b.immune?.length) bits.push(`${b.immune.join(", ")} immunity`);
  }
  return bits.length ? bits.join(", ") : null;
}

// Some catalogs serve giant-strength items under their FULL name ("Belt of Storm Giant Strength")
// while the effect table keys the base variant item ("Belt of Giant Strength") with a lineage
// dropdown. Resolve a full name to {base, lineage} so either form matches the same effect. Returns
// null when the name isn't a giant-strength item, leaving normal lookup untouched.
const GIANT_LINEAGES = ["Hill", "Frost", "Stone", "Fire", "Cloud", "Storm"];
function resolveGiantStrength(nm: string): { base: string; lineage: string } | null {
  // "Belt of Storm Giant Strength" / "Potion of Fire Giant Strength"
  const m = nm.match(/^(Belt|Potion) of (Hill|Frost|Stone|Fire|Cloud|Storm) Giant Strength$/);
  if (m) return { base: `${m[1]} of Giant Strength`, lineage: `${m[2]} giant` };
  return null;
}

// The effect a gear entry contributes, resolving a variant choice if the item needs one.
function gearEffectOf(e: GearEntry, ctx: RulesContext): ItemEffect | null {
  const nm = gearName(e);

  // Fully-named giant-strength item: map to the base variant + its lineage, ignoring any need for a
  // separate variant pick (the lineage is in the name).
  const giant = resolveGiantStrength(nm);
  if (giant) {
    const varSpec = ctx.itemVariants[giant.base];
    const opt = varSpec?.options.find((o) => o.name === giant.lineage);
    if (opt) return opt.effect;
  }

  const varSpec = ctx.itemVariants[nm];
  if (varSpec) {
    const chosen = e?.variant;
    if (!chosen) return null;
    const opt = varSpec.options.find((o) => o.name === chosen);
    return opt ? opt.effect : null;
  }
  return ctx.itemEffects[nm] || null;
}

// Ability effects from all carried gear: {bump, set}. Order-independent, computed fresh.
function gearAbilityEffects(items: GearEntry[], ctx: RulesContext): {
  bump: Partial<Record<Ability, number>>; set: Partial<Record<Ability, number>>;
} {
  const out = { bump: {} as Partial<Record<Ability, number>>, set: {} as Partial<Record<Ability, number>> };
  for (const e of items) {
    const eff = gearEffectOf(e, ctx);
    if (!eff) continue;
    if (eff.type === "setScore") out.set[eff.abil] = Math.max(out.set[eff.abil] || 0, eff.value);
    else out.bump[eff.abil] = (out.bump[eff.abil] || 0) + eff.value;
  }
  return out;
}

const SUBCLASS_LEVEL_2014: Record<string, number> = { Cleric: 1, Sorcerer: 1, Warlock: 1, Druid: 2, Wizard: 2 };
function subclassLevel(className: string, ruleset: Ruleset): number {
  if (ruleset === "2014") return SUBCLASS_LEVEL_2014[className] || 3;
  return 3;
}
function hasSubclass(build: Build, ctx: RulesContext): boolean {
  return !!(build.meta.subclass && build.level >= subclassLevel(build.meta.className, ctx.ruleset));
}
function castRule(build: Build, ctx: RulesContext): CastRule | null {
  const sub = ctx.subclasses[build.meta.subclass];
  if (hasSubclass(build, ctx) && sub?.casting) return sub.casting;
  return ctx.classes[build.meta.className]?.casting || null;
}

// Class/subclass features that replace base AC while unarmored. base stands in for armor; add
// is an extra ability mod on top of DEX. Values from SRD 5.2 (2024) and SRD 5.0 (2014).
const UNARMORED_AC: Record<Ruleset, {
  cls: Record<string, { base: number; add: Ability | null; shieldOk: boolean; label: string }>;
  sub: Record<string, { base: number; add: Ability | null; shieldOk: boolean; label: string }>;
}> = {
  "2024": {
    cls: {
      Barbarian: { base: 10, add: "con", shieldOk: true, label: "Unarmored Defense" },
      Monk: { base: 10, add: "wis", shieldOk: false, label: "Unarmored Defense" },
    },
    sub: {
      "Draconic Sorcery": { base: 10, add: "cha", shieldOk: false, label: "Draconic Resilience" },
      // Forgotten Realms: Heroes of Faerun, Oath of the Noble Genies level 3 (2026-11-08): with no
      // armor, base AC 10 + DEX + CHA, and a Shield still counts.
      "Oath of the Noble Genies": { base: 10, add: "cha", shieldOk: true, label: "Genie's Splendor" },
    },
  },
  "2014": {
    cls: {
      Barbarian: { base: 10, add: "con", shieldOk: true, label: "Unarmored Defense" },
      Monk: { base: 10, add: "wis", shieldOk: false, label: "Unarmored Defense" },
    },
    sub: { "Draconic Bloodline": { base: 13, add: null, shieldOk: false, label: "Draconic Resilience" } },
  },
};

function wornArmorKinds(build: Build, ctx: RulesContext): {
  body: string | null; shield: boolean; heavy: boolean; baseAC: number | null; dexCap: number | null;
} {
  const out = { body: null as string | null, shield: false, heavy: false,
    baseAC: null as number | null, dexCap: null as number | null };
  // only what is equipped: armor in the pack does not protect you
  for (const e of activeGear(build, ctx)) {
    const it = ctx.items[gearName(e)];
    if (!it || it.kind !== "Armor") continue;
    if (it.sub === "Shield") { out.shield = true; continue; }
    out.body = it.sub || "worn";
    if (it.sub === "Heavy") out.heavy = true;
    // The last body armor wins (you wear one). Carry its base AC and Dex cap so the AC calc can use
    // them: Light armor adds full Dex (cap null), Medium caps Dex at +2, Heavy adds no Dex (cap 0).
    if (typeof it.baseAC === "number") out.baseAC = it.baseAC;
    out.dexCap = it.dexCap === undefined ? out.dexCap : it.dexCap;
  }
  return out;
}

// The character's level in one class, whether it is the primary class or one added by multiclassing.
export function classLevelOf(build: Build, className: string): number {
  if (build.meta.className === className) return build.level || 0;
  return (build.multiclass || []).find((c) => c.className === className)?.level || 0;
}

function unarmoredACRule(build: Build, ctx: RulesContext) {
  const set = UNARMORED_AC[ctx.ruleset] || UNARMORED_AC["2024"];
  const rule = set.sub[build.meta.subclass] || set.cls[build.meta.className];
  if (!rule) return null;
  const w = wornArmorKinds(build, ctx);
  if (w.body) return null;
  if (build.armorBase > 10) return null;
  if (!rule.shieldOk && w.shield) return null;
  return rule;
}

// Monk Unarmored Movement and Martial Arts die, by level (highest threshold that applies).
const MONK_MOVE: [number, number][] = [[18, 30], [14, 25], [10, 20], [6, 15], [2, 10]];
const MONK_MA_DIE: [number, number][] = [[17, 12], [11, 10], [5, 8], [1, 6]];
function stepValue(table: [number, number][], level: number): number {
  for (const [threshold, value] of table) if (level >= threshold) return value;
  return 0;
}

function sneakDice(build: Build, ctx: RulesContext, epic: EpicTable): number {
  const cls = ctx.classes[build.meta.className];
  if (!cls?.sneakAttack) return 0;
  if (build.level > 20 && epic.sneakByLevel?.[build.level]) return epic.sneakByLevel[build.level];
  return cls.sneakByLevel?.[Math.min(build.level, 20)] || 0;
}

// Aggregate the per-level epic (21-30) choices into modifier and grant bundles.
function epicAgg(build: Build) {
  const out = {
    mods: {} as Record<string, number>,
    grants: { allSkillProf: false, saveProf: [] as string[], senses: [] as string[], resist: [] as string[], advConc: false },
    expertise: [] as string[], skillProf: [] as string[],
    bonusCantrips: 0, bonusKnown: 0,
    features: [] as { level: number; name: string }[],
  };
  Object.keys(build.epicChoices).map(Number).sort((a, b) => a - b).forEach((L) => {
    for (const ch of build.epicChoices[L] || []) {
      if (!ch) continue;
      if (ch.mods) for (const k in ch.mods) out.mods[k] = (out.mods[k] || 0) + ch.mods[k];
      if (ch.grants) {
        if (ch.grants.allSkillProf) out.grants.allSkillProf = true;
        if (ch.grants.advConc) out.grants.advConc = true;
        (ch.grants.saveProf || []).forEach((s) => { if (!out.grants.saveProf.includes(s)) out.grants.saveProf.push(s); });
        (ch.grants.senses || []).forEach((s) => out.grants.senses.push(s));
        (ch.grants.resist || []).forEach((s) => out.grants.resist.push(s));
      }
      // Resilient and anything like it: the save proficiency follows the score you raised.
      if (ch.saveProfFromAsi && ch.asi) {
        Object.keys(ch.asi).forEach((a) => { if (!out.grants.saveProf.includes(a)) out.grants.saveProf.push(a); });
      }
      (ch.expertiseSkills || []).forEach((s) => { if (!out.expertise.includes(s)) out.expertise.push(s); });
      (ch.profSkills || []).forEach((s) => { if (!out.skillProf.includes(s)) out.skillProf.push(s); });
      (ch.chosenTypes || []).forEach((t) => out.grants.resist.push(t));
      out.bonusCantrips += ch.bonusCantrips || 0;
      out.bonusKnown += ch.bonusKnown || 0;
      out.features.push({ level: L, name: ch.name || "" });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

export type DerivedSheet = {
  proficiencyBonus: number;
  /** Every class level added together. Equals build.level for a single-class character. */
  totalLevel: number;
  abilities: Record<Ability, number>;      // effective scores (gear applied)
  mods: Record<Ability, number>;
  ac: number;
  acFormula: string;
  hpMax: number;
  saves: Record<Ability, number>;
  skills: Record<string, { abil: Ability; rank: number; val: number; fromEpic: boolean }>;
  isCaster: boolean;
  castAbil: Ability | null;
  spellDC: number;
  spellAttack: number;
  initiative: number;
  speed: number;
  speedLabel: string;
  sneakDice: number;
  martialArts: number;
  resist: string[];
  immune: string[];
  /** "Darkvision 60 ft", "Tremorsense 30 ft" */
  senses: string[];
  /** "Fly 30 ft", "Swim 30 ft": movement other than walking. */
  otherSpeeds: string[];
  /** Conditions with Advantage on saves to avoid or end them: "poisoned". */
  advAgainst: string[];
  /** Saving throws with Advantage always (Gnomish Cunning). */
  advSaves: Ability[];
  /** What those save advantages are limited to, if anything ("magic" for the 2014 gnome). */
  advSavesVs: string;
  /** Bonus to every ability check from items (Stone of Good Luck); already in skills and initiative. */
  checkBonus?: number;
  /** What each active magic item adds, one line per item: "Ring of Protection: +1 AC, +1 to saves". */
  itemNotes?: string[];
  /** Phase 5e: where each ability score comes from, in the order applied (the sheet's breakdown). */
  abilityParts?: Record<Ability, AbilityPart[]>;
  /** Phase 5e: maximum HP before the player's modifier or override. */
  hpMaxRolled?: number;
  /** Phase 5f: damage vulnerabilities (only ever recorded by hand: no species or item in either SRD gives one to a character). */
  vulnerable?: string[];
};

/** One line of an ability score's breakdown. "set" raises the score to a value (Belt of Giant Strength). */
export type AbilityPart = { label: string; value: number; how: "base" | "add" | "set" | "cap" | "override" };

// How many epic choices a character of the given level has earned, and the ability-score cap
// in force, from the epic table. The builder UI uses this to offer the right number of ASI /
// Epic Feat pickers past level 20. Below level 21 there are no epic grants and the cap is 20.
export function epicAdvancement(level: number, epic: EpicTable = DEFAULT_EPIC): {
  abilityCap: number; asiCount: number; epicFeatCount: number;
} {
  if (level <= 20) return { abilityCap: 20, asiCount: 0, epicFeatCount: 0 };
  return {
    abilityCap: epic.abilityCap ?? 20,
    asiCount: (epic.asiLevels || []).filter((l) => l <= level).length,
    epicFeatCount: (epic.epicFeatLevels || []).filter((l) => l <= level).length,
  };
}

export function deriveSheet(build: Build, ctx: RulesContext): DerivedSheet {  const epic = ctx.epic || DEFAULT_EPIC;
  // TOTAL character level: every class added together. Proficiency bonus is the clearest case
  // where the distinction bites - a Fighter 3 / Rogue 3 has the bonus of a level 6 character, not
  // of two level 3 ones.
  const totalLevel = build.level + (build.multiclass || []).reduce((n, c) => n + (c.level || 0), 0);
  const P = proficiencyBonus(totalLevel, epic);
  const ep = epicAgg(build);
  const em = ep.mods;

  // Effective abilities: stored scores with current gear effects applied, so changing gear
  // flows into every derived number with no rebuild.
  const liveAb = {} as Record<Ability, number>;
  ABILITIES.forEach((a) => { liveAb[a] = build.abilities[a]; });
  // the breakdown the character sheet shows, built beside the arithmetic so the two cannot disagree
  const parts = {} as Record<Ability, AbilityPart[]>;
  ABILITIES.forEach((a) => { parts[a] = [{ label: "Base score", value: build.abilities[a], how: "base" }]; });
  // Species and feat/background ability-score bonuses raise the BASE score (a +2 racial adds to
  // your stat), applied before gear so a gear "set" can still override a low result. In 2024 the
  // species table carries no ability mods (they moved to backgrounds), so this is a no-op there;
  // in 2014 the species table supplies "STR +2" etc., and featMods carries background bonuses.
  const abMods = ctx.species[build.meta.species]?.mods || {};
  const featAbMods = build.featMods || {};
  ABILITIES.forEach((a) => { if (abMods[a]) { liveAb[a] += abMods[a] as number; parts[a].push({ label: "Species", value: abMods[a] as number, how: "add" }); } });
  ABILITIES.forEach((a) => {
    if (!featAbMods[a]) return;
    liveAb[a] += featAbMods[a] as number;
    const srcs = (build.featModSources || []).map((x) => ({ label: x.label, value: Number(x.mods[a] || 0) })).filter((x) => x.value);
    if (srcs.length && srcs.reduce((n, x) => n + x.value, 0) === featAbMods[a]) srcs.forEach((x) => parts[a].push({ ...x, how: "add" }));
    else parts[a].push({ label: "Species, background and feats", value: featAbMods[a] as number, how: "add" });
  });
  // Ability-score increases and feat bonuses chosen at ASI levels (standard 4/8/12/16/19 and epic
  // 21-30) accumulate into em.mods via epicAgg; apply their per-ability values to the base score
  // too, so an ASI or an ability-raising feat actually moves the stat.
  ABILITIES.forEach((a) => { if (em[a]) { liveAb[a] += em[a] as number; parts[a].push({ label: "Ability score improvements and feats", value: em[a] as number, how: "add" }); } });
  // Only equipped (and, where needed, attuned) gear applies (phase 5c).
  const active = activeGear(build, ctx);
  const geff = gearAbilityEffects(active, ctx);
  ABILITIES.forEach((a) => { if (geff.bump[a]) liveAb[a] += geff.bump[a] as number; });
  const setWon: Partial<Record<Ability, boolean>> = {};
  ABILITIES.forEach((a) => { const s = geff.set[a]; if (s !== undefined && liveAb[a] < s) { liveAb[a] = s; setWon[a] = true; } });
  // the items behind those two lines, named
  for (const e of active) {
    const eff = gearEffectOf(e, ctx);
    if (!eff) continue;
    if (eff.type === "bumpScore") parts[eff.abil].push({ label: e.n, value: eff.value, how: "add" });
    else if (geff.set[eff.abil] === eff.value) parts[eff.abil].push({ label: setWon[eff.abil] ? `${e.n} sets the score` : `${e.n} (would set ${eff.value}, already higher)`, value: eff.value, how: "set" });
  }
  // Cap after everything: no ability exceeds the epic ceiling (30 by default).
  const abilityCap = epic.abilityCap || 30;
  ABILITIES.forEach((a) => { if (liveAb[a] > abilityCap) { liveAb[a] = abilityCap; parts[a].push({ label: `Capped at ${abilityCap}`, value: abilityCap, how: "cap" }); } });
  // The player's override replaces the result outright (phase 5e).
  ABILITIES.forEach((a) => {
    const ov = build.abilityOverride?.[a];
    if (typeof ov === "number" && Number.isFinite(ov)) { liveAb[a] = Math.max(1, Math.min(abilityCap, Math.round(ov))); parts[a].push({ label: "Override", value: liveAb[a], how: "override" }); }
  });
  const m = {} as Record<Ability, number>;
  ABILITIES.forEach((a) => { m[a] = abilityMod(liveAb[a]); });

  // Highest plus-bonus among worn armor/shields feeds AC directly.
  let gearAcBonus = 0, gearWeaponBonus = 0;
  for (const e of active) {
    const it = ctx.items[gearName(e)]; const md = gearMod(e);
    if (!it || !md) continue;
    if (it.kind === "Armor") gearAcBonus = Math.max(gearAcBonus, md);
    if (it.kind === "Weapon") gearWeaponBonus = Math.max(gearWeaponBonus, md);
  }
  // Fixed item bonuses (Ring of Protection and the like). The same item twice does not stack:
  // the rules let you attune to only one copy of a named item.
  const ib = { ac: 0, acUnarmored: 0, acBaseNoArmor: 0, saves: 0, checks: 0, spellDC: 0, spellAttack: 0, resist: [] as string[], immune: [] as string[] };
  const itemNotes: string[] = [];
  const seenItems = new Set<string>();
  for (const e of active) {
    // the sheet lists what each active magic item adds (a score, a +N, a fixed bonus)
    if (gearMod(e) || gearEffectOf(e, ctx) || itemBonusOf(e.n)) {
      const line = itemEffectSummary(e, ctx);
      if (line && !itemNotes.some((x) => x.startsWith(`${e.n}${gearMod(e) ? ` +${gearMod(e)}` : ""}:`))) itemNotes.push(`${e.n}${gearMod(e) ? ` +${gearMod(e)}` : ""}: ${line}`);
    }
    const b = itemBonusOf(e.n);
    if (!b || seenItems.has(e.n)) continue;
    seenItems.add(e.n);
    ib.ac += b.ac || 0; ib.acUnarmored = Math.max(ib.acUnarmored, b.acUnarmored || 0);
    ib.acBaseNoArmor = Math.max(ib.acBaseNoArmor, b.acBaseNoArmor || 0);
    ib.saves += b.saves || 0; ib.checks += b.checks || 0;
    ib.spellDC += b.spellDC || 0; ib.spellAttack += b.spellAttack || 0;
    ib.resist.push(...(b.resist || [])); ib.immune.push(...(b.immune || []));
  }

  // Class features that set base AC while unarmored replace armorBase and can add a second
  // ability modifier on top of DEX.
  const worn = wornArmorKinds(build, ctx);
  const udRule = unarmoredACRule(build, ctx);
  // Base AC priority: an unarmored-defense class feature, else the worn body armor's own base AC,
  // else the stored armorBase (10 by default). This is what makes Half Plate's 15 (etc.) actually
  // set the floor instead of only the magic +N applying.
  const acBase = udRule ? udRule.base
    : (worn.body && typeof worn.baseAC === "number" ? worn.baseAC : build.armorBase);
  const acAbil = udRule && udRule.add ? m[udRule.add] : 0;
  // DEX contribution respects the armor's cap: Light armor + unarmored add full DEX (cap null);
  // Medium caps at +2; Heavy adds none (cap 0). Unarmored-defense features add full DEX.
  const dexCap = udRule ? null : (worn.body ? worn.dexCap : null);
  const dexToAc = dexCap === null || dexCap === undefined ? m.dex : Math.min(m.dex, dexCap);
  let acFormula = udRule
    ? `${udRule.label}: ${udRule.base} plus DEX${udRule.add ? ` plus ${udRule.add.toUpperCase()}` : ""}`
    : "";
  // A shield adds a flat +2 to AC (5e), stacking on armor or unarmored defense.
  const shieldBonus = worn.shield ? 2 : 0;
  // A species AC bonus (Warforged Integrated Protection) applies armored or not.
  const speciesAc = ctx.species[build.meta.species]?.acBonus || 0;
  // Item AC: flat bonuses always; Bracers of Defense only with no armor and no shield.
  const itemAc = ib.ac + (!worn.body && !worn.shield ? ib.acUnarmored : 0);
  let ac = acBase + dexToAc + acAbil + build.armorMisc + (em.ac || 0) + gearAcBonus + shieldBonus + speciesAc + itemAc;
  // Robe of the Archmagi: base 15 plus DEX with no body armor, when that beats the usual base.
  if (ib.acBaseNoArmor && !worn.body) {
    const robe = ib.acBaseNoArmor + m.dex + build.armorMisc + (em.ac || 0) + shieldBonus + speciesAc + itemAc;
    if (robe > ac) { ac = robe; acFormula = `${ib.acBaseNoArmor} plus DEX (item)`; }
  }
  // Species natural armor (Lizardfolk, Tortle) replaces the base only without body armor, and only
  // when it comes out higher, which is how the trait is worded.
  const nat = ctx.species[build.meta.species]?.naturalArmor;
  if (nat && !worn.body) {
    const natAc = nat.base + (nat.addDex ? m.dex : 0) + (nat.addAbil ? m[nat.addAbil] : 0)
      + build.armorMisc + (em.ac || 0) + gearAcBonus
      + shieldBonus + speciesAc + itemAc;
    if (natAc > ac) {
      ac = natAc;
      acFormula = `Natural Armor: ${nat.base}${nat.addDex ? " plus DEX" : ""}${nat.addAbil ? ` plus ${nat.addAbil.toUpperCase()}` : ""}`;
    }
  }
  // Phase 5i.2: what D&D Beyond counts that the engine does not (an item or feature not modelled yet)
  const acAdj = build.importAdjust?.ac || 0;
  if (acAdj) { ac += acAdj; acFormula = `${acFormula || "10 plus DEX"}, ${acAdj > 0 ? "plus" : "minus"} ${Math.abs(acAdj)} to match D&D Beyond`; }

  const cls = ctx.classes[build.meta.className] || {};
  const hd = cls.hitDie || 8;
  const avg = epic.hitDieAvg || (Math.floor(hd / 2) + 1);
  const spMods = ctx.species[build.meta.species]?.mods || {};
  const ftMods = build.featMods || {};
  // Feats the engine models (phase 5o). Tough: +2 HP per character level (both editions). Alert:
  // initiative plus the proficiency bonus (2024) or plus 5 (2014).
  const featSet = new Set((build.feats || []).map((f) => f.trim().toLowerCase()));
  const toughHp = featSet.has("tough") ? 2 * totalLevel : 0;
  const perLvl = (em.hpPerLevel || 0) + (spMods.hpPerLevel || 0) + (ftMods.hpPerLevel || 0);

  // Draconic Resilience raises HP max by 3 at the subclass level and +1 per level after.
  let classHp = 0;
  if (/^Draconic/.test(build.meta.subclass || "")) {
    const at = subclassLevel(build.meta.className, ctx.ruleset) || 3;
    if (build.level >= at) classHp = 3 + Math.max(0, build.level - at);
  }
  // Hit points across classes. The FIRST class gets its full hit die at level 1; every level after
  // that, in any class, is an average roll of THAT class's die. Constitution applies per character
  // level, which is why it multiplies the total rather than the primary.
  const extraHp = (build.multiclass || []).reduce((n, c) => {
    const cd = ctx.classes[c.className]?.hitDie || 8;
    const cavg = epic.hitDieAvg || (Math.floor(cd / 2) + 1);
    return n + (c.level || 0) * cavg;
  }, 0);
  const hpMaxRolled = hd + (build.level - 1) * avg + extraHp
    + totalLevel * m.con + perLvl * totalLevel + classHp + toughHp;
  // the player's adjustments (phase 5e): an override replaces the maximum; a modifier adds to it
  const adj = build.importAdjust || {};
  const hpMax = typeof build.hpMaxOverride === "number" && build.hpMaxOverride > 0
    ? Math.round(build.hpMaxOverride)
    : Math.max(1, hpMaxRolled + Math.round(build.hpMaxMod || 0) + (adj.hp || 0));

  // Saves: class proficiencies plus any earned at later levels plus epic grants.
  const lateSaves: Ability[] = [];
  const spa = cls.saveProfAt || {};
  Object.keys(spa).map(Number).forEach((l) => {
    if (build.level >= l) spa[l].forEach((x) => { if (!lateSaves.includes(x)) lateSaves.push(x); });
  });
  const saveProfAll = build.saveProf
    .concat(lateSaves.filter((s) => !build.saveProf.includes(s)))
    .concat(ep.grants.saveProf.filter((s) => !build.saveProf.includes(s as Ability) && !lateSaves.includes(s as Ability)) as Ability[]);
  // Aura of Protection (Paladin 6, both editions): the paladin adds their Charisma modifier (at least
  // +1) to their own saving throws, as everyone in the aura does. Phase 5i.1: it was missing, so an
  // imported paladin carried it as a flat saveBonusAll instead (and lost it on any CHA change).
  const auraOfProtection = classLevelOf(build, "Paladin") >= 6 ? Math.max(1, m.cha) : 0;
  const saves = {} as Record<Ability, number>;
  ABILITIES.forEach((a) => {
    saves[a] = m[a] + (saveProfAll.includes(a) ? P : 0) + (build.saveBonusAll || 0) + (em.allSaves || 0) + ib.saves + auraOfProtection + (adj.saves?.[a] || 0);
  });

  // Skills: proficiency and expertise from class and epic; epic-granted ones are flagged.
  const jackOfAllTrades = classLevelOf(build, "Bard") >= 2;
  // 2024 class options that add Wisdom to checks: Divine Order: Thaumaturge (Cleric 1) on Arcana and
  // Religion, Primal Order: Magician (Druid 1) on Arcana and Nature, each at least +1.
  const picks = (build as Build & { classChoices?: Record<string, string[]> }).classChoices || {};
  const picked = (owner: string, feature: string, option: string) =>
    classLevelOf(build, owner) >= 1 && Object.entries(picks).some(([k, v]) => k.startsWith(`${owner}:`) && k.endsWith(`:${feature}`) && (v || []).includes(option));
  const wisToChecks: Record<string, number> = {};
  if (picked("Cleric", "Divine Order", "Thaumaturge")) { wisToChecks.arcana = Math.max(1, m.wis); wisToChecks.religion = Math.max(1, m.wis); }
  if (picked("Druid", "Primal Order", "Magician")) { wisToChecks.arcana = Math.max(1, m.wis); wisToChecks.nature = Math.max(1, m.wis); }
  const skills: DerivedSheet["skills"] = {};
  SKILLS.forEach(([k, , ab]) => {
    const isExp = build.skillExpert.includes(k) || ep.expertise.includes(k);
    const isProf = build.skillProf.includes(k) || ep.skillProf.includes(k) || ep.grants.allSkillProf;
    const rank = isExp ? 2 : isProf ? 1 : 0;
    skills[k] = {
      abil: ab, rank,
      // Jack of All Trades (Bard 2, both editions): half the proficiency bonus, rounded down, on any
      // check without proficiency. Phase 5i.2: it was missing; D&D Beyond marks those skills "H".
      val: m[ab] + rank * P + (rank === 0 && jackOfAllTrades ? Math.floor(P / 2) : 0) + (wisToChecks[k] || 0) + (em.allSkills || 0) + ib.checks + (adj.skills?.[k] || 0),
      fromEpic: !build.skillExpert.includes(k) && !build.skillProf.includes(k) && rank > 0,
    };
  });

  // Spell DC / attack come from the casting ability the class actually uses, and only exist
  // if the character casts at all (a Cleric keys off WIS, a Bard off CHA, a Barbarian off none).
  const cr = castRule(build, ctx);
  const isCaster = !!cr;
  const castAbil = cr ? cr.ability : null;
  const spellDC = isCaster && castAbil ? 8 + m[castAbil] + P + (em.spellDC || 0) + ib.spellDC + (adj.spellDC || 0) : 0;
  const spellAttack = isCaster && castAbil ? m[castAbil] + P + (em.spellAttack || 0) + ib.spellAttack + (adj.spellAttack || 0) : 0;

  // Initiative is a Dexterity check, so an item's bonus to checks counts.
  const alertInit = featSet.has("alert") ? (ctx.ruleset === "2014" ? 5 : P) : 0;
  const init = m.dex + (em.initiative || 0) + ib.checks + alertInit + (adj.init || 0);

  // Speed: species base plus class movement features (Monk unarmored, Barbarian fast).
  let speed = (ctx.species[build.meta.species]?.speed || 30) + (em.speed || 0);
  const wa = worn;
  let speedLabel = "";
  if (build.meta.className === "Monk" && !wa.body && !wa.shield && build.armorBase <= 10) {
    const cs = stepValue(MONK_MOVE, build.level);
    if (cs) { speed += cs; speedLabel = "Unarmored Movement"; }
  } else if (build.meta.className === "Barbarian" && build.level >= 5 && !wa.heavy) {
    speed += 10; speedLabel = "Fast Movement";
  }
  speed += adj.speed || 0;
  if (speed < 0) speed = 0;

  const martialArts = build.meta.className === "Monk" ? stepValue(MONK_MA_DIE, build.level) : 0;
  const sneak = sneakDice(build, ctx, epic) + (em.sneakDice || 0);
  // Species data is lower case ("poison") and a chosen type arrives capitalized ("Acid"), so the
  // list is normalized and de-duplicated rather than showing Poison twice.
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const resist: string[] = [];
  const cd = build.customDefenses || {};
  for (const r of (ctx.species[build.meta.species]?.resist || []).concat(ep.grants.resist, ib.resist, cd.resist || [])) {
    if (r && !resist.includes(cap(r))) resist.push(cap(r));
  }

  const sp = ctx.species[build.meta.species] || {};
  const immune: string[] = [];
  // Aura of Courage (Paladin 10, both editions): immune to the Frightened condition while it is up.
  const classImmune = classLevelOf(build, "Paladin") >= 10 ? ["Frightened"] : [];
  for (const r of (sp.immune || []).concat(ib.immune, classImmune, cd.immune || [])) if (r && !immune.includes(cap(r))) immune.push(cap(r));
  const vulnerable: string[] = [];
  for (const r of cd.vuln || []) if (r && !vulnerable.includes(cap(r))) vulnerable.push(cap(r));
  const senses: string[] = [];
  if (sp.darkvision) senses.push(`Darkvision ${sp.darkvision} ft`);
  for (const [k, v] of Object.entries(sp.senses || {})) if (v) senses.push(`${cap(k)} ${v} ft`);
  const otherSpeeds: string[] = [];
  for (const [k, v] of Object.entries(sp.speeds || {})) {
    if (v) otherSpeeds.push(`${cap(k)} ${v === "speed" ? speed : v} ft`);
  }

  return {
    proficiencyBonus: P,
    totalLevel,
    abilities: liveAb, mods: m,
    ac, acFormula, hpMax, saves, skills,
    isCaster, castAbil, spellDC, spellAttack,
    initiative: init, speed, speedLabel,
    sneakDice: sneak, martialArts, resist,
    immune, senses, otherSpeeds,
    advAgainst: sp.advAgainst || [], advSaves: sp.advSaves || [], advSavesVs: sp.advSavesVs || "",
    checkBonus: ib.checks, itemNotes,
    abilityParts: parts, hpMaxRolled, vulnerable,
  };
}
