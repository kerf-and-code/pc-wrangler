// Lancer frame TRAITS and CORE SYSTEMS (from the public lancer-data / COMP-CON data set, used under the
// Lancer Third Party License). MECHANICS ONLY: each frame's trait names and its core-system name (plus
// the active/passive power names, the activation type, and any frequency limit), with short IN-HOUSE
// telegraphic notes so the Forge is usable. Massif Press's descriptive prose does NOT ship - the notes
// are our own concise mechanical paraphrase, and the full text stays in the rulebook. See
// lib/systems/lancer.ts for the required in-app attribution.
//
// This data is merged onto the frames in rules-data.ts (keyed by frame id), so the derived sheet's
// `frame` carries its traits and core system for the Forge to show read-only. Nothing here is applied to
// the stat block - traits are almost all conditional / reactive / active, not flat always-on modifiers.

import type { LancerFrameTrait, LancerCoreSystem } from "./character";

export interface LancerFrameExtras {
  traits: LancerFrameTrait[];
  coreSystem: LancerCoreSystem;
}

const t = (name: string, note: string): LancerFrameTrait => ({ name, note });

export const FRAME_EXTRAS: Record<string, LancerFrameExtras> = {
  // ---- GENERAL MASSIVE SYSTEMS ----
  mf_standard_pattern_i_everest: {
    traits: [
      t("Initiative", "1/scene, take any quick action as a free action."),
      t("Replaceable Parts", "Rests repair 1 Repair per structure damage instead of 2."),
    ],
    coreSystem: {
      name: "Hyperspec Fuel Injector", activeName: "Power Up", activation: "Protocol", frequency: "1/scene",
      activeNote: "Rest of scene: +1 Accuracy on all attacks, checks, and saves; 1/turn Boost as a free action.",
    },
  },

  // ---- HARRISON ARMORY ----
  mf_barbarossa: {
    traits: [
      t("Heavy Frame", "Can't be pushed, pulled, knocked prone, or knocked back by smaller characters."),
      t("Pressure Plating", "Resistance to explosive damage."),
      t("Colossus", "Adjacent allies can use it for hard cover."),
      t("Slow", "+1 difficulty on Agility checks and saves."),
    ],
    coreSystem: {
      name: "Apocalypse Rail", activeName: "Charge Rail", activation: "Quick",
      activeNote: "Charge a ship-scale rail (Apocalypse Die from 4, counting down), then fire a devastating line attack when ready.",
    },
  },
  mf_genghis: {
    traits: [
      t("Insulated", "Immunity to burn."),
      t("Emergency Vent", "Taking structure damage clears all heat."),
    ],
    coreSystem: {
      name: "TBK Sustain Suite", activeName: "Expose Power Cells", activation: "Quick",
      activeNote: "Next time you exceed Heat Cap this scene, instead clear all heat and vent a burst 3 cloud of burning matter.",
    },
  },
  mf_iskander: {
    traits: [
      t("Assault Launcher", "1/round, throw a grenade or plant a mine as though at range 15."),
      t("Mine Deployers", "1/round when planting a mine, plant up to two more in adjacent free spaces as a free action."),
      t("Skeleton Key", "Never triggers mines or proximity systems unless it chooses to."),
    ],
    coreSystem: {
      name: "Broad-Sweep Seeder", activeName: "Death Cloud", activation: "Quick",
      activeNote: "Seed micromines across the field (range 50); hostiles taking non-standard movement suffer for the scene.",
    },
  },
  mf_napoleon: {
    traits: [
      t("Heavy Shielding", "When it would take half damage on a save, reduce that damage to 1 instead."),
      t("Flash Aegis", "When it Braces, reduce incoming damage to 1 instead of gaining Resistance."),
    ],
    coreSystem: {
      name: "Trueblack Aegis", activeName: "Activate Aegis", activation: "Quick",
      activeNote: "Rest of scene: reduce all damage to 1 (except unreducible); gain Immunity to all tech actions.",
    },
  },
  mf_saladin: {
    traits: [
      t("Reinforced Frame", "Immunity to Shredded."),
      t("Guardian", "Adjacent allies can use it for hard cover."),
      t("Warp Shield", "1/round reaction: +1 difficulty to an attack against it or a nearby ally before the roll."),
    ],
    coreSystem: {
      name: "Tachyon Loop", activeName: "Tachyon Shield", activation: "Quick",
      activeNote: "Shield an ally in Sensors (retarget as a quick action); gain the Defensive Pulse reaction (1/round) for the scene.",
    },
  },
  mf_sherman: {
    traits: [
      t("Superior Reactor", "+1 Accuracy on Engineering checks and saves."),
      t("Mathur Stop", "When it clears all heat, may instead take half Heat Cap to enter the Danger Zone."),
      t("Vent Heat", "On Stabilize or a Heat Cap overflow, gain soft cover until your next turn."),
    ],
    coreSystem: {
      name: "Zone-Focus Mk IV SOLIDCORE", activeName: "COREBURN Protocol", activation: "Protocol",
      activeNote: "Gain 3 SOLIDCORE charges; rest of scene Stabilize gives 2 charges, and terrain/objects take 10 AP energy per charge on hit.",
    },
  },
  mf_tokugawa: {
    traits: [
      t("Limit Break", "While Exposed: attacks deal +3 energy bonus damage, kinetic/explosive become energy, +5 range / +1 threat."),
      t("Plasma Sheath", "In the Danger Zone, bonus damage from energy weapons becomes burn."),
    ],
    coreSystem: {
      name: "Superheated Reactor Feed", activeName: "Radiance", passiveName: "Overclock", activation: "Protocol",
      activeNote: "Rest of scene: energy weapons gain +5 range or +2 threat (stacks with Limit Break while Exposed).",
    },
  },

  // ---- HORUS ----
  mf_balor: {
    traits: [
      t("Scouring Swarm", "Deals 2 kinetic to chosen characters that start their turn adjacent to or grappled by it."),
      t("Regeneration", "End of turn, regains 1/4 max HP; pauses a round after taking stress or structure damage."),
      t("Self-Perpetuating", "Resting restores full HP with no repairs."),
    ],
    coreSystem: {
      name: "Hellswarm", activeName: "Hive Frenzy", activation: "Protocol",
      activeNote: "Rest of scene: you and adjacent allies gain soft cover; Scouring Swarm deals 4; Regeneration restores 1/2.",
    },
  },
  mf_goblin: {
    traits: [
      t("Liturgicode", "+1 Accuracy on tech attacks."),
      t("Reactive Code", "Gain the Reactive Code reaction."),
      t("Fragile", "+1 difficulty on Hull checks and saves."),
    ],
    coreSystem: {
      name: "INSTINCT Rig", activeName: "Symbiosis", activation: "Quick",
      activeNote: "Attach to a larger, willing allied mech as a vestigial blister, hosting on and boosting it.",
    },
  },
  mf_gorgon: {
    traits: [
      t("Metastatic Paralysis", "Attack rolls of 1-2 against it auto-miss and Stun the attacker until end of their next turn."),
      t("Gaze", "Take two reactions per turn instead of one."),
      t("Guardian", "Adjacent allies can use it for hard cover."),
    ],
    coreSystem: {
      name: "BASILISK Directed Anticognition Hyperfractal", activeName: "Extrude Basilisk", activation: "Quick",
      activeNote: "Project a harmful basilisk data-pattern; rest of scene, hostiles must pass a Systems save before attacking.",
    },
  },
  mf_hydra: {
    traits: [
      t("System Link", "Deployables and drones gain +5 HP."),
      t("Shepherd Field", "Drones, deployables, and objects adjacent to it gain Resistance to all damage."),
    ],
    coreSystem: {
      name: "OROCHI Disarticulation", activeName: "Full Deployment", passiveName: "OROCHI Drones", activation: "Quick",
      passiveNote: "Gain an OROCHI drone that shares your Evasion, E-Defense, and Speed.",
      activeNote: "Deploy all four OROCHI drones to points within Sensors for the rest of the scene.",
    },
  },
  mf_manticore: {
    traits: [
      t("Slag Carapace", "Resistance to energy damage and burn."),
      t("Unstable System", "When destroyed, explodes as a reactor meltdown at the end of its next turn."),
      t("Castigate the Enemies of the Godhead", "On rest or Full Repair, toggle a Castigation State (explodes immediately when destroyed)."),
    ],
    coreSystem: {
      name: "Charged Exoskeleton", activeName: "Destruction of the Temple of the Enemies of RA", passiveName: "Charged Exoskeleton", activation: "Protocol",
      passiveNote: "1/round, when you take heat, deal 2 AP energy to a character within range 3.",
      activeNote: "Gain Resistance to heat and a Charge Die that builds with heat/energy, then discharges.",
    },
  },
  mf_minotaur: {
    traits: [
      t("Invert Cockpit", "Mount or Dismount free the first time each round; no Impaired when you Eject."),
      t("Internal Metafold", "While inside, you can't be harmed in any way, even if the Minotaur is destroyed."),
      t("Localized Maze", "Hostiles can't pass through its space and must stop when Engaged with it."),
    ],
    coreSystem: {
      name: "Metafold Maze", activeName: "Maze", passiveName: "Metafold Maze", activation: "Full",
      activeNote: "Stun a character in Sensors; they escape only on a Systems save at +3 difficulty at end of their next turn.",
    },
  },
  mf_pegasus: {
    traits: [
      t("¿%:?EXTR!UDE GUN", "GUN. (Extrude a gun.)"),
      t("By the Way, I Know Everything", "May take average damage instead of rolling (1d3=2, 1d6=4, 2d6=7, 3d6=11, 4d6=14), decided before rolling."),
    ],
    coreSystem: {
      name: "Ushabti Omnigun", activeName: "Unshackle Ushabti", passiveName: "Ushabti Omnigun", activation: "Protocol",
      passiveNote: "A mount-less, type-less omnigun usable 1/round that can't be modified or benefit from talents.",
      activeNote: "Rest of scene: use the Ushabti Omnigun 3/round instead of 1/round.",
    },
  },

  // ---- IPS-NORTHSTAR ----
  mf_blackbeard: {
    traits: [
      t("Grapple Cable", "Grapple targets within range 5, pulling itself adjacent on a success."),
      t("Lock/Kill Subsystem", "While grappling, it may Boost and take reactions."),
      t("Exposed Reactor", "+1 difficulty on Engineering checks and saves."),
    ],
    coreSystem: {
      name: "Assault Grapples", activeName: "Omni-harpoon", activation: "Quick",
      activeNote: "Harpoon any number of targets in range 5; each makes a Hull save or takes 2d6 kinetic, is knocked prone, and pulled adjacent.",
    },
  },
  mf_drake: {
    traits: [
      t("Heavy Frame", "Can't be pushed, pulled, knocked prone, or knocked back by smaller characters."),
      t("Blast Plating", "Resistance to damage, burn, and heat from blast, burst, line, and cone attacks."),
      t("Slow", "+1 difficulty on Agility checks and saves."),
      t("Guardian", "Adjacent allies can use it for hard cover."),
    ],
    coreSystem: {
      name: "Fortress", activeName: "Fortress Protocol", activation: "Protocol",
      activeNote: "Deploy two sections of hard cover (line 2, Size 1) from your mech in any direction.",
    },
  },
  mf_lancaster: {
    traits: [
      t("Insulated", "Immunity to burn."),
      t("Combat Repair", "Spend 4 Repairs as a full action to revive a destroyed mech at 1 Structure, Stress, and HP."),
      t("Redundant Systems", "Adjacent allies may spend its Repairs as their own."),
    ],
    coreSystem: {
      name: "Latch Drone", activeName: "Supercharger", activation: "Quick",
      activeNote: "Latch an allied mech: you take 1 heat per turn, they gain +1 Accuracy on all rolls and Immunity for the scene.",
    },
  },
  mf_nelson: {
    traits: [
      t("Momentum", "1/round after Boosting, its next melee attack deals +1d6 bonus damage on hit."),
      t("Skirmisher", "After attacking, move 1 space freely (ignores engagement, provokes no reactions)."),
    ],
    coreSystem: {
      name: "Perpetual Momentum Drive", activeName: "Engage Drive", activation: "Protocol",
      activeNote: "Rest of scene: Skirmisher lets you move 4 spaces at a time instead of 1.",
    },
  },
  mf_raleigh: {
    traits: [
      t("Full Metal Jacket", "End of turn, if it made no attacks and forced no saves, reload all Loading weapons as a free action."),
      t("Shielded Magazines", "May make ranged attacks while Jammed."),
    ],
    coreSystem: {
      name: "M35 Mjolnir Cannon", activeName: "Thunder God", activation: "Protocol",
      activeNote: "Spin up the M35 Mjolnir; it loads rounds on turns you don't fire it, building toward a massive volley.",
    },
  },
  mf_tortuga: {
    traits: [
      t("Sentinel", "+1 Accuracy on attacks made as reactions (e.g. Overwatch)."),
      t("Guardian", "Adjacent allies can use it for hard cover."),
    ],
    coreSystem: {
      name: "WATCHDOG Co-Pilot", activeName: "Hyper-Reflex Mode", activation: "Protocol",
      activeNote: "Rest of scene: ranged weapons get min threat 3; +1 Overwatch reaction/round; Overwatch hits Immobilize.",
    },
  },
  mf_vlad: {
    traits: [
      t("Dismemberment", "When it Immobilizes a character, that character is also Shredded for the same duration."),
      t("Shrike Armor", "Attackers within range 3 first take 1 AP kinetic damage."),
    ],
    coreSystem: {
      name: "Shrike Armor", activeName: "Tormentor Spines", activation: "Protocol",
      activeNote: "Rest of scene: Resistance to damage originating within range 3; Shrike Armor deals 3 AP kinetic instead of 1.",
    },
  },

  // ---- SMITH-SHIMANO CORPRO ----
  mf_black_witch: {
    traits: [
      t("Repulsor Field", "Resistance to kinetic damage."),
      t("Mag Parry", "1/round reaction vs a kinetic attack: roll 1d6, on 5+ it misses (doesn't stack with Invisible)."),
    ],
    coreSystem: {
      name: "Magnetic Field Projector", activeName: "Mag Field", activation: "Full",
      activeNote: "Project a blast 3 magnetic field: difficult terrain that warps kinetic ranged attacks until your next turn.",
    },
  },
  mf_deaths_head: {
    traits: [
      t("Neurolink", "Reroll its first ranged attack each round, but keep the second result."),
      t("Perfected Targeting", "+1 to all ranged attack rolls."),
    ],
    coreSystem: {
      name: "Precognitive Targeting", activeName: "Neural Shunt", activation: "Protocol",
      activeNote: "Rest of scene: gain the Mark for Death action.",
    },
  },
  mf_dusk_wing: {
    traits: [
      t("Maneuverability Jets", "Can hover when it moves."),
      t("Harlequin Cloak", "Invisible during its turn; reappears at the end of the turn."),
      t("Fragile", "+1 difficulty on Hull checks and saves."),
    ],
    coreSystem: {
      name: "DHIYED Articulation", activeName: "Hall of Mirrors", activation: "Protocol",
      activeNote: "Rest of scene: leave a holographic imprint of yourself behind whenever you make a unique movement.",
    },
  },
  mf_metalmark: {
    traits: [
      t("Flash Cloak", "Invisible while moving; reappears when stationary."),
      t("Carapace Adaptation", "In soft cover, ranged attackers take +2 difficulty instead of +1."),
    ],
    coreSystem: {
      name: "Tactical Cloak", activeName: "Tactical Cloak", activation: "Protocol",
      activeNote: "Invisible for the rest of the scene.",
    },
  },
  mf_monarch: {
    traits: [
      t("Avenger Silos", "1/round on a ranged critical hit, deal 3 explosive to another character within range 15 and line of sight."),
      t("Seeking Payload", "Use a Launcher against a Lock On target as if it had Seeking, consuming the Lock On."),
    ],
    coreSystem: {
      name: "SSC-30 High-Penetration Missile System", activeName: "Divine Punishment", activation: "Full",
      activeNote: "Any number of targets within range 50: each makes an Agility save or takes 1d6+4 explosive (half on success).",
    },
  },
  mf_mourning_cloak: {
    traits: [
      t("Hunter", "1/round, deal +1d6 bonus melee damage against an isolated target."),
      t("Biotic Components", "+1 Accuracy on Agility checks and saves."),
    ],
    coreSystem: {
      name: "EX Slipstream Module", activeName: "Stabilize Singularity", passiveName: "Blinkspace Jump", activation: "Protocol",
      passiveNote: "Gain the Blinkspace Jump full action.",
      activeNote: "Rest of scene: you teleport when you Boost or make a standard move.",
    },
  },
  mf_swallowtail: {
    traits: [
      t("Integrated Cloak", "End of turn, becomes Invisible if it didn't move; lasts until it moves, reacts, or its next turn."),
      t("Prophetic Scanners", "1/round when it inflicts Lock On, the target is also Shredded until end of its next turn."),
    ],
    coreSystem: {
      name: "Cloudscout TACSIM Swarms", activeName: "Prophetic Interjection", activation: "Protocol",
      activeNote: "Rest of scene: gain the Tactical Simulation reaction.",
    },
  },
};

export const frameExtrasById = (id: string): LancerFrameExtras | undefined => FRAME_EXTRAS[id];
