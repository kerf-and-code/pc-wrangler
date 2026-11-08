// lib/play/features.ts (2026-11-07)
//
// Phase 5f: which part of a turn a class feature costs, read from its rules text, so features that
// spend no tracked pool (Cunning Action, Uncanny Dodge, a Magic action) still show in the Actions
// tab beside the ones that do. Pure functions, no React.
//
// Both books write the cost into the text in a fixed style: "as a Bonus Action", "take a Reaction",
// "as a Magic action". The first such phrase in the text decides; text with none of them (most
// passive features) costs nothing and stays on the Features tab only. Text that only forbids one
// ("you can't take Reactions") does not count, because the patterns need "as", "use", "take" or
// "with" before the cost, and a negation in front of it rules the match out.

export type FeatureCost = "action" | "bonus" | "reaction";

const PATTERNS: [FeatureCost, RegExp][] = [
  ["bonus", /\b(?:as|use|take|using|with|spend)\s+(?:a|an|your|one)\s+bonus action\b/i],
  ["reaction", /\b(?:as|use|take|using|with|spend)\s+(?:a|an|your|one)\s+reaction\b/i],
  ["action", /\b(?:as|use|take|using|with|spend)\s+(?:a|an|your|one)\s+(?:magic |utilize )?action\b/i],
];
const NEGATED = /\b(?:can(?:no|')t|cannot|can not|don't|doesn't|no)\b[^.]{0,20}$/i;

export function featureCost(desc: string | null | undefined): FeatureCost | null {
  const text = (desc ?? "").replace(/\s+/g, " ");
  let best: { cost: FeatureCost; at: number } | null = null;
  for (const [cost, re] of PATTERNS) {
    const g = new RegExp(re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) {
      if (NEGATED.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
      if (!best || m.index < best.at) best = { cost, at: m.index };
      break;
    }
  }
  return best?.cost ?? null;
}

// A one-line summary for an action row: the sentence that names the cost ("On your turn, you can
// take one of the following actions as a Bonus Action: Dash, Disengage, or Hide."), since the first
// sentence is often flavour; the first sentence when no cost phrase is found.
export function costSentence(desc: string | null | undefined, max = 180): string {
  const t = (desc ?? "").replace(/\s+/g, " ").trim();
  let at = -1;
  for (const [, re] of PATTERNS) { const m = re.exec(t); if (m && (at < 0 || m.index < at)) at = m.index; }
  const from = at < 0 ? 0 : Math.max(t.lastIndexOf(". ", at) + 1, 0);
  const rest = t.slice(from).trimStart();
  const end = rest.search(/[.!?](\s|$)/);
  const s = end > 0 ? rest.slice(0, end + 1) : rest;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
