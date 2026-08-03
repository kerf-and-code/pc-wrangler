// lib/spoken-rolls.ts
//
// Finds dice rolls in what people SAID, for tables that roll physical dice.
//
// WHY THIS EXISTS
//   Mechanical capture is the thing audio-only competitors structurally cannot do: we know what was
//   rolled, not just what was discussed. But it arrives through Beyond20, which means it only
//   reaches tables playing online through D&D Beyond. In-person tables roll real dice, so the
//   differentiator would not reach the market in-person capture opens up. The numbers are already
//   in the transcript: "I got a 22 on perception" is sitting in transcript_segments right now.
//
// PRECISION OVER RECALL, DELIBERATELY
//   A missed roll costs nothing: the recap and the analytics simply do not know about it, which is
//   the status quo. A FALSE roll is expensive: it enters vtt_events, shows up in Mechanics as a
//   fact, and skews the encounter-calibration loop that the whole feature is meant to feed. So this
//   requires explicit roll LANGUAGE and refuses to guess from a bare number. "Twenty gold pieces"
//   and "he has 14 hit points" contain numbers and are not rolls.
//
//   Everything it produces is marked low fidelity and source "spoken", so nothing downstream ever
//   mistakes it for a Beyond20 reading.
//
// Dependency-free on purpose: no imports means it can be unit-tested directly rather than only
// through a running app.

export type SpokenRoll = {
  /** The face value as spoken. Null when a check is clearly announced but no number follows. */
  total: number | null;
  /** "attack" | "save" | "check" | "damage" | "unknown" */
  kind: RollKind;
  /** The skill or ability named, lower case, when one was. */
  subject: string | null;
  /** True for an announced natural 20 or natural 1. */
  natural: boolean | null;
  /** The phrase that triggered the match, for the GM to sanity-check against. */
  evidence: string;
  /** How much to trust it. Nothing here is ever "high": that is reserved for Beyond20. */
  confidence: "medium" | "low";
};

export type RollKind = "attack" | "save" | "check" | "damage" | "unknown";

// Skills and abilities worth recognising by name. A number attached to one of these is far more
// likely to be a roll than a number attached to anything else in the sentence.
const SUBJECTS = [
  "acrobatics", "animal handling", "arcana", "athletics", "deception", "history", "insight",
  "intimidation", "investigation", "medicine", "nature", "perception", "performance",
  "persuasion", "religion", "sleight of hand", "stealth", "survival",
  "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
  "initiative", "death", "concentration",
];

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, "twenty-one": 21, "twenty-two": 22, "twenty-three": 23,
  "twenty-four": 24, "twenty-five": 25, "twenty-six": 26, "twenty-seven": 27, "twenty-eight": 28,
  "twenty-nine": 29, thirty: 30,
};

// Nouns that turn a number into something other than a roll. Deepgram writes numerals, so the
// giveaway is what FOLLOWS them.
const NOT_A_ROLL_AFTER = new RegExp(
  "^\\s*(gold|gp|silver|sp|copper|cp|platinum|feet|foot|ft|miles?|minutes?|hours?|days?|weeks?|" +
  "years?|rounds?|people|goblins?|orcs?|arrows?|potions?|copies|level|levels|hit\\s*points?|hp|" +
  "temporary|percent|%)\\b",
  "i",
);

const NUM = "(\\d{1,3}|" + Object.keys(NUM_WORDS).join("|") + ")";

function toNumber(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return NUM_WORDS[t] ?? null;
}

function subjectIn(text: string): string | null {
  const t = text.toLowerCase();
  // Longest first, so "sleight of hand" wins over nothing and "animal handling" is not missed.
  for (const s of [...SUBJECTS].sort((a, b) => b.length - a.length)) {
    if (t.includes(s)) return s;
  }
  return null;
}

type Pattern = { re: RegExp; kind: RollKind; conf: "medium" | "low"; natural?: boolean };

// Ordered: the first match wins, so put the least ambiguous first.
const PATTERNS: Pattern[] = [
  // "natural 20", "nat 1" - unambiguous, and the moment most worth catching for a recap.
  { re: new RegExp("\\bnat(?:ural)?\\s+" + NUM + "\\b", "i"), kind: "attack", conf: "medium", natural: true },
  // "22 to hit", "that's a 17 to hit"
  { re: new RegExp("\\b" + NUM + "\\s+to\\s+hit\\b", "i"), kind: "attack", conf: "medium" },
  // "I rolled a 14", "rolled an 18"
  { re: new RegExp("\\broll(?:ed|s|ing)?\\s+(?:a|an|the)?\\s*" + NUM + "\\b", "i"), kind: "unknown", conf: "medium" },
  // "17 on my perception check", "14 for stealth"
  { re: new RegExp("\\b" + NUM + "\\s+(?:on|for)\\s+(?:my|the|a|an)?\\s*[a-z' ]{0,24}\\b(?:check|save|saving\\s+throw|roll)\\b", "i"), kind: "check", conf: "medium" },
  // "perception is 17", "my stealth check is a 22"
  { re: new RegExp("\\b(?:check|save|saving\\s+throw)\\b[^.?!]{0,20}?\\bis\\s+(?:a|an)?\\s*" + NUM + "\\b", "i"), kind: "check", conf: "medium" },
  // "12 points of damage", "for 9 damage"
  { re: new RegExp("\\b" + NUM + "\\s+(?:points?\\s+of\\s+)?damage\\b", "i"), kind: "damage", conf: "medium" },
  // "I got a 22" - real, but "got" is doing a lot of work, so it is the weakest one kept.
  { re: new RegExp("\\bgot\\s+(?:a|an)\\s+" + NUM + "\\b", "i"), kind: "unknown", conf: "low" },
];

/**
 * Find rolls in one utterance. Usually returns zero or one; a sentence can legitimately carry two
 * ("18 to hit for 7 damage"), which is why it returns an array.
 */
export function detectSpokenRolls(text: string): SpokenRoll[] {
  if (!text || text.length > 600) return [];   // a 600-char "utterance" is a monologue, not a roll
  const out: SpokenRoll[] = [];
  const seen = new Set<string>();

  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;

    const total = toNumber(m[1] ?? "");
    if (total === null) continue;

    // A number followed by a unit is a quantity, not a roll. This is the single most effective
    // rejection: "20 gold", "30 feet", "14 hit points" all otherwise look like plausible d20s.
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (NOT_A_ROLL_AFTER.test(after)) continue;

    // A d20 result cannot exceed the low 40s even with heavy modifiers, and damage rarely does at
    // the tables this serves. Beyond that it is a price, a distance or a hit-point pool.
    if (p.kind !== "damage" && total > 45) continue;
    if (total > 200) continue;

    // Dedupe on the NUMBER, not on kind+number. Two patterns routinely match one utterance from
    // different angles - "I got a 17 on my perception check" trips both the check pattern and the
    // looser "got a" one - and keying on kind let both through, writing one roll twice. Patterns
    // are ordered most-specific first, so the first match for a given total is the better read.
    // The cost is losing a genuine "I rolled a 17 and another 17", which is rare and cheaper than
    // doubling every checked roll.
    const key = String(total);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      total,
      kind: p.kind,
      subject: subjectIn(text),
      natural: p.natural ? total === 20 || total === 1 : null,
      evidence: m[0].trim(),
      confidence: p.conf,
    });
  }
  return out;
}

/** Convenience: is this utterance worth writing to vtt_events at all. */
export function hasSpokenRoll(text: string): boolean {
  return detectSpokenRolls(text).length > 0;
}
