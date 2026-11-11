import { describe, it, expect } from "vitest";
import { normalizeMaps, foeScene, groupByScene, sceneOfEntry, MAX_MAPS } from "@/lib/tabletop/encounter-maps";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTIVE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("encounter maps (push 31, V4)", () => {
  it("keeps scene ids in order, without repeats or junk, at most twelve", () => {
    expect(normalizeMaps([A, "nope", B, A, 3, null, C])).toEqual([A, B, C]);
    expect(normalizeMaps(null)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`);
    expect(normalizeMaps(many)).toHaveLength(MAX_MAPS);
  });
  it("starts a foe on its own map, or the first, or nowhere in particular", () => {
    expect(foeScene(B, [A, B])).toBe(B);
    expect(foeScene(C, [A, B])).toBe(A);       // a map taken off the encounter
    expect(foeScene(null, [A, B])).toBe(A);
    expect(foeScene(B, [])).toBeNull();          // no maps: the active scene, as before
  });
  it("groups tokens by their map, falling back to the active scene", () => {
    const list = [{ n: 1, sceneId: B }, { n: 2 }, { n: 3, sceneId: A }, { n: 4, sceneId: B }, { n: 5, sceneId: C }];
    const g = groupByScene(list, ACTIVE, [A, B, ACTIVE]);
    expect(g.map((x) => [x.sceneId, x.items.map((i) => i.n)])).toEqual([[B, [1, 4]], [ACTIVE, [2, 5]], [A, [3]]]);
  });
  it("finds where an entry is", () => {
    const tok = { t1: A, t2: B };
    const pc = { c1: [A, B], c2: [C] };
    expect(sceneOfEntry({ kind: "monster", tokenId: "t2" }, tok, pc, A)).toBe(B);
    expect(sceneOfEntry({ kind: "monster", tokenId: "gone" }, tok, pc, A)).toBeNull();
    expect(sceneOfEntry({ kind: "pc", characterId: "c1" }, tok, pc, B)).toBe(B);   // the map in view wins
    expect(sceneOfEntry({ kind: "pc", characterId: "c1" }, tok, pc, C)).toBe(A);
    expect(sceneOfEntry({ kind: "pc", characterId: "c2", tokenId: null }, tok, pc, null)).toBe(C);
    expect(sceneOfEntry({ kind: "pc", characterId: "none" }, tok, pc, A)).toBeNull();
  });
});
