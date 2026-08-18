// Lancer pilot talent list (from the public lancer-data / COMP-CON data set, used under the Lancer Third
// Party License). MECHANICS ONLY: talent identity and that each talent has three ranks. No Massif Press
// rank/effect prose ships here, the sheet tracks which talents are taken and at what rank. See
// lib/systems/lancer.ts for the required in-app attribution.

import type { LancerTalent } from "./pilot";

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
