// Lancer frame data (from the public lancer-data / COMP-CON data set, used under the Lancer Third
// Party License). MECHANICS ONLY: each frame's base stat block plus its mount layout and license
// level. Frame TRAITS and CORE SYSTEMS (names + short in-house notes, no Massif Press prose) live in
// frame-traits.ts and are merged on by id below. See lib/systems/lancer.ts for the required in-app
// attribution.

import type { LancerFrame, LancerRules } from "./character";
import { FRAME_EXTRAS } from "./frame-traits";

// Base stats are the frame's printed values; the engine adds the pilot's mech skills (HASE) and Grit.
const FRAMES: LancerFrame[] = [
  { id: "mf_standard_pattern_i_everest", name: "Everest", manufacturer: "GENERAL MASSIVE SYSTEMS", licenseLevel: 0, mounts: ["Main", "Flex", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 0, hp: 10, evasion: 8, edef: 8, heatCap: 6, repCap: 5, sensors: 10, techAttack: 0, save: 10, speed: 4, sp: 6 } },
  { id: "mf_barbarossa", name: "Barbarossa", manufacturer: "HARRISON ARMORY", licenseLevel: 2, mounts: ["Main", "Main", "Heavy"],
    base: { size: 3, structure: 4, stress: 4, armor: 2, hp: 10, evasion: 6, edef: 6, heatCap: 8, repCap: 4, sensors: 10, techAttack: -2, save: 10, speed: 2, sp: 5 } },
  { id: "mf_genghis", name: "Genghis", manufacturer: "HARRISON ARMORY", licenseLevel: 2, mounts: ["Flex", "Main", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 3, hp: 6, evasion: 6, edef: 8, heatCap: 10, repCap: 4, sensors: 5, techAttack: -2, save: 10, speed: 3, sp: 5 } },
  { id: "mf_iskander", name: "Iskander", manufacturer: "HARRISON ARMORY", licenseLevel: 2, mounts: ["Flex", "Heavy"],
    base: { size: 2, structure: 4, stress: 4, armor: 1, hp: 8, evasion: 8, edef: 10, heatCap: 7, repCap: 3, sensors: 15, techAttack: 1, save: 12, speed: 3, sp: 6 } },
  { id: "mf_napoleon", name: "Napoleon", manufacturer: "HARRISON ARMORY", licenseLevel: 2, mounts: ["Main/Aux"],
    base: { size: 0.5, structure: 4, stress: 4, armor: 2, hp: 6, evasion: 8, edef: 8, heatCap: 8, repCap: 3, sensors: 5, techAttack: 0, save: 11, speed: 4, sp: 7 } },
  { id: "mf_saladin", name: "Saladin", manufacturer: "HARRISON ARMORY", licenseLevel: 2, mounts: ["Flex"],
    base: { size: 2, structure: 4, stress: 4, armor: 1, hp: 12, evasion: 6, edef: 8, heatCap: 8, repCap: 4, sensors: 10, techAttack: 0, save: 10, speed: 3, sp: 8 } },
  { id: "mf_sherman", name: "Sherman", manufacturer: "HARRISON ARMORY", licenseLevel: 2, mounts: ["Flex", "Main", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 1, hp: 10, evasion: 7, edef: 8, heatCap: 8, repCap: 4, sensors: 10, techAttack: -1, save: 10, speed: 3, sp: 5 } },
  { id: "mf_tokugawa", name: "Tokugawa", manufacturer: "HARRISON ARMORY", licenseLevel: 2, mounts: ["Flex", "Main", "Main"],
    base: { size: 1, structure: 4, stress: 4, armor: 1, hp: 8, evasion: 8, edef: 6, heatCap: 8, repCap: 4, sensors: 10, techAttack: -1, save: 11, speed: 4, sp: 6 } },
  { id: "mf_balor", name: "Balor", manufacturer: "HORUS", licenseLevel: 2, mounts: ["Main", "Heavy"],
    base: { size: 2, structure: 4, stress: 4, armor: 0, hp: 12, evasion: 6, edef: 10, heatCap: 4, repCap: 4, sensors: 5, techAttack: 1, save: 10, speed: 3, sp: 6 } },
  { id: "mf_goblin", name: "Goblin", manufacturer: "HORUS", licenseLevel: 2, mounts: ["Flex"],
    base: { size: 0.5, structure: 4, stress: 4, armor: 0, hp: 6, evasion: 10, edef: 12, heatCap: 4, repCap: 2, sensors: 20, techAttack: 2, save: 11, speed: 5, sp: 8 } },
  { id: "mf_gorgon", name: "Gorgon", manufacturer: "HORUS", licenseLevel: 2, mounts: ["Flex", "Main", "Main"],
    base: { size: 2, structure: 4, stress: 4, armor: 0, hp: 12, evasion: 8, edef: 12, heatCap: 5, repCap: 3, sensors: 8, techAttack: 1, save: 12, speed: 4, sp: 6 } },
  { id: "mf_hydra", name: "Hydra", manufacturer: "HORUS", licenseLevel: 2, mounts: ["Main", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 1, hp: 8, evasion: 7, edef: 10, heatCap: 5, repCap: 4, sensors: 10, techAttack: 1, save: 10, speed: 5, sp: 8 } },
  { id: "mf_manticore", name: "Manticore", manufacturer: "HORUS", licenseLevel: 2, mounts: ["Flex", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 2, hp: 8, evasion: 6, edef: 10, heatCap: 7, repCap: 3, sensors: 10, techAttack: 1, save: 10, speed: 3, sp: 6 } },
  { id: "mf_minotaur", name: "Minotaur", manufacturer: "HORUS", licenseLevel: 2, mounts: ["Main/Aux"],
    base: { size: 1, structure: 4, stress: 4, armor: 0, hp: 12, evasion: 8, edef: 10, heatCap: 5, repCap: 4, sensors: 8, techAttack: 1, save: 11, speed: 4, sp: 8 } },
  { id: "mf_pegasus", name: "Pegasus", manufacturer: "HORUS", licenseLevel: 2, mounts: ["Flex", "Flex", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 0, hp: 8, evasion: 8, edef: 10, heatCap: 6, repCap: 3, sensors: 10, techAttack: 1, save: 10, speed: 4, sp: 7 } },
  { id: "mf_blackbeard", name: "Blackbeard", manufacturer: "IPS-NORTHSTAR", licenseLevel: 2, mounts: ["Flex", "Main", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 1, hp: 12, evasion: 8, edef: 6, heatCap: 4, repCap: 5, sensors: 5, techAttack: -2, save: 10, speed: 5, sp: 5 } },
  { id: "mf_drake", name: "Drake", manufacturer: "IPS-NORTHSTAR", licenseLevel: 2, mounts: ["Main", "Main", "Heavy"],
    base: { size: 2, structure: 4, stress: 4, armor: 3, hp: 8, evasion: 6, edef: 6, heatCap: 5, repCap: 5, sensors: 10, techAttack: 0, save: 10, speed: 3, sp: 5 } },
  { id: "mf_lancaster", name: "Lancaster", manufacturer: "IPS-NORTHSTAR", licenseLevel: 2, mounts: ["Main/Aux"],
    base: { size: 2, structure: 4, stress: 4, armor: 1, hp: 6, evasion: 8, edef: 8, heatCap: 6, repCap: 10, sensors: 8, techAttack: 1, save: 10, speed: 6, sp: 8 } },
  { id: "mf_nelson", name: "Nelson", manufacturer: "IPS-NORTHSTAR", licenseLevel: 2, mounts: ["Flex", "Main/Aux"],
    base: { size: 1, structure: 4, stress: 4, armor: 0, hp: 8, evasion: 11, edef: 7, heatCap: 6, repCap: 5, sensors: 5, techAttack: 0, save: 10, speed: 5, sp: 6 } },
  { id: "mf_raleigh", name: "Raleigh", manufacturer: "IPS-NORTHSTAR", licenseLevel: 2, mounts: ["Aux/Aux", "Flex", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 1, hp: 10, evasion: 8, edef: 7, heatCap: 5, repCap: 5, sensors: 10, techAttack: -1, save: 10, speed: 4, sp: 5 } },
  { id: "mf_tortuga", name: "Tortuga", manufacturer: "IPS-NORTHSTAR", licenseLevel: 2, mounts: ["Main", "Heavy"],
    base: { size: 2, structure: 4, stress: 4, armor: 2, hp: 8, evasion: 6, edef: 10, heatCap: 6, repCap: 6, sensors: 15, techAttack: 1, save: 10, speed: 3, sp: 6 } },
  { id: "mf_vlad", name: "Vlad", manufacturer: "IPS-NORTHSTAR", licenseLevel: 2, mounts: ["Flex", "Main", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 2, hp: 8, evasion: 8, edef: 8, heatCap: 6, repCap: 4, sensors: 5, techAttack: -2, save: 11, speed: 4, sp: 5 } },
  { id: "mf_black_witch", name: "Black Witch", manufacturer: "SMITH-SHIMANO CORPRO", licenseLevel: 2, mounts: ["Main/Aux"],
    base: { size: 1, structure: 4, stress: 4, armor: 1, hp: 6, evasion: 10, edef: 12, heatCap: 6, repCap: 3, sensors: 15, techAttack: 0, save: 11, speed: 5, sp: 8 } },
  { id: "mf_deaths_head", name: "Death’s Head", manufacturer: "SMITH-SHIMANO CORPRO", licenseLevel: 2, mounts: ["Main/Aux", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 0, hp: 8, evasion: 10, edef: 8, heatCap: 6, repCap: 2, sensors: 20, techAttack: 0, save: 10, speed: 5, sp: 6 } },
  { id: "mf_dusk_wing", name: "Dusk Wing", manufacturer: "SMITH-SHIMANO CORPRO", licenseLevel: 2, mounts: ["Aux/Aux", "Flex"],
    base: { size: 0.5, structure: 4, stress: 4, armor: 0, hp: 6, evasion: 12, edef: 8, heatCap: 4, repCap: 3, sensors: 10, techAttack: 1, save: 11, speed: 6, sp: 6 } },
  { id: "mf_metalmark", name: "Metalmark", manufacturer: "SMITH-SHIMANO CORPRO", licenseLevel: 2, mounts: ["Aux/Aux", "Main", "Heavy"],
    base: { size: 1, structure: 4, stress: 4, armor: 1, hp: 8, evasion: 10, edef: 6, heatCap: 5, repCap: 4, sensors: 10, techAttack: 0, save: 10, speed: 5, sp: 5 } },
  { id: "mf_monarch", name: "Monarch", manufacturer: "SMITH-SHIMANO CORPRO", licenseLevel: 2, mounts: ["Flex", "Main", "Heavy"],
    base: { size: 2, structure: 4, stress: 4, armor: 1, hp: 8, evasion: 8, edef: 8, heatCap: 6, repCap: 3, sensors: 15, techAttack: 1, save: 10, speed: 5, sp: 5 } },
  { id: "mf_mourning_cloak", name: "Mourning Cloak", manufacturer: "SMITH-SHIMANO CORPRO", licenseLevel: 2, mounts: ["Flex", "Main/Aux"],
    base: { size: 1, structure: 4, stress: 4, armor: 0, hp: 8, evasion: 12, edef: 6, heatCap: 4, repCap: 3, sensors: 15, techAttack: 0, save: 10, speed: 5, sp: 6 } },
  { id: "mf_swallowtail", name: "Swallowtail", manufacturer: "SMITH-SHIMANO CORPRO", licenseLevel: 2, mounts: ["Flex", "Aux/Aux"],
    base: { size: 1, structure: 4, stress: 4, armor: 0, hp: 6, evasion: 10, edef: 10, heatCap: 4, repCap: 5, sensors: 20, techAttack: 1, save: 10, speed: 6, sp: 6 } },
];

// Merge each frame's traits + core system (from frame-traits.ts) onto its stat block by id.
const FRAMES_WITH_EXTRAS: LancerFrame[] = FRAMES.map((f) => {
  const x = FRAME_EXTRAS[f.id];
  return x ? { ...f, traits: x.traits, coreSystem: x.coreSystem } : f;
});

export const LANCER_RULES: LancerRules = { frames: FRAMES_WITH_EXTRAS };
export const LANCER_FRAME_LIST: LancerFrame[] = FRAMES_WITH_EXTRAS;
