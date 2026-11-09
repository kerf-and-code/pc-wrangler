// tests/sight.test.ts: walls for movement (lib/tabletop/sight.ts moveStop over wallSegments). The
// server repeats this test in p122 (tabletop_wall_blocks), checked to agree on 4,596 random moves.
import { describe, expect, it } from "vitest";
import { moveStop, sightWallSegs, wallSegments } from "@/lib/tabletop/sight";
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
