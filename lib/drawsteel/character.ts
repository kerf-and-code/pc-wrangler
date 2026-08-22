// Draw Steel (MCDM) character derivation engine. The Forge's D&D side feeds a Build to deriveSheet;
// PF2e and Daggerheart have their own engines; this is the Draw Steel parallel: a DSBuild (the player's
// choices) + rules data -> a computed DSSheet. Pure and deterministic, no I/O, re-derives on every edit.
//
// LICENSING: the rules DATA is used under the Draw Steel Creator License (see lib/systems/drawsteel.ts
// for the required attribution). Only MECHANICS ship (the numbers), never MCDM's descriptive prose.
//
// Model (Draw Steel Rules Reference): five characteristics (Might, Agility, Reason, Intuition, Presence)
// assigned at creation from the class's fixed values plus a chosen array. Base hero stats are size 1M,
// speed 5, stability 0, disengage 1. Stamina = class starting Stamina + (level-1) * class per-level gain
// + the kit's Stamina bonus, which is "per echelon" and so scales as (kit value * echelon). Recoveries
// come from the class; a Recovery restores 1/3 of maximum Stamina; a hero is Winded at 1/2. Speed and
// stability and disengage and the weapon damage/distance bonuses come from the kit. Potency (weak /
// average / strong) is the class's key characteristic minus 2 / minus 1 / itself. Every hero also has a
// career, which grants skills (fixed + chosen), some languages, and one perk group.

import type { DSCareer, DSSkillSlot, DSPerkGroup, DSSkillGroup } from "./careers";
import { slotOptions, DS_SKILL_GROUPS } from "./careers";
import type { DSSubclass } from "./subclasses";
import { abilityById } from "./abilities";
import { deityById, domainName } from "./deities";

export type DSChar = "might" | "agility" | "reason" | "intuition" | "presence";
export const DS_CHARS: DSChar[] = ["might", "agility", "reason", "intuition", "presence"];
export const DS_CHAR_LABEL: Record<DSChar, string> = {
  might: "Might", agility: "Agility", reason: "Reason", intuition: "Intuition", presence: "Presence",
};

export type DSEchelon = 1 | 2 | 3 | 4;
// Echelons: 1st = levels 1-3, 2nd = 4-6, 3rd = 7-9, 4th = 10.
export function echelonOf(level: number): DSEchelon {
  if (level <= 3) return 1;
  if (level <= 6) return 2;
  if (level <= 9) return 3;
  return 4;
}

// ---- rules-data shapes (populated in the data module) ------------------------------------------

export interface DSKit {
  id: string;
  name: string;
  armor: string;
  weapon: string;
  staminaPerEchelon: number;                 // added to max Stamina as (value * echelon)
  speed: number;
  stability: number;
  meleeDamage: [number, number, number];     // bonus to tier 1 / 2 / 3 melee ability damage
  rangedDamage: [number, number, number];    // bonus to tier 1 / 2 / 3 ranged ability damage
  meleeDistance: number;
  rangedDistance: number;
  disengage: number;
}

export interface DSClass {
  id: string;
  name: string;
  fixed: Partial<Record<DSChar, number>>;    // characteristics preset at creation (e.g. Might 2)
  arrays: number[][];                        // array options to distribute across the non-fixed traits
  keyChar: DSChar;                           // the characteristic that drives Potency
  baseStamina: number;                       // starting Stamina at 1st level
  staminaPerLevel: number;                   // Stamina gained at 2nd and higher levels
  recoveries: number;
  resource: string;                          // the class's heroic resource (Ferocity, Piety, ...)
  faithDomains?: number;                      // # of domains this class picks from a deity (Conduit 2, Censor 1)
  subclass?: DSSubclass;                     // the class's subclass concept + selectable options
}

// A flat, always-on numeric sheet modifier a trait grants. Only traits with a clear passive number set
// this; active/triggered/situational traits carry no mods and are name + cost only.
export interface DSTraitMods {
  stability?: number;
  recoveries?: number;
  speed?: number;
  staminaPerEchelon?: number;                // added to max Stamina as (value * echelon), e.g. +6/echelon
  size?: string;                             // rarely used; base size already reflects signature setters
}

export interface DSAncestryTrait {
  id: string;                                // unique within its ancestry
  name: string;
  cost: number;                              // 0 for signature (automatic), else ancestry-point cost
  signature?: boolean;                       // true = always on, does not spend points
  mods?: DSTraitMods;
}

export interface DSAncestry {
  id: string;
  name: string;
  size: string;                              // "1M" default; e.g. "1L" (Hakaan), "1S" (Polder)
  speed: number;                             // 5 default (Memonek reaches 7 via Lightning Nimbleness)
  points: number;                            // ancestry points to spend on purchased traits
  signatureTraits: DSAncestryTrait[];        // automatic (always applied)
  purchasedTraits: DSAncestryTrait[];        // buyable with ancestry points
  quickTraits: string[];                     // quick-build recommended purchased-trait ids
}

export interface DSRules {
  classes: Record<string, DSClass>;
  kits: Record<string, DSKit>;
  ancestries: Record<string, DSAncestry>;
  careers: Record<string, DSCareer>;
}

// ---- the build (player choices) + the derived sheet --------------------------------------------

export interface DSBuild {
  level: number;                             // 1-10
  classId: string;
  ancestryId: string;
  kitId: string;                             // "" for no kit (casters may run kitless)
  careerId: string;                          // "" until a career is chosen
  ancestryTraitIds: string[];                // purchased ancestry-trait ids the player bought
  subclassIds: string[];                     // selected subclass option ids (Conduit picks 2, else 1)
  subclassSkill: string;                     // chosen skill when the selected subclass grants a group skill
  deityId: string;                           // chosen deity/saint (Conduit + Censor); "" otherwise
  domainIds: string[];                       // domains picked from the deity's portfolio (Conduit 2, Censor 1)
  abilityIds: string[];                      // class abilities the player has taken (catalog ids)
  characteristics: Record<DSChar, number>;   // the five assigned scores
  // One entry per CHOICE slot on the career (fixed slots are implicit), aligned to the choice-slot order.
  // "" means that slot is still unfilled. Fixed skills are added by the engine, not stored here.
  careerSkillChoices: string[];
  careerLanguages: string[];                 // free-text languages, up to the career's language count
}

export interface DSSheet {
  level: number;
  echelon: DSEchelon;
  characteristics: Record<DSChar, number>;
  stamina: number;
  winded: number;                            // floor(stamina / 2)
  recoveries: number;
  recoveryValue: number;                     // floor(stamina / 3), restored per Recovery spent
  speed: number;
  stability: number;
  size: string;
  disengage: number;
  meleeDamage: [number, number, number];
  rangedDamage: [number, number, number];
  meleeDistance: number;
  rangedDistance: number;
  potency: { weak: number; average: number; strong: number };
  keyChar: DSChar;
  // Subclass-derived:
  subclassConcept: string;                   // "" if the class has no subclass modeled
  subclassNames: string[];                   // selected subclass option name(s)
  subclassSkills: string[];                  // skills the subclass grants (specific or chosen group skill)
  heroicResource: string;                    // the class's heroic resource name ("" if no class)
  abilityNames: string[];                    // names of the class abilities the player has taken
  deityName: string;                         // chosen deity/saint name ("" if none / class has no faith)
  domainNames: string[];                     // chosen domain names (capped at the class's faithDomains)
  faithDomains: number;                      // how many domains the class picks (0 if it has no faith)
  // Ancestry-derived:
  ancestryName: string;                      // "" if no ancestry chosen
  ancestryPoints: number;                    // total points available
  ancestryPointsSpent: number;               // sum of selected purchased-trait costs
  signatureTraitNames: string[];             // automatic traits (always on)
  purchasedTraitNames: string[];             // selected purchased traits
  // Career-derived:
  careerName: string;                        // "" if no career chosen
  skills: string[];                          // resolved skills (fixed + chosen), deduped, in order
  languagesCount: number;                    // number of languages the career grants
  languages: string[];                       // the named languages the player entered (filtered blanks)
  perkGroup: DSPerkGroup | null;             // perk group the career draws from
}

export function emptyDSChars(): Record<DSChar, number> {
  return { might: 0, agility: 0, reason: 0, intuition: 0, presence: 0 };
}

export function emptyDSBuild(): DSBuild {
  return {
    level: 1, classId: "", ancestryId: "", kitId: "", careerId: "",
    ancestryTraitIds: [], subclassIds: [], subclassSkill: "", deityId: "", domainIds: [], abilityIds: [],
    characteristics: emptyDSChars(), careerSkillChoices: [], careerLanguages: [],
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// The choice slots of a career, in order (fixed slots excluded). Exposed for the UI so it can render
// one selector per choice and index into build.careerSkillChoices consistently with the engine.
export function careerChoiceSlots(career: DSCareer | undefined): DSSkillSlot[] {
  if (!career) return [];
  return career.skills.filter((s) => !s.fixed);
}

// Resolve a career's full skill list from its fixed grants plus the player's choices. A chosen skill is
// only counted if it is a legal option for its slot and not already granted (no duplicate skills).
export function resolveCareerSkills(career: DSCareer | undefined, choices: string[]): string[] {
  if (!career) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  };
  for (const slot of career.skills) if (slot.fixed) add(slot.fixed);
  const choiceSlots = careerChoiceSlots(career);
  choiceSlots.forEach((slot, i) => {
    const picked = choices[i];
    if (!picked) return;
    if (slotOptions(slot).includes(picked)) add(picked);
  });
  return out;
}

// The ancestry traits that apply to a build: all signature traits (automatic) plus the purchased traits
// the player selected (validated against the ancestry's purchased list). Returns them split so the sheet
// can list signatures and purchases separately and sum only the purchase costs.
export function resolveAncestryTraits(
  anc: DSAncestry | undefined, selectedIds: string[],
): { signature: DSAncestryTrait[]; purchased: DSAncestryTrait[]; spent: number } {
  if (!anc) return { signature: [], purchased: [], spent: 0 };
  const wanted = new Set(selectedIds ?? []);
  const purchased = anc.purchasedTraits.filter((t) => wanted.has(t.id));
  const spent = purchased.reduce((s, t) => s + t.cost, 0);
  return { signature: anc.signatureTraits, purchased, spent };
}

// Sum the flat numeric mods across a set of traits.
function sumTraitMods(traits: DSAncestryTrait[]): Required<DSTraitMods> {
  const acc = { stability: 0, recoveries: 0, speed: 0, staminaPerEchelon: 0, size: "" };
  for (const t of traits) {
    if (!t.mods) continue;
    acc.stability += t.mods.stability ?? 0;
    acc.recoveries += t.mods.recoveries ?? 0;
    acc.speed += t.mods.speed ?? 0;
    acc.staminaPerEchelon += t.mods.staminaPerEchelon ?? 0;
    if (t.mods.size) acc.size = t.mods.size;
  }
  return acc;
}

// Resolve the selected subclass option(s) into names and the skills they grant. A specific grant is
// added directly; a group grant adds the player's chosen skill only if it is legal for that group.
export function resolveSubclass(
  subclass: DSSubclass | undefined, selectedIds: string[], groupSkill: string,
): { names: string[]; skills: string[] } {
  if (!subclass) return { names: [], skills: [] };
  const wanted = new Set(selectedIds ?? []);
  const chosen = subclass.options.filter((o) => wanted.has(o.id));
  const names = chosen.map((o) => o.name);
  const skills: string[] = [];
  for (const o of chosen) {
    if (o.grantsSkill) skills.push(o.grantsSkill);
    else if (o.grantsSkillFrom && groupSkill && DS_SKILL_GROUPS[o.grantsSkillFrom].includes(groupSkill)) {
      skills.push(groupSkill);
    }
  }
  return { names, skills };
}

// Resolve a build's deity + domains. Domains are kept only if they are in the chosen deity's portfolio,
// and no more than the class's faithDomains are counted. Returns display names.
export function resolveFaith(
  deityId: string, domainIds: string[], faithDomains: number,
): { deityName: string; domainNames: string[] } {
  if (faithDomains <= 0) return { deityName: "", domainNames: [] };
  const deity = deityId ? deityById(deityId) : undefined;
  const allowed = new Set(deity?.domains ?? []);
  const domains = (domainIds ?? [])
    .filter((id) => allowed.has(id))
    .slice(0, faithDomains)
    .map(domainName);
  return { deityName: deity?.name ?? "", domainNames: domains };
}

export function deriveDrawSteelSheet(build: DSBuild, rules: DSRules): DSSheet | null {
  const cls = rules.classes[build.classId];
  if (!cls) return null;
  const level = clamp(Math.round(build.level) || 1, 1, 10);
  const echelon = echelonOf(level);
  const anc = build.ancestryId ? rules.ancestries[build.ancestryId] : undefined;
  const kit = build.kitId ? rules.kits[build.kitId] : undefined;
  const career = build.careerId ? rules.careers[build.careerId] : undefined;

  const characteristics = emptyDSChars();
  for (const c of DS_CHARS) characteristics[c] = build.characteristics[c] ?? 0;

  // Ancestry traits: signatures (always on) + selected purchases, and the flat mods they contribute.
  const traits = resolveAncestryTraits(anc, build.ancestryTraitIds);
  const traitMods = sumTraitMods([...traits.signature, ...traits.purchased]);

  // Stamina: class base + per-level gains + the kit's per-echelon bonus + ancestry per-echelon bonus.
  const kitStamina = kit ? kit.staminaPerEchelon * echelon : 0;
  const ancStamina = traitMods.staminaPerEchelon * echelon;
  const stamina = cls.baseStamina + (level - 1) * cls.staminaPerLevel + kitStamina + ancStamina;
  const winded = Math.floor(stamina / 2);
  const recoveryValue = Math.floor(stamina / 3);

  const speed = (anc?.speed ?? 5) + (kit?.speed ?? 0) + traitMods.speed;
  const stability = 0 + (kit?.stability ?? 0) + traitMods.stability;
  const size = traitMods.size || anc?.size || "1M";
  const disengage = 1 + (kit?.disengage ?? 0);

  const meleeDamage: [number, number, number] = kit ? [...kit.meleeDamage] : [0, 0, 0];
  const rangedDamage: [number, number, number] = kit ? [...kit.rangedDamage] : [0, 0, 0];

  const key = characteristics[cls.keyChar];
  const potency = { weak: key - 2, average: key - 1, strong: key };

  const skills = resolveCareerSkills(career, build.careerSkillChoices);
  const languages = (build.careerLanguages ?? []).map((s) => s.trim()).filter(Boolean);
  const sub = resolveSubclass(cls.subclass, build.subclassIds, build.subclassSkill);

  // Class abilities the player has taken: resolve each id to its catalog entry, keep only those that
  // belong to this class (or the shared "common" set), and surface their names. The effect text is
  // never here - the sheet lists what was taken; the numbers are read off the card in the SRD.
  const abilityNames = (build.abilityIds ?? [])
    .map((id) => abilityById(id))
    .filter((a): a is NonNullable<typeof a> => !!a && (a.classId === build.classId || a.classId === "common"))
    .map((a) => a.name);

  const faithDomains = cls.faithDomains ?? 0;
  const faith = resolveFaith(build.deityId, build.domainIds, faithDomains);

  return {
    level,
    echelon,
    characteristics,
    stamina,
    winded,
    recoveries: cls.recoveries + traitMods.recoveries,
    recoveryValue,
    speed,
    stability,
    size,
    disengage,
    meleeDamage,
    rangedDamage,
    meleeDistance: kit?.meleeDistance ?? 0,
    rangedDistance: kit?.rangedDistance ?? 0,
    potency,
    keyChar: cls.keyChar,
    subclassConcept: cls.subclass?.concept ?? "",
    subclassNames: sub.names,
    subclassSkills: sub.skills,
    heroicResource: cls.resource ?? "",
    abilityNames,
    deityName: faith.deityName,
    domainNames: faith.domainNames,
    faithDomains,
    ancestryName: anc?.name ?? "",
    ancestryPoints: anc?.points ?? 0,
    ancestryPointsSpent: traits.spent,
    signatureTraitNames: traits.signature.map((t) => t.name),
    purchasedTraitNames: traits.purchased.map((t) => t.name),
    careerName: career?.name ?? "",
    skills,
    languagesCount: career?.languages ?? 0,
    languages,
    perkGroup: career?.perkGroup ?? null,
  };
}
