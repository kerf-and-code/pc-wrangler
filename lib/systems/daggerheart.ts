import type { RulesModule } from "./contract";

// Daggerheart (Darrington Press) - the first DUALITY-dice system. Every action rolls 2d12: a Hope die
// and a Fear die. Their sum + a modifier meets a Difficulty for success/failure, but WHICH die is
// higher colours the outcome (with Hope / with Fear), and matching dice are a critical success. That
// is a genuinely new resolution beyond d20/d100, which is why it's the real test of the dice-style seam.
//
// First cut: dice-only, like PF2e's. `character` and `adversary` are ABSENT until their support is
// built, so a Daggerheart campaign is creatable and rolls Duality dice today while the D&D-shaped tools
// stay hidden. Only the Duality MECHANIC is implemented (rolling 2d12, comparing Hope vs Fear) - no
// Daggerheart content ships here. Their SRD is under the Darrington Press Community Gaming License;
// verify it before shipping any of their text/content in a paid product (mechanics themselves are open).
export const daggerheart: RulesModule = {
  id: "daggerheart",
  label: "Daggerheart",
  dice: { style: { kind: "duality", dice: "2d12" }, label: "Roll with Hope & Fear" },
  axes: [],
  rulesRef: { id: "daggerheart-srd", label: "Daggerheart SRD" },
};
