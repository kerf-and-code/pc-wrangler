// lib/backfill/types.ts
//
// The normalized intermediate for campaign backfill ("upload your notes, we take care of the rest").
//
// Every supported input, an Obsidian vault, a World Anvil JSON export, a Word doc, a PDF, or pasted
// text, is parsed by a format adapter into the SAME shape below: a list of SourceNotes (each a candidate
// entity or a chunk of prose) plus optional SessionSegments (for the timeline). Extraction then runs on
// this pre-structured intermediate, which is why a linked Obsidian note yields a far better result than a
// wall of PDF text: the structure and the links are handed to the model as facts to confirm, not guessed.
//
// Nothing here knows about the Six Axes database. The EntityKind values are generic and are mapped to the
// real codex tables at the commit step, so this whole module is schema-agnostic and reusable.

// The coarse category a note looks like. Deliberately small and game-agnostic; the commit step maps these
// onto the actual codex entity tables (npcs, places, factions, threads, loot, characters, sessions).
export type EntityKind =
  | "npc"
  | "place"
  | "faction"
  | "thread"   // quest / plot thread / open question
  | "item"     // loot, artifact, notable object
  | "pc"       // a player character
  | "session"  // a session log / journal entry (feeds the timeline)
  | "event"    // a dated historical/timeline event
  | "lore"     // setting, history, religion, prose with no cleaner bucket
  | "unknown";

// Which upstream tool produced the input. Drives which adapter runs and how much structure we trust.
export type SourceFormat =
  | "obsidian"        // a vault: markdown files with [[links]], frontmatter, tags, folders
  | "markdown"        // loose markdown / .md with no vault structure
  | "worldanvil-json" // the Guild "Advanced Export" structured world JSON
  | "worldanvil-html" // the HTML half of that export, or printed article HTML
  | "docx"
  | "pdf"
  | "plaintext"       // .txt or pasted prose
  | "unknown";

// A link one note makes to another, by the target's title or external id. Obsidian [[wikilinks]] and
// World Anvil @mentions both land here; the commit step resolves them to real entity ids after dedupe.
export type NoteLink = {
  target: string;          // the referenced title or id, verbatim
  display?: string;        // alias shown in text, if different ([[Real|shown]])
};

// One unit of source material: usually one file / one article, sometimes one section.
export type SourceNote = {
  id: string;                          // stable within this import (slug of path or title)
  title: string;                       // canonical name (filename, H1, or article title)
  kind: EntityKind;                    // best structural guess; extraction may correct it
  kindConfidence: "structural" | "guessed"; // structural = from frontmatter/folder/template; guessed = heuristic
  text: string;                        // cleaned prose (markup stripped), ready for the model
  raw?: string;                        // original body, kept for audit / re-parse
  links: NoteLink[];                   // explicit references to other notes
  tags: string[];                      // #tags and frontmatter tags, lowercased, deduped
  frontmatter: Record<string, string | string[]>;
  sourcePath?: string;                 // original path inside the upload (folder gives context)
  session?: SessionRef;                // set when this note is (or belongs to) a session log
};

// Where a note sits on the campaign timeline, when we can tell.
export type SessionRef = {
  index?: number;   // "Session 12" -> 12, when present
  date?: string;    // ISO date if one was parseable, else undefined
  label?: string;   // human label ("Session 12 - The Sunken Vault", or a daily-note date)
};

// A contiguous session's worth of material, for building the timeline. In per-file mode one uploaded file
// is one segment; in one-pile mode we segment by in-text markers ("Session 4", date headings).
export type SessionSegment = {
  index: number;         // 1-based order along the timeline as we found it
  label: string;         // display label
  date?: string;         // ISO date if known
  text: string;          // the session's prose
  noteIds: string[];     // SourceNotes that belong to / were cut from this segment
};

// What an adapter returns, and what extraction consumes.
export type NormalizedImport = {
  format: SourceFormat;
  notes: SourceNote[];
  sessions: SessionSegment[];
  warnings: string[];      // e.g. "World Anvil PDF export detected; structure is limited"
  stats: {
    noteCount: number;
    linkCount: number;
    sessionCount: number;
    structuralKindCount: number; // notes whose kind came from real structure, not a guess
  };
};

// One decoded upload handed to the router. Binary formats (docx/pdf/zip) are decoded to text/files by the
// binary step BEFORE they reach here, so the text-normalization core stays dependency-free and testable.
export type UploadedFile = {
  name: string;            // original filename incl. relative path when from a vault/zip ("NPCs/Gnarl.md")
  text: string;            // decoded text content
  mime?: string;
};

// Build the stats block from finished notes + sessions. Kept here so every adapter reports consistently.
export function summarize(
  format: SourceFormat,
  notes: SourceNote[],
  sessions: SessionSegment[],
  warnings: string[] = [],
): NormalizedImport {
  let linkCount = 0;
  let structuralKindCount = 0;
  for (const n of notes) {
    linkCount += n.links.length;
    if (n.kindConfidence === "structural") structuralKindCount += 1;
  }
  return {
    format,
    notes,
    sessions,
    warnings,
    stats: {
      noteCount: notes.length,
      linkCount,
      sessionCount: sessions.length,
      structuralKindCount,
    },
  };
}

// Map a free-text type hint (a frontmatter `type:`, a tag, a folder name, a World Anvil template) to an
// EntityKind. One place so Obsidian and World Anvil classify the same way. Returns null if nothing matches
// so the caller can fall back to a content heuristic or leave it "unknown".
export function kindFromHint(hint: string | undefined | null): EntityKind | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  const has = (...xs: string[]) => xs.some((x) => h.includes(x));
  if (has("npc", "person", "character-npc", "personality", "villain", "ally", "contact")) return "npc";
  if (has("pc", "player character", "playercharacter", "hero", "party member")) return "pc";
  if (has("location", "place", "settlement", "geography", "region", "landmark", "building", "dungeon", "city", "town")) return "place";
  if (has("faction", "organization", "organisation", "guild", "order", "cult", "house", "company", "ethnicity")) return "faction";
  if (has("quest", "thread", "plot", "mission", "objective", "hook", "mystery")) return "thread";
  if (has("item", "loot", "artifact", "artefact", "treasure", "equipment", "weapon", "relic", "technology")) return "item";
  if (has("session", "journal", "log", "recap", "adventure log", "chronicle")) return "session";
  if (has("event", "timeline", "history-event", "historical")) return "event";
  if (has("lore", "history", "religion", "myth", "legend", "document", "law", "language", "setting")) return "lore";
  return null;
}
