import type { RulesModule } from "./contract";

// A system-neutral d10 SUCCESS POOL: roll a pool of ten-sided dice, each 6 or higher is a success, and
// a pair of 10s is a critical. This is a generic dice MECHANIC - not tied to, and not naming, any
// published game - so it is safe to ship in a commercial product. It proves the reserved `dice-pool`
// style and serves any "roll a handful of d10s and count successes" system. No game-specific content,
// terminology, or trackers ship here; the roller reads only the pool size and an optional difficulty.
export const poold10: RulesModule = {
  id: "poold10",
  label: "d10 Pool",
  dice: { style: { kind: "dice-pool", die: 10, countSuccesses: true }, label: "Roll a d10 pool" },
  axes: [],
};
