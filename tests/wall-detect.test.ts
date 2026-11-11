import { describe, it, expect } from "vitest";
import { detectWalls, otsu, withoutExisting } from "@/lib/tabletop/wall-detect";

// A made-up map: n x n squares of S pixels, light floor, painted with dark lines and blocks.
function canvas(n: number, S: number, floor = 0.8) {
  const W = n * S, lum = new Float32Array(W * W).fill(floor);
  const rect = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) lum[y * W + x] = v;
  };
  return { lum, rect, W };
}

describe("otsu", () => {
  it("splits two groups between them", () => {
    const t = otsu([0.1, 0.12, 0.15, 0.8, 0.82, 0.85, 0.9]);
    expect(t).toBeGreaterThan(0.15);
    expect(t).toBeLessThan(0.8);
  });
});

describe("detectWalls (push 32, P8)", () => {
  it("finds a dark line drawn along a grid line, as one wall", () => {
    const n = 6, S = 10, { lum, rect } = canvas(n, S);
    rect(29, 10, 31, 50, 0.1);                // x = 3, from row 1 to row 5
    rect(0, 0, 10, 60, 0.05);                 // and a column of solid rock on the left
    const walls = detectWalls(lum, n, S, 0.5);
    expect(walls).toContainEqual([3, 1, 3, 5]);
    expect(walls).toContainEqual([1, 0, 1, 6]);  // the rock's edge, the whole height
    expect(walls).toHaveLength(2);
  });
  it("finds a room's outline drawn as a dark frame", () => {
    const n = 8, S = 10, { lum, rect } = canvas(n, S);
    // a room from (2,2) to (6,6): its four sides as 2 px lines
    rect(19, 19, 61, 21, 0.1); rect(19, 59, 61, 61, 0.1);
    rect(19, 19, 21, 61, 0.1); rect(59, 19, 61, 61, 0.1);
    const walls = detectWalls(lum, n, S, 0.5);
    expect(walls).toEqual(expect.arrayContaining([[2, 2, 2, 6], [6, 2, 6, 6], [2, 2, 6, 2], [2, 6, 6, 6]]));
    expect(walls).toHaveLength(4);
  });
  it("finds nothing on a plain or noisy-but-even floor, and nothing inside solid rock", () => {
    const n = 6, S = 10;
    expect(detectWalls(canvas(n, S).lum, n, S)).toEqual([]);
    const { lum } = canvas(n, S);
    for (let i = 0; i < lum.length; i++) lum[i] = 0.75 + ((i * 7919) % 13) / 200;
    expect(detectWalls(lum, n, S)).toEqual([]);
    const dark = canvas(n, S, 0.05);
    expect(detectWalls(dark.lum, n, S)).toEqual([]);
  });
  it("finds fainter lines only at higher sensitivity", () => {
    const n = 6, S = 10, { lum, rect } = canvas(n, S);
    rect(0, 0, 10, 60, 0.05);                  // something dark, so the map has a range
    rect(39, 0, 41, 60, 0.55);                 // a faint line at x = 4
    expect(detectWalls(lum, n, S, 0).some((w) => w[0] === 4 && w[2] === 4)).toBe(false);
    expect(detectWalls(lum, n, S, 1).some((w) => w[0] === 4 && w[2] === 4)).toBe(true);
  });
  it("ignores the faint grid lines most battle maps print, at the usual sensitivity", () => {
    const n = 8, S = 10, { lum, rect } = canvas(n, S);
    for (let k = 1; k < n; k++) { rect(k * S, 0, k * S + 1, n * S, 0.62); rect(0, k * S, n * S, k * S + 1, 0.62); }
    rect(0, 0, 10, 80, 0.05);                  // rock down the left
    rect(49, 10, 51, 70, 0.1);                 // and one real wall at x = 5
    const walls = detectWalls(lum, n, S, 0.5);
    expect(walls).toContainEqual([5, 1, 5, 7]);
    expect(walls).toContainEqual([1, 0, 1, 8]);
    expect(walls).toHaveLength(2);
  });
  it("refuses input that does not fit", () => {
    expect(detectWalls(new Float32Array(10), 6, 10)).toEqual([]);
    expect(detectWalls(new Float32Array(100), 1, 10)).toEqual([]);
  });
  it("drops proposals that repeat a wall already drawn, either way round", () => {
    expect(withoutExisting([[3, 1, 3, 5], [1, 0, 1, 6]], [[3, 5, 3, 1, 0]])).toEqual([[1, 0, 1, 6]]);
  });
});
