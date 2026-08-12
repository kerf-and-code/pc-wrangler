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
};

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
  };
}
