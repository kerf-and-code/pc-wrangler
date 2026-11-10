import { describe, expect, it } from "vitest";
import { pickerSystem, rulesetForCampaign } from "@/lib/systems/ruleset";

// Push 5 (audit G7, U25).
describe("rulesetForCampaign", () => {
  it("only 2014 means the 2014 rules", () => {
    expect(rulesetForCampaign("2014")).toBe("2014");
    for (const s of ["5e", "5.5e", "dnd5e", "darkmatter", null, undefined, ""]) expect([s, rulesetForCampaign(s)]).toEqual([s, "2024"]);
  });
});
describe("pickerSystem", () => {
  it("shows the old 5.5e label as the 2024 entry and keeps everything else", () => {
    expect(pickerSystem("5.5e")).toBe("5e");
    expect(pickerSystem(null)).toBe("5e");
    expect(pickerSystem("2014")).toBe("2014");
    expect(pickerSystem("daggerheart")).toBe("daggerheart");
  });
});
