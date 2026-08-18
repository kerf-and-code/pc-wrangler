import type { RulesModule } from "./contract";

// Draw Steel (MCDM Productions) - the POWER ROLL system: roll 2d10 + a characteristic against outcome
// tiers (11 or lower = tier 1, 12-16 = tier 2, 17+ = tier 3), with edges (+2, or a double edge bumps the
// result up one tier) and banes (-2, or a double bane drops one tier); a natural 19-20 is always tier 3
// and a critical. That tiered resolution is new to the dice-style seam, which is why it is worth proving.
//
// LICENSING: Draw Steel content is used under the Draw Steel Creator License, which permits commercial
// digital tools with no royalties. The app must carry the required attribution ("<product> is an
// independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM
// Productions, LLC.") and must NOT use MCDM's or Draw Steel's logos or wordmark. Only MECHANICS ship
// here (the power-roll numbers), not MCDM's descriptive prose. `character` is ON: full derivation
// (deriveDrawSteelSheet) so the Forge shows a Draw Steel build column. `adversary` is now ON too: the
// Monster Maker authors Draw Steel stat blocks, and the encounter builder uses the Encounter Value (EV)
// budget against the party's Encounter Strength (encounterMethod "drawsteel").
export const drawsteel: RulesModule = {
  id: "drawsteel",
  label: "Draw Steel",
  dice: { style: { kind: "power-roll" }, label: "Power Roll (2d10)" },
  character: { schemaId: "drawsteel-pc", hasImport: false, hasDerivation: true },
  adversary: { schemaId: "drawsteel-adversary", hasEncounterMath: true, encounterMethod: "drawsteel" },
  axes: [],
  rulesRef: { id: "draw-steel-creator-license", label: "Draw Steel (Creator License)" },
};
