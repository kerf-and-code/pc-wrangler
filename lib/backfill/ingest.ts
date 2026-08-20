// lib/backfill/ingest.ts
//
// The format router. Takes the decoded uploads (binary formats already turned into text/files upstream)
// and produces one NormalizedImport regardless of where the notes came from. This is the single entry the
// extraction step calls.
//
// Session handling supports the two modes the GM picks: one pile (entities only, no reliable timeline) or
// session-by-session (a timeline is built). In per-file mode each uploaded file is one session; otherwise
// we detect session logs by structure (Obsidian) or by in-text markers ("Session 4", date headings).

import {
  NormalizedImport, SessionSegment, SourceFormat, SourceNote, UploadedFile, summarize,
} from "./types";
import { parseMarkdownFiles, sessionsFromNotes, stripMarkdown, slugify } from "./markdown";
import { looksLikeWorldAnvilJson, parseWorldAnvilJson, stripBBCode } from "./worldanvil";

export type SessionMode = "auto" | "per-file" | "markers" | "none";
export type IngestOptions = { sessionMode?: SessionMode };

// Decide the format from the fileset. A vault export is many .md; a World Anvil export is a .json that
// sniffs positive; loose .md is markdown; everything else is plaintext.
export function detectFormat(files: UploadedFile[]): SourceFormat {
  if (files.some((f) => looksLikeWorldAnvilJson(f.name, f.text))) return "worldanvil-json";
  const md = files.filter((f) => /\.(md|markdown)$/i.test(f.name));
  if (md.length >= 2) return "obsidian";           // a folder of markdown = a vault
  if (md.length === 1) return "markdown";
  if (files.some((f) => /\.html?$/i.test(f.name) && /worldanvil/i.test(f.text.slice(0, 4000)))) return "worldanvil-html";
  return "plaintext";
}

// Split one blob into session segments by in-text markers: "Session 4", "Session 4:", a "## 2024-11-03"
// heading, or a bare date line. Text before the first marker is kept as a lead-in segment only if it has
// real content. Returns [] when no markers are found (caller falls back to one-pile).
export function segmentByMarkers(text: string): SessionSegment[] {
  const lines = text.split(/\r?\n/);
  const marker = /^\s*#{0,3}\s*(?:session\s*[#-]?\s*(\d+)\b[^\n]*|(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b[^\n]*)$/i;
  const cuts: { line: number; index?: number; date?: string; label: string }[] = [];
  lines.forEach((ln, i) => {
    const m = marker.exec(ln);
    if (m) {
      const date = m[2] ? normDate(m[2]) : undefined;
      cuts.push({ line: i, index: m[1] ? parseInt(m[1], 10) : undefined, date, label: ln.replace(/^\s*#+\s*/, "").trim() });
    }
  });
  if (cuts.length === 0) return [];
  const segs: SessionSegment[] = [];
  for (let c = 0; c < cuts.length; c++) {
    const start = cuts[c].line;
    const end = c + 1 < cuts.length ? cuts[c + 1].line : lines.length;
    const chunk = lines.slice(start + 1, end).join("\n");
    segs.push({
      index: c + 1,
      label: cuts[c].label || `Session ${cuts[c].index ?? c + 1}`,
      date: cuts[c].date,
      text: stripMarkdown(chunk),
      noteIds: [],
    });
  }
  return segs;
}

function normDate(s: string): string {
  const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (!m) return s;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

// One uploaded file -> one session segment, in upload order. For "I have a file per session".
function sessionsPerFile(files: UploadedFile[]): SessionSegment[] {
  return files.map((f, i) => ({
    index: i + 1,
    label: f.name.split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, "") || `Session ${i + 1}`,
    text: stripMarkdown(f.text),
    noteIds: [],
  }));
}

export function ingest(files: UploadedFile[], opts: IngestOptions = {}): NormalizedImport {
  const clean = files.filter((f) => f && typeof f.text === "string" && f.text.trim());
  if (clean.length === 0) return summarize("unknown", [], [], ["No readable text found in the upload."]);

  const format = detectFormat(clean);
  const warnings: string[] = [];
  const mode: SessionMode = opts.sessionMode ?? "auto";

  // --- World Anvil JSON -----------------------------------------------------
  if (format === "worldanvil-json") {
    const notes: SourceNote[] = [];
    for (const f of clean) {
      if (!looksLikeWorldAnvilJson(f.name, f.text)) continue;
      try {
        notes.push(...parseWorldAnvilJson(JSON.parse(f.text)));
      } catch {
        warnings.push(`Could not parse ${f.name} as World Anvil JSON; skipped.`);
      }
    }
    if (notes.length === 0) warnings.push("World Anvil export had no readable articles.");
    // World Anvil worlds are reference material, not session logs, so no timeline unless one is added later.
    return summarize(format, notes, [], warnings);
  }

  // --- World Anvil HTML / print (limited) -----------------------------------
  if (format === "worldanvil-html") {
    warnings.push("World Anvil HTML/print export detected; structure is limited, so entity types are guessed from content.");
    const notes = clean.map((f, i) => oneNote(f, i, stripBBCode(f.text)));
    return summarize(format, notes, mode === "per-file" ? sessionsPerFile(clean) : [], warnings);
  }

  // --- Markdown / Obsidian --------------------------------------------------
  if (format === "obsidian" || format === "markdown") {
    const notes = parseMarkdownFiles(clean);
    let sessions: SessionSegment[] = [];
    if (mode === "per-file") sessions = sessionsPerFile(clean);
    else if (mode === "none") sessions = [];
    else {
      sessions = sessionsFromNotes(notes);                 // structural (session folder / dated notes)
      if (sessions.length === 0 && clean.length === 1) sessions = segmentByMarkers(clean[0].text); // single note w/ markers
    }
    if (format === "markdown" && notes.every((n) => n.kindConfidence === "guessed")) {
      warnings.push("Loose markdown with no frontmatter or links; entity types are guessed from content.");
    }
    return summarize(format, notes, sessions, warnings);
  }

  // --- Plaintext / paste ----------------------------------------------------
  let sessions: SessionSegment[] = [];
  if (mode === "per-file") sessions = sessionsPerFile(clean);
  else if (mode !== "none") {
    // segment each file by markers; concatenate, renumbering
    for (const f of clean) sessions.push(...segmentByMarkers(f.text));
    sessions = sessions.map((s, i) => ({ ...s, index: i + 1 }));
  }
  // Every plaintext file is also kept as a whole note so entity extraction sees the full prose.
  const notes = clean.map((f, i) => oneNote(f, i, stripMarkdown(f.text)));
  if (sessions.length === 0 && mode !== "none") {
    warnings.push("No session markers found, so no timeline was built. Tell us where sessions break, or upload one file per session, to get a timeline.");
  }
  return summarize("plaintext", notes, sessions, warnings);
}

// A whole file as a single unknown-kind note, for entity extraction over free prose.
function oneNote(f: UploadedFile, i: number, text: string): SourceNote {
  const title = f.name.split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, "") || `Notes ${i + 1}`;
  return {
    id: slugify(f.name || title) + `-${i}`,
    title,
    kind: "unknown",
    kindConfidence: "guessed",
    text,
    raw: f.text,
    links: [],
    tags: [],
    frontmatter: {},
    sourcePath: f.name,
  };
}
