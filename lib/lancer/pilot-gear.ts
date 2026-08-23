// Lancer PILOT GEAR: the kit a pilot carries out of the mech - one set of personal armor (a hardsuit),
// up to two pilot-scale weapons, and up to three other pieces of gear. Parallel split to the loadout /
// pilot files: this is the types + data + the small budget/derivation helpers, pure and no I/O.
//
// LICENSING: gear identity and stats are used under the Lancer Third Party License (see lib/systems/
// lancer.ts for the required attribution). Only MECHANICS ship - names, tags, and the printed numbers,
// plus short in-house telegraphic notes so the picker is usable. Massif Press's descriptive prose does
// NOT ship.
//
// Rules (Lancer Core Rulebook, Pilot Gear): on a mission a pilot takes one set of personal armor, up to
// two weapons, and up to three other pieces of gear. All pilot weapons are pilot-scale and can't be used
// by mechs. A hardsuit sets the pilot's Armor / Evasion / E-Defense / Speed while worn and adds its
// listed bonus (extra HP, or Flight, or Invisibility). Without a hardsuit ("riding naked") the pilot uses
// their bare-body defaults (Evasion 10, E-Defense 10, Speed 4, Armor 0).

export const MAX_PILOT_WEAPONS = 2;
export const MAX_PILOT_GEAR = 3;

// ---- personal armor (hardsuits) ----------------------------------------------------------------

export interface LancerPilotArmor {
  id: string;
  name: string;
  tags: string[];
  armor: number;        // pilot Armor while worn
  evasion: number;      // pilot Evasion while worn
  edef: number;         // pilot E-Defense while worn
  speed: number;        // pilot Speed while worn
  hpBonus: number;      // extra pilot HP granted (0 for suits whose bonus is Flight / Invisibility)
  flight?: boolean;     // grants Flight
  invisibility?: boolean; // can become Invisible (as a quick action)
  bonusLabel: string;   // short label for the suit's headline bonus, e.g. "+3 HP", "Flight"
}

const armor = (
  id: string, name: string, a: number, ev: number, ed: number, sp: number,
  hpBonus: number, bonusLabel: string, extra?: Partial<LancerPilotArmor>,
): LancerPilotArmor => ({
  id, name, tags: ["Personal Armor"], armor: a, evasion: ev, edef: ed, speed: sp, hpBonus, bonusLabel, ...extra,
});

export const LANCER_PILOT_ARMOR: LancerPilotArmor[] = [
  armor("pa_light", "Light Hardsuit", 0, 10, 10, 4, 3, "+3 HP"),
  armor("pa_assault", "Assault Hardsuit", 1, 8, 8, 4, 3, "+3 HP"),
  armor("pa_heavy", "Heavy Hardsuit", 2, 6, 8, 3, 3, "+3 HP"),
  armor("pa_mobility", "Mobility Hardsuit", 0, 10, 10, 5, 0, "Flight", { flight: true }),
  armor("pa_stealth", "Stealth Hardsuit", 0, 8, 8, 4, 0, "Invisibility", { invisibility: true }),
];

export const pilotArmorById = (id: string): LancerPilotArmor | undefined =>
  LANCER_PILOT_ARMOR.find((a) => a.id === id);

// ---- pilot weapons -----------------------------------------------------------------------------

export type PilotWeaponCategory = "Archaic" | "Alloy/Composite" | "Signature";

export interface LancerPilotWeapon {
  id: string;
  name: string;
  category: PilotWeaponCategory;
  tags: string[];
  range: string[];        // e.g. ["Threat 1"], ["Range 5"]
  damage: string;         // e.g. "1 Kinetic"; for signature weapons the number, with damageChoice set
  damageChoice?: boolean; // true if the pilot chooses explosive / energy / kinetic when acquired
}

const wpn = (
  id: string, name: string, category: PilotWeaponCategory, tags: string[],
  range: string[], damage: string, damageChoice?: boolean,
): LancerPilotWeapon => ({ id, name, category, tags, range, damage, ...(damageChoice ? { damageChoice } : {}) });

export const LANCER_PILOT_WEAPONS: LancerPilotWeapon[] = [
  // Archaic - relics, heirlooms, ceremonial arms
  wpn("pw_archaic_melee", "Archaic Melee", "Archaic", ["Archaic"], ["Threat 1"], "1 Kinetic"),
  wpn("pw_archaic_ranged", "Archaic Ranged", "Archaic", ["Archaic"], ["Range 5"], "1 Kinetic"),

  // Alloy / Composite melee - knives up to heavy assault swords
  wpn("pw_ac_light", "Light A/C Melee", "Alloy/Composite", ["Sidearm"], ["Threat 1"], "1 Kinetic"),
  wpn("pw_ac_medium", "Medium A/C Melee", "Alloy/Composite", [], ["Threat 1"], "2 Kinetic"),
  wpn("pw_ac_heavy", "Heavy A/C Melee", "Alloy/Composite", ["Inaccurate"], ["Threat 1"], "3 Kinetic"),

  // Signature ranged - choose the damage type (explosive / energy / kinetic) when the weapon is acquired
  wpn("pw_sig_light", "Light Signature", "Signature", ["Sidearm"], ["Range 3"], "1", true),
  wpn("pw_sig_medium", "Medium Signature", "Signature", [], ["Range 5"], "2", true),
  wpn("pw_sig_heavy", "Heavy Signature", "Signature", ["Ordnance", "Loading"], ["Range 10"], "4", true),
];

export const pilotWeaponById = (id: string): LancerPilotWeapon | undefined =>
  LANCER_PILOT_WEAPONS.find((w) => w.id === id);

// ---- other gear (limited-use kit + utility gear) -----------------------------------------------

export type PilotGearGroup = "Limited" | "Utility";

export interface LancerPilotGear {
  id: string;
  name: string;
  group: PilotGearGroup;
  tags: string[];   // mechanical labels, e.g. "Limited 1", "Full Action", "Quick Action"
  note: string;     // short in-house telegraphic function summary (NOT the rulebook's prose)
}

const gear = (id: string, name: string, group: PilotGearGroup, tags: string[], note: string): LancerPilotGear =>
  ({ id, name, group, tags, note });

export const LANCER_PILOT_GEAR: LancerPilotGear[] = [
  // Limited pilot gear - consumable, tracked by charges
  gear("pg_corrective", "Corrective", "Limited", ["Limited 1", "Full Action"],
    "Brings a Down and Out pilot back to consciousness at 1 HP."),
  gear("pg_frag_grenades", "Frag Grenades", "Limited", ["Limited 2"],
    "Grenade, Range 5, Blast 1: Agility save or 2 explosive."),
  gear("pg_patch", "Patch", "Limited", ["Limited 1", "Full Action"],
    "Restores half max HP to you or an adjacent pilot; no effect on Down and Out."),
  gear("pg_stims", "Stims", "Limited", ["Limited 3", "Quick Action"],
    "Quick action: stay awake and alert, stay calm, or heighten senses and reactions."),
  gear("pg_thermite_charge", "Thermite Charge", "Limited", ["Limited 1", "Full Action"],
    "Mine, Blast 1: Engineering save or 3 AP; auto-hits objects for 10 AP."),

  // Utility gear - persistent kit, no charge tracking
  gear("pg_antiphoton_visor", "Antiphoton Visor", "Utility", [],
    "Shields the eyes from flash weapons, intense UV, and stray energy-weapon glare."),
  gear("pg_camo_cloth", "Camo Cloth", "Utility", [],
    "Reactive sheet that shifts to match its surroundings, hiding what it covers."),
  gear("pg_dataplating", "Dataplating", "Utility", [],
    "Comm-linked wearable that subvocalizes, translates, and drives an AR HUD without a helm."),
  gear("pg_extra_rations", "Extra Rations", "Utility", [],
    "Stashed food and luxuries; useful to barter or boost morale."),
  gear("pg_flexsuit", "Flexsuit", "Utility", [],
    "Base-layer suit that recycles water and nutrients, extending survival about a week."),
  gear("pg_handheld_printer", "Handheld Printer", "Utility", [],
    "Portable printer that makes simple durable-plastic objects from a pattern chip."),
  gear("pg_subjectivity_suite", "Subjectivity-Enhancement Suite", "Utility", [],
    "Implanted plug cables for hardline hacking and a full AR interface without a rig."),
  gear("pg_infoskin", "Infoskin", "Utility", [],
    "Reactive polymer bonded to skin and hair; alters face, hair color, or makeup on command."),
  gear("pg_mag_clamps", "Mag-Clamps", "Utility", [],
    "Clamps that grip any metal surface; aid zero-g movement and mech repairs."),
  gear("pg_nanite_spray", "Nanite Spray", "Utility", [],
    "Invisible spray that carries short messages or data packets when scanned."),
  gear("pg_omnihook", "Omnihook", "Utility", [],
    "Bulky omninet terminal for comms, data transfer, and limited hotspotting."),
  gear("pg_personal_drone", "Personal Drone", "Utility", [],
    "Small non-combat drone that flies about half a mile relaying audio and video."),
  gear("pg_prosocollar", "Prosocollar", "Utility", [],
    "Neck device projecting a holo-disguise and altering the wearer's voice."),
  gear("pg_smart_scope", "Smart Scope", "Utility", [],
    "Electronic scope with long-range magnification that pairs with a networked HUD."),
  gear("pg_sleeping_bag", "Sleeping Bag", "Utility", ["Full Action"],
    "Fire-resistant bag that seals against vacuum; Immunity to Burn while inside, but Stunned."),
  gear("pg_ssc_sylph_undersuit", "SSC Sylph Undersuit", "Utility", [],
    "Living undersuit that cleans and heals its host and seals against vacuum for a time."),
  gear("pg_sound_system", "Sound System", "Utility", [],
    "Cockpit speaker rig for clear comms with allies, and playing music."),
  gear("pg_tertiary_arm", "Tertiary Arm", "Utility", [],
    "Powered third arm on the hardsuit for fine motor work, tools, or a weapon."),
  gear("pg_wilderness_survival_kit", "Wilderness Survival Kit", "Utility", [],
    "Rebreather, water filters, hardsuit patches, backup thermals, and a bivouac kit."),
];

export const pilotGearById = (id: string): LancerPilotGear | undefined =>
  LANCER_PILOT_GEAR.find((g) => g.id === id);
