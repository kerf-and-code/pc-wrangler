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

// A single equipped item. `mod` is the plus-bonus of magic armor/weapons (+1, +2...).
// `variant` names a chosen sub-option (e.g. which Belt of Giant Strength).
export type GearEntry = { n: string; mod?: number; variant?: string };

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
  gear: { budget?: string; items: GearEntry[]; attuned?: string[] };
  effects: string[];                       // active effect ids (conditions, buffs)
  epicChoices: Record<number, EpicChoice[]>; // per-level 21-30 boon/feat picks
  spells: { cantrips: string[]; known: string[] };
  slotsUsed?: Record<number, number>;
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
export type SpeciesRule = { speed?: number; mods?: Record<string, number>; resist?: string[] };
export type SubclassRule = { casting?: CastRule | null };
export type CastRule = { ability: Ability };
export type ItemDef = { kind: string; sub?: string; rarity?: string; baseAC?: number; dexCap?: number | null };

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
    sub: { "Draconic Sorcery": { base: 10, add: "cha", shieldOk: false, label: "Draconic Resilience" } },
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
  for (const e of build.gear?.items || []) {
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
};

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
  const P = proficiencyBonus(build.level, epic);
  const ep = epicAgg(build);
  const em = ep.mods;

  // Effective abilities: stored scores with current gear effects applied, so changing gear
  // flows into every derived number with no rebuild.
  const liveAb = {} as Record<Ability, number>;
  ABILITIES.forEach((a) => { liveAb[a] = build.abilities[a]; });
  // Species and feat/background ability-score bonuses raise the BASE score (a +2 racial adds to
  // your stat), applied before gear so a gear "set" can still override a low result. In 2024 the
  // species table carries no ability mods (they moved to backgrounds), so this is a no-op there;
  // in 2014 the species table supplies "STR +2" etc., and featMods carries background bonuses.
  const abMods = ctx.species[build.meta.species]?.mods || {};
  const featAbMods = build.featMods || {};
  ABILITIES.forEach((a) => { if (abMods[a]) liveAb[a] += abMods[a] as number; });
  ABILITIES.forEach((a) => { if (featAbMods[a]) liveAb[a] += featAbMods[a] as number; });
  // Ability-score increases and feat bonuses chosen at ASI levels (standard 4/8/12/16/19 and epic
  // 21-30) accumulate into em.mods via epicAgg; apply their per-ability values to the base score
  // too, so an ASI or an ability-raising feat actually moves the stat.
  ABILITIES.forEach((a) => { if (em[a]) liveAb[a] += em[a] as number; });
  const geff = gearAbilityEffects(build.gear?.items || [], ctx);
  ABILITIES.forEach((a) => { if (geff.bump[a]) liveAb[a] += geff.bump[a] as number; });
  ABILITIES.forEach((a) => { const s = geff.set[a]; if (s !== undefined && liveAb[a] < s) liveAb[a] = s; });
  // Cap after everything: no ability exceeds the epic ceiling (30 by default).
  const abilityCap = epic.abilityCap || 30;
  ABILITIES.forEach((a) => { if (liveAb[a] > abilityCap) liveAb[a] = abilityCap; });
  const m = {} as Record<Ability, number>;
  ABILITIES.forEach((a) => { m[a] = abilityMod(liveAb[a]); });

  // Highest plus-bonus among carried armor/shields feeds AC directly.
  let gearAcBonus = 0, gearWeaponBonus = 0;
  for (const e of build.gear?.items || []) {
    const it = ctx.items[gearName(e)]; const md = gearMod(e);
    if (!it || !md) continue;
    if (it.kind === "Armor") gearAcBonus = Math.max(gearAcBonus, md);
    if (it.kind === "Weapon") gearWeaponBonus = Math.max(gearWeaponBonus, md);
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
  const acFormula = udRule
    ? `${udRule.label}: ${udRule.base} plus DEX${udRule.add ? ` plus ${udRule.add.toUpperCase()}` : ""}`
    : "";
  // A shield adds a flat +2 to AC (5e), stacking on armor or unarmored defense.
  const shieldBonus = worn.shield ? 2 : 0;
  const ac = acBase + dexToAc + acAbil + build.armorMisc + (em.ac || 0) + gearAcBonus + shieldBonus;

  const cls = ctx.classes[build.meta.className] || {};
  const hd = cls.hitDie || 8;
  const avg = epic.hitDieAvg || (Math.floor(hd / 2) + 1);
  const spMods = ctx.species[build.meta.species]?.mods || {};
  const ftMods = build.featMods || {};
  const perLvl = (em.hpPerLevel || 0) + (spMods.hpPerLevel || 0) + (ftMods.hpPerLevel || 0);

  // Draconic Resilience raises HP max by 3 at the subclass level and +1 per level after.
  let classHp = 0;
  if (/^Draconic/.test(build.meta.subclass || "")) {
    const at = subclassLevel(build.meta.className, ctx.ruleset) || 3;
    if (build.level >= at) classHp = 3 + Math.max(0, build.level - at);
  }
  const hpMax = hd + (build.level - 1) * avg + build.level * m.con + perLvl * build.level + classHp;

  // Saves: class proficiencies plus any earned at later levels plus epic grants.
  const lateSaves: Ability[] = [];
  const spa = cls.saveProfAt || {};
  Object.keys(spa).map(Number).forEach((l) => {
    if (build.level >= l) spa[l].forEach((x) => { if (!lateSaves.includes(x)) lateSaves.push(x); });
  });
  const saveProfAll = build.saveProf
    .concat(lateSaves.filter((s) => !build.saveProf.includes(s)))
    .concat(ep.grants.saveProf.filter((s) => !build.saveProf.includes(s as Ability) && !lateSaves.includes(s as Ability)) as Ability[]);
  const saves = {} as Record<Ability, number>;
  ABILITIES.forEach((a) => {
    saves[a] = m[a] + (saveProfAll.includes(a) ? P : 0) + (build.saveBonusAll || 0) + (em.allSaves || 0);
  });

  // Skills: proficiency and expertise from class and epic; epic-granted ones are flagged.
  const skills: DerivedSheet["skills"] = {};
  SKILLS.forEach(([k, , ab]) => {
    const isExp = build.skillExpert.includes(k) || ep.expertise.includes(k);
    const isProf = build.skillProf.includes(k) || ep.skillProf.includes(k) || ep.grants.allSkillProf;
    const rank = isExp ? 2 : isProf ? 1 : 0;
    skills[k] = {
      abil: ab, rank,
      val: m[ab] + rank * P + (em.allSkills || 0),
      fromEpic: !build.skillExpert.includes(k) && !build.skillProf.includes(k) && rank > 0,
    };
  });

  // Spell DC / attack come from the casting ability the class actually uses, and only exist
  // if the character casts at all (a Cleric keys off WIS, a Bard off CHA, a Barbarian off none).
  const cr = castRule(build, ctx);
  const isCaster = !!cr;
  const castAbil = cr ? cr.ability : null;
  const spellDC = isCaster && castAbil ? 8 + m[castAbil] + P + (em.spellDC || 0) : 0;
  const spellAttack = isCaster && castAbil ? m[castAbil] + P + (em.spellAttack || 0) : 0;

  const init = m.dex + (em.initiative || 0);

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
  if (speed < 0) speed = 0;

  const martialArts = build.meta.className === "Monk" ? stepValue(MONK_MA_DIE, build.level) : 0;
  const sneak = sneakDice(build, ctx, epic) + (em.sneakDice || 0);
  const resist = (ctx.species[build.meta.species]?.resist || []).concat(ep.grants.resist);

  return {
    proficiencyBonus: P,
    abilities: liveAb, mods: m,
    ac, acFormula, hpMax, saves, skills,
    isCaster, castAbil, spellDC, spellAttack,
    initiative: init, speed, speedLabel,
    sneakDice: sneak, martialArts, resist,
  };
}
