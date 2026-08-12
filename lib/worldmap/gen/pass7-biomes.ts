// lib/worldmap/gen/pass7-biomes.ts
// Pass 7: assign one of the canonical 28 biomes per hex. A temperature x moisture lookup gives the
// terrestrial base; then overrides apply IN ORDER (water, lake, elevation, hydrology, coast). River
// (15) and Cave (23) are never generator-assigned (rivers are overlay polylines; caves are POIs in
// Pass 12); fantasy biomes (24-27) come only from Pass 9. Faithful to the blueprint's Pass 7.

import { type Fields } from "./types";

const PLAINS = 0, SAVANNA = 1, PRAIRIE = 2, FOREST = 3, TAIGA = 4, RAINFOREST = 5, JUNGLE = 6,
  MEDITERRANEAN = 7, DESERT_SANDY = 8, DESERT_ROCKY = 9, TUNDRA = 10, ALPINE = 11, HIGHLAND = 12,
  SWAMP = 13, BOG = 14, LAKE = 16, SEA = 17, COAST = 18, REEF = 19, MOUNTAINS = 20, CANYON = 22;

// rows = tempBand (polar..tropical), cols = moistureBand (arid..saturated)
const LUT: number[][] = [
  [TUNDRA, TUNDRA, TUNDRA, TUNDRA, TUNDRA],
  [DESERT_ROCKY, PRAIRIE, TAIGA, TAIGA, BOG],
  [DESERT_ROCKY, PRAIRIE, FOREST, FOREST, SWAMP],
  [DESERT_SANDY, MEDITERRANEAN, PLAINS, FOREST, SWAMP],
  [DESERT_SANDY, SAVANNA, SAVANNA, JUNGLE, RAINFOREST],
];

export function pass7Biomes(f: Fields): void {
  const { width: W, height: H } = f;
  const N = W * H;

  const majorRiver = new Uint8Array(N);
  for (const r of f.rivers) if (r.width >= 2) for (const c of r.path) majorRiver[c] = 1;

  for (let i = 0; i < N; i++) {
    const t = f.tempBand[i], m = f.moistureBand[i];

    // 1. Ocean.
    if (!f.land[i]) {
      f.biome[i] = f.shallows[i] && t >= 3 ? REEF : SEA;
      continue;
    }
    // 2. Lake (lakes are land cells with the lake flag; frozen already set in Pass 6 when polar).
    if (f.lake[i]) { f.biome[i] = LAKE; continue; }

    // Base lookup.
    let b = LUT[t][m];
    if (t === 0 && m >= 3) f.glacier[i] = 1;

    // 3. Elevation.
    const eb = f.elevBand[i];
    if (eb === 4 || (eb === 3 && t <= 1)) b = ALPINE;
    else if (eb === 3) b = MOUNTAINS;
    else if (eb === 2 && m <= 1) b = HIGHLAND;

    // 4. Hydrology.
    if (f.basinId[i] >= 0 && !f.lake[i]) { b = CANYON; if (m === 0) f.saltPan[i] = 1; }
    if (majorRiver[i] && eb >= 1 && eb <= 3) { if (m <= 1) b = CANYON; else f.gorge[i] = 1; }
    if (f.delta[i]) b = SWAMP;

    // 5. Coast (delta wins over this).
    if (!f.delta[i] && f.coast[i] && (eb === 0 || eb === 1)) { b = COAST; if (eb >= 1) f.cliff[i] = 1; }

    f.biome[i] = b;
  }
}
