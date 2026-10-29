// lib/subclass-features.ts
//
// A class's level-by-level features WITH the character's own subclass in them.
//
// THE BUG THIS FIXES
//   The class JSON (classes-2014.json, classes-2024.json) was built from the SRD, and the SRD prints
//   each class with its one SRD subclass folded into the feature list. So every Paladin was shown
//   Oath of Devotion Spells and Sacred Weapon, every Wizard the Evoker features, every Fighter the
//   Champion's, whatever subclass they had picked, and a non-SRD subclass's own features never
//   appeared at all. Measured on 2026-10-28: all 12 classes in both editions carried their SRD
//   subclass features this way.
//
// WHAT IT DOES
//   1. Drops from the class list every (level, name) that belongs to that class's SRD subclass.
//   2. Adds the chosen subclass's features, from the SRD structured files or, for Kerf and Code
//      authored subclasses (Arcana Unleashed and later batches), subclasses-authored-<ed>.json.
//   Matching uses sameSubclass, so the catalog's short names ("Devotion", "Vestige") find the
//   book names ("Oath of Devotion", "Vestige Patron").
//
// ADDING A SUBCLASS
//   Add an entry to subclasses-authored-<ed>.json ({ class, name, features_by_level: [{ level,
//   features: [{ name, desc }] }] }). It then shows in the Forge and the compendium with no code.

import sub2014 from "./srd/subclasses-2014-structured.json";
import sub2024 from "./srd/subclasses-2024-structured.json";
import authored2024 from "./srd/subclasses-authored-2024.json";
import authored2014 from "./srd/subclasses-authored-2014.json";
import { sameSubclass } from "./subclass-names";
import type { ClassFeature, ClassRecord } from "./class-progression";

type SubRec = {
  class: string;
  name: string;
  features_by_level?: { level: number; features?: { name: string; desc: string }[]; name?: string; desc?: string }[];
};

const SRD: Record<"2014" | "2024", SubRec[]> = {
  "2014": sub2014 as unknown as SubRec[],
  "2024": sub2024 as unknown as SubRec[],
};
const AUTHORED: Record<"2014" | "2024", SubRec[]> = {
  "2014": authored2014 as unknown as SubRec[],
  "2024": authored2024 as unknown as SubRec[],
};

function flatten(rec: SubRec): ClassFeature[] {
  const out: ClassFeature[] = [];
  for (const row of rec.features_by_level || []) {
    if (row.features) for (const f of row.features) out.push({ level: row.level, name: f.name, desc: f.desc || "" });
    else if (row.name) out.push({ level: row.level, name: row.name, desc: row.desc || "" });
  }
  return out;
}

const ed = (e: string): "2014" | "2024" => (e === "2014" ? "2014" : "2024");

/** The chosen subclass's features, same edition first, then the other edition. [] if unmodeled. */
export function subclassFeatures(className: string, subclass: string | null | undefined, edition: string): ClassFeature[] {
  if (!className || !subclass) return [];
  const e = ed(edition);
  const other = e === "2014" ? "2024" : "2014";
  for (const pool of [SRD[e], AUTHORED[e], SRD[other], AUTHORED[other]]) {
    const hit = pool.find((s) => s.class === className && sameSubclass(s.name, subclass));
    if (hit) return flatten(hit);
  }
  return [];
}

/** Whether the app holds feature data for this subclass at all. */
export function hasSubclassFeatures(className: string, subclass: string | null | undefined, edition: string): boolean {
  return subclassFeatures(className, subclass, edition).length > 0;
}

/**
 * The class record with the SRD subclass's features removed and the chosen subclass's added.
 * Returns the record unchanged when there is no class data.
 */
export function withSubclass(
  cls: ClassRecord | undefined, className: string, subclass: string | null | undefined, edition: string,
): ClassRecord | undefined {
  if (!cls?.features_by_level) return cls;
  const e = ed(edition);
  const srdKeys = new Set<string>();
  for (const pool of [SRD["2014"], SRD["2024"]]) {
    for (const s of pool) if (s.class === className) for (const f of flatten(s)) srdKeys.add(`${f.level}|${f.name}`);
  }
  // The SRD subclass itself keeps its features: they are removed from the class list and added
  // back below from the subclass record, so the result is the same for Devotion and correct for
  // every other oath.
  const base = cls.features_by_level.filter((f) => !srdKeys.has(`${f.level}|${f.name}`));
  let extra = subclassFeatures(className, subclass, e);
  if (!extra.length && subclass) {
    // Picked but not modeled: say so once, at the level the class grants its subclass, rather than
    // showing nothing and leaving the player to wonder whether the pick registered.
    const at = cls.features_by_level.find((f) => /subclass|sacred oath|arcane tradition|archetype|domain|circle|college|patron|path|origin|tradition/i.test(f.name))?.level || 3;
    extra = [{ level: at, name: `${subclass} features`,
      desc: "This subclass's features are not in the app yet. The pick is saved and counts for party coverage." }];
  }
  const merged = [...base, ...extra].sort((a, b) => a.level - b.level);
  return { ...cls, features_by_level: merged };
}
