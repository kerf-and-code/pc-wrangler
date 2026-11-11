// lib/ask.ts (2026-11-10, push 27, audit P1: ask the campaign)
//
// The pure half of "Ask the campaign": turning a GM's question into search terms, turning what the
// search found (p153 ask_campaign_search) into numbered excerpts for Claude, and reading the citations
// back out of the answer. No I/O here, so it is all unit tested (tests/ask.test.ts). The route is
// app/api/ask/route.ts and the page is app/gm/ask/page.tsx.
//
// Retrieval is full-text search, not embeddings (Terry, 2026-11-10): the question's words become
// prefix terms ORed together, ranked by Postgres. That misses pure paraphrase ("the dock boss" when
// the record says "harbourmaster"), which the page says plainly; embeddings can be added later if the
// misses show up in practice.

export type AskKind = "transcript" | "event" | "entry" | "character" | "recap";

/** One row from ask_campaign_search, numbered from 1 in the order Claude sees it. */
export type AskSource = {
  n: number;
  kind: AskKind;
  id: string;
  title: string | null;
  snippet: string | null;
  session_id: string | null;
  session_number: number | null;
  track_id: string | null;
  t_seconds: number | null;
};

export const ASK_MODEL = "claude-sonnet-4-6";
export const QUESTION_MAX = 500;

// Words that carry no search value. English only, because that is what most tables write in; for any
// other language the question's words all go through, which costs a little ranking quality and
// nothing else (the database drops terms that match nothing).
const STOP = new Set(
  (
    "a an and are as at be been but by can could did do does doing done for from had has have he her " +
    "here hers him his how i if in into is it its just me might my no not of on or our ours out over " +
    "she should so some than that the their theirs them then there these they this those to too up us " +
    "very was we were what whats when where which while who whom whose why will with would you your " +
    "yours about after again all any also back before being both each ever few get got last latest " +
    "more most much never next now only other own same say said tell told think know remember " +
    "happened happen happens time times thing things anything something everything someone anyone " +
    "session sessions campaign party players player character characters ago recently recent previous " +
    "previously yesterday lately week weeks night"
  ).split(/\s+/),
);

/** The question's search terms: words of 3 or more letters (or any word with a digit and 2 or more
 *  characters), minus stopwords, a trailing plural s trimmed so the prefix search finds both forms,
 *  de-duplicated, at most 12. */
export function extractTerms(question: string): string[] {
  const words = (question || "").toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) || [];
  const out: string[] = [];
  for (const raw of words) {
    let w = raw.replace(/['’]s$/u, "").replace(/['’]/gu, "");
    if (STOP.has(w)) continue;
    const hasDigit = /\p{N}/u.test(w);
    if (hasDigit ? w.length < 2 : w.length < 3) continue;
    if (/^\p{N}+$/u.test(w) && w.length < 3) continue;
    if (w.length > 4 && /ies$/.test(w)) w = w.slice(0, -3);
    else if (w.length > 4 && /[^s]s$/.test(w)) w = w.slice(0, -1);
    w = w.slice(0, 40);
    if (!out.includes(w)) out.push(w);
    if (out.length >= 12) break;
  }
  return out;
}

/** Whether the question is about the latest sessions ("what happened last time?"), so the latest
 *  recaps are worth including even without a keyword match. */
export function wantsRecent(question: string): boolean {
  return /\b(last|latest|recent|recently|previous|previously|yesterday|lately|so far|catch me up|recap)\b/i.test(question || "");
}

export const clock = (t: number | null | undefined): string => {
  if (t === null || t === undefined || !Number.isFinite(Number(t))) return "";
  const s = Math.max(0, Math.floor(Number(t)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

const sessionPart = (s: AskSource): string => (s.session_number !== null && s.session_number !== undefined ? `session ${s.session_number}` : "");

/** A short human label for a source, used in the prompt and on the page. */
export function sourceLabel(s: AskSource): string {
  const sess = sessionPart(s);
  const at = clock(s.t_seconds);
  switch (s.kind) {
    case "transcript":
      return ["Transcript", sess && (at ? `${sess} at ${at}` : sess), s.title ? `near ${s.title}` : ""].filter(Boolean).join(", ");
    case "event":
      return [s.title || "Story beat", sess].filter(Boolean).join(", ");
    case "entry":
      return `Codex: ${s.title || "entry"}`;
    case "character":
      return `Cast: ${s.title || "character"}`;
    case "recap":
      return `Recap of ${sess || s.title || "a session"}`;
  }
}

/** Numbers the search rows from 1 and keeps only well-formed ones. */
export function numberSources(rows: unknown[]): AskSource[] {
  const kinds: AskKind[] = ["transcript", "event", "entry", "character", "recap"];
  const out: AskSource[] = [];
  for (const r of rows || []) {
    const o = r as Record<string, unknown>;
    if (!o || typeof o.id !== "string" || !kinds.includes(o.kind as AskKind)) continue;
    const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
    out.push({
      n: out.length + 1,
      kind: o.kind as AskKind,
      id: o.id,
      title: str(o.title),
      snippet: str(o.snippet),
      session_id: str(o.session_id),
      session_number: num(o.session_number),
      track_id: str(o.track_id),
      t_seconds: num(o.t_seconds),
    });
  }
  return out;
}

export const ASK_SYSTEM = `You answer a game master's question about their own tabletop RPG campaign. You are given numbered excerpts from the campaign's record: transcripts of what was said at the table, story beats pulled from those transcripts, Codex entries and cast notes the GM wrote, and session recaps.

Rules:
- Use only the excerpts. Never invent a name, event, number or motive. If something is implied but not stated, say it is implied.
- Cite every claim with the excerpt's number in square brackets, like [3], or [2][5] when several support it. Put the citation right after the claim.
- Transcripts are automatic speech-to-text, so names can be misspelled and lines garbled, and players speak both in and out of character. Prefer the GM's own notes and the story beats when they disagree with a transcript, and mention the disagreement if it matters.
- Later sessions override earlier ones when facts changed; say so when that is the case.
- If the excerpts do not answer the question, say so plainly in one sentence, then say briefly what they do show, if anything useful.
- Be brief and direct: the answer first, in one to three short paragraphs or a short list. No headings, no preamble, no closing offer.
- Answer in the language the question is written in.
- Do not use em dashes or en dashes; use commas, colons or parentheses.`;

/** The user turn: the question and the numbered excerpts. */
export function buildAskPrompt(question: string, sources: AskSource[], campaignName?: string | null): string {
  const lines: string[] = [];
  if (campaignName) lines.push(`Campaign: ${campaignName}`, "");
  lines.push("Excerpts:", "");
  for (const s of sources) {
    lines.push(`[${s.n}] ${sourceLabel(s)}`);
    lines.push((s.snippet || "(no text)").trim());
    lines.push("");
  }
  lines.push(`Question: ${question.trim()}`);
  return lines.join("\n");
}

/** The source numbers an answer cites, in first-cited order, ignoring numbers that are not sources. */
export function citedNumbers(answer: string, count: number): number[] {
  const out: number[] = [];
  for (const m of (answer || "").matchAll(/\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g)) {
    for (const part of m[1].split(/[,;]/)) {
      const n = Number(part.trim());
      if (n >= 1 && n <= count && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/** Splits an answer into text and citation pieces for rendering. "[2, 4]" becomes two citations. */
export type AnswerPiece = { text: string } | { cite: number };
export function answerPieces(answer: string, count: number): AnswerPiece[] {
  const out: AnswerPiece[] = [];
  let last = 0;
  for (const m of (answer || "").matchAll(/\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g)) {
    const nums = m[1].split(/[,;]/).map((p) => Number(p.trim())).filter((n) => n >= 1 && n <= count);
    if (!nums.length) continue;
    if (m.index! > last) out.push({ text: answer.slice(last, m.index) });
    for (const n of nums) out.push({ cite: n });
    last = m.index! + m[0].length;
  }
  if (last < (answer || "").length) out.push({ text: answer.slice(last) });
  return out;
}

/** House style: no em or en dashes, whatever the model does. */
const DASHES = new RegExp(`\\s*[${String.fromCharCode(0x2013, 0x2014)}]\\s*`, "g");
export function tidyAnswer(s: string): string {
  return (s || "").replace(DASHES, ", ").replace(/,\s*,/g, ",").trim();
}
