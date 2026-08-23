// Lancer pilot talent list (from the public lancer-data / COMP-CON data set, used under the Lancer Third
// Party License). MECHANICS ONLY: talent identity and that each talent has three ranks. No Massif Press
// rank/effect prose ships here, the sheet tracks which talents are taken and at what rank. See
// lib/systems/lancer.ts for the required in-app attribution.

import type { LancerTalent, LancerSkillTrigger } from "./pilot";

// The example skill triggers from the Core Rulebook. A pilot may also invent custom triggers (GM
// approval); this catalog is the standard list the picker offers. MECHANICS ONLY: names only - the
// descriptive "what this covers" prose stays in the rulebook.
export const LANCER_SKILL_TRIGGERS: LancerSkillTrigger[] = [
  { id: "st_act_unseen", name: "Act Unseen or Unheard" },
  { id: "st_apply_fists", name: "Apply Fists to Faces" },
  { id: "st_assault", name: "Assault" },
  { id: "st_blow_something_up", name: "Blow Something Up" },
  { id: "st_charm", name: "Charm" },
  { id: "st_get_a_hold", name: "Get a Hold of Something" },
  { id: "st_get_somewhere_quickly", name: "Get Somewhere Quickly" },
  { id: "st_hack_or_fix", name: "Hack or Fix" },
  { id: "st_invent_or_create", name: "Invent or Create" },
  { id: "st_investigate", name: "Investigate" },
  { id: "st_lead_or_inspire", name: "Lead or Inspire" },
  { id: "st_patch", name: "Patch" },
  { id: "st_pull_rank", name: "Pull Rank" },
  { id: "st_read_a_situation", name: "Read a Situation" },
  { id: "st_show_off", name: "Show Off" },
  { id: "st_spot", name: "Spot" },
  { id: "st_stay_cool", name: "Stay Cool" },
  { id: "st_survive", name: "Survive" },
  { id: "st_take_control", name: "Take Control" },
  { id: "st_take_someone_out", name: "Take Someone Out" },
  { id: "st_threaten", name: "Threaten" },
  { id: "st_word_on_the_street", name: "Word on the Street" },
];

export const LANCER_TALENTS: LancerTalent[] = [
  { id: "t_ace", name: "Ace" },
  { id: "t_bonded", name: "Bonded" },
  { id: "t_brawler", name: "Brawler" },
  { id: "t_brutal", name: "Brutal" },
  { id: "t_centimane", name: "Centimane" },
  { id: "t_combined_arms", name: "Combined Arms" },
  { id: "t_crack_shot", name: "Crack Shot" },
  { id: "t_drone_commander", name: "Drone Commander" },
  { id: "t_duelist", name: "Duelist" },
  { id: "t_engineer", name: "Engineer" },
  { id: "t_executioner", name: "Executioner" },
  { id: "t_exemplar", name: "Exemplar" },
  { id: "t_grease_monkey", name: "Grease Monkey" },
  { id: "t_gunslinger", name: "Gunslinger" },
  { id: "t_hacker", name: "Hacker" },
  { id: "t_heavy_gunner", name: "Heavy Gunner" },
  { id: "t_hunter", name: "Hunter" },
  { id: "t_infiltrator", name: "Infiltrator" },
  { id: "t_juggernaut", name: "Juggernaut" },
  { id: "t_leader", name: "Leader" },
  { id: "t_nuclear_cavalier", name: "Nuclear Cavalier" },
  { id: "t_siege_specialist", name: "Siege Specialist" },
  { id: "t_skirmisher", name: "Skirmisher" },
  { id: "t_spotter", name: "Spotter" },
  { id: "t_stormbringer", name: "Stormbringer" },
  { id: "t_tactician", name: "Tactician" },
  { id: "t_technophile", name: "Technophile" },
  { id: "t_vanguard", name: "Vanguard" },
  { id: "t_walking_armory", name: "Walking Armory" },
];
