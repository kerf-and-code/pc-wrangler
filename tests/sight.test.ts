// tests/sight.test.ts: walls for movement (lib/tabletop/sight.ts moveStop over wallSegments). The
// server repeats this test in p122 (tabletop_wall_blocks), checked to agree on 4,596 random moves.
import { describe, expect, it } from "vitest";
import { forMove, forSight, moveStop, sightWallSegs, visibility, wallSegments } from "@/lib/tabletop/sight";
import { normSightWalls } from "@/lib/dungeon/battle";
import type { MapShape } from "@/lib/tabletop/fog";

// a 10 by 10 indoor map with one room painted at columns 1..4, rows 1..4
function room(doors: MapShape["doors"] = {}): MapShape {
  const n = 10, grid = Array.from({ length: n * n }, (_, i) => ((i % n) >= 1 && (i % n) <= 4 && Math.floor(i / n) >= 1 && Math.floor(i / n) <= 4 ? 1 : 0));
  return { n, grid, custom: {}, doors, outdoor: false, walls: [] };
}

describe("moveStop", () => {
  it("lets a move inside the room through", () => {
    expect(moveStop({ x: 1.5, y: 1.5 }, { x: 3.5, y: 2.5 }, wallSegments(room(), {})).blocked).toBe(false);
  });
  it("stops 0.2 squares short of the room's wall", () => {
    const s = moveStop({ x: 2.5, y: 2.5 }, { x: 7.5, y: 2.5 }, wallSegments(room(), {}));
    expect(s.blocked).toBe(true);
    expect(s.x).toBeCloseTo(4.8, 6);
    expect(s.y).toBeCloseTo(2.5, 6);
  });
  it("is blocked by a closed door and not by an open one or an archway", () => {
    const doors: MapShape["doors"] = { "25v": "door" };       // the room's east wall at row 2 (x = 5)
    const a = { x: 4.5, y: 2.5 }, b = { x: 5.5, y: 2.5 };
    expect(moveStop(a, b, wallSegments(room(doors), {})).blocked).toBe(true);
    expect(moveStop(a, b, wallSegments(room(doors), { "25v": true })).blocked).toBe(false);
    expect(moveStop(a, b, wallSegments(room({ "25v": "arch" }), {})).blocked).toBe(false);
  });
  it("is blocked by a sight wall drawn at an angle", () => {
    const segs = wallSegments(room(), {}, sightWallSegs([[6, 5, 9, 9]]));
    expect(moveStop({ x: 6.5, y: 8.5 }, { x: 8.5, y: 6.5 }, segs).blocked).toBe(true);
  });
  it("is blocked by the map's edge", () => {
    expect(moveStop({ x: 0.5, y: 6.5 }, { x: -1.5, y: 6.5 }, wallSegments(room(), {})).blocked).toBe(true);
  });
});

// phase 5v: wall types. One wall of each kind across an open 10 by 10 map, at x = 5 from y = 0 to 10.
describe("wall types", () => {
  const open = (): MapShape => ({ n: 10, grid: new Array(100).fill(0), custom: {}, doors: {}, outdoor: false, walls: [] });
  const segsOf = (k?: 1 | 2 | 3) => wallSegments(open(), {}, sightWallSegs([k ? [5, 0, 5, 10, k] : [5, 0, 5, 10]]));
  const left = { x: 2.5, y: 5.5 }, right = { x: 7.5, y: 5.5 };
  const sees = (segs: ReturnType<typeof segsOf>, from: typeof left) => {
    const poly = visibility(from, forSight(segs, from));
    return Math.max(...poly.map((p) => p.x)) > 6;           // the sight polygon reaches past the wall
  };
  const walks = (segs: ReturnType<typeof segsOf>) => !moveStop(left, right, forMove(segs)).blocked;

  it("a wall stops sight and feet", () => { expect([sees(segsOf(), left), walks(segsOf())]).toEqual([false, false]); });
  it("a window lets sight through and stops feet", () => { expect([sees(segsOf(1), left), walks(segsOf(1))]).toEqual([true, false]); });
  it("a screen stops sight and lets feet through", () => { expect([sees(segsOf(2), left), walks(segsOf(2))]).toEqual([false, true]); });
  it("a one-way wall is seen through from its front only, and stops feet", () => {
    // from (5,0) to (5,10) the normal (-dy, dx) points to -x: the front is the left side
    const segs = segsOf(3);
    expect(sees(segs, left)).toBe(true);
    const fromRight = visibility(right, forSight(segs, right));
    expect(Math.min(...fromRight.map((p) => p.x))).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(walks(segs)).toBe(false);
  });
  it("reads a stored kind and ignores a bad one", () => {
    expect(normSightWalls([[1, 1, 2, 2], [1, 1, 3, 3, 1], [1, 1, 4, 4, 9], [1, 1, 5, 5, 3]], 10)).toEqual([[1, 1, 2, 2], [1, 1, 3, 3, 1], [1, 1, 4, 4], [1, 1, 5, 5, 3]]);
  });
});
