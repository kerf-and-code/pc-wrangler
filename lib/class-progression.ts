import { stripTableBleed } from "./strip-table-bleed";
// lib/class-progression.ts
//
// Reads a class's per-level features from the SRD class data and returns them grouped by level, so
// the Forge can show "what you get at each level" up to the character's current level.
//
// DATA NOTE: the 2024 class JSON was parsed from a PDF, and the FIRST feature entry of each class
// carries the class's progression TABLE mashed into its description (OCR bleed: "Fighter Features
// Level Proficiency Bonus ... 1 +2 Fighting Style ..."). Every other description is clean. We trim
// that table out by density (see lib/strip-table-bleed) rather than by a header string, so the view
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

// The OCR table dump is stripped by lib/strip-table-bleed, which finds it by DENSITY rather than by
// a literal header string. The old version here cut at " Features Level" - Fighter's and
// Barbarian's header - and checked against the real data that caught two classes out of twelve,
// leaving Druid, Bard, Cleric, Paladin and Wizard rendering their whole progression table as prose.
// It also truncated, which threw away the real rules text that follows the table on Druid.
function trimTableBleed(desc: string): string {
  return stripTableBleed(desc);
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

// The epic table shape this module reads (a subset of the engine's EpicTable). Passing the real
// DEFAULT_EPIC keeps the epic rows sourced from actual data, not invented numbers.
export type EpicInfo = {
  pbByLevel?: Record<number, number>;
  asiLevels?: number[];
  epicFeatLevels?: number[];
  abilityCap?: number;
};

// Published class tables stop at level 20; levels 21-30 are the Epic Legacy extension, which grants
// advancement through the epic framework (higher proficiency, ability increases, epic boons, a
// raised ability cap) rather than per-level class features. This builds progression rows for the
// epic tier from the real epic table so the panel shows what each epic level actually grants,
// instead of appearing empty past 20.
//
// Tiers follow Epic Legacy: 21-25 Epic, 26-29 Legendary, 30 the Finale. Only levels up to maxLevel
// are returned, and only when maxLevel > 20.
export function epicProgression(epic: EpicInfo | undefined, maxLevel: number): LevelGroup[] {
  if (!epic || maxLevel <= 20) return [];
  const asi = new Set(epic.asiLevels || []);
  const feats = new Set(epic.epicFeatLevels || []);
  const pb = epic.pbByLevel || {};
  const groups: LevelGroup[] = [];

  for (let level = 21; level <= Math.min(maxLevel, 30); level++) {
    const features: { name: string; desc: string }[] = [];

    // Tier openers.
    if (level === 21) features.push({
      name: "Epic tier",
      desc: `You cross into epic play. Your proficiency bonus, ability ceiling (now ${epic.abilityCap || 30}), and power scale beyond the mortal tiers.`,
    });
    if (level === 26) features.push({ name: "Legendary tier", desc: "Your deeds pass into legend; the world reshapes around your presence." });
    if (level === 30) features.push({ name: "Finale", desc: "The pinnacle of epic advancement, the capstone of a legendary career." });

    // Proficiency bonus increases (only note the level it changes).
    if (pb[level] && pb[level] !== pb[level - 1]) {
      features.push({ name: `Proficiency bonus +${pb[level]}`, desc: `Your proficiency bonus rises to +${pb[level]}.` });
    }
    if (asi.has(level)) features.push({ name: "Ability Score Improvement", desc: "Increase your ability scores or take a feat (chosen below)." });
    if (feats.has(level)) features.push({ name: "Epic Boon", desc: "You gain an Epic Boon of your choice (chosen below)." });

    if (features.length) groups.push({ level, features });
  }
  return groups;
}
