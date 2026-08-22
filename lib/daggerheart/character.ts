// Daggerheart character derivation engine. The Forge's D&D side feeds a Build to deriveSheet(build,
// ctx) and the PF2e side feeds a Pf2eBuild to derivePf2eSheet; this is the Daggerheart parallel: a
// DHBuild (the player's choices) + rules data -> a computed DHSheet. Pure and deterministic, no I/O,
// so it re-derives on every edit exactly like the other two engines.
//
// The MECHANICS here are Daggerheart's rules, which are open under the Darrington Press Community
// Gaming License; only the numbers and structure live in this codebase, never Darrington Press's
// descriptive card/feature TEXT. The rules DATA (which classes/ancestries/armor exist, their starting
// values and the handful of numeric feature modifiers) lives in a separate data module and fills in
// iteratively.
//
// Character creation (SRD): assign the trait array +2/+1/+1/+0/+0/-1; start with 2 Hope (max 6) and 6
// Stress slots; Proficiency 1 at level 1; Evasion and starting HP come from the class; damage
// thresholds are the equipped armor's base Major/Severe plus your level (unarmored: Major = level,
// Severe = twice level). Leveling: Proficiency +1 at the level-2/5/8 tier achievements, two chosen
// advancements per level from a fixed menu, thresholds +1 each level (folded into the "+ level" rule),
// and a new domain card each level. HP and Stress each cap at 12; Armor Score caps at 12.

export type DHTrait =
  | "agility" | "strength" | "finesse" | "instinct" | "presence" | "knowledge";

export const DH_TRAITS: DHTrait[] = [
  "agility", "strength", "finesse", "instinct", "presence", "knowledge",
];

// The values a player distributes across the six traits at character creation.
export const DH_TRAIT_ARRAY: readonly number[] = [2, 1, 1, 0, 0, -1];

export type DHDomainId =
  | "arcana" | "blade" | "bone" | "codex" | "grace"
  | "midnight" | "sage" | "splendor" | "valor";

export type DHTier = 1 | 2 | 3 | 4;

// SRD tiers: tier 1 is level 1 only, tier 2 is levels 2-4, tier 3 is 5-7, tier 4 is 8-10.
export function tierOf(level: number): DHTier {
  if (level <= 1) return 1;
  if (level <= 4) return 2;
  if (level <= 7) return 3;
  return 4;
}

// Proficiency increases by 1 automatically at the start of each new tier (levels 2, 5, and 8).
export function tierProficiencyBumps(level: number): number {
  return (level >= 2 ? 1 : 0) + (level >= 5 ? 1 : 0) + (level >= 8 ? 1 : 0);
}

// New Experiences are gained at the same tier achievements (a character always starts with 2).
export function experienceCount(level: number): number {
  return 2 + (level >= 2 ? 1 : 0) + (level >= 5 ? 1 : 0) + (level >= 8 ? 1 : 0);
}

// ---- the level-up advancement menu -------------------------------------------------------------
// Each level from 2 on, a character chooses two advancements from a fixed list. "proficiency" and
// "multiclass" each cost both of the level's two slots. We store each chosen advancement as one entry;
// the engine sums their numeric effects. Per-option selection caps and tier gating are a play-testing
// refinement (the SRD prints those caps on the character sheet, not in the rules text).
export type AdvancementKind =
  | "trait"        // +1 to two unmarked traits (and mark them until the next tier clears the marks)
  | "hp"           // permanently add 1 Hit Point slot
  | "stress"       // permanently add 1 Stress slot
  | "experience"   // +1 to two of your Experiences
  | "domainCard"   // acquire an additional domain card
  | "evasion"      // permanent +1 Evasion
  | "subclass"     // take an upgraded subclass card (foundation -> specialization -> mastery)
  | "proficiency"  // +1 Proficiency (costs two advancement slots)
  | "multiclass";  // multiclass (costs two advancement slots)

export interface Advancement {
  kind: AdvancementKind;
  traits?: DHTrait[];       // for kind "trait": the two traits raised
  experiences?: string[];   // for kind "experience": the two Experiences raised
}

// ---- rules-data shapes (populated in the data module) ------------------------------------------

// A bundle of static numeric modifiers a feature/ancestry/armor grants. Mechanics only, no prose.
export interface DHMods {
  evasion?: number;
  hp?: number;
  stress?: number;
  major?: number;                    // flat bonus to the Major damage threshold
  severe?: number;                   // flat bonus to the Severe damage threshold
  thresholdsPlusProficiency?: boolean; // Galapa: add Proficiency to both thresholds
  proficiency?: number;
  spellcast?: number;                // flat bonus to Spellcast rolls
  armorScore?: number;
  traits?: Partial<Record<DHTrait, number>>;
}

export interface DHClass {
  id: string;
  name: string;
  domains: [DHDomainId, DHDomainId];
  evasion: number;   // starting Evasion
  hp: number;        // starting Hit Points
}

export interface DHSubclass {
  id: string;
  classId: string;
  name: string;
  spellcast: DHTrait | null;         // the trait used on Spellcast rolls (null for martial subclasses)
  mods?: DHMods;                     // foundation modifiers (apply whenever the subclass is chosen)
  specializationMods?: DHMods;       // apply once the subclass has been upgraded to specialization
  masteryMods?: DHMods;              // apply once the subclass has been upgraded to mastery
}

export interface DHAncestry {
  id: string;
  name: string;
  mods?: DHMods;                     // static character-creation modifiers (e.g. Giant +1 HP)
}

export interface DHCommunity {
  id: string;
  name: string;
}

export interface DHArmor {
  id: string;
  name: string;
  tier: DHTier;
  baseMajor: number;
  baseSevere: number;
  baseScore: number;
  evasionMod?: number;               // Flexible +1, Heavy -1, Very Heavy -2, Difficult -1
  spellcastMod?: number;             // Channeling +1
  traitMods?: Partial<Record<DHTrait, number>>;  // Very Heavy -1 Agility, Gilded +1 Presence, etc.
}

export type DHDamageType = "phy" | "mag" | "both";
export type DHBurden = "One-Handed" | "Two-Handed";

export interface DHWeapon {
  id: string;
  name: string;
  tier: DHTier;
  category: "primary" | "secondary";
  trait: DHTrait;            // the trait the attack roll uses
  range: string;
  damageDie: string;        // "d6" | "d8" | "d10" | "d12"
  damageBonus: number;      // flat modifier added ONCE (not multiplied by Proficiency)
  damageType: DHDamageType;
  burden: DHBurden;
  magic?: boolean;          // magic weapons require a Spellcast trait to wield
  feature?: string;         // feature NAME only (e.g. "Massive", "Barrier"); full prose not shipped
  // Passive numeric feature effects that change a derived number (applied to the sheet when equipped):
  evasionMod?: number;      // Heavy / Massive / Barrier / Brave: -1 to Evasion
  armorScoreMod?: number;   // shields: Protective / Barrier / Double Duty
  severeMod?: number;       // Brave: +N to Severe threshold
  pairedDamage?: number;    // secondary Paired / Double Duty: +N to primary melee damage (situational)
  traitMods?: Partial<Record<DHTrait, number>>;  // Cumbersome -1 Finesse, Destructive -1 Agility
}

// A player-authored weapon for anything not in the shipped Tier 1 list (higher tiers, homebrew).
export interface DHCustomWeapon {
  name: string;
  trait: DHTrait;
  range: string;
  damageDie: string;
  damageBonus: number;
  damageType: DHDamageType;
  burden: DHBurden;
}

export interface DHDomainDef {
  id: DHDomainId;
  name: string;
  classes: string[];
}

export interface DHRules {
  classes: Record<string, DHClass>;
  subclasses: Record<string, DHSubclass>;
  ancestries: Record<string, DHAncestry>;
  communities: Record<string, DHCommunity>;
  armors: Record<string, DHArmor>;
  weapons: Record<string, DHWeapon>;
  domains: Record<DHDomainId, DHDomainDef>;
}

// ---- the build (player choices) + the derived sheet --------------------------------------------

export interface DHBuild {
  level: number;                     // 1-10
  classId: string;
  subclassId: string;
  ancestryId: string;
  ancestryId2: string;               // second ancestry for a Mixed Ancestry, "" otherwise
  communityId: string;
  traits: Record<DHTrait, number>;   // the assigned base array values (before advancement bumps)
  armorId: string;                   // equipped armor, "" for unarmored
  weaponId: string;                  // equipped primary weapon: "" none, "custom", or a rules.weapons id
  customWeapon: DHCustomWeapon;      // used when weaponId === "custom"
  secondaryId: string;               // equipped secondary weapon (a rules.weapons id, category secondary), "" for none
  advancements: Advancement[];       // every advancement chosen across levels 2..level
  experiences: DHExperience[];       // the character's Experiences (names + running bonus)
  loadout: string[];                 // domain card ids in the active loadout (max 5)
  vault: string[];                   // domain card ids owned but kept in the vault (inactive)
}

export interface DHExperience {
  name: string;
  bonus: number;
}

export interface DHSheet {
  level: number;
  tier: DHTier;
  traits: Record<DHTrait, number>;
  evasion: number;
  hp: number;                        // max Hit Point slots (capped at 12)
  stress: number;                    // max Stress slots (capped at 12)
  hopeStart: number;                 // always 2
  hopeMax: number;                   // always 6
  proficiency: number;
  major: number;                     // Major damage threshold
  severe: number;                    // Severe damage threshold
  armorScore: number;                // capped at 12
  spellcastTrait: DHTrait | null;
  spellcast: number | null;          // spellcast trait value + modifiers, or null for martial subclasses
  weaponName: string | null;
  attackTrait: DHTrait | null;       // the trait the equipped weapon attacks with
  attackMod: number | null;          // that trait's value (the attack modifier)
  damage: string | null;             // Proficiency dice of the weapon die + its flat modifier, e.g. "2d8+1"
  secondaryName: string | null;      // equipped secondary weapon name
  secondaryDamage: string | null;    // secondary weapon damage, same Proficiency-dice formula
  pairedBonus: number;               // situational +N to primary melee damage from a Paired secondary (shown, not auto-added)
  domains: [DHDomainId, DHDomainId];
  subclassTier: number;              // 1 foundation, 2 specialization, 3 mastery
  loadoutMax: number;                // 5
  domainCardsKnown: number;          // 2 at creation + 1 per level + domainCard advancements
  experienceSlots: number;           // how many Experiences the character should have at this level
}

export function emptyDHTraits(): Record<DHTrait, number> {
  return { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 };
}

export function emptyDHBuild(): DHBuild {
  return {
    level: 1,
    classId: "",
    subclassId: "",
    ancestryId: "",
    ancestryId2: "",
    communityId: "",
    traits: emptyDHTraits(),
    armorId: "",
    weaponId: "",
    customWeapon: { name: "", trait: "strength", range: "Melee", damageDie: "d6", damageBonus: 0, damageType: "phy", burden: "One-Handed" },
    secondaryId: "",
    advancements: [],
    experiences: [{ name: "", bonus: 2 }, { name: "", bonus: 2 }],
    loadout: [],
    vault: [],
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Collect every static modifier bundle that applies to this build: both ancestries, the subclass
// foundation, and its specialization/mastery bundles once the subclass has been upgraded that far.
function collectMods(build: DHBuild, rules: DHRules, subclassTier: number): DHMods[] {
  const out: DHMods[] = [];
  const anc = rules.ancestries[build.ancestryId];
  if (anc?.mods) out.push(anc.mods);
  const anc2 = build.ancestryId2 ? rules.ancestries[build.ancestryId2] : undefined;
  if (anc2?.mods) out.push(anc2.mods);
  const sub = rules.subclasses[build.subclassId];
  if (sub?.mods) out.push(sub.mods);
  if (subclassTier >= 2 && sub?.specializationMods) out.push(sub.specializationMods);
  if (subclassTier >= 3 && sub?.masteryMods) out.push(sub.masteryMods);
  return out;
}

function sumMod(mods: DHMods[], key: "evasion" | "hp" | "stress" | "major" | "severe" | "proficiency" | "spellcast" | "armorScore"): number {
  let total = 0;
  for (const m of mods) total += m[key] ?? 0;
  return total;
}

function countAdvancements(build: DHBuild, kind: AdvancementKind): number {
  return build.advancements.filter((a) => a.kind === kind).length;
}

export function deriveDaggerheartSheet(build: DHBuild, rules: DHRules): DHSheet | null {
  const cls = rules.classes[build.classId];
  if (!cls) return null;
  const level = clamp(Math.round(build.level) || 1, 1, 10);
  const tier = tierOf(level);

  // Subclass tier reached: foundation plus one step per "upgraded subclass" advancement, capped at mastery.
  const subclassTier = Math.min(3, 1 + countAdvancements(build, "subclass"));
  const mods = collectMods(build, rules, subclassTier);
  const armor = build.armorId ? rules.armors[build.armorId] : undefined;
  const sub = rules.subclasses[build.subclassId];

  // Equipped weapons whose passive numeric features touch the sheet: a catalog primary (a custom
  // primary carries no mods) plus a secondary. Their Evasion / Armor Score / Severe / trait effects
  // are summed and applied below.
  const primaryCat = build.weaponId && build.weaponId !== "custom" ? rules.weapons[build.weaponId] : undefined;
  const secondaryW = build.secondaryId ? rules.weapons[build.secondaryId] : undefined;
  const equipped: DHWeapon[] = [primaryCat, secondaryW].filter((w): w is DHWeapon => Boolean(w));
  const wSum = (k: "evasionMod" | "armorScoreMod" | "severeMod") => equipped.reduce((n, w) => n + (w[k] ?? 0), 0);

  // Proficiency: 1 + automatic tier bumps + any +1 Proficiency advancements + feature bonuses.
  const proficiency = 1 + tierProficiencyBumps(level) + countAdvancements(build, "proficiency") + sumMod(mods, "proficiency");

  // Traits: assigned base values + advancement bumps + trait modifiers from features and armor.
  const traits = emptyDHTraits();
  for (const t of DH_TRAITS) traits[t] = build.traits[t] ?? 0;
  for (const a of build.advancements) {
    if (a.kind === "trait") for (const t of a.traits ?? []) traits[t] += 1;
  }
  for (const m of mods) {
    if (m.traits) for (const t of DH_TRAITS) traits[t] += m.traits[t] ?? 0;
  }
  if (armor?.traitMods) for (const t of DH_TRAITS) traits[t] += armor.traitMods[t] ?? 0;
  for (const w of equipped) if (w.traitMods) for (const t of DH_TRAITS) traits[t] += w.traitMods[t] ?? 0;

  // Evasion: class base + evasion advancements + feature/armor/weapon evasion modifiers.
  const evasion = cls.evasion + countAdvancements(build, "evasion") + sumMod(mods, "evasion") + (armor?.evasionMod ?? 0) + wSum("evasionMod");

  // HP and Stress: base + feature bonuses + slot advancements, each capped at 12.
  const hp = clamp(cls.hp + sumMod(mods, "hp") + countAdvancements(build, "hp"), 0, 12);
  const stress = clamp(6 + sumMod(mods, "stress") + countAdvancements(build, "stress"), 0, 12);

  // Damage thresholds: armored = armor base + level; unarmored = (level, twice level). Then feature bonuses.
  let major = armor ? armor.baseMajor + level : level;
  let severe = armor ? armor.baseSevere + level : 2 * level;
  major += sumMod(mods, "major");
  severe += sumMod(mods, "severe") + wSum("severeMod");
  if (mods.some((m) => m.thresholdsPlusProficiency)) {
    major += proficiency;
    severe += proficiency;
  }

  const armorScore = clamp((armor?.baseScore ?? 0) + sumMod(mods, "armorScore") + wSum("armorScoreMod"), 0, 12);

  const spellcastTrait = sub?.spellcast ?? null;
  const spellcast = spellcastTrait ? traits[spellcastTrait] + sumMod(mods, "spellcast") + (armor?.spellcastMod ?? 0) : null;

  // Equipped weapon. The attack rolls with the weapon's trait; damage rolls a number of the weapon's
  // die equal to Proficiency, plus the weapon's flat modifier added once (not multiplied by Proficiency).
  const wpn: DHWeapon | DHCustomWeapon | undefined =
    build.weaponId === "custom" ? build.customWeapon
    : build.weaponId ? rules.weapons[build.weaponId]
    : undefined;
  let weaponName: string | null = null;
  let attackTrait: DHTrait | null = null;
  let attackMod: number | null = null;
  let damage: string | null = null;
  if (wpn) {
    weaponName = wpn.name || "Custom weapon";
    attackTrait = wpn.trait;
    attackMod = traits[wpn.trait];
    damage = `${proficiency}${wpn.damageDie}${wpn.damageBonus ? `+${wpn.damageBonus}` : ""}`;
  }

  // Secondary weapon: its own damage line (same Proficiency-dice formula). A Paired secondary's
  // primary-damage bonus is situational ("within Melee range"), so it is surfaced, not auto-added.
  const secondaryName = secondaryW ? secondaryW.name : null;
  const secondaryDamage = secondaryW
    ? `${proficiency}${secondaryW.damageDie}${secondaryW.damageBonus ? `+${secondaryW.damageBonus}` : ""}`
    : null;
  const pairedBonus = equipped.reduce((n, w) => n + (w.pairedDamage ?? 0), 0);

  const domainCardsKnown = 2 + (level - 1) + countAdvancements(build, "domainCard");

  return {
    level,
    tier,
    traits,
    evasion,
    hp,
    stress,
    hopeStart: 2,
    hopeMax: 6,
    proficiency,
    major,
    severe,
    armorScore,
    spellcastTrait,
    spellcast,
    weaponName,
    attackTrait,
    attackMod,
    damage,
    secondaryName,
    secondaryDamage,
    pairedBonus,
    domains: cls.domains,
    subclassTier,
    loadoutMax: 5,
    domainCardsKnown,
    experienceSlots: experienceCount(level),
  };
}
