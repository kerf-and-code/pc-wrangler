// tests/uvtt.test.ts: reading a Universal VTT map (lib/tabletop/uvtt.ts) into walls and grid doors.
import { describe, expect, it } from "vitest";
import { buildImport, describeImport, doorEdges, readUvtt, simplify, type Uvtt } from "@/lib/tabletop/uvtt";

// a 10 by 8 square room drawn from origin (2, 3): walls round the edge with a door gap on the top wall
// between x 4 and 5 (map squares), a door in that gap, a window, a pillar and two lights
const file = {
  format: 0.3,
  resolution: { map_origin: { x: 2, y: 3 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 70 },
  line_of_sight: [
    [{ x: 6, y: 4 }, { x: 3, y: 4 }, { x: 3, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 4 }, { x: 7, y: 4 }],
  ],
  objects_line_of_sight: [[{ x: 8, y: 7 }, { x: 9, y: 7 }, { x: 9, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 7 }]],
  portals: [
    { position: { x: 6.5, y: 4 }, bounds: [{ x: 6, y: 4 }, { x: 7, y: 4 }], rotation: 0, closed: true, freestanding: false },
    { position: { x: 11, y: 7 }, bounds: [{ x: 11, y: 6.5 }, { x: 11, y: 7.5 }], rotation: 1.57, closed: false, freestanding: false },
    { position: { x: 5, y: 8 }, bounds: [{ x: 4.6, y: 7.6 }, { x: 5.4, y: 8.4 }], rotation: 0.78, closed: true, freestanding: true },
  ],
  lights: [{ position: { x: 5, y: 5 }, range: 4, intensity: 1, color: "ffffaa66", shadows: true }, { position: { x: 9, y: 9 }, range: 2, intensity: 1, color: "ff6688ff", shadows: true }],
  image: "",
};

const read = (): Uvtt => { const r = readUvtt(file); if (!r.ok) throw new Error(r.error); return r.map; };

describe("readUvtt", () => {
  it("reads the grid and shifts everything to the map's top-left corner", () => {
    const m = read();
    expect([m.ppg, m.cols, m.rows, m.lights]).toEqual([70, 10, 8, 2]);
    expect(m.walls[0][0]).toEqual({ x: 4, y: 1 });
    expect(m.portals[0]).toEqual({ a: { x: 4, y: 1 }, b: { x: 5, y: 1 }, closed: true });
  });
  it("refuses a file without a map size or square size", () => {
    expect(readUvtt({ line_of_sight: [] }).ok).toBe(false);
    expect(readUvtt({ resolution: { map_size: { x: 5, y: 5 } } }).ok).toBe(false);
  });
});

describe("simplify", () => {
  it("collapses a wobbly straight wall to its ends, and keeps real corners", () => {
    const wobbly = Array.from({ length: 50 }, (_, i) => ({ x: i * 0.1, y: (i % 2) * 0.01 }));
    expect(simplify(wobbly)).toHaveLength(2);
    expect(simplify([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }])).toHaveLength(3);
  });
});

describe("doorEdges", () => {
  it("puts a door on the grid edge it lies along", () => {
    expect(doorEdges({ a: { x: 4, y: 1 }, b: { x: 5, y: 1 }, closed: true }, 10)).toEqual(["14h"]);
    expect(doorEdges({ a: { x: 9, y: 3.05 }, b: { x: 9, y: 5 }, closed: true }, 10)).toEqual(["39v", "49v"]);
  });
  it("leaves a door at an angle or between lines off the grid", () => {
    expect(doorEdges({ a: { x: 2.6, y: 4.6 }, b: { x: 3.4, y: 5.4 }, closed: true }, 10)).toBeNull();
    expect(doorEdges({ a: { x: 2, y: 4.5 }, b: { x: 3, y: 4.5 }, closed: true }, 10)).toBeNull();
  });
});

describe("buildImport", () => {
  it("makes walls, a window, object barriers and one grid door, and reports the rest", () => {
    const r = buildImport(read(), 10);
    expect(r.sightWalls).toEqual([
      [4, 1, 1, 1], [1, 1, 1, 7], [1, 7, 9, 7], [9, 7, 9, 1], [9, 1, 5, 1],     // the room
      [9, 3.5, 9, 4.5, 1],                                                     // the window
      [6, 4, 7, 4, 1], [7, 4, 7, 5, 1], [7, 5, 6, 5, 1], [6, 5, 6, 4, 1],      // the pillar: feet, not eyes
    ]);
    expect(r.doors).toEqual({ "14h": "door" });
    expect(r.report).toMatchObject({ walls: 10, doors: 1, doorsLeftOpen: 1, windows: 1, objects: 1, objectsBlockSight: false, lights: 2, cut: 0 });
    expect(describeImport(r.report)).toMatch(/1 window, 1 object outline that stop movement but not sight\. Not brought in: 1 door off the grid lines/);
  });
  it("makes object outlines plain walls when they block sight", () => {
    const w = buildImport(read(), 10, { objects: true }).sightWalls;
    expect(w.slice(6).every((x) => x.length === 4)).toBe(true);
  });
  it("stops at the table's wall limit and says how many were cut", () => {
    const zig = Array.from({ length: 1000 }, (_, i) => ({ x: (i % 2) * 2 + 1, y: i * 0.01 + 1 }));
    const r = buildImport({ ...read(), walls: [zig] }, 20);
    expect(r.sightWalls.length).toBe(800);
    expect(r.report.cut).toBeGreaterThan(150);
    // the zigzag (at most 999 pieces) plus the file's window and the pillar's four sides
    expect(r.report.walls + r.report.cut).toBeLessThanOrEqual(999 + 5);
  });
});
