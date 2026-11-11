// lib/play/system-tracks.ts (2026-11-10, push 22, audit G5)
//
// What the at-the-table tracker (components/system-play.tsx) keeps for each system outside D&D 5e, and
// the limits of each track, from the system's derived sheet. Pure, so it is tested on its own.

import type { Pf2eSheet } from "@/lib/pf2e/character";
import type { DHSheet } from "@/lib/daggerheart/character";
import type { DSSheet } from "@/lib/drawsteel/character";
import type { LancerSheet } from "@/lib/lancer/character";

export type SystemPlayState = { values?: Record<string, number>; conditions?: string };

export type PlayTrack = {
  key: string; label: string; min: number; max: number;
  /** The value after a reset (a long rest, a new session). */
  start: number;
  /** Shown under the label: what the number means. */
  hint?: string;
};

export type PlaySheet =
  | { system: "pf2e"; sheet: Pf2eSheet }
  | { system: "daggerheart"; sheet: DHSheet }
  | { system: "drawsteel"; sheet: DSSheet }
  | { system: "lancer"; sheet: LancerSheet };

/** The tracks each system keeps, with their limits from the derived sheet. */
export function playTracks(p: PlaySheet): PlayTrack[] {
  switch (p.system) {
    case "pf2e": return [
      { key: "hp", label: "Hit Points", min: 0, max: p.sheet.hp, start: p.sheet.hp },
      { key: "temp", label: "Temporary HP", min: 0, max: 999, start: 0 },
      { key: "hero", label: "Hero Points", min: 0, max: 3, start: 1, hint: "1 at the start of each session" },
      { key: "dying", label: "Dying", min: 0, max: 4, start: 0 },
      { key: "wounded", label: "Wounded", min: 0, max: 3, start: 0 },
    ];
    case "daggerheart": return [
      { key: "hpMarked", label: "Hit Points marked", min: 0, max: p.sheet.hp, start: 0, hint: `Thresholds: Major ${p.sheet.major}, Severe ${p.sheet.severe}` },
      { key: "stressMarked", label: "Stress marked", min: 0, max: p.sheet.stress, start: 0 },
      { key: "hope", label: "Hope", min: 0, max: p.sheet.hopeMax, start: p.sheet.hopeStart },
      { key: "armorMarked", label: "Armor slots marked", min: 0, max: p.sheet.armorScore, start: 0 },
    ];
    case "drawsteel": return [
      { key: "stamina", label: "Stamina", min: -p.sheet.winded, max: p.sheet.stamina, start: p.sheet.stamina, hint: `Winded at ${p.sheet.winded} or less` },
      { key: "recoveries", label: "Recoveries", min: 0, max: p.sheet.recoveries, start: p.sheet.recoveries, hint: `Each restores ${p.sheet.recoveryValue} Stamina` },
      { key: "heroic", label: p.sheet.heroicResource || "Heroic resource", min: 0, max: 99, start: 0 },
      { key: "surges", label: "Surges", min: 0, max: 99, start: 0 },
      { key: "victories", label: "Victories", min: 0, max: 99, start: 0 },
    ];
    case "lancer": return [
      { key: "pilotHp", label: "Pilot HP", min: 0, max: p.sheet.pilot.hp, start: p.sheet.pilot.hp },
      { key: "mechHp", label: "Mech HP", min: 0, max: p.sheet.mech.hp, start: p.sheet.mech.hp },
      { key: "structure", label: "Structure", min: 0, max: p.sheet.mech.structure, start: p.sheet.mech.structure },
      { key: "heat", label: "Heat", min: 0, max: p.sheet.mech.heatCap, start: 0 },
      { key: "stress", label: "Reactor Stress", min: 0, max: p.sheet.mech.stress, start: p.sheet.mech.stress },
      { key: "repairs", label: "Repairs", min: 0, max: p.sheet.mech.repCap, start: p.sheet.mech.repCap },
      { key: "overshield", label: "Overshield", min: 0, max: 99, start: 0 },
    ];
  }
}

/** The current value of a track, kept inside its limits (a level change can lower a maximum). */
export function playValue(t: PlayTrack, state: SystemPlayState | undefined): number {
  const v = state?.values?.[t.key];
  const n = typeof v === "number" && Number.isFinite(v) ? v : t.start;
  return Math.max(t.min, Math.min(t.max, n));
}
