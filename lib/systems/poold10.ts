import type { RulesModule } from "./contract";

// A generic d10 DICE-POOL system (Storyteller-style resolution): roll a pool of d10s, each 6 or higher
// is a success, and a pair of 10s is a critical worth two successes. This ships the plain success-pool
// MECHANIC ONLY - no setting, no clans, no publisher's branded terminology - so it stays clean of any
// one game's IP while proving the `dice-pool` dice style the contract reserves. It also serves any table
// that runs a d10 pool. Dice-only first cut: no character or adversary module, like CoC's.
export const poold10: RulesModule = {
  id: "poold10",
  label: "d10 Dice Pool",
  dice: { style: { kind: "dice-pool", die: 10, countSuccesses: true }, label: "Roll the pool" },
  axes: [],
};
