import type { RulesModule } from "./contract";

// Daggerheart (Darrington Press) - the first DUALITY-dice system. Every action rolls 2d12: a Hope die
// and a Fear die. Their sum + a modifier meets a Difficulty for success/failure, but WHICH die is
// higher colours the outcome (with Hope / with Fear), and matching dice are a critical success. That
// is a genuinely new resolution beyond d20/d100, which is why it's the real test of the dice-style seam.
//
// `character` is now ON: full derivation (deriveDaggerheartSheet over the SRD rules data), so the Forge
// shows a Daggerheart build column and the player-side character tools apply. `adversary` is still
// ABSENT until its support is built, so the GM stat-block/encounter tools stay hidden for Daggerheart.
// Only Daggerheart MECHANICS ship (the Duality dice plus derivation numbers) - no Darrington Press
// card/feature TEXT is embedded. Their SRD is under the Darrington Press Community Gaming License;
// verify it before shipping any of their text/content in a paid product (the mechanics are open).
export const daggerheart: RulesModule = {
  id: "daggerheart",
  label: "Daggerheart",
  dice: { style: { kind: "duality", dice: "2d12" }, label: "Roll with Hope & Fear" },
  character: { schemaId: "daggerheart-pc", hasImport: false, hasDerivation: true },
  axes: [],
  rulesRef: { id: "daggerheart-srd", label: "Daggerheart SRD" },
};
