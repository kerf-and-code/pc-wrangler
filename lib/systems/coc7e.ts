import type { RulesModule } from "./contract";

// Call of Cthulhu 7e - a NARRATIVE-TRACK module. It runs on the agnostic core (codex, connections,
// reveals, timeline, recording, map) plus a d100 roller. No character creator, no adversary builder:
// investigation doesn't reward them, so those D&D-shaped surfaces simply step aside for a CoC
// campaign rather than showing maths that mean nothing there.
//
// It's also the first real proof that the Phase 0 seam ROUTES rather than just compiles. Flip a
// campaign's `system` to 'coc7e' (by hand for now, until the Phase 4 picker exists) and watch the
// wired features react: the roller drops the advantage toggle (no d20-vs-dc), and the encounter
// balancer shows its "this system doesn't use encounter budgets" note.
export const coc7e: RulesModule = {
  id: "coc7e",
  label: "Call of Cthulhu (7e)",
  dice: { style: { kind: "percentile-under" }, label: "Roll d100" },
  // no `character`, no `adversary` - the core carries a CoC campaign on its own.
  axes: [],
};
