// lib/quick-build.ts (2026-11-11, push 30, audit P12: a quick guided build)
//
// The decisions behind the Forge's quick build (app/me/quick-build): from a class, a species and a
// background, a level 1 character that is ready to play once the player makes the picks only they can
// make (skills, spells, a species or feat option). Everything here is a sensible default, the kind a
// GM would suggest to a new player, and every one of them can be changed in the full Forge afterwards:
//
//   abilities  the standard array (15, 14, 13, 12, 10, 8), placed in the class's usual order
//   background a common background that suits the class (a Wizard is a Sage, a Rogue a Criminal), or
//              the best fit by its three abilities; its +2 goes on the class's best of those three
//              and the +1 on the next
//   gear       option A of the class's and the background's starting equipment, as the Forge's own
//              Granted equipment panel would add it, with the gold that comes with it in the purse
//
// 2024 rules only: a 2014 background has no ability increase, and a 2014 player is better served by
// the full Forge. Pure, so it is tested on its own (tests/quick-build.test.ts).

import { parseGranted, resolveCrossRefs, matchGranted } from "@/lib/granted-equipment";
import { backgroundAbilities } from "@/lib/picker-filters";
import { STANDARD_ARRAY } from "@/lib/ability-gen";

export type QAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";
const FULL: Record<string, QAbility> = {
  Strength: "str", Dexterity: "dex", Constitution: "con", Intelligence: "int", Wisdom: "wis", Charisma: "cha",
};

/** The classes a quick build offers: the background that suits each one in story as well as numbers
 *  (its +2 always lands on the class's main ability), and the order the abilities usually matter in. */
export const QUICK_CLASSES: { name: string; bg: string; order: QAbility[] }[] = [
  { name: "Barbarian", bg: "Soldier", order: ["str", "con", "dex", "wis", "cha", "int"] },
  { name: "Bard", bg: "Entertainer", order: ["cha", "dex", "con", "wis", "int", "str"] },
  { name: "Cleric", bg: "Acolyte", order: ["wis", "con", "dex", "str", "cha", "int"] },
  { name: "Druid", bg: "Hermit", order: ["wis", "con", "dex", "int", "cha", "str"] },
  { name: "Fighter", bg: "Soldier", order: ["str", "con", "dex", "wis", "cha", "int"] },
  { name: "Monk", bg: "Sailor", order: ["dex", "wis", "con", "str", "cha", "int"] },
  { name: "Paladin", bg: "Noble", order: ["str", "cha", "con", "wis", "dex", "int"] },
  { name: "Ranger", bg: "Guide", order: ["dex", "wis", "con", "str", "int", "cha"] },
  { name: "Rogue", bg: "Criminal", order: ["dex", "con", "int", "wis", "cha", "str"] },
  { name: "Sorcerer", bg: "Charlatan", order: ["cha", "con", "dex", "wis", "int", "str"] },
  { name: "Warlock", bg: "Hermit", order: ["cha", "con", "dex", "wis", "int", "str"] },
  { name: "Wizard", bg: "Sage", order: ["int", "con", "dex", "wis", "cha", "str"] },
  { name: "Artificer", bg: "Artisan", order: ["int", "con", "dex", "wis", "str", "cha"] },
];
export const quickClass = (name: string) => QUICK_CLASSES.find((c) => c.name === name) ?? null;

/** The common backgrounds a quick build chooses among (the rest are a click away in the Forge). */
export const QUICK_BACKGROUNDS = [
  "Acolyte", "Artisan", "Charlatan", "Criminal", "Entertainer", "Farmer", "Guard", "Guide",
  "Hermit", "Merchant", "Noble", "Sage", "Sailor", "Scribe", "Soldier", "Wayfarer",
];

/** The standard array placed in the class's order. */
export function standardScores(order: QAbility[]): Record<QAbility, number> {
  const out = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } as Record<QAbility, number>;
  order.forEach((a, i) => { out[a] = STANDARD_ARRAY[i] ?? 8; });
  return out;
}

const abilitiesOf = (text: string | undefined): QAbility[] =>
  backgroundAbilities(text).map((n) => FULL[n]).filter((a): a is QAbility => !!a);

/** How much a background's abilities matter to a class: the top ability counts most. */
function fit(order: QAbility[], abs: QAbility[]): number {
  const w = [16, 8, 4, 2, 1, 0];
  return abs.reduce((s, a) => s + (w[order.indexOf(a)] ?? 0), 0);
}

/** The class's own suggestion when the data has it; otherwise the best-fitting common background
 *  (ties go to the earlier one in QUICK_BACKGROUNDS); null when none of them is in the data. */
export function bestBackground(order: QAbility[], backgrounds: { name: string; ability_scores?: string }[], className?: string): string | null {
  const own = className ? quickClass(className)?.bg : undefined;
  if (own && backgrounds.some((b) => b.name === own)) return own;
  let best: { name: string; score: number } | null = null;
  for (const name of QUICK_BACKGROUNDS) {
    const b = backgrounds.find((x) => x.name === name);
    if (!b) continue;
    const score = fit(order, abilitiesOf(b.ability_scores));
    if (!best || score > best.score) best = { name, score };
  }
  return best?.name ?? null;
}

/** The background's increase: +2 on the class's best of its three abilities, +1 on the next. */
export function backgroundAsi(order: QAbility[], abilityScores: string | undefined): Record<string, number> {
  const abs = abilitiesOf(abilityScores).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!abs.length) return {};
  return abs.length === 1 ? { [abs[0]]: 2 } : { [abs[0]]: 2, [abs[1]]: 1 };
}

export type StarterKit = {
  items: { n: string }[];
  coins: { gp?: number; sp?: number; cp?: number; ep?: number; pp?: number };
  choose: string[];        // grants that are a decision ("Musical Instrument of your choice"), left to the player
};

/** Option A of one grant ("Choose A or B: (A) ...; or (B) 75 GP"), matched to the catalog. */
function kitFrom(text: string | undefined, catalog: string[], tool?: string): StarterKit {
  const out: StarterKit = { items: [], coins: {}, choose: [] };
  const bundles = parseGranted(text || "");
  if (!bundles.length) return out;
  const a = bundles[0];
  const { matched, missing, choose } = matchGranted(resolveCrossRefs(a.items, tool), catalog);
  // as the Forge's panel adds them: the catalog's items one per count (capped), and the rest by name
  for (const i of matched) for (let k = 0; k < Math.min(i.qty, 20); k++) out.items.push({ n: i.name });
  for (const i of missing) out.items.push({ n: i.name });
  out.choose = choose.map((i) => i.name);
  for (const c of a.currency) {
    const m = /(\d[\d,]*)\s*(cp|sp|ep|gp|pp)/i.exec(c);
    if (!m) continue;
    const k = m[2].toLowerCase() as keyof StarterKit["coins"];
    out.coins[k] = (out.coins[k] ?? 0) + Number(m[1].replace(/,/g, ""));
  }
  return out;
}

/** The class's starting equipment as its structured data carries it. Three words in that data are
 *  split by a stray space ("Leather Ar mor", "20 Ar rows", "Ar cane Focus"); they are joined here so
 *  they match the catalog. */
export function classEquipmentText(coreTraits: string | undefined): string | undefined {
  return /\|\s*Starting Equipment\s*\|([^|]*)\|/i.exec(coreTraits || "")?.[1]?.replace(/\bAr (mor|rows?|cane)\b/g, "Ar$1");
}

/** Option A of the class's and the background's starting equipment, together. */
export function starterKit(classEquipment: string | undefined, bg: { equipment?: string; tool_proficiency?: string } | undefined, catalog: string[]): StarterKit {
  const c = kitFrom(classEquipment, catalog);
  const b = kitFrom(bg?.equipment, catalog, bg?.tool_proficiency);
  const coins: StarterKit["coins"] = { ...c.coins };
  for (const [k, v] of Object.entries(b.coins) as [keyof StarterKit["coins"], number][]) coins[k] = (coins[k] ?? 0) + v;
  return { items: [...c.items, ...b.items], coins, choose: [...c.choose, ...b.choose] };
}

/** The build the quick path saves: the Forge's Build shape, with only what a quick build decides. */
export function quickBuild(o: {
  className: string; species: string; background: string; bgAbilityScores?: string;
  kit: StarterKit; aim?: string | null;
}): Record<string, unknown> {
  const order = quickClass(o.className)?.order ?? ["str", "dex", "con", "int", "wis", "cha"];
  return {
    edition: "2024",
    level: 1,
    abilities: standardScores(order),
    meta: { species: o.species, className: o.className, subclass: "", background: o.background },
    armorBase: 10, armorMisc: 0,
    saveProf: [], skillProf: [], skillExpert: [],
    bgAsi: backgroundAsi(order, o.bgAbilityScores),
    gear: { items: o.kit.items },
    coins: o.kit.coins,
    effects: [], epicChoices: {},
    spells: { cantrips: [], known: [] },
    // what the quick build left for the player, shown once in the Forge: gear choices, and the
    // subclass the class quiz pointed at (a subclass comes at level 3)
    quick: { at: new Date().toISOString(), choose: o.kit.choose, ...(o.aim ? { aim: o.aim } : {}) },
  };
}
