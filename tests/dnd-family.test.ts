import { describe, expect, it } from "vitest";
import { isDndFamilyBlock } from "@/lib/combat";
import { getModule } from "@/lib/systems/registry";

// Audit G2: Dark Matter is a 5e setting, so its stat blocks run in the D&D combat tools.
describe("D&D family stat blocks", () => {
  it("accepts D&D, Dark Matter and old blocks with no system", () => {
    for (const s of [null, undefined, "", "dnd5e", "darkmatter"]) expect([s, isDndFamilyBlock(s)]).toEqual([s, true]);
  });
  it("leaves other systems to their own tools", () => {
    for (const s of ["pf2e", "daggerheart", "drawsteel", "lancer", "coc7e"]) expect([s, isDndFamilyBlock(s)]).toEqual([s, false]);
  });
  it("registers Dark Matter under its own name", () => {
    expect(getModule("darkmatter").label).toBe("Dark Matter");
  });
});
