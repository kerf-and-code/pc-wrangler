// lib/codex-graph.ts (2026-11-11, push 33, audit P3: the campaign graph)
//
// The Codex's connections (entity_links: an entry or a character linked to another, with an optional
// relation such as "rules" or "owes money to") drawn as a graph. Used by the GM's Codex (Graph tab)
// and by the published codex (/c/[slug]/graph), which passes only what public_codex_links lets a
// stranger see. Pure: the data in, nodes, edges and a layout out, so it is tested on its own
// (tests/codex-graph.test.ts). components/codex-graph.tsx draws it.
//
// The layout is a plain force layout (linked items pull together, every item pushes every other
// away, a gentle pull to the middle keeps islands on screen), run a fixed number of steps from a
// starting ring that depends only on the ids, so the same campaign always draws the same picture.

export type GraphGroup = "location" | "faction" | "item" | "lore" | "note" | "npc" | "pc";
export type GraphNode = { id: string; kind: "entry" | "character"; group: GraphGroup; label: string; degree: number };
export type GraphEdge = { a: string; b: string; relation: string | null };
export type Placed = GraphNode & { x: number; y: number };

export const GROUPS: { key: GraphGroup; label: string; color: string }[] = [
  { key: "location", label: "Places", color: "#d9a43a" },
  { key: "npc", label: "NPCs", color: "#b49af0" },
  { key: "pc", label: "PCs", color: "#7cc49a" },
  { key: "faction", label: "Factions", color: "#e8907e" },
  { key: "item", label: "Items", color: "#9cc6e6" },
  { key: "lore", label: "Lore", color: "#cbbfa6" },
  { key: "note", label: "Notes", color: "#959daa" },
];
export const groupColor = (g: GraphGroup) => GROUPS.find((x) => x.key === g)?.color ?? "#959daa";

type EntryLike = { id: string; type: string; title: string | null; tags?: string[] | null };
type CharLike = { id: string; name: string; kind: string };
type LinkLike = { source_type: string; source_id: string; target_type: string; target_id: string; relation?: string | null };

/** An entry's group: its type, with lore split by the reserved faction and item tags. */
export function groupOfEntry(e: { type: string; tags?: string[] | null }): GraphGroup {
  const tags = e.tags || [];
  if (e.type === "location") return "location";
  if (e.type === "note") return "note";
  if (tags.includes("faction")) return "faction";
  if (tags.includes("item")) return "item";
  return "lore";
}

/** Nodes and edges from the Codex. Links to anything not given (an arc, a deleted entry) are left out;
 *  a pair linked more than once is one edge, keeping the first relation that has words. */
export function buildGraph(entries: EntryLike[], chars: CharLike[], links: LinkLike[], opts: { includeUnlinked?: boolean } = {}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const all = new Map<string, GraphNode>();
  for (const e of entries) all.set(`entry:${e.id}`, { id: e.id, kind: "entry", group: groupOfEntry(e), label: e.title || "Untitled", degree: 0 });
  for (const c of chars) all.set(`character:${c.id}`, { id: c.id, kind: "character", group: c.kind === "pc" ? "pc" : "npc", label: c.name || "Unnamed", degree: 0 });
  const edges = new Map<string, GraphEdge>();
  for (const l of links) {
    const a = all.get(`${l.source_type}:${l.source_id}`), b = all.get(`${l.target_type}:${l.target_id}`);
    if (!a || !b || a === b) continue;
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    const rel = (l.relation || "").trim() || null;
    const have = edges.get(key);
    if (have) { if (!have.relation && rel) have.relation = rel; continue; }
    edges.set(key, { a: a.id, b: b.id, relation: rel });
    a.degree++; b.degree++;
  }
  const nodes = [...all.values()].filter((n) => opts.includeUnlinked || n.degree > 0);
  return { nodes, edges: [...edges.values()] };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

/** Positions for every node inside width x height. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number, steps = 260): Placed[] {
  const n = nodes.length;
  if (!n) return [];
  const cx = width / 2, cy = height / 2;
  const k = Math.sqrt((width * height) / n) * 0.62;          // the ideal distance between items
  const ordered = [...nodes].sort((p, q) => (p.id < q.id ? -1 : 1));
  const idx = new Map(ordered.map((nd, i) => [nd.id, i]));
  const x = new Float64Array(n), y = new Float64Array(n);
  ordered.forEach((nd, i) => {
    const a = hash(nd.id) * Math.PI * 2, r = Math.min(width, height) * (0.25 + 0.2 * hash(nd.id + "r"));
    x[i] = cx + Math.cos(a) * r; y[i] = cy + Math.sin(a) * r;
  });
  const pairs = edges.map((e) => [idx.get(e.a), idx.get(e.b)]).filter((p): p is [number, number] => p[0] != null && p[1] != null);
  const dx = new Float64Array(n), dy = new Float64Array(n);
  // a big codex gets fewer steps, so the page stays quick (every step compares every pair)
  const runs = Math.max(40, Math.min(steps, Math.floor(30_000_000 / (n * n))));
  let temp = Math.min(width, height) / 8;
  const cool = temp / (runs + 1);
  for (let s = 0; s < runs; s++) {
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let ddx = x[i] - x[j], ddy = y[i] - y[j];
      let d = Math.hypot(ddx, ddy);
      if (d < 0.01) { ddx = 0.01 * (i - j); ddy = 0.01; d = Math.hypot(ddx, ddy); }
      const f = (k * k) / d;
      dx[i] += (ddx / d) * f; dy[i] += (ddy / d) * f; dx[j] -= (ddx / d) * f; dy[j] -= (ddy / d) * f;
    }
    for (const [i, j] of pairs) {
      const ddx = x[i] - x[j], ddy = y[i] - y[j], d = Math.max(0.01, Math.hypot(ddx, ddy));
      const f = (d * d) / k;
      dx[i] -= (ddx / d) * f; dy[i] -= (ddy / d) * f; dx[j] += (ddx / d) * f; dy[j] += (ddy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i] += (cx - x[i]) * 0.05; dy[i] += (cy - y[i]) * 0.05;   // a gentle pull to the middle
      const d = Math.max(0.01, Math.hypot(dx[i], dy[i])), m = Math.min(d, temp);
      x[i] += (dx[i] / d) * m; y[i] += (dy[i] / d) * m;
      x[i] = Math.max(24, Math.min(width - 24, x[i])); y[i] = Math.max(24, Math.min(height - 24, y[i]));
    }
    temp = Math.max(0.5, temp - cool);
  }
  return ordered.map((nd, i) => ({ ...nd, x: x[i], y: y[i] }));
}

/** The ids linked to one node, for highlighting its neighbourhood. */
export function neighboursOf(id: string, edges: GraphEdge[]): Set<string> {
  const out = new Set<string>([id]);
  for (const e of edges) { if (e.a === id) out.add(e.b); else if (e.b === id) out.add(e.a); }
  return out;
}
