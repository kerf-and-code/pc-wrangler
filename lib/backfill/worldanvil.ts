// lib/backfill/worldanvil.ts
//
// World Anvil adapter. The Guild "Advanced Export" is a zip whose JSON half serializes the whole world:
// articles carrying a template (Person, Location, Organization, ...), a title, a body in World Anvil
// BBCode, and cross-article @mentions. That template maps cleanly onto our EntityKind, and the mentions
// are explicit relationships, so a JSON export is nearly as rich as an Obsidian vault.
//
// The exact JSON schema is undocumented and has drifted across export versions, so the reader is
// deliberately tolerant: it walks the object graph and treats any node that has a title/name AND a
// body-like field as an article, rather than assuming a fixed path. Free-tier users who can only
// browser-print to PDF never reach here; that input goes through the generic PDF text path instead.

import { EntityKind, NoteLink, SourceNote, kindFromHint } from "./types";
import { slugify } from "./markdown";

// Strip World Anvil BBCode to readable prose. Handles paired tags ([b]..[/b], [quote]..[/quote]),
// self-closing tags, @mentions (@[Shown](id) or @[id]), and [url:..] links. Mentions are unwrapped to
// their display text here; they are captured as links separately by extractWaLinks.
export function stripBBCode(input: string): string {
  let t = input || "";
  t = t.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, "$1");        // @[Shown](id) -> Shown
  t = t.replace(/@\[([^\]]+)\]/g, "$1");                    // @[id] -> id
  t = t.replace(/\[url:[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1"); // [url:..]text[/url]
  t = t.replace(/\[img:[^\]]*\]/gi, " ");                   // images
  t = t.replace(/\[\/?[a-z][a-z0-9]*(?:[:=][^\]]*)?\]/gi, ""); // any other [tag] / [/tag] / [tag:..]
  t = t.replace(/<[^>]+>/g, " ");                            // stray HTML from the html export
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

// Pull @mentions out of a BBCode body as relationship links to other articles.
function extractWaLinks(body: string): NoteLink[] {
  const out: NoteLink[] = [];
  const seen = new Set<string>();
  const re = /@\[([^\]]+)\](?:\(([^)]+)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const shown = m[1].trim();
    const id = (m[2] || m[1]).trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key)) continue;
    seen.add(key);
    out.push(m[2] ? { target: id, display: shown } : { target: id });
  }
  return out;
}

type Loose = Record<string, unknown>;

const TITLE_KEYS = ["title", "name"];
const BODY_KEYS = ["content", "body", "contentParsed", "fullContent", "description", "text", "vignette", "sidebarcontent"];
const TYPE_KEYS = ["templateType", "template", "entityClass", "category", "type"];
const ID_KEYS = ["id", "slug", "url", "ref"];

function firstString(o: Loose, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

// Recursively collect article-like nodes: any object with a title/name and some body field. Guards on
// depth and a visited set so a cyclic or huge export can't loop.
function collectArticles(root: unknown): Loose[] {
  const found: Loose[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach((x) => walk(x, depth + 1)); return; }
    const o = node as Loose;
    const hasTitle = firstString(o, TITLE_KEYS);
    const hasBody = firstString(o, BODY_KEYS);
    if (hasTitle && hasBody) found.push(o);
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

// Parse a World Anvil JSON export (already JSON.parsed) into notes. `raw` may be the world object or the
// whole export wrapper; we search either way.
export function parseWorldAnvilJson(root: unknown): SourceNote[] {
  const articles = collectArticles(root);
  const notes: SourceNote[] = [];
  const usedIds = new Set<string>();
  for (const a of articles) {
    const title = firstString(a, TITLE_KEYS) || "Untitled";
    const bodyRaw = firstString(a, BODY_KEYS) || "";
    const typeHint = firstString(a, TYPE_KEYS);
    const kind: EntityKind = kindFromHint(typeHint) || "lore";
    let id = slugify(firstString(a, ID_KEYS) || title);
    while (usedIds.has(id)) id += "-x";
    usedIds.add(id);
    notes.push({
      id,
      title,
      kind,
      kindConfidence: kindFromHint(typeHint) ? "structural" : "guessed",
      text: stripBBCode(bodyRaw),
      raw: bodyRaw,
      links: extractWaLinks(bodyRaw),
      tags: typeHint ? [typeHint.toLowerCase()] : [],
      frontmatter: typeHint ? { template: typeHint } : {},
      sourcePath: undefined,
    });
  }
  return notes;
}

// Detect whether a decoded text file is a World Anvil JSON export. Cheap sniff before we JSON.parse.
export function looksLikeWorldAnvilJson(name: string, text: string): boolean {
  if (!/\.json$/i.test(name) && !text.trimStart().startsWith("{") && !text.trimStart().startsWith("[")) return false;
  const head = text.slice(0, 4000).toLowerCase();
  return head.includes("worldanvil") || head.includes("templatetype") || (head.includes("\"world\"") && head.includes("\"articles\""));
}
