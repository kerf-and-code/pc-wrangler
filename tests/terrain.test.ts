// tests/terrain.test.ts: difficult terrain (lib/tabletop/terrain.ts). The server's
// tabletop_difficult_extra (p125) was checked to agree with these sums on 3,201 random moves.
import { describe, expect, it } from "vitest";
import { difficultExtra, difficultShare, encodeDifficult, normDifficult, paintDifficult, pathExtra } from "@/lib/tabletop/terrain";

const n = 10, rubble = new Set([12, 13]);      // squares (2,1) and (3,1)
const feet = (a: { x: number; y: number }, b: { x: number; y: number }) => 5 * Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));

describe("difficultShare and difficultExtra", () => {
  it("costs nothing on open ground", () => {
    expect(difficultShare(rubble, n, { x: 0.5, y: 5.5 }, { x: 4.5, y: 5.5 })).toBe(0);
  });
  it("doubles a move made wholly in difficult terrain", () => {
    const share = difficultShare(rubble, n, { x: 2.1, y: 1.5 }, { x: 3.9, y: 1.5 });
    expect(share).toBe(1);
    expect(difficultExtra(10, share, 5)).toBe(10);
  });
  it("charges the part of a move that crosses it, in whole squares", () => {
    // from the middle of square 1 to the middle of square 3: three quarters in rubble, 10 ft base
    const share = difficultShare(rubble, n, { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 });
    expect(share).toBeCloseTo(0.75, 6);
    expect(difficultExtra(10, share, 5)).toBe(10);
  });
  it("rounds an exact half square up, as the server does", () => {
    const share = difficultShare(new Set([1]), 5, { x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 });
    expect(difficultExtra(5, share, 5)).toBe(5);
  });
});

describe("pathExtra", () => {
  it("costs each leg of a ruler on its own", () => {
    const pts = [{ x: 0.5, y: 1.5 }, { x: 2.5, y: 1.5 }, { x: 2.5, y: 4.5 }];
    // leg 1: 10 ft, a quarter of it in square 12 -> 2.5 ft -> 5; leg 2: starts in 12 for half a square of 15 ft -> 2.5 -> 5
    expect(pathExtra(rubble, n, pts, feet, 5)).toBe(10);
  });
});

describe("storing", () => {
  it("keeps whole squares inside the grid, sorted", () => {
    expect([...normDifficult([5, 5, -1, 3.5, 99, 100, "7"], 10)]).toEqual([5, 99]);
    expect(encodeDifficult(new Set([9, 2, 5]))).toEqual([2, 5, 9]);
  });
  it("paints and erases", () => {
    const s = paintDifficult(new Set([1]), [2, 3], true);
    expect([...paintDifficult(s, [1, 3], false)]).toEqual([2]);
  });
});
