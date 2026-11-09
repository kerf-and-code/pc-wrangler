import { describe, expect, it } from "vitest";
import { IDENT, apply, axisAngle, mul, settleStep, solidFor, topFace, type M3 } from "@/lib/tabletop/dice3d";

// Phase 5z: the 3D dice are real solids, and settling always turns one face square to the viewer.
describe("dice solids", () => {
  const want: Record<number, [number, number]> = { 4: [4, 3], 6: [6, 4], 8: [8, 3], 10: [10, 4], 12: [12, 5], 20: [20, 3], 100: [10, 4] };
  for (const [sides, [faces, corners]] of Object.entries(want)) {
    it(`d${sides} has ${faces} faces of ${corners} corners`, () => {
      const s = solidFor(Number(sides));
      expect(s.faces.length).toBe(faces);
      expect(s.faces.every((f) => f.length === corners)).toBe(true);
      expect(Math.max(...s.verts.map((v) => Math.hypot(...v)))).toBeCloseTo(1, 9);
    });
  }
  it("an unusual die is drawn as a d20", () => { expect(solidFor(7).faces.length).toBe(20); });
});

describe("rotation", () => {
  it("axisAngle keeps lengths and turns a quarter", () => {
    const m = axisAngle([0, 0, 1], Math.PI / 2), v = apply(m, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 9); expect(v[1]).toBeCloseTo(1, 9);
    expect(Math.hypot(...apply(mul(m, axisAngle([1, 2, 3], 1.1)), [0.3, -0.4, 0.5]))).toBeCloseTo(Math.hypot(0.3, -0.4, 0.5), 9);
  });
  it("settling turns the top face to face the viewer exactly", () => {
    let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const sides of [4, 6, 8, 10, 12, 20]) for (let k = 0; k < 25; k++) {
      const s = solidFor(sides);
      let m: M3 = IDENT;
      for (let j = 0; j < 3; j++) m = mul(axisAngle([r() - 0.5, r() - 0.5, r() - 0.5], r() * 6.3), m);
      const before = topFace(s, m).face;
      m = settleStep(s, m, 1);
      const after = topFace(s, m);
      expect(after.face).toBe(before);
      expect(after.normal[2]).toBeCloseTo(1, 6);
    }
  });
});
