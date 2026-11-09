import { describe, expect, it } from "vitest";
import { floorError, onConnector } from "@/lib/tabletop/floors";

// Phase 6c: the stairs test mirrors tabletop_on_connector (p132).
describe("ways between floors", () => {
  const els = [{ k: "stairs", x: 2, y: 2, s: 1 }, { k: "chest", x: 6, y: 6, s: 1 }, { k: "trapdoor", x: 8, y: 1, s: 2 }];
  it("counts a token on stairs, ladders, trapdoors and pits only", () => {
    expect(onConnector(els, 2.5, 2.5)).toBe(true);
    expect(onConnector(els, 3.2, 2.5)).toBe(true);
    expect(onConnector(els, 3.3, 2.5)).toBe(false);
    expect(onConnector(els, 6.5, 6.5)).toBe(false);
    expect(onConnector(els, 9.5, 2.5)).toBe(true);
    expect(onConnector([{ k: "ladder", x: 0, y: 0 }], 0.5, 0.5)).toBe(true);
    expect(onConnector([], 0.5, 0.5)).toBe(false);
  });
  it("says what went wrong in the table's words", () => {
    expect(floorError("stand on stairs, a ladder, a trapdoor or a pit to change floor")).toMatch(/^Stand on stairs/);
    expect(floorError("that spot is solid rock on the other floor")).toMatch(/Move a little/);
    expect(floorError("something else")).toBe("something else");
  });
});
