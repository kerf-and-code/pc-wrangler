import { describe, expect, it } from "vitest";
import { parseDice, roll } from "@/lib/dice";

// Audit B7: a minus in front of a dice term subtracts it ("1d20-1d4" used to roll as "1d20+1d4").
describe("signed dice terms", () => {
  it("parses and writes back the sign", () => {
    expect(parseDice("1d20-1d4").normalized).toBe("1d20-1d4");
    expect(parseDice("1d20 - 1d4 + 2").normalized).toBe("1d20-1d4+2");
    expect(parseDice("-1d4+5").normalized).toBe("-1d4+5");
    expect(parseDice("2d6+1d4+3").normalized).toBe("2d6+1d4+3");
    expect(parseDice("4d6kh3").normalized).toBe("4d6kh3");
    expect(parseDice("1d8-1").normalized).toBe("1d8-1");
  });
  it("subtracts the minus term from the total", () => {
    for (let i = 0; i < 300; i++) {
      const r = roll("1d20-1d4");
      const d20 = r.dice.find((d) => d.sides === 20)!.value, d4 = r.dice.find((d) => d.sides === 4)!.value;
      expect(r.total).toBe(d20 - d4);
    }
    for (let i = 0; i < 100; i++) {
      const r = roll("2d6+3");
      expect(r.total).toBe(r.dice.reduce((a, d) => a + d.value, 0) + 3);
    }
  });
  it("keeps natural 20 detection on the d20", () => {
    for (let i = 0; i < 200; i++) {
      const r = roll("1d20-1d4");
      const d20 = r.dice.find((d) => d.sides === 20)!.value;
      expect(r.natural).toBe(d20 === 20 ? 20 : d20 === 1 ? 1 : null);
    }
  });
});
