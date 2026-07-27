// lib/class-progression.ts
//
// Reads a class's per-level features from the SRD class data and returns them grouped by level, so
// the Forge can show "what you get at each level" up to the character's current level.
//
// DATA NOTE: the 2024 class JSON was parsed from a PDF, and the FIRST feature entry of each class
// carries the class's progression TABLE mashed into its description (OCR bleed: "Fighter Features
// Level Proficiency Bonus ... 1 +2 Fighting Style ..."). Every other description is clean. We trim
// that table tail at the reliable "<Class> Features Level" / " Features Level" marker so the view
// shows just the feature's own text.

export type ClassFeature = { level: number; name: string; desc: string };

export type ClassRecord = {
  name: string;
  hit_die?: string | number;
  primary_ability?: string;
  saving_throws?: string;
  features_by_level?: ClassFeature[];
};

// A level's worth of features.
export type LevelGroup = { level: number; features: { name: string; desc: string }[] };

// Trim the OCR table dump that bleeds into the first feature's description. The table always starts
// with "... Features Level Proficiency Bonus ...", so cut at " Features Level" if present.
function trimTableBleed(desc: string): string {
  if (!desc) return "";
  const idx = desc.indexOf(" Features Level");
  const cut = idx >= 0 ? desc.slice(0, idx) : desc;
  return cut.replace(/\s+/g, " ").trim();
}

// Standard 2024 ASI levels (plus the class-specific extras like Fighter's 6/14 are represented as
// their own "Ability Score Improvement" entries in the data, so those come through the features
// list directly; this list is what the picker will use, and the view flags them).
export const STANDARD_ASI_LEVELS = [4, 8, 12, 16, 19];

// Build the per-level progression for a class, up to and including maxLevel. Groups multiple
// features at the same level together and sorts ascending.
export function classProgression(cls: ClassRecord | undefined, maxLevel: number): LevelGroup[] {
  if (!cls?.features_by_level?.length) return [];
  const byLevel = new Map<number, { name: string; desc: string }[]>();
  for (const f of cls.features_by_level) {
    if (f.level > maxLevel) continue;
    const list = byLevel.get(f.level) || [];
    list.push({ name: f.name, desc: trimTableBleed(f.desc) });
    byLevel.set(f.level, list);
  }
  return [...byLevel.keys()]
    .sort((a, b) => a - b)
    .map((level) => ({ level, features: byLevel.get(level) as { name: string; desc: string }[] }));
}

// Is a given level an ability-score-improvement level for this class? True when the class has an
// explicit ASI feature at that level OR it's one of the standard ASI levels. Used by the view to
// mark ASI levels (and, later, by the picker to offer the ASI-or-feat choice).
export function isAsiLevel(cls: ClassRecord | undefined, level: number): boolean {
  if (STANDARD_ASI_LEVELS.includes(level)) return true;
  return !!cls?.features_by_level?.some(
    (f) => f.level === level && /ability score improvement/i.test(f.name),
  );
}

// The count of ASI/feat opportunities a class grants up to maxLevel, from its explicit ASI entries
// (deduped by level). Some martial classes get extra ASIs; this reads them from the data rather
// than assuming the standard five.
export function asiLevelsUpTo(cls: ClassRecord | undefined, maxLevel: number): number[] {
  const levels = new Set<number>();
  for (const l of STANDARD_ASI_LEVELS) if (l <= maxLevel) levels.add(l);
  cls?.features_by_level?.forEach((f) => {
    if (f.level <= maxLevel && /ability score improvement/i.test(f.name)) levels.add(f.level);
  });
  return [...levels].sort((a, b) => a - b);
}
