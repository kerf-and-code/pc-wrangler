// lib/dice.ts
//
// Parses dice notation and rolls it. Dependency-free, so it can be unit-tested directly.
//
// WHY THE RANDOMNESS IS DONE CAREFULLY
//   The obvious implementation is Math.floor(Math.random() * sides) + 1, and it is very nearly
//   fine. This uses crypto.getRandomValues with rejection sampling instead, for two reasons.
//
//   The first is modulo bias. Taking a 32-bit value mod 20 maps 2^32 outcomes onto 20 faces, and
//   2^32 is not divisible by 20, so the low faces come up fractionally more often. The effect is
//   tiny - about one part in 200 million - and completely invisible at a table. But it is a real
//   bias in a tool whose whole job is to be trusted, and rejecting the overhanging values costs
//   one comparison.
//
//   The second matters more: these rolls feed the encounter calibration loop. If the app is going
//   to tell a GM their Moderate fights land like Hard ones, the dice underneath that claim should
//   not have a thumb on the scale, however small.
//
// WHAT IT SUPPORTS
//   2d6+3   d20   4d6kh3 (keep highest 3)   2d20kl1 (keep lowest, i.e. disadvantage)
//   Advantage and disadvantage are expressed as kh/kl rather than a flag, so one code path handles
//   "roll with advantage" and "roll 4d6 drop lowest" without special cases.

export type DiceTerm = {
  count: number;
  sides: number;
  keep?: { mode: "h" | "l"; n: number };
};

export type ParsedDice = {
  terms: DiceTerm[];
  modifier: number;
  /** The notation as parsed back out, so a caller can show what it understood. */
  normalized: string;
};

export type RollResult = {
  total: number;
  /** Every die face rolled, in order, including ones dropped by a keep rule. */
  dice: { sides: number; value: number; kept: boolean }[];
  modifier: number;
  /** True when a single d20 was rolled and came up 20 or 1. Null when the roll is not a lone d20. */
  natural: 20 | 1 | null;
  notation: string;
};

const TERM = /([+-]?)\s*(\d*)d(\d+)(?:k([hl])(\d+))?/gi;
const FLAT = /([+-])\s*(\d+)(?!\s*d)/gi;

export class DiceError extends Error {}

/** Parse notation into terms and a flat modifier. Throws DiceError with a readable message. */
export function parseDice(input: string): ParsedDice {
  const src = (input || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!src) throw new DiceError("Type something like 2d6+3.");
  if (src.length > 60) throw new DiceError("That is longer than any roll needs to be.");
  if (!/^[0-9dkhl+-]+$/.test(src)) throw new DiceError("Use only numbers, d, k, h, l, + and -.");

  const terms: DiceTerm[] = [];

  TERM.lastIndex = 0;
  for (let m = TERM.exec(src); m; m = TERM.exec(src)) {
    const count = m[2] === "" ? 1 : Number(m[2]);
    const sides = Number(m[3]);

    // Caps are not arbitrary: they are where a typo stops being a roll. 200d20 is a mis-keyed 2d20,
    // and a d1000000 is someone testing what breaks.
    if (count < 1 || count > 100) throw new DiceError("Roll between 1 and 100 dice at a time.");
    if (sides < 2 || sides > 1000) throw new DiceError("Dice need between 2 and 1000 sides.");

    let keep: DiceTerm["keep"];
    if (m[4]) {
      const n = Number(m[5]);
      if (n < 1 || n > count) throw new DiceError(`Cannot keep ${n} of ${count} dice.`);
      keep = { mode: m[4] as "h" | "l", n };
    }
    terms.push({ count, sides, keep });
  }

  if (terms.length === 0) throw new DiceError("No dice in that. Try d20 or 2d6+3.");

  // Flat modifiers are whatever remains once the dice terms are blanked out. Blanking rather than
  // deleting matters: removing "2d6" from "2d6+3" would leave "+3", but removing it from "1d8-1"
  // would leave "-1" adjacent to nothing, and a naive scan of the original string would read the 6
  // in "2d6" as a +6.
  let leftover = src;
  TERM.lastIndex = 0;
  for (let m = TERM.exec(src); m; m = TERM.exec(src)) leftover = leftover.replace(m[0], "\u0000");
  TERM.lastIndex = 0;

  let modifier = 0;

  FLAT.lastIndex = 0;
  for (let m = FLAT.exec(leftover); m; m = FLAT.exec(leftover)) {
    modifier += m[1] === "-" ? -Number(m[2]) : Number(m[2]);
  }

  const normalized =
    terms.map((t, i) =>
      `${i > 0 ? "+" : ""}${t.count}d${t.sides}${t.keep ? `k${t.keep.mode}${t.keep.n}` : ""}`).join("")
    + (modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : "");

  return { terms, modifier, normalized };
}

/**
 * One uniform integer in [1, sides], with no modulo bias.
 *
 * Rejection sampling: draw 32 random bits, discard any value in the overhang above the largest
 * exact multiple of `sides`, and try again. Expected retries are well under one.
 */
function rollDie(sides: number): number {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  const buf = new Uint32Array(1);
  const rand: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;

  for (let guard = 0; guard < 64; guard++) {
    let v: number;
    if (rand?.getRandomValues) {
      rand.getRandomValues(buf);
      v = buf[0];
    } else {
      // Only where Web Crypto is unavailable. Still uniform enough to play with; the bias this
      // avoids is far smaller than the difference between two physical dice.
      v = Math.floor(Math.random() * 0x1_0000_0000);
    }
    if (v < limit) return (v % sides) + 1;
  }
  return (Date.now() % sides) + 1;   // unreachable in practice; never throw mid-roll
}

export function roll(input: string): RollResult {
  const parsed = parseDice(input);
  const dice: RollResult["dice"] = [];
  let total = parsed.modifier;

  for (const t of parsed.terms) {
    const faces = Array.from({ length: t.count }, () => rollDie(t.sides));

    let keptIdx: Set<number>;
    if (t.keep) {
      const order = faces
        .map((v, i) => ({ v, i }))
        .sort((a, b) => (t.keep!.mode === "h" ? b.v - a.v : a.v - b.v))
        .slice(0, t.keep.n)
        .map((x) => x.i);
      keptIdx = new Set(order);
    } else {
      keptIdx = new Set(faces.map((_, i) => i));
    }

    faces.forEach((v, i) => {
      const kept = keptIdx.has(i);
      dice.push({ sides: t.sides, value: v, kept });
      if (kept) total += v;
    });
  }

  // A "natural" only means anything when exactly one d20 counted. On 2d20kh1 that is the kept die,
  // which is what advantage means; on 3d20 it is meaningless and stays null.
  const keptD20 = dice.filter((d) => d.sides === 20 && d.kept);
  const natural = keptD20.length === 1
    ? (keptD20[0].value === 20 ? 20 : keptD20[0].value === 1 ? 1 : null)
    : null;

  return { total, dice, modifier: parsed.modifier, natural, notation: parsed.normalized };
}

/**
 * Apply advantage or disadvantage to an existing roll by rewriting its FIRST d20 term.
 *
 * Expressed as a transform rather than a flag on roll(), because advantage is not a property of the
 * roller, it is a property of the notation: "d20+7" with advantage IS "2d20kh1+7". Doing it this way
 * means the displayed notation always matches what was actually rolled, so a player watching over
 * the GM's shoulder can check the maths.
 *
 * Only the first d20 is touched, and only a d20. "2d6+4" with advantage is not a thing in 5e - there
 * is no die to have advantage on - so it comes back unchanged rather than silently doubling damage
 * dice, which would be a very expensive kind of helpful.
 */
export function applyAdvantage(notation: string, mode: "adv" | "dis" | "flat"): string {
  if (mode === "flat") return notation;
  const keep = mode === "adv" ? "kh1" : "kl1";
  let done = false;
  return notation.replace(/(\d*)d20(k[hl]\d+)?/i, (whole, count, existingKeep) => {
    if (done) return whole;
    // Already has a keep rule: leave it, the GM asked for something specific.
    if (existingKeep) return whole;
    const n = count === "" ? 1 : Number(count);
    if (n !== 1) return whole;   // 3d20 is not an advantage roll
    done = true;
    return `2d20${keep}`;
  });
}

/** True when this roll has a lone d20 in it, i.e. advantage means something. */
export function canHaveAdvantage(notation: string): boolean {
  try {
    return parseDice(notation).terms.some((t) => t.sides === 20 && t.count === 1 && !t.keep);
  } catch { return false; }
}

/** Add or replace the trailing flat modifier. Used by the roller's +/- control. */
export function withModifier(notation: string, mod: number): string {
  const base = notation.replace(/\s*[+-]\s*\d+\s*$/, "").trim();
  if (!mod) return base;
  return `${base}${mod > 0 ? "+" : "-"}${Math.abs(mod)}`;
}
