// lib/backfill/markdown.ts
//
// Markdown / Obsidian adapter. Turns a set of markdown files into SourceNotes, mining the structure an
// Obsidian vault carries for free: YAML frontmatter (type / tags), [[wikilinks]] (explicit relationships),
// #tags, the H1 or filename as the canonical title, and the containing folder as a type hint. Prose is
// stripped of markup so the model sees clean text. No external dependencies (frontmatter is parsed by a
// small tolerant reader, good enough for the flat key/value/list that note apps emit).

import {
  EntityKind, NoteLink, SourceNote, SessionSegment, UploadedFile,
  kindFromHint,
} from "./types";

// --- frontmatter -----------------------------------------------------------

type Frontmatter = Record<string, string | string[]>;

// Split a leading --- ... --- block off the top of a markdown file. Tolerant: no block -> empty map and
// the whole string as body.
export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { frontmatter: {}, body: raw };
  const fm: Frontmatter = {};
  const lines = m[1].split(/\r?\n/);
  let pendingKey: string | null = null;
  for (const line of lines) {
    if (/^\s*-\s+/.test(line) && pendingKey) {
      // a YAML list item under the last key
      const val = line.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, "");
      const cur = fm[pendingKey];
      if (Array.isArray(cur)) cur.push(val);
      else fm[pendingKey] = [val];
      continue;
    }
    const kv = /^([A-Za-z0-9_.\- ]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    let val = kv[2].trim();
    pendingKey = key;
    if (val === "") { fm[key] = []; continue; } // list follows on next lines
    // inline list: [a, b, c]
    if (/^\[.*\]$/.test(val)) {
      fm[key] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      continue;
    }
    val = val.replace(/^["']|["']$/g, "");
    fm[key] = val;
  }
  return { frontmatter: fm, body: raw.slice(m[0].length) };
}

// --- links + tags ----------------------------------------------------------

// [[Target]] and [[Target|Shown]] and [[Target#heading]]. Ignores markdown image embeds ![[...]] targets
// for prose but still records the linked note.
export function extractWikilinks(body: string): NoteLink[] {
  const out: NoteLink[] = [];
  const seen = new Set<string>();
  const re = /!?\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const inner = m[1];
    const [rawTarget, display] = inner.split("|");
    const target = rawTarget.split("#")[0].trim();
    if (!target) continue;
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(display ? { target, display: display.trim() } : { target });
  }
  return out;
}

// #tag and #nested/tag, plus frontmatter tags/tag. Lowercased, deduped, leading # stripped.
export function extractTags(body: string, fm: Frontmatter): string[] {
  const tags = new Set<string>();
  for (const key of ["tags", "tag"]) {
    const v = fm[key];
    if (Array.isArray(v)) v.forEach((t) => tags.add(String(t).replace(/^#/, "").toLowerCase()));
    else if (typeof v === "string") v.split(/[,\s]+/).forEach((t) => t && tags.add(t.replace(/^#/, "").toLowerCase()));
  }
  // inline #tags, but not '#' inside code or headings. Cheap filter: require a letter after #.
  const re = /(^|\s)#([A-Za-z][\w\-/]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) tags.add(m[2].toLowerCase());
  return [...tags];
}

// --- clean text ------------------------------------------------------------

// Strip markdown to readable prose for the model: unwrap [[links]] and [md](url) to their text, drop
// images, code fences, headings markers, emphasis, blockquote/list markers, and Dataview `key:: value`
// inline fields (captured separately below). Collapses blank runs.
export function stripMarkdown(body: string): string {
  let t = body;
  t = t.replace(/```[\s\S]*?```/g, " ");            // fenced code
  t = t.replace(/`([^`]+)`/g, "$1");                 // inline code
  t = t.replace(/!\[\[[^\]]*\]\]/g, " ");            // embeds
  t = t.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, tgt, shown) => (shown || tgt)); // wikilinks
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");       // md images
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");     // md links
  t = t.replace(/^#{1,6}\s+/gm, "");                  // heading markers
  t = t.replace(/^\s*>+\s?/gm, "");                   // blockquotes
  t = t.replace(/^\s*[-*+]\s+/gm, "");               // bullet markers
  t = t.replace(/^\s*\d+\.\s+/gm, "");               // ordered markers
  t = t.replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1"); // emphasis
  t = t.replace(/^[A-Za-z0-9_.\- ]+::\s*.*$/gm, " "); // dataview inline fields
  t = t.replace(/\|/g, " ");                          // table pipes
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

// Dataview `key:: value` inline fields become extra frontmatter-like hints (type::, status::, etc.).
function extractDataview(body: string): Frontmatter {
  const fm: Frontmatter = {};
  const re = /^([A-Za-z0-9_.\- ]+)::\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const k = m[1].trim().toLowerCase();
    const v = m[2].trim();
    fm[k] = v;
  }
  return fm;
}

// --- title, kind, date -----------------------------------------------------

function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() || path;
  return file.replace(/\.(md|markdown|txt)$/i, "");
}

function titleFor(path: string, fm: Frontmatter, body: string): string {
  const fmTitle = fm["title"] || fm["name"] || fm["aliases"];
  if (typeof fmTitle === "string" && fmTitle.trim()) return fmTitle.trim();
  if (Array.isArray(fmTitle) && fmTitle[0]) return fmTitle[0];
  const h1 = /^#\s+(.+)$/m.exec(body);
  if (h1) return h1[1].trim();
  return baseName(path);
}

// Kind from the strongest available signal, in order: frontmatter type/category, dataview type,
// tags, then the folder the file sits in. Marked "structural" because every one of these is authored
// classification, not a content guess.
function kindFor(path: string, fm: Frontmatter, tags: string[]): { kind: EntityKind; structural: boolean } {
  const fmType = [fm["type"], fm["category"], fm["cssclass"], fm["template"]].find((x) => typeof x === "string") as string | undefined;
  let k = kindFromHint(fmType);
  if (!k) for (const t of tags) { k = kindFromHint(t); if (k) break; }
  if (!k) {
    const folders = path.split(/[\\/]/).slice(0, -1);
    for (const f of folders) { k = kindFromHint(f); if (k) break; }
  }
  return k ? { kind: k, structural: true } : { kind: "unknown", structural: false };
}

// Pull an ISO date and a "Session N" index out of a filename or frontmatter, for timeline placement.
const DATE_RE = /(\d{4})[-_./](\d{1,2})[-_./](\d{1,2})/;
const SESSION_RE = /session\s*[#-]?\s*(\d+)/i;

function sessionRefFor(path: string, fm: Frontmatter, title: string): SourceNote["session"] | undefined {
  const hay = `${baseName(path)} ${title} ${fm["date"] || ""} ${fm["session"] || ""}`;
  const dm = DATE_RE.exec(hay);
  const sm = SESSION_RE.exec(hay);
  let date: string | undefined;
  if (dm) {
    const [_, y, mo, d] = dm;
    date = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (!dm && !sm) return undefined;
  return {
    index: sm ? parseInt(sm[1], 10) : undefined,
    date,
    label: title,
  };
}

// --- main ------------------------------------------------------------------

// Parse markdown files into notes. `obsidian` only affects the reported format upstream; the parsing is
// identical (loose .md just tends to have less frontmatter and fewer links).
export function parseMarkdownFiles(files: UploadedFile[]): SourceNote[] {
  const notes: SourceNote[] = [];
  for (const f of files) {
    const { frontmatter, body } = parseFrontmatter(f.text);
    const dv = extractDataview(body);
    const fm = { ...frontmatter, ...dv };
    const title = titleFor(f.name, fm, body);
    const tags = extractTags(body, fm);
    const { kind, structural } = kindFor(f.name, fm, tags);
    const session = kind === "session" || SESSION_RE.test(f.name) || DATE_RE.test(f.name)
      ? sessionRefFor(f.name, fm, title)
      : undefined;
    notes.push({
      id: slugify(f.name || title),
      title,
      kind: session && kind === "unknown" ? "session" : kind,
      kindConfidence: structural ? "structural" : "guessed",
      text: stripMarkdown(body),
      raw: body,
      links: extractWikilinks(body),
      tags,
      frontmatter: fm,
      sourcePath: f.name,
      session,
    });
  }
  return notes;
}

// Build timeline segments from any notes that look like session logs (kind session or a parseable
// date/index). Ordered by index, then date, then discovery order. Non-session notes are left for entity
// extraction and are not forced onto the timeline.
export function sessionsFromNotes(notes: SourceNote[]): SessionSegment[] {
  const logs = notes.filter((n) => n.kind === "session" || n.session);
  logs.sort((a, b) => {
    const ai = a.session?.index, bi = b.session?.index;
    if (ai != null && bi != null && ai !== bi) return ai - bi;
    const ad = a.session?.date, bd = b.session?.date;
    if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
    if (ai != null && bi == null) return -1;
    if (bi != null && ai == null) return 1;
    return 0;
  });
  return logs.map((n, i) => ({
    index: i + 1,
    label: n.session?.label || n.title,
    date: n.session?.date,
    text: n.text,
    noteIds: [n.id],
  }));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note";
}
