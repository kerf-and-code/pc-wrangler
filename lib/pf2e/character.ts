// PF2e character derivation engine. The Forge's D&D side feeds a Build to deriveSheet(build, ctx);
// this is the PF2e parallel: a Pf2eBuild (the player's choices) + rules data -> a computed Pf2eSheet.
// Pure and deterministic, no I/O, so it re-derives on every edit exactly like the D&D engine.
//
// The MECHANICS here (proficiency = level + 2*rank, ability boosts +2 / +1-above-18, HP = ancestry +
// (classHP + Con) * level, AC/saves/perception/DCs) are PF2e's rules - open under OGL/ORC. The rules
// DATA (which ancestries/classes exist, their per-level proficiency progressions) lives in a separate
// data module, referenced against the Foundry pf2e system's mechanics, and fills in iteratively.

export type PF2Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type PF2Save = "fortitude" | "reflex" | "will";
export type ProfRank = 0 | 1 | 2 | 3 | 4; // Untrained, Trained, Expert, Master, Legendary
export type ArmorCategory = "unarmored" | "light" | "medium" | "heavy";

export const PF2_ABILITIES: PF2Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
export const PF2_SAVES: PF2Save[] = ["fortitude", "reflex", "will"];

// PF2e proficiency bonus: 0 when untrained, otherwise your level plus twice the rank (T +2, E +4,
// M +6, L +8, each also adding your level).
export function profBonus(rank: ProfRank, level: number): number {
  return rank === 0 ? 0 : level + 2 * rank;
}

// A proficiency that improves at set levels: `start` from level 1, each [level, rank] raising it.
export interface Prog { start: ProfRank; bumps?: [number, ProfRank][] }
export function rankAt(p: Prog, level: number): ProfRank {
  let r = p.start;
  for (const [lvl, rank] of p.bumps ?? []) if (level >= lvl) r = rank;
  return r;
}

// Which ability powers each skill (Lore uses Int; unknown skills default to Int).
export const SKILL_ABILITY: Record<string, PF2Ability> = {
  acrobatics: "dex", arcana: "int", athletics: "str", crafting: "int", deception: "cha",
  diplomacy: "cha", intimidation: "cha", medicine: "wis", nature: "wis", occultism: "int",
  performance: "cha", religion: "wis", society: "int", stealth: "dex", survival: "wis", thievery: "dex",
};

// ---- rules-data shapes (populated in the data module) -----------------------------------------

export interface Ancestry {
  id: string; name: string; hp: number; size: string; speed: number;
  boosts: (PF2Ability | "free")[];  // fixed boosts, plus "free" slots the player chooses
  flaws: PF2Ability[];
  languages: string[];
}
export interface Heritage { id: string; name: string; ancestryId: string; note?: string }
export interface Background {
  id: string; name: string;
  boosts: (PF2Ability | "free")[];  // usually a limited choice + one free
  trainedSkill: string; loreSkill?: string; feat?: string;
}
export interface PClass {
  id: string; name: string;
  keyAbility: PF2Ability[];          // options (most classes one; some let you choose)
  hp: number;                        // HP granted per level
  perception: Prog;
  saves: Record<PF2Save, Prog>;
  classDc: Prog;
  weapons: { unarmed: Prog; simple: Prog; martial: Prog; advanced?: Prog };
  armor: Record<ArmorCategory, Prog>;
  spell?: { tradition: string; ability: PF2Ability; dc: Prog };
  trainedSkills: number;             // free skill trainings at level 1 (before adding Int)
}

export interface PF2Rules {
  ancestries: Record<string, Ancestry>;
  heritages: Record<string, Heritage>;
  backgrounds: Record<string, Background>;
  classes: Record<string, PClass>;
}

// ---- the build (player choices) + the derived sheet -------------------------------------------

export interface Pf2eBuild {
  level: number;                     // 1-20
  ancestryId: string; heritageId: string; backgroundId: string; classId: string;
  keyAbility: PF2Ability;            // chosen from the class's options
  boosts: {
    ancestry: PF2Ability[];          // choices for the ancestry's "free" slots
    background: PF2Ability[];        // choices for the background's boosts
    level1: PF2Ability[];            // the four free level-1 boosts
    level5: PF2Ability[]; level10: PF2Ability[]; level15: PF2Ability[]; level20: PF2Ability[];
  };
  skills: Record<string, ProfRank>;  // skill id -> chosen rank
  armor: { category: ArmorCategory; dexCap: number; itemBonus: number };
  feats: Record<string, string[]>;   // slot key (pf2eFeatSlots) -> chosen feat names
  /** Push 22 (audit G4): spells the character knows or prepares, by name and rank (0 = cantrip). */
  spells?: { name: string; rank: number }[];
  /** Push 22: carried gear, by name. Recorded only; armor still sets AC through `armor` above. */
  gear?: { name: string; qty: number }[];
}

export type Pf2eFeatType = "ancestry" | "class" | "skill" | "general";
export type Pf2eFeatSlot = { key: string; type: Pf2eFeatType; level: number; label: string };

const ANCESTRY_FEAT_LEVELS = [1, 5, 9, 13, 17];
const GENERAL_FEAT_LEVELS = [3, 7, 11, 15, 19];
/** Classes in PF2_RULES that take a class feat at level 1 (the fighter and the rogue; the cleric and
 *  the wizard start at 2). */
const CLASS_FEAT_AT_1 = new Set(["fighter", "rogue"]);

/**
 * The feat slots a character has by level (Player Core): ancestry feats at 1, 5, 9, 13 and 17; class
 * feats at every even level (and level 1 for the fighter and rogue); skill feats at every even level
 * (every level for the rogue); general feats at 3, 7, 11, 15 and 19.
 */
export function pf2eFeatSlots(level: number, classId: string): Pf2eFeatSlot[] {
  const lv = clamp(Math.round(level) || 1, 1, 20);
  const out: Pf2eFeatSlot[] = [];
  const add = (type: Pf2eFeatType, at: number) =>
    out.push({ key: `${type}-${at}`, type, level: at, label: `${type[0].toUpperCase()}${type.slice(1)} feat (level ${at})` });
  for (let at = 1; at <= lv; at++) {
    if (ANCESTRY_FEAT_LEVELS.includes(at)) add("ancestry", at);
    if (at % 2 === 0 || (at === 1 && CLASS_FEAT_AT_1.has(classId))) add("class", at);
    if (at % 2 === 0 || classId === "rogue") add("skill", at);
    if (GENERAL_FEAT_LEVELS.includes(at)) add("general", at);
  }
  return out;
}

/** The highest spell rank a full caster can cast at this level (rank 1 at 1, rank 10 at 19). */
export function pf2eMaxSpellRank(level: number): number {
  return clamp(Math.ceil((Math.round(level) || 1) / 2), 1, 10);
}

export interface Pf2eSheet {
  level: number;
  keyAbility: PF2Ability;
  abilities: Record<PF2Ability, number>;   // scores
  mods: Record<PF2Ability, number>;         // modifiers
  ac: number;
  saves: Record<PF2Save, number>;
  perception: number;
  hp: number;
  classDc: number;
  spellDc: number | null;
  skills: Record<string, number>;           // skill id -> total modifier
}

export function emptyPf2eBuild(): Pf2eBuild {
  return {
    level: 1, ancestryId: "", heritageId: "", backgroundId: "", classId: "", keyAbility: "str",
    boosts: { ancestry: [], background: [], level1: [], level5: [], level10: [], level15: [], level20: [] },
    skills: {}, armor: { category: "unarmored", dexCap: 99, itemBonus: 0 }, feats: {},
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Apply PF2e's boost rule to a score: +2, or +1 if already 18 or higher (a partial boost).
function boostScore(score: number): number { return score + (score < 18 ? 2 : 1); }

export function derivePf2eSheet(build: Pf2eBuild, rules: PF2Rules): Pf2eSheet | null {
  const cls = rules.classes[build.classId];
  if (!cls) return null;
  const anc = rules.ancestries[build.ancestryId];
  const level = clamp(Math.round(build.level) || 1, 1, 20);

  // 1) Ability scores: start 10, apply ancestry (fixed + chosen free) + flaws, background, class key,
  //    then the free boosts by level. Boosts respect the +1-above-18 rule as they apply.
  const scores: Record<PF2Ability, number> = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  const boost = (a: PF2Ability) => { scores[a] = boostScore(scores[a]); };
  const flaw = (a: PF2Ability) => { scores[a] -= 2; };
  if (anc) {
    for (const b of anc.boosts) if (b !== "free") boost(b);
    for (const a of build.boosts.ancestry) boost(a);
    for (const f of anc.flaws) flaw(f);
  }
  for (const a of build.boosts.background) boost(a);
  boost(build.keyAbility);
  for (const a of build.boosts.level1) boost(a);
  if (level >= 5) for (const a of build.boosts.level5) boost(a);
  if (level >= 10) for (const a of build.boosts.level10) boost(a);
  if (level >= 15) for (const a of build.boosts.level15) boost(a);
  if (level >= 20) for (const a of build.boosts.level20) boost(a);

  const mods = {} as Record<PF2Ability, number>;
  for (const a of PF2_ABILITIES) mods[a] = Math.floor((scores[a] - 10) / 2);

  // 2) Derived statistics.
  const armorProg = cls.armor[build.armor.category] ?? { start: 0 };
  const ac = 10 + Math.min(mods.dex, build.armor.dexCap) + profBonus(rankAt(armorProg, level), level) + build.armor.itemBonus;

  const saves = {} as Record<PF2Save, number>;
  const saveAbility: Record<PF2Save, PF2Ability> = { fortitude: "con", reflex: "dex", will: "wis" };
  for (const s of PF2_SAVES) saves[s] = mods[saveAbility[s]] + profBonus(rankAt(cls.saves[s], level), level);

  const perception = mods.wis + profBonus(rankAt(cls.perception, level), level);
  const hp = (anc?.hp ?? 8) + (cls.hp + mods.con) * level;
  const classDc = 10 + mods[build.keyAbility] + profBonus(rankAt(cls.classDc, level), level);
  const spellDc = cls.spell ? 10 + mods[cls.spell.ability] + profBonus(rankAt(cls.spell.dc, level), level) : null;

  const skills: Record<string, number> = {};
  for (const [sk, rank] of Object.entries(build.skills)) {
    const abil = SKILL_ABILITY[sk] ?? "int";
    skills[sk] = mods[abil] + profBonus(rank, level);
  }

  return { level, keyAbility: build.keyAbility, abilities: scores, mods, ac, saves, perception, hp, classDc, spellDc, skills };
}
