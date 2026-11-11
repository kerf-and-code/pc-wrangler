import { describe, it, expect } from "vitest";
import { buildGraph, layoutGraph, neighboursOf, groupOfEntry } from "@/lib/codex-graph";

const entries = [
  { id: "e1", type: "location", title: "Saltmere", tags: [] },
  { id: "e2", type: "lore", title: "The Tide Court", tags: ["faction"] },
  { id: "e3", type: "lore", title: "The Drowned Crown", tags: ["item"] },
  { id: "e4", type: "lore", title: "Old songs", tags: null },
  { id: "e5", type: "note", title: "Loose thought", tags: [] },
];
const chars = [{ id: "c1", name: "Quill", kind: "npc" }, { id: "c2", name: "Mira", kind: "pc" }];
const links = [
  { source_type: "character", source_id: "c1", target_type: "entry", target_id: "e1", relation: "runs the docks of" },
  { source_type: "entry", source_id: "e1", target_type: "character", target_id: "c1", relation: null },   // the same pair again
  { source_type: "character", source_id: "c1", target_type: "entry", target_id: "e2", relation: "" },
  { source_type: "character", source_id: "c2", target_type: "entry", target_id: "e3", relation: "carries" },
  { source_type: "arc", source_id: "a1", target_type: "entry", target_id: "e1", relation: null },            // not drawn
  { source_type: "entry", source_id: "gone", target_type: "entry", target_id: "e1", relation: null },        // deleted
];

describe("the campaign graph (push 33, P3)", () => {
  it("sorts entries into the Codex's kinds", () => {
    expect(entries.map(groupOfEntry)).toEqual(["location", "faction", "item", "lore", "note"]);
  });
  it("builds one edge per linked pair, skipping what it cannot draw", () => {
    const g = buildGraph(entries, chars, links);
    expect(g.edges).toHaveLength(3);
    expect(g.edges[0]).toEqual({ a: "c1", b: "e1", relation: "runs the docks of" });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["c1", "c2", "e1", "e2", "e3"]);
    expect(g.nodes.find((n) => n.id === "c1")?.degree).toBe(2);
    const all = buildGraph(entries, chars, links, { includeUnlinked: true });
    expect(all.nodes).toHaveLength(7);
    expect(all.nodes.find((n) => n.id === "e5")?.degree).toBe(0);
  });
  it("lays every item out inside the box, the same way every time, linked items closer", () => {
    const g = buildGraph(entries, chars, links, { includeUnlinked: true });
    const a = layoutGraph(g.nodes, g.edges, 1000, 640), b = layoutGraph(g.nodes, g.edges, 1000, 640);
    expect(a).toEqual(b);
    for (const p of a) { expect(p.x).toBeGreaterThanOrEqual(24); expect(p.x).toBeLessThanOrEqual(976); expect(p.y).toBeGreaterThanOrEqual(24); expect(p.y).toBeLessThanOrEqual(616); }
    const at = new Map(a.map((p) => [p.id, p]));
    const d = (x: string, y: string) => Math.hypot(at.get(x)!.x - at.get(y)!.x, at.get(x)!.y - at.get(y)!.y);
    expect(d("c1", "e1")).toBeLessThan(d("e5", "e4") + d("c1", "e5"));
    expect(layoutGraph([], [], 100, 100)).toEqual([]);
  });
  it("finds an item's neighbours", () => {
    const g = buildGraph(entries, chars, links);
    expect([...neighboursOf("c1", g.edges)].sort()).toEqual(["c1", "e1", "e2"]);
  });
});
