// lib/worldmap/gen/pipeline.ts
// Orchestrates the generation passes in dependency order. 6a builds terrain (passes 1-3 so far);
// later passes append. Every pass is a pure function of (fields, config); this only wires them.

import { type GenConfig, type Fields, createFields } from "./types";
import { pass1Elevation } from "./pass1-elevation";
import { pass2SeaLevel } from "./pass2-sealevel";
import { pass3Depressions } from "./pass3-depressions";
import { pass4Temperature } from "./pass4-temperature";

export function generateTerrain(cfg: GenConfig): Fields {
  const elevation = pass1Elevation(cfg);
  const f = createFields(cfg.width, cfg.height, elevation);
  pass2SeaLevel(f, cfg);
  pass3Depressions(f);
  pass4Temperature(f, cfg);
  return f;
}
