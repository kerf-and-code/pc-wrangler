// lib/backfill/extract.ts
//
// Turns a NormalizedImport (from ingest.ts) into codex-ready EntityCandidates plus per-session recaps.
//
// The key move: a note that already carries a structural kind (an Obsidian note with `type: npc`, a World
// Anvil "Person" article) needs NO model call. Its title is the name, its type is the kind, its text is the
// body, its [[links]] are relationships. We map it straight through. The model is only spent on the two
// things structure cannot give us: pulling entities out of loose PROSE (a pasted doc, a PDF), and writing
// a short RECAP for each session segment on the timeline.
//
// The candidate kinds line up 1:1 with how the app already stores the codex (see app/api/lore-triage):
//   npc      -> characters(kind='npc')
//   location -> entries(type='location')
//   faction  -> entries(type='lore', tags=['faction'])
//   item     -> entries(type='lore', tags=['item'])
//   lore     -> entries(type='lore')
//   pc       -> characters(kind='pc')      (matched to a real player at commit, never auto-created blind)
// Commit (DB-touching) lives elsewhere; this module is pure and injectable so it can be unit-tested with
// no network.

import { EntityKind, NormalizedImport, SourceNote, SessionSegment } from "./types";

export type CandidateKind = "npc" | "location" | "faction" | "item" | "lore" | "pc";

export type EntityCandidate = {
  kind: CandidateKind;
  name: string;
  body: string;
  links: string[];          // names/ids this entity references
  confidence: number;       // 1.0 for structural, model-supplied for prose
  origin: "structural" | "prose";
  sourceNoteId?: string;
  sourcePath?: string;
};

export type SessionRecap = {
  index: number;
  label: string;
  date?: string;
  recap: string;
  entityNames: string[];    // entities the model saw appear this session (for timeline linking)
};

export type ExtractResult = {
  candidates: EntityCandidate[];
  recaps: SessionRecap[];
  warnings: string[];
  usedModel: boolean;
};

// The model interface: (system, userPrompt) => raw assistant text. Injectable so tests run offline and so
// the caller can swap transport. The default mirrors app/api/extract exactly (same endpoint, headers,
// model), so backfill and live extraction speak to the model the same way.
export type Complete = (system: string, prompt: string) => Promise<string>;

export const anthropicComplete: Complete = async (system, prompt) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Server is missing the extraction API key.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return ((data?.content || []) as { type?: string; text?: string }[])
    .filter((b) => b?.type === "text")
    .map((b) => b.text || "")
    .join("")
    .trim();
};

// Structural kind -> codex kind. `session`/`event`/`unknown` are not entities here (session feeds recaps;
// unknown prose goes to the model), so they return null.
function toCandidateKind(k: EntityKind): CandidateKind | null {
  switch (k) {
    case "npc": return "npc";
    case "place": return "location";
    case "faction": return "faction";
    case "item": return "item";
    case "pc": return "pc";
    case "lore": return "lore";
    default: return null; // session, event, unknown
  }
}

function structuralCandidate(n: SourceNote): EntityCandidate | null {
  const kind = toCandidateKind(n.kind);
  if (!kind) return null;
  const name = n.title.trim();
  if (!name) return null;
  return {
    kind,
    name,
    body: n.text.trim(),
    links: n.links.map((l) => l.target),
    confidence: 1,
    origin: "structural",
    sourceNoteId: n.id,
    sourcePath: n.sourcePath,
  };
}

// Strip a model response down to its JSON payload (handles ```json fences and stray prose), then parse.
// Returns [] on any failure, so a bad response degrades to "found nothing here" rather than throwing.
function parseJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return Array.isArray(v) ? v : [];
  } catch {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) { try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : []; } catch { /* fall through */ } }
    return [];
  }
}

const PROSE_KINDS = new Set<CandidateKind>(["npc", "location", "faction", "item", "lore"]);

const EXTRACT_SYSTEM =
  "You extract campaign wiki entities from tabletop RPG notes. You are precise and conservative: only "
  + "return an entity when the text clearly describes one. Prefer precision over recall. Never invent "
  + "facts not in the text. Output STRICT JSON only, no prose, no code fences.";

function extractPrompt(text: string): string {
  return `From the notes below, list the campaign entities worth filing in a wiki.

KINDS (use exactly one per entity):
  npc      a person/creature the party can meet (not a player character)
  location a place: settlement, region, landmark, dungeon, building
  faction  an organization, guild, cult, house, order
  item     a notable object, artifact, or piece of loot
  lore     setting, history, religion, event, or other reference with no cleaner kind

For each entity return an object:
{"kind": <one kind>, "name": <short proper name>, "body": <1-4 sentence description drawn only from the text>, "links": [<names of other entities it references>], "confidence": <0.0-1.0>}

Return a JSON array. Return [] if nothing here is a clear entity.

NOTES:
${text.slice(0, 12000)}`;
}

// One prose note -> candidates via the model. Coerces/validates each returned object.
async function extractProse(note: SourceNote, complete: Complete): Promise<EntityCandidate[]> {
  const text = note.text.trim();
  if (text.length < 40) return []; // too little to bother the model with
  const raw = parseJsonArray(await complete(EXTRACT_SYSTEM, extractPrompt(text)));
  const out: EntityCandidate[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const kind = String(r.kind || "").toLowerCase() as CandidateKind;
    const name = String(r.name || "").trim();
    if (!PROSE_KINDS.has(kind) || !name) continue;
    const links = Array.isArray(r.links) ? r.links.map((x) => String(x)).filter(Boolean) : [];
    const conf = typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.5;
    out.push({
      kind, name, body: String(r.body || "").trim(), links,
      confidence: conf, origin: "prose", sourceNoteId: note.id, sourcePath: note.sourcePath,
    });
  }
  return out;
}

const RECAP_SYSTEM =
  "You write a tight one-paragraph recap of a single tabletop RPG session from its notes, in past tense, "
  + "covering what the party did and what changed. No preamble. Then list the named entities that appear. "
  + "Output STRICT JSON only.";

function recapPrompt(seg: SessionSegment): string {
  return `Session: ${seg.label}${seg.date ? ` (${seg.date})` : ""}

Return {"recap": <one paragraph, past tense>, "entities": [<proper names that appear>]}

NOTES:
${seg.text.slice(0, 10000)}`;
}

async function recapOne(seg: SessionSegment, complete: Complete): Promise<SessionRecap> {
  const fallback: SessionRecap = { index: seg.index, label: seg.label, date: seg.date, recap: seg.text.slice(0, 600), entityNames: [] };
  if (seg.text.trim().length < 40) return fallback;
  try {
    const cleaned = (await complete(RECAP_SYSTEM, recapPrompt(seg))).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const obj = JSON.parse(cleaned) as { recap?: string; entities?: unknown[] };
    return {
      index: seg.index, label: seg.label, date: seg.date,
      recap: String(obj.recap || fallback.recap).trim(),
      entityNames: Array.isArray(obj.entities) ? obj.entities.map((x) => String(x)).filter(Boolean) : [],
    };
  } catch {
    return fallback;
  }
}

// Dedupe candidates within the import: same kind + case-insensitive name are merged, bodies concatenated,
// links unioned, highest confidence kept. (Dedupe against the EXISTING codex happens at commit, against
// the DB.) Structural candidates win their name over a prose duplicate.
function mergeCandidates(cands: EntityCandidate[]): EntityCandidate[] {
  const byKey = new Map<string, EntityCandidate>();
  for (const c of cands) {
    const key = `${c.kind}::${c.name.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...c, links: [...new Set(c.links)] }); continue; }
    const keepName = prev.origin === "structural" ? prev.name : c.name;
    const body = [prev.body, c.body].filter(Boolean).filter((b, i, a) => a.indexOf(b) === i).join("\n\n");
    byKey.set(key, {
      ...prev,
      name: keepName,
      body,
      links: [...new Set([...prev.links, ...c.links])],
      confidence: Math.max(prev.confidence, c.confidence),
      origin: prev.origin === "structural" || c.origin === "structural" ? "structural" : "prose",
    });
  }
  return [...byKey.values()];
}

export type ExtractOptions = {
  complete?: Complete;      // model transport; defaults to Anthropic
  buildRecaps?: boolean;    // write per-session recaps (needs the model). Default true when sessions exist.
  extractProse?: boolean;   // run the model over unstructured notes. Default true.
};

// Orchestrate. Structural notes map straight through (no model). Prose notes and recaps use the model when
// enabled. Everything is deduped before returning.
export async function extract(norm: NormalizedImport, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const complete = opts.complete ?? anthropicComplete;
  const doProse = opts.extractProse ?? true;
  const doRecaps = opts.buildRecaps ?? true;
  const warnings = [...norm.warnings];
  let usedModel = false;

  const structural: EntityCandidate[] = [];
  const proseNotes: SourceNote[] = [];
  for (const n of norm.notes) {
    const c = structuralCandidate(n);
    if (c) structural.push(c);
    else if (n.kind !== "session") proseNotes.push(n); // session notes feed recaps, not entity prose
  }

  const prose: EntityCandidate[] = [];
  if (doProse && proseNotes.length) {
    for (const n of proseNotes) {
      try { prose.push(...await extractProse(n, complete)); usedModel = true; }
      catch (e) { warnings.push(`Extraction failed for "${n.title}": ${e instanceof Error ? e.message : "error"}`); }
    }
  } else if (!doProse && proseNotes.length) {
    warnings.push(`${proseNotes.length} unstructured note(s) were not scanned for entities (prose extraction off).`);
  }

  const candidates = mergeCandidates([...structural, ...prose]);

  const recaps: SessionRecap[] = [];
  if (doRecaps && norm.sessions.length) {
    for (const s of norm.sessions) {
      recaps.push(await recapOne(s, complete));
      usedModel = true;
    }
  } else if (norm.sessions.length) {
    for (const s of norm.sessions) recaps.push({ index: s.index, label: s.label, date: s.date, recap: s.text.slice(0, 600), entityNames: [] });
  }

  return { candidates, recaps, warnings, usedModel };
}
