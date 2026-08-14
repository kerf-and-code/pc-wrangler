// lib/worldmap/gen/pipeline.ts
// Orchestrates the generation passes in dependency order. 6a builds terrain (passes 1-3 so far);
// later passes append. Every pass is a pure function of (fields, config); this only wires them.

import { type GenConfig, type Fields, createFields } from "./types";
import { pass1Elevation } from "./pass1-elevation";
import { pass2SeaLevel } from "./pass2-sealevel";
import { pass3Depressions } from "./pass3-depressions";
import { pass4Temperature } from "./pass4-temperature";
import { pass5Moisture } from "./pass5-moisture";
import { pass6Rivers } from "./pass6-rivers";
import { pass7Biomes } from "./pass7-biomes";
import { pass8Cohesion } from "./pass8-cohesion";
import { pass9Fantasy } from "./pass9-fantasy";
import { pass10Settlements } from "./pass10-settlements";
import { pass11Roads } from "./pass11-roads";
import { pass12Pois } from "./pass12-pois";

export type GenProgress = (p: { pass: string; index: number; total: number }) => void;

export function generateTerrain(cfg: GenConfig, onProgress?: GenProgress): Fields {
  const total = 12;
  const step = (index: number, pass: string) => { if (onProgress) onProgress({ pass, index, total }); };
  const elevation = pass1Elevation(cfg); step(1, "elevation");
  const f = createFields(cfg.width, cfg.height, elevation);
  pass2SeaLevel(f, cfg); step(2, "sea level");
  pass3Depressions(f); step(3, "drainage");
  pass4Temperature(f, cfg); step(4, "temperature");
  pass5Moisture(f, cfg); step(5, "moisture");
  pass6Rivers(f, cfg); step(6, "rivers");
  pass7Biomes(f, cfg); step(7, "biomes");
  pass8Cohesion(f); step(8, "cohesion");
  pass9Fantasy(f, cfg); step(9, "fantasy");
  // Snowcap: cold-latitude mountains/alpine, set on FINAL biomes (after cohesion + fantasy).
  for (let i = 0; i < cfg.width * cfg.height; i++) { const b = f.biome[i]; if ((b === 20 || b === 11) && f.tempBand[i] <= 1) f.snowcap[i] = 1; }
  pass10Settlements(f, cfg); step(10, "settlements");
  pass11Roads(f, cfg); step(11, "roads");
  pass12Pois(f, cfg); step(12, "POIs");
  return f;
}
