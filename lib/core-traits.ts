// lib/core-traits.ts
//
// Parse the 2024 "core traits" table - what every character of a class starts with.
//
// WHAT IT LOOKS LIKE IN THE DATA
//   |Primary Ability|Dexterity|
//   |Skill Proficiencies|Choose 4: Acrobatics, Athletics, Deception, ... or Stealth|
//   |Starting Equipment|Choose A or B: (A) Leather Armor, 2 Daggers, ...; or (B) 100 GP|
//
//   A two-column markdown table, and the two rows that matter both state their own option list.
//   So the level 1 skill choice and the starting equipment choice are EXTRACTED for all twelve
//   classes rather than authored twelve times - which matters beyond effort, since an authored copy
//   drifts from the data the moment the fetch is rerun and drifts silently.
//
// WHY THIS EXISTED AS A GAP AT ALL
//   The 2024 SRD has no proficiency_choices field; it folds starting proficiencies into this one
//   table. The first version of the fetcher dropped the table as "not a feature you gain at a
//   level" - true, and unhelpful: it IS the level 1 grant. Without it no class handed out its own
//   skills, so a Rogue arrived at Expertise with nothing to be expert in.

export type CoreTraits = {
  primaryAbility?: string;
  hitDie?: string;
  savingThrows?: string;
  weapons?: string;
  tools?: string;
  armor?: string;
  /** "Choose 4: Acrobatics, Athletics, ... or Stealth" */
  skills?: { choose: number; options: string[] };
  /** "Choose A or B: (A) ...; or (B) 100 GP" */
  equipment?: { options: { label: string; items: string }[] };
};

const ROW_KEYS: Record<string, keyof CoreTraits> = {
  "primary ability": "primaryAbility",
  "hit point die": "hitDie",
  "saving throw proficiencies": "savingThrows",
  "weapon proficiencies": "weapons",
  "tool proficiencies": "tools",
  "armor training": "armor",
};

/** "Choose 4: A, B, C, or D" -> { choose: 4, options: [A, B, C, D] } */
export function parseChooseList(text: string): { choose: number; options: string[] } | undefined {
  const m = /choose\s+(\d+)\s*:\s*(.+)/i.exec(text || "");
  if (!m) return undefined;
  const choose = Number(m[1]);
  const options = m[2]
    .split(/,|\bor\b/i)
    .map((t) => t.trim().replace(/\.$/, ""))
    .filter((t) => t.length > 1 && t.length < 30);
  if (!options.length || !Number.isFinite(choose)) return undefined;
  return { choose, options };
}

/**
 * "Choose A or B: (A) Leather Armor, 2 Daggers; or (B) 100 GP"
 *
 * Split on the LABELS rather than on punctuation: the bundles themselves are comma-separated lists
 * containing semicolons, so any punctuation-based split cuts a bundle in half.
 */
export function parseEquipmentChoice(text: string): CoreTraits["equipment"] {
  if (!/choose\s+[a-z](\s+or\s+[a-z])+/i.test(text || "")) return undefined;
  const parts: { label: string; items: string }[] = [];
  const re = /\(([A-Z])\)\s*([^()]*?)(?=(?:;?\s*or\s*)?\([A-Z]\)|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const items = m[2].replace(/;?\s*or\s*$/i, "").replace(/[;,]\s*$/, "").trim();
    if (items) parts.push({ label: m[1], items });
  }
  return parts.length >= 2 ? { options: parts } : undefined;
}

export function parseCoreTraits(desc: string): CoreTraits {
  const out: CoreTraits = {};
  if (!desc) return out;

  for (const line of desc.split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim());
    // A markdown row is |a|b| so split gives ["", "a", "b", ""]; anything else is a separator or
    // stray prose and is skipped rather than guessed at.
    if (cells.length < 4) continue;
    const key = cells[1].toLowerCase();
    const value = cells[2];
    if (!key || !value || /^-+$/.test(value)) continue;

    if (key.startsWith("skill")) {
      out.skills = parseChooseList(value);
      continue;
    }
    if (key.startsWith("starting equipment")) {
      out.equipment = parseEquipmentChoice(value);
      continue;
    }
    const mapped = ROW_KEYS[key];
    if (mapped) (out as Record<string, unknown>)[mapped] = value;
  }
  return out;
}
