// The rules-module contract for Six Axes' multi-system support (Phase 0).
//
// This describes WHAT varies between game systems, as plain data. The agnostic core - recording,
// transcription, recaps, codex, connections, reveals, world map, timeline, prep, search, publish, and
// the setting-neutral play axes - never imports this file. Only the system-specific surfaces (the
// dice roller, the character creator, the stat-block builder, encounter tools, and any rules-flavored
// axis) resolve a module for the campaign's `system` and read from it.
//
// Deliberately dependency-free: no React, no data-source clients. Actual components and resolver
// functions are wired in the registry (see registry.ts), so this contract can be imported anywhere -
// server, client, or a migration script - without pulling in the world.

export type SystemId = string; // "dnd5e", "pf2e", "coc7e", "vtm5e", ...

// --- Dice / resolution -------------------------------------------------------------------------
// How a system turns a roll into an outcome. The roller renders a picker + inputs from this; the
// resolver function itself is supplied by the module implementation, not here.
export type DiceStyle =
  | { kind: "d20-vs-dc"; advantage: boolean }                 // D&D 5e, Pathfinder 2e
  | { kind: "percentile-under" }                              // Call of Cthulhu (d100 under skill)
  | { kind: "dice-pool"; die: 6 | 10; countSuccesses: true }  // Blades (d6), Vampire (d10)
  | { kind: "step-plus-stat"; dice: string }                  // PbtA 2d6+stat
  | { kind: "duality"; dice: string }                         // Daggerheart: 2d12 Hope vs Fear
  | { kind: "power-roll" }                                    // Draw Steel: 2d10 + characteristic vs tiers
  | { kind: "d20-accuracy" }                                  // Lancer: d20 + Accuracy/Difficulty (net highest of Nd6) vs target
  | { kind: "custom" };

export interface DiceConfig {
  style: DiceStyle;
  label: string; // shown on the roller, e.g. "Roll d20"
}

// --- Characters (optional: narrative systems may omit) -----------------------------------------
export interface CharacterModule {
  schemaId: string;      // identifies the sheet shape this system's creator + sheet use
  hasImport: boolean;    // e.g. D&D Beyond for 5e
  hasDerivation: boolean; // system computes values (5e modifiers, PF2e proficiency)
}

// --- Adversaries / stat blocks (optional) ------------------------------------------------------
export interface AdversaryModule {
  schemaId: string;
  hasEncounterMath: boolean;      // CR/XP budget (5e), level budget (PF2e); false for CoC/Vampire
  encounterMethod?: string;       // which budgeting ALGORITHM the encounter builder dispatches to:
                                  // "dnd5e" (CR/XP) or "pf2e" (level-relative XP). Present only when
                                  // hasEncounterMath. New crunch systems add their own id here.
  dataSource?: string;            // "open5e", "archives-of-nethys"
}

// --- System-specific play axis (on top of the agnostic ones the core owns) ---------------------
export interface AxisDef {
  id: string;    // "arcana"
  label: string; // "Arcana"
  blurb: string;
}

// --- Rules reference source --------------------------------------------------------------------
export interface RulesRefSource {
  id: string;    // "srd-open5e", "archives-of-nethys"
  label: string;
}

// --- The module ---------------------------------------------------------------------------------
// A system declares what it has. Optional sub-modules absent = the core hides that surface for this
// system (e.g. Call of Cthulhu has no adversary builder, so the stat-block tool won't show).
export interface RulesModule {
  id: SystemId;
  label: string;               // "D&D 5e (2024)"
  dice: DiceConfig;
  character?: CharacterModule;
  adversary?: AdversaryModule;
  axes: AxisDef[];             // [] for none
  rulesRef?: RulesRefSource;
}
