// tests/elevation.test.ts: token height (lib/tabletop/elevation.ts) and the distance it makes.
import { describe, expect, it } from "vitest";
import { distance3d, elevationOf, elevationText } from "@/lib/tabletop/elevation";

describe("elevationOf", () => {
  it("reads whole feet and ignores anything else", () => {
    expect(elevationOf({ elevation: 30 })).toBe(30);
    expect(elevationOf({ elevation: -12.6 })).toBe(-13);
    expect(elevationOf({ elevation: "30" })).toBe(0);
    expect(elevationOf({ elevation: 1e9 })).toBe(9999);
    expect(elevationOf(null)).toBe(0);
  });
});

describe("distance3d", () => {
  it("is the flat distance when both are at one height", () => {
    expect(distance3d(25, 0, "five", 5)).toBe(25);
  });
  it("takes the longer leg under the usual 5e rule", () => {
    expect(distance3d(20, 30, "five", 5)).toBe(30);
    expect(distance3d(40, -15, "five", 5)).toBe(40);
  });
  it("adds half the shorter leg, in whole squares, under 5-10-5", () => {
    // 4 squares across, 3 up: 4 + floor(3 / 2) = 5 squares
    expect(distance3d(20, 15, "alternate", 5)).toBe(25);
  });
  it("uses the straight line when measuring exactly", () => {
    expect(distance3d(30, 40, "euclid", 5)).toBe(50);
  });
});

describe("elevationText", () => {
  it("says up, down, or nothing", () => {
    expect([elevationText(30), elevationText(-10), elevationText(0)]).toEqual(["30 ft up", "10 ft down", ""]);
  });
});
