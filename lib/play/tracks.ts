// lib/play/tracks.ts (2026-11-07)
//
// Phase 5b: the countable pools and spell slots a character has, in one place, so the Forge's
// resource tracker and the play sheet's spells and actions read the same numbers (they were computed
// inside the tracker alone before). Pure: the caller passes the class table rows' sources.
//
// Spell slots are keyed two ways, both kept as they are stored: a single class's slots come from its
// table columns ("slot-1st"), a multiclass caster's from the combined table ("slot-1"). slotFor()
// finds a level's slot either way.

import { classTable } from "@/lib/class-table";
import { resourcesFor, slotsFor, remaining, type Resource } from "@/lib/resources";

export type TrackInputs = {
  structuredRec?: unknown;
  level: number;
  extraClasses: { rec?: unknown; level: number }[];
  extraPools: Resource[];
  mcSlots: { level: number; slots: number }[];
};

export function trackedResources(inp: TrackInputs): { pools: Resource[]; slots: Resource[]; pactLevel: number | null } {
  const row = classTable(inp.structuredRec).find((r) => r.level === inp.level);
  const out = [...resourcesFor(row)];
  for (const c of inp.extraClasses) {
    const r = classTable(c.rec).find((x) => x.level === c.level);
    for (const p of resourcesFor(r)) {
      // a pool of the same name from two classes is ONE pool, with the larger maximum
      const at = out.findIndex((e) => e.key === p.key);
      if (at >= 0) out[at] = out[at].max >= p.max ? out[at] : p;
      else out.push(p);
    }
  }
  const pools = [...out, ...inp.extraPools];
  // the combined multiclass table REPLACES the primary class's own slot row
  const slots = inp.mcSlots.length
    ? inp.mcSlots.map((r) => ({ key: `slot-${r.level}`, label: `Level ${r.level}`, max: r.slots, shortRest: "none" as const }))
    : slotsFor(row);
  // a warlock's pact slots are all of one level, in the table's "Slot Level" column
  const pactRaw = row?.columns["Slot Level"] ?? row?.columns["Spell Slot Level"] ?? null;
  const pactLevel = pactRaw ? parseInt(String(pactRaw), 10) || null : null;
  return { pools, slots, pactLevel };
}

const ORDS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
export function slotLevelOf(r: Resource): number {
  const m = /^slot-(\d+)/.exec(r.key);
  if (m) return Number(m[1]);
  const i = ORDS.indexOf(r.key.replace(/^slot-/, ""));
  return i > 0 ? i : 0;
}
export function slotFor(slots: Resource[], level: number): Resource | null {
  return slots.find((r) => slotLevelOf(r) === level) ?? null;
}
export function slotsLeft(slots: Resource[], spent: Record<string, number>): { level: number; key: string; left: number; max: number }[] {
  return slots.map((r) => ({ level: slotLevelOf(r), key: r.key, left: remaining(r, spent), max: r.max })).filter((s) => s.level > 0).sort((a, b) => a.level - b.level);
}
