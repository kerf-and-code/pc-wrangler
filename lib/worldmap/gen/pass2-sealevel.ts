// lib/worldmap/gen/pass2-sealevel.ts
// Pass 2: quantile sea level (exact ocean coverage, F2), land elevation bands, relational coast /
// shallows / cliff tags (F3, a coast is land next to ocean, not a height), and landmass / ocean
// connected components (everything from settlements on is per-landmass).

import { type Fields, type GenConfig } from "./types";
import { neighborsByDir } from "./grid";

function quantile(values: Float32Array, q: number): number {
  const s = Float32Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

export function pass2SeaLevel(f: Fields, cfg: GenConfig): void {
  const { width: W, height: H, elevation } = f;
  const N = W * H;

  f.seaLevel = quantile(elevation, cfg.oceanCoverage);
  for (let i = 0; i < N; i++) f.land[i] = elevation[i] > f.seaLevel ? 1 : 0;

  // Land bands as quantiles of LAND elevations only, so a wet world does not squash all land low.
  const landElev: number[] = [];
  for (let i = 0; i < N; i++) if (f.land[i]) landElev.push(elevation[i]);
  landElev.sort((a, b) => a - b);
  const lq = (q: number) => (landElev.length ? landElev[Math.min(landElev.length - 1, Math.floor(q * (landElev.length - 1)))] : 1);
  const tLow = lq(0.45), tHill = lq(0.68), tHigh = lq(0.84), tMtn = lq(0.95);
  for (let i = 0; i < N; i++) {
    if (!f.land[i]) { f.elevBand[i] = 0; continue; }
    const e = elevation[i];
    f.elevBand[i] = e <= tLow ? 0 : e <= tHill ? 1 : e <= tHigh ? 2 : e <= tMtn ? 3 : 4;
  }

  // Coast / shallows / cliff tags.
  const nb = new Int32Array(6);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col;
      neighborsByDir(col, row, W, H, nb);
      if (f.land[i]) {
        let oceanAdj = false;
        for (let d = 0; d < 6; d++) { const n = nb[d]; if (n >= 0 && !f.land[n]) { oceanAdj = true; break; } }
        if (oceanAdj) { f.coast[i] = 1; if (f.elevBand[i] >= 1) f.cliff[i] = 1; }
      } else {
        for (let d = 0; d < 6; d++) { const n = nb[d]; if (n >= 0 && f.land[n]) { f.shallows[i] = 1; break; } }
      }
    }
  }

  // Connected components (land -> landmassId, ocean -> oceanId).
  const flood = (isLand: boolean, ids: Int32Array) => {
    let next = 0;
    const q = new Int32Array(N);
    for (let start = 0; start < N; start++) {
      if (!!f.land[start] !== isLand || ids[start] !== -1) continue;
      let qh = 0, qt = 0; q[qt++] = start; ids[start] = next;
      while (qh < qt) {
        const c = q[qh++]; const col = c % W, row = (c / W) | 0;
        neighborsByDir(col, row, W, H, nb);
        for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0 || !!f.land[n] !== isLand || ids[n] !== -1) continue; ids[n] = next; q[qt++] = n; }
      }
      next++;
    }
    return next;
  };
  flood(true, f.landmassId);
  flood(false, f.oceanId);
}
