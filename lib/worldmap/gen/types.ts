// lib/worldmap/gen/types.ts
// Config + field container for the generation pipeline. Fields are flat typed arrays (row-major,
// i = row*W + col) grown pass by pass. Only Pass 0/1 members exist so far; later passes add theirs.

export type GenConfig = {
  width: number;
  height: number;
  seed: string | number;
  oceanCoverage: number;     // quantile sea level (0.40-0.80); 0.62 default
  continentCount: number;    // 1-4
  landConcentration: number; // 0 (off) - 1.0; 0.5 default
  plateCount: number;        // >= 5
  archipelago: boolean;      // mask off, more plates
  latN: number;              // latitude of the top row (deg)
  latS: number;              // latitude of the bottom row (deg)
  lapsePerBand: number;      // temperature drop per land band above lowland
  windDir: number;           // downwind AXIAL_DIRS index 0-5 (0 = E, prevailing westerlies)
  cBase: number;             // moisture capacity base
  pBase: number;             // base precipitation fraction over land
  pOro: number;              // extra orographic precipitation per band climbed
};

// Per-hex fields, row-major (i = row*W + col), grown pass by pass.
export type Fields = {
  width: number;
  height: number;
  elevation: Float32Array;   // pass 1, 0-1
  seaLevel: number;          // pass 2
  land: Uint8Array;          // pass 2: 1 land / 0 ocean
  elevBand: Uint8Array;      // pass 2: 0 lowland,1 hill,2 highland,3 mountain,4 peak (land)
  coast: Uint8Array;         // pass 2 flag
  shallows: Uint8Array;      // pass 2 flag
  cliff: Uint8Array;         // pass 2 flag
  landmassId: Int32Array;    // pass 2: per land hex (-1 ocean)
  oceanId: Int32Array;       // pass 2: per ocean hex (-1 land)
  filled: Float32Array;      // pass 3: depression-filled surface
  flowDir: Int8Array;        // pass 3: 0-5 neighbour dir, -1 ocean/sink
  basinId: Int32Array;       // pass 3: depression component (-1 none)
  distToOcean: Int32Array;   // pass 3: BFS hops over land (-1 ocean)
  temperature: Float32Array; // pass 4, 0-1
  tempBand: Uint8Array;      // pass 4: 0 polar..4 tropical
  moisture: Float32Array;    // pass 5, 0-1 (land); 1 over water
  moistureBand: Uint8Array;  // pass 5: 0 arid..4 saturated
};

export function createFields(width: number, height: number, elevation: Float32Array): Fields {
  const n = width * height;
  return {
    width, height, elevation,
    seaLevel: 0,
    land: new Uint8Array(n),
    elevBand: new Uint8Array(n),
    coast: new Uint8Array(n),
    shallows: new Uint8Array(n),
    cliff: new Uint8Array(n),
    landmassId: new Int32Array(n).fill(-1),
    oceanId: new Int32Array(n).fill(-1),
    filled: new Float32Array(n),
    flowDir: new Int8Array(n).fill(-1),
    basinId: new Int32Array(n).fill(-1),
    distToOcean: new Int32Array(n).fill(-1),
    temperature: new Float32Array(n),
    tempBand: new Uint8Array(n),
    moisture: new Float32Array(n),
    moistureBand: new Uint8Array(n),
  };
}

export function defaultConfig(width: number, height: number, seed: string | number): GenConfig {
  const area = width * height;
  return {
    width,
    height,
    seed,
    oceanCoverage: 0.62,
    continentCount: Math.max(1, Math.round(area / 30000)) || 1,
    landConcentration: 0.5,
    plateCount: Math.max(5, Math.round(area / 5500)),
    archipelago: false,
    latN: height >= 150 ? 75 : 60,
    latS: height >= 150 ? -15 : 10,
    lapsePerBand: 0.12,
    windDir: 0,
    cBase: 1.0,
    pBase: 0.10,
    pOro: 0.22,
  };
}
