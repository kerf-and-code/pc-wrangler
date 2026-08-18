import type { RulesModule } from "./contract";

// Lancer (Massif Press) - the d20 + ACCURACY / DIFFICULTY system: roll 1d20 + a flat bonus against a
// target number (a check/save DC, or a foe's Evasion or E-Defense). Accuracy and Difficulty are the
// game's swing dice: for each net point of Accuracy you roll a d6 and ADD the single highest, for each
// net point of Difficulty you roll a d6 and SUBTRACT the single highest, and the two cancel one for one
// so you only ever roll the net. A natural 20 on the d20 is a critical hit. That accuracy/difficulty
// resolution is new to the dice-style seam (it is not advantage), which is why it gets its own kind and
// a proven roll branch, exactly as Draw Steel's power roll did.
//
// LICENSING: Lancer third-party content is used under the Lancer Third Party License, which explicitly
// permits commercial products, charges no royalties, and does not restrict digital tools or shipping
// game mechanics. The license requires two verbatim notices in the product (handled in the app's legal
// text): "<work> is not an official Lancer product; it is a third party work, and is not affiliated with
// Massif Press. <work> is published via the Lancer Third Party License." and "Lancer is copyright Massif
// Press." Only MECHANICS ship here (the numbers), never Massif Press's descriptive prose. `character` is
// now ON: full derivation (deriveLancerSheet) so the Forge shows a Lancer pilot-and-mech build column.
// `adversary` is now ON: the Monster Maker authors Lancer NPC stat blocks. hasEncounterMath is FALSE
// because Lancer has no XP/EV point budget (encounters are built by NPC tier and count, not a spend), so
// the encounter balancer stays hidden for Lancer rather than presenting maths that do not apply.
export const lancer: RulesModule = {
  id: "lancer",
  label: "Lancer",
  dice: { style: { kind: "d20-accuracy" }, label: "Roll d20 (Accuracy / Difficulty)" },
  character: { schemaId: "lancer-pc", hasImport: false, hasDerivation: true },
  adversary: { schemaId: "lancer-npc", hasEncounterMath: false },
  axes: [],
  rulesRef: { id: "lancer-third-party-license", label: "Lancer (Third Party License)" },
};
