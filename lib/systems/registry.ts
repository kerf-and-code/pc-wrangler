import type { RulesModule, SystemId } from "./contract";
import { dnd5e } from "./dnd5e";
import { coc7e } from "./coc7e";
import { pf2e } from "./pf2e";
import { daggerheart } from "./daggerheart";
import { poold10 } from "./poold10";
import { drawsteel } from "./drawsteel";
import { lancer } from "./lancer";
import { darkmatter } from "./darkmatter";

// The registry maps a campaign's `system` to its module: D&D 5e and every other system that has a
// module (MODULES below). New systems are added here as their modules are built.
//
// Everything reading the active system goes through getModule(), never a hardcoded system check, so
// when the day comes that a campaign is "pf2e" the right module simply falls out. Unknown or missing
// systems fall back to the default rather than throwing - a campaign should never break because a
// system string is stale.

const MODULES: Record<SystemId, RulesModule> = {
  dnd5e,
  coc7e,
  pf2e,
  daggerheart,
  poold10,
  drawsteel,
  lancer,
  darkmatter,
};

export const DEFAULT_SYSTEM: SystemId = "dnd5e";

export function getModule(system: string | null | undefined): RulesModule {
  if (system && MODULES[system]) return MODULES[system];
  return MODULES[DEFAULT_SYSTEM];
}

export function listModules(): RulesModule[] {
  return Object.values(MODULES);
}

export function isKnownSystem(system: string | null | undefined): boolean {
  return !!system && !!MODULES[system];
}
