// lib/srd/rules-context.ts
//
// Builds the RulesContext that deriveSheet() consumes. deriveSheet is pure and reads its
// static rules (class hit dice and casting, species speed/mods/resist, subclass casting, item
// effects and variants, and an item -> {kind,sub,rarity} map) entirely from this context. This
// module is the bridge: it holds the game-rules tables (lifted verbatim from dnd-forge.html's
// embedded data via a faithful eval-and-serialize, not retyped) and reshapes them into the
// shapes the engine's types expect, pulling the item catalog from the SRD equipment JSON that
// already ships in lib/srd.
//
// Two layers:
//   1. The raw forge tables, re-exported typed (RULES_DATA) for the builder UI to read directly
//      when it needs the richer fields the engine ignores (traits, subclass lists, skill picks).
//   2. buildRulesContext(ruleset) -> RulesContext, the adapter the engine takes.

import type {
  RulesContext, ClassRule, SpeciesRule, SubclassRule, ItemDef,
  ItemEffect, ItemVariant, Ruleset, Ability,
} from "./derive-sheet";

import rulesData from "./rules-data.json";
import equipment2024 from "./equipment-2024.json";
import equipment2014 from "./equipment-2014.json";
import magicItems2024 from "./magic-items-2024.json";
import magicItems2014 from "./magic-items-2014.json";

// ---------------------------------------------------------------------------
// Raw forge tables, typed. These carry MORE than the engine reads (traits, subclass
// lists, skill picks, backgrounds); the builder UI uses those, the engine uses a subset.
// ---------------------------------------------------------------------------

type ForgeCasting = { type: string; ability: Ability; list?: string;[k: string]: unknown };
type ForgeClass = {
  hitDie: number; primary?: Ability[]; saves?: Ability[];
  casting?: ForgeCasting; subclasses?: string[]; sneakAttack?: boolean;
  saveProfAt?: Record<number, Ability[]>;
  features?: Record<number, [string, string][]>;
  [k: string]: unknown;
};
type ForgeSpecies = { speed?: number; resist?: string[]; mods?: Record<string, number>;[k: string]: unknown };
type ForgeSubclass = { casting?: ForgeCasting; features?: [string, string][];[k: string]: unknown };

type RulesData = {
  ITEM_EFFECTS: Record<string, ItemEffect>;
  ITEM_VARIANTS: Record<string, ItemVariant>;
  SPECIES: Record<string, ForgeSpecies>;
  BACKGROUNDS: Record<string, unknown>;
  CLASSES: Record<string, ForgeClass>;
  SUBCLASS_RULES: Record<string, ForgeSubclass>;
};

export const RULES_DATA = rulesData as unknown as RulesData;

// ---------------------------------------------------------------------------
// Item catalog: name -> {kind, sub, rarity}. deriveSheet reads kind ("Armor"/"Weapon" gate
// gear AC/attack bonuses) and sub ("Heavy"/"Shield" gate unarmored defense and heavy-armor
// movement). Built from the SRD equipment + magic-item JSON per ruleset.
// ---------------------------------------------------------------------------

type EquipRow = { name: string; category?: string; weapon_category?: string; armor_category?: string };
type MagicRow = { name: string; category?: string; rarity?: string };

function itemsFromEquipment(rows: EquipRow[]): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};
  for (const r of rows) {
    if (r.weapon_category) {
      out[r.name] = { kind: "Weapon", sub: r.weapon_category, rarity: "mundane" };
    } else if (r.armor_category) {
      // armor_category is Light | Medium | Heavy | Shield; the engine keys on Heavy and Shield.
      out[r.name] = { kind: "Armor", sub: r.armor_category, rarity: "mundane" };
    }
  }
  return out;
}

function itemsFromMagic(rows: MagicRow[]): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {};
  for (const r of rows) {
    // Magic armor/weapons carry their +N in the gear entry's `mod`; the catalog just needs the
    // kind so the engine knows to apply that mod to AC or attack. Category names vary, so map
    // the common ones and leave the rest as Wondrous (no AC/attack gate).
    const cat = (r.category || "").toLowerCase();
    const kind = cat.includes("armor") ? "Armor" : cat.includes("weapon") ? "Weapon" : "Wondrous";
    out[r.name] = { kind, rarity: r.rarity || "unknown" };
  }
  return out;
}

// ---------------------------------------------------------------------------
// The adapter: shape the forge tables + SRD items into a RulesContext.
// ---------------------------------------------------------------------------

// Standard rogue sneak-attack progression: ceil(level / 2) d6 for levels 1-20 (10d6 by 19-20).
// The forge computes this dynamically after its CLASSES literal, so it is reconstructed here.
function rogueSneakByLevel(): Record<number, number> {
  const t: Record<number, number> = {};
  for (let l = 1; l <= 20; l++) t[l] = Math.ceil(l / 2);
  return t;
}

function toClassRule(name: string, c: ForgeClass): ClassRule {
  const rule: ClassRule = {
    hitDie: c.hitDie,
    casting: c.casting ? { ability: c.casting.ability } : null,
    saveProfAt: c.saveProfAt,
    sneakAttack: c.sneakAttack,
    features: c.features,
  };
  if (c.sneakAttack) rule.sneakByLevel = rogueSneakByLevel();
  return rule;
}

function toSpeciesRule(s: ForgeSpecies): SpeciesRule {
  return { speed: s.speed, mods: s.mods, resist: s.resist };
}

function toSubclassRule(s: ForgeSubclass): SubclassRule {
  return { casting: s.casting ? { ability: s.casting.ability } : null };
}

/**
 * Build the RulesContext deriveSheet consumes for a given ruleset. The class/species/subclass
 * rules are edition-agnostic in the forge data (they describe 2024 mechanics); the item catalog
 * is edition-specific and drawn from the matching SRD equipment + magic-item JSON, with mundane
 * gear from both so nothing a character carries goes unrecognized.
 */
export function buildRulesContext(ruleset: Ruleset): RulesContext {
  const classes: Record<string, ClassRule> = {};
  for (const [name, c] of Object.entries(RULES_DATA.CLASSES)) classes[name] = toClassRule(name, c);

  const species: Record<string, SpeciesRule> = {};
  for (const [name, s] of Object.entries(RULES_DATA.SPECIES)) species[name] = toSpeciesRule(s);

  const subclasses: Record<string, SubclassRule> = {};
  for (const [name, s] of Object.entries(RULES_DATA.SUBCLASS_RULES)) subclasses[name] = toSubclassRule(s);

  const equip = ruleset === "2014" ? equipment2014 : equipment2024;
  const magic = ruleset === "2014" ? magicItems2014 : magicItems2024;
  const items: Record<string, ItemDef> = {
    ...itemsFromEquipment(equip as EquipRow[]),
    ...itemsFromMagic(magic as MagicRow[]),
  };

  return {
    ruleset,
    classes,
    species,
    subclasses,
    itemEffects: RULES_DATA.ITEM_EFFECTS,
    itemVariants: RULES_DATA.ITEM_VARIANTS,
    items,
    // epic defaults to DEFAULT_EPIC inside deriveSheet; override here only for a house ruleset.
  };
}
