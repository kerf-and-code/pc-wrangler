// lib/compendium/match.ts
//
// The matching brain for the voice compendium. It takes a query string, from a typed search box OR
// from whatever Vosk recognized, and ranks the compendium entries. Pure TypeScript, no DOM and no
// framework, so it is reusable by the page and the voice handler and unit-testable in node.
//
// Why more than an exact lookup: Vosk output is lexicon-constrained but still noisy ("fire ball" for
// "fireball", "belt of giant strngth"), and a DM typing at speed makes the same slips. So matching is
// layered: exact phrase, prefix, substring, token overlap, then a bounded fuzzy pass, highest score
// wins. Every entry's `spoken` phrases plus its normalized name are candidate keys.

import type { CompendiumEntry } from "./types";

export interface RankedMatch {
  entry: CompendiumEntry;
  score: number;      // 0..1000, higher is better
  matched: string;    // the entry phrase that scored best (for debugging / "did you mean")
}

const norm = (s: string): string =>
  String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const tokens = (s: string): string[] => norm(s).split(" ").filter(Boolean);

// Bounded Levenshtein: returns the edit distance, capping work at `max` (returns max+1 past the band).
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array<number>(bl + 1);
  let cur = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1; // whole row past the band: give up early
    [prev, cur] = [cur, prev];
  }
  return prev[bl];
}

// Similarity 0..1 from edit distance, normalized by the longer string.
function ratio(a: string, b: string): number {
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  const d = editDistance(a, b, Math.ceil(longer * 0.4));
  return 1 - d / longer;
}

interface Candidate { phrase: string; tokens: Set<string>; entry: CompendiumEntry }

export class CompendiumMatcher {
  private candidates: Candidate[] = [];
  private exact = new Map<string, CompendiumEntry[]>();

  constructor(entries: CompendiumEntry[]) {
    for (const entry of entries) {
      const phrases = new Set<string>([norm(entry.name), ...entry.spoken.map(norm)]);
      for (const phrase of phrases) {
        if (!phrase) continue;
        this.candidates.push({ phrase, tokens: new Set(phrase.split(" ")), entry });
        const arr = this.exact.get(phrase);
        if (arr) { if (!arr.includes(entry)) arr.push(entry); } else this.exact.set(phrase, [entry]);
      }
    }
  }

  // Rank entries for a query. Returns up to `limit` distinct entries, best first.
  match(query: string, limit = 5): RankedMatch[] {
    const q = norm(query);
    if (!q) return [];
    const qTokens = new Set(tokens(q));
    const best = new Map<string, RankedMatch>(); // entry.id -> best match

    const consider = (entry: CompendiumEntry, score: number, phrase: string) => {
      const prev = best.get(entry.id);
      if (!prev || score > prev.score) best.set(entry.id, { entry, score, matched: phrase });
    };

    // 1. Exact phrase hit is unbeatable.
    for (const e of this.exact.get(q) ?? []) consider(e, 1000, q);

    // 2. Everything else, scored per candidate phrase.
    for (const c of this.candidates) {
      const p = c.phrase;
      if (p === q) { consider(c.entry, 1000, p); continue; }
      let score = 0;
      if (p.startsWith(q) || q.startsWith(p)) score = Math.max(score, 780);
      if (p.includes(q) || q.includes(p)) score = Math.max(score, 620);
      // token overlap (Jaccard) handles word-order and partials ("giant strength belt")
      if (qTokens.size && c.tokens.size) {
        let inter = 0;
        for (const t of qTokens) if (c.tokens.has(t)) inter++;
        if (inter) {
          const jac = inter / (qTokens.size + c.tokens.size - inter);
          score = Math.max(score, Math.round(300 + jac * 300));
        }
      }
      // bounded fuzzy for mishears / typos, only worth it when lengths are comparable
      if (score < 780 && Math.abs(p.length - q.length) <= Math.ceil(Math.max(p.length, q.length) * 0.4)) {
        const r = ratio(q, p);
        if (r >= 0.72) score = Math.max(score, Math.round(r * 720));
      }
      if (score > 0) consider(c.entry, score, p);
    }

    return [...best.values()]
      .sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length || a.entry.name.localeCompare(b.entry.name))
      .slice(0, limit);
  }
}

export { norm as normalizeQuery };
