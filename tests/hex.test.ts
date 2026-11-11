import { describe, it, expect } from "vitest";
import { gridOf, offsetOf, ruleForGrid, snapHex, hexSteps, hexDeltaSteps, hexCorners, hexCentres } from "@/lib/tabletop/hex";
import { measure, snapTokenOn, snapPointOn } from "@/lib/tabletop/geometry";

const H = Math.sqrt(3) / 2;
const O = { x: 0, y: 0 };

describe("hex grid (push 33, P16)", () => {
  it("reads the scene's grid and offset safely", () => {
    expect(gridOf({ grid: "hex-flat" })).toBe("hex-flat");
    expect(gridOf({ grid: "triangles" })).toBe("square");
    expect(gridOf(null)).toBe("square");
    expect(offsetOf({ hexOffset: { x: 0.3, y: "x" } })).toEqual({ x: 0.3, y: 0 });
    expect(offsetOf({ hexOffset: { x: 99, y: -99 } })).toEqual({ x: 2, y: -2 });
    expect(ruleForGrid("hex-pointy")).toBe("hexp");
    expect(ruleForGrid("square")).toBeNull();
  });
  it("snaps to the nearest hex centre, wherever the lattice is slid", () => {
    expect(snapHex({ x: 0.1, y: 0.1 }, "hex-pointy", O)).toEqual({ x: 0, y: 0 });
    const p = snapHex({ x: 0.55, y: 0.8 }, "hex-pointy", O);
    expect(p.x).toBeCloseTo(0.5); expect(p.y).toBeCloseTo(H);
    const q = snapHex({ x: 1.32, y: 0.28 }, "hex-pointy", { x: 0.3, y: 0.3 });
    expect(q.x).toBeCloseTo(1.3); expect(q.y).toBeCloseTo(0.3);
    const f = snapHex({ x: 0.9, y: 0.4 }, "hex-flat", O);
    expect(f.x).toBeCloseTo(H); expect(f.y).toBeCloseTo(0.5);
  });
  it("counts hexes along the shortest path", () => {
    expect(hexDeltaSteps(1, 0, "hex-pointy")).toBe(1);
    expect(hexDeltaSteps(3, 0, "hex-pointy")).toBe(3);
    expect(hexDeltaSteps(0.5, H, "hex-pointy")).toBe(1);
    expect(hexDeltaSteps(2.5, 3 * H, "hex-pointy")).toBe(4);     // the same sum the server makes
    expect(hexDeltaSteps(0, 2, "hex-flat")).toBe(2);
    expect(hexDeltaSteps(H, 0.5, "hex-flat")).toBe(1);
    // translation does not matter for centre-to-centre moves
    const a = snapHex({ x: 3.2, y: 3.1 }, "hex-pointy", { x: 0.4, y: 0.2 }), b = snapHex({ x: 6.1, y: 5.9 }, "hex-pointy", { x: 0.4, y: 0.2 });
    expect(hexSteps(a, b, "hex-pointy")).toBe(hexSteps({ x: a.x - 0.4, y: a.y - 0.2 }, { x: b.x - 0.4, y: b.y - 0.2 }, "hex-pointy"));
  });
  it("measures a ruler path in hexes and feet", () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3.5, y: H }];
    expect(measure(pts, "hexp", 5)).toEqual({ squares: 4, feet: 20 });
    expect(measure([{ x: 0, y: 0 }, { x: 0, y: 3 }], "hexf", 1)).toEqual({ squares: 3, feet: 3 });
    expect(measure([{ x: 0.5, y: 0.5 }, { x: 3.5, y: 4.5 }], "five", 5)).toEqual({ squares: 4, feet: 20 });   // squares unchanged
  });
  it("snaps tokens and the ruler for the scene's grid", () => {
    expect(snapTokenOn({}, 2.3, 2.7, 1)).toEqual({ x: 2.5, y: 2.5 });
    expect(snapPointOn(null, { x: 2.3, y: 2.7 })).toEqual({ x: 2.5, y: 2.5 });
    const t = snapTokenOn({ grid: "hex-pointy" }, 1.05, 0.05, 2);
    expect(t.x).toBeCloseTo(1); expect(t.y).toBeCloseTo(0);
  });
  it("draws hexes one square across, covering the map", () => {
    const cs = hexCorners({ x: 0, y: 0 }, "hex-pointy");
    expect(cs).toHaveLength(6);
    const xs = cs.map((c) => c.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1);    // flat side to flat side
    const centres = hexCentres(4, "hex-pointy", O);
    // every point of the map is within a hex's reach of some centre
    for (const p of [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 2.2, y: 3.7 }, { x: 0, y: 4 }]) {
      expect(Math.min(...centres.map((c) => Math.hypot(c.x - p.x, c.y - p.y)))).toBeLessThan(0.6);
    }
  });
});
