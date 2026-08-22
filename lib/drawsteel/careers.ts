// Draw Steel careers + the skill catalog (MCDM Draw Steel Rules Reference, via the Steel Compendium data
// set, used under the Draw Steel Creator License). MECHANICS ONLY: each career's granted skills, the
// number of languages, and its perk group; plus the five skill groups and their skill lists. No MCDM
// descriptive prose (career flavor, inciting-incident tables, skill/perk descriptions) is stored here.
// See lib/systems/drawsteel.ts for the required in-app attribution.
//
// Every hero takes one career. A career grants a mix of FIXED skills (a specific named skill) and
// CHOICE skills (pick one from a group, from a couple of groups, or from a short either/or list),
// some languages, and one perk from a named perk group. Perks themselves are a separate content area;
// a career records only which perk group it draws from and the quick-build perk name, so the career is
// self-contained without shipping the full perk catalog.

export type DSSkillGroup = "crafting" | "exploration" | "interpersonal" | "intrigue" | "lore";

export const DS_SKILL_GROUP_LABEL: Record<DSSkillGroup, string> = {
  crafting: "Crafting",
  exploration: "Exploration",
  interpersonal: "Interpersonal",
  intrigue: "Intrigue",
  lore: "Lore",
};

// The five skill groups and every skill in each (Skills tables in the Rules Reference).
export const DS_SKILL_GROUPS: Record<DSSkillGroup, string[]> = {
  crafting: [
    "Alchemy", "Architecture", "Blacksmithing", "Carpentry", "Cooking",
    "Fletching", "Forgery", "Jewelry", "Mechanics", "Tailoring",
  ],
  exploration: [
    "Climb", "Drive", "Endurance", "Gymnastics", "Heal",
    "Jump", "Lift", "Navigate", "Ride", "Swim",
  ],
  interpersonal: [
    "Brag", "Empathize", "Flirt", "Gamble", "Handle Animals", "Interrogate",
    "Intimidate", "Lead", "Lie", "Music", "Perform", "Persuade", "Read Person",
  ],
  intrigue: [
    "Alertness", "Conceal Object", "Disguise", "Eavesdrop", "Escape Artist", "Hide",
    "Pick Lock", "Pick Pocket", "Sabotage", "Search", "Sneak", "Track",
  ],
  lore: [
    "Criminal Underworld", "Culture", "History", "Magic", "Monsters", "Nature",
    "Psionics", "Religion", "Rumors", "Society", "Strategy", "Timescape",
  ],
};

// A single skill grant on a career. Exactly one of the three shapes applies:
//  - fixed:      a specific skill the career grants automatically (not chosen)
//  - oneOf:      the player picks exactly one of these named skills
//  - fromGroups: the player picks one skill from any of these group(s)
// Every choice grant is a single pick; "choose two from exploration" is two fromGroups slots.
export interface DSSkillSlot {
  fixed?: string;
  oneOf?: string[];
  fromGroups?: DSSkillGroup[];
}

// Perk groups a career can draw from. Perks are a separate (unbuilt) content area; the career records
// only the group name and the quick-build perk so it stays self-contained.
export type DSPerkGroup =
  | "crafting" | "exploration" | "interpersonal" | "intrigue" | "lore" | "supernatural";

export const DS_PERK_GROUP_LABEL: Record<DSPerkGroup, string> = {
  crafting: "Crafting",
  exploration: "Exploration",
  interpersonal: "Interpersonal",
  intrigue: "Intrigue",
  lore: "Lore",
  supernatural: "Supernatural",
};

export interface DSCareer {
  id: string;
  name: string;
  skills: DSSkillSlot[];    // fixed + choice grants, in display order
  languages: number;        // number of languages the career grants
  perkGroup: DSPerkGroup;   // which perk group the career's one perk comes from
  quickSkills: string[];    // quick-build recommended skill set (fixed + suggested choices)
  quickPerk: string;        // quick-build recommended perk name
}

// Small builders to keep the table readable.
const fx = (s: string): DSSkillSlot => ({ fixed: s });
const grp = (...g: DSSkillGroup[]): DSSkillSlot => ({ fromGroups: g });
const one = (...s: string[]): DSSkillSlot => ({ oneOf: s });

const CAREERS: Record<string, DSCareer> = {
  agent: {
    id: "agent", name: "Agent",
    skills: [fx("Sneak"), grp("interpersonal"), grp("intrigue")],
    languages: 2, perkGroup: "intrigue",
    quickSkills: ["Disguise", "Lie", "Sneak"], quickPerk: "Forgettable Face",
  },
  aristocrat: {
    id: "aristocrat", name: "Aristocrat",
    skills: [grp("interpersonal"), grp("lore")],
    languages: 1, perkGroup: "lore",
    quickSkills: ["Brag", "Society"], quickPerk: "I've Read About This Place",
  },
  artisan: {
    id: "artisan", name: "Artisan",
    skills: [grp("crafting"), grp("crafting")],
    languages: 1, perkGroup: "crafting",
    quickSkills: ["Blacksmithing", "Carpentry"], quickPerk: "Area of Expertise",
  },
  beggar: {
    id: "beggar", name: "Beggar",
    skills: [fx("Rumors"), grp("exploration"), grp("interpersonal")],
    languages: 2, perkGroup: "interpersonal",
    quickSkills: ["Empathize", "Endurance", "Rumors"], quickPerk: "Spot the Tell",
  },
  criminal: {
    id: "criminal", name: "Criminal",
    skills: [fx("Criminal Underworld"), grp("intrigue"), grp("intrigue")],
    languages: 1, perkGroup: "intrigue",
    quickSkills: ["Criminal Underworld", "Pick Lock", "Pick Pocket"], quickPerk: "Criminal Contacts",
  },
  disciple: {
    id: "disciple", name: "Disciple",
    skills: [fx("Religion"), grp("lore"), grp("lore")],
    languages: 0, perkGroup: "supernatural",
    quickSkills: ["Culture", "Magic", "Religion"], quickPerk: "Ritualist",
  },
  explorer: {
    id: "explorer", name: "Explorer",
    skills: [fx("Navigate"), grp("exploration"), grp("exploration")],
    languages: 2, perkGroup: "exploration",
    quickSkills: ["Climb", "Heal", "Navigate"], quickPerk: "Wood Wise",
  },
  farmer: {
    id: "farmer", name: "Farmer",
    skills: [fx("Handle Animals"), grp("exploration"), grp("exploration")],
    languages: 1, perkGroup: "exploration",
    quickSkills: ["Drive", "Handle Animals", "Lift"], quickPerk: "Monster Whisperer",
  },
  gladiator: {
    id: "gladiator", name: "Gladiator",
    skills: [grp("exploration"), grp("exploration")],
    languages: 1, perkGroup: "exploration",
    quickSkills: ["Gymnastics", "Jump"], quickPerk: "Friend Catapult",
  },
  laborer: {
    id: "laborer", name: "Laborer",
    skills: [fx("Endurance"), grp("crafting", "exploration"), grp("crafting", "exploration")],
    languages: 1, perkGroup: "exploration",
    quickSkills: ["Blacksmithing", "Endurance", "Lift"], quickPerk: "Brawny",
  },
  "mages-apprentice": {
    id: "mages-apprentice", name: "Mage's Apprentice",
    skills: [fx("Magic"), grp("lore"), grp("lore")],
    languages: 1, perkGroup: "supernatural",
    quickSkills: ["Magic", "Monsters", "Timescape"], quickPerk: "Arcane Trick",
  },
  performer: {
    id: "performer", name: "Performer",
    skills: [one("Music", "Perform"), grp("interpersonal"), grp("interpersonal")],
    languages: 0, perkGroup: "interpersonal",
    quickSkills: ["Flirt", "Music", "Perform"], quickPerk: "Harmonizer",
  },
  politician: {
    id: "politician", name: "Politician",
    skills: [grp("interpersonal"), grp("interpersonal")],
    languages: 1, perkGroup: "interpersonal",
    quickSkills: ["Lead", "Lie"], quickPerk: "Engrossing Monologue",
  },
  sage: {
    id: "sage", name: "Sage",
    skills: [grp("lore"), grp("lore")],
    languages: 1, perkGroup: "lore",
    quickSkills: ["History", "Magic"], quickPerk: "Expert Sage",
  },
  sailor: {
    id: "sailor", name: "Sailor",
    skills: [fx("Swim"), grp("exploration"), grp("exploration")],
    languages: 2, perkGroup: "exploration",
    quickSkills: ["Climb", "Gymnastics", "Swim"], quickPerk: "Put Your Back Into It!",
  },
  soldier: {
    id: "soldier", name: "Soldier",
    skills: [grp("exploration"), grp("intrigue")],
    languages: 2, perkGroup: "exploration",
    quickSkills: ["Alertness", "Endurance"], quickPerk: "Teamwork",
  },
  warden: {
    id: "warden", name: "Warden",
    skills: [fx("Nature"), grp("exploration"), grp("intrigue")],
    languages: 1, perkGroup: "exploration",
    quickSkills: ["Nature", "Navigate", "Track"], quickPerk: "Camouflage Hunter",
  },
  "watch-officer": {
    id: "watch-officer", name: "Watch Officer",
    skills: [fx("Alertness"), grp("intrigue"), grp("intrigue")],
    languages: 2, perkGroup: "exploration",
    quickSkills: ["Alertness", "Search", "Track"], quickPerk: "Team Leader",
  },
};

export const DS_CAREERS: Record<string, DSCareer> = CAREERS;
export const DS_CAREER_LIST: DSCareer[] = Object.values(CAREERS);
export const careerById = (id: string): DSCareer | undefined => CAREERS[id];

// The allowed skills for one choice slot (empty for a fixed slot). Used by the UI to build the picker.
export function slotOptions(slot: DSSkillSlot): string[] {
  if (slot.fixed) return [];
  if (slot.oneOf) return [...slot.oneOf];
  if (slot.fromGroups) {
    const out: string[] = [];
    for (const g of slot.fromGroups) out.push(...DS_SKILL_GROUPS[g]);
    return out;
  }
  return [];
}

// A short human label for a choice slot ("Interpersonal", "Crafting or Exploration", "Music or Perform").
export function slotLabel(slot: DSSkillSlot): string {
  if (slot.fixed) return slot.fixed;
  if (slot.oneOf) return slot.oneOf.join(" or ");
  if (slot.fromGroups) return slot.fromGroups.map((g) => DS_SKILL_GROUP_LABEL[g]).join(" or ");
  return "";
}
