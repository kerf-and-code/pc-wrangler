// lib/worldmap/gen/pass10-settlements.ts
// Pass 10: place settlements by a suitability score, then greedy tiered placement (cities, towns,
// villages) with hex-distance spacing per landmass and a per-landmass city cap. Reject-only, no
// randomness beyond score-tie breaking from this pass's stream. Faithful to the blueprint's Pass 10.

import { type Fields, type GenConfig, type Settlement } from "./types";
import { hashSeed, passStream } from "./rng";
import { neighborsByDir } from "./grid";
import { offsetToAxial } from "../hex";

const MOUNTAINS = 20, ALPINE = 11, VOLCANIC = 21, CANYON = 22, TUNDRA = 10, COAST = 18,
  PLAINS = 0, SAVANNA = 1, PRAIRIE = 2, FOREST = 3, SWAMP = 13, BOG = 14, D_SANDY = 8, D_ROCKY = 9, HIGHLAND = 12;

function cubeDist(qa: number, ra: number, qb: number, rb: number): number {
  const dq = qa - qb, dr = ra - rb;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function pass10Settlements(f: Fields, cfg: GenConfig): void {
  const { width: W, height: H } = f;
  const N = W * H;
  const rnd = passStream(hashSeed(cfg.seed), "settlements");
  const nb = new Int32Array(6), nb2 = new Int32Array(6);

  // distToFreshwater (BFS from river/lake over land).
  const distFW = new Int32Array(N).fill(-1);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (f.river[i] || f.lake[i]) { distFW[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const c = q[qh++];
    neighborsByDir(c % W, (c / W) | 0, W, H, nb);
    for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0 || !f.land[n] || distFW[n] >= 0) continue; distFW[n] = distFW[c] + 1; q[qt++] = n; }
  }

  const buildable = (i: number): boolean => {
    if (!f.land[i]) return false;
    const b = f.biome[i];
    if (b === MOUNTAINS || b === ALPINE || b === VOLCANIC || b === CANYON || b >= 24) return false;
    if (b === TUNDRA && f.glacier[i]) return false;
    if (b >= 15 && b <= 19) return false;
    return true;
  };
  const workable = (b: number) => b === PLAINS || b === PRAIRIE || b === SAVANNA || b === FOREST;

  // Suitability score + a per-hex random tie-break key.
  const score = new Float32Array(N);
  const tie = new Float32Array(N);
  const buildIdx: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!buildable(i)) { score[i] = -Infinity; continue; }
    buildIdx.push(i);
    tie[i] = rnd();
    const b = f.biome[i];
    neighborsByDir(i % W, (i / W) | 0, W, H, nb);
    let workN = 0, harbor = false, riverInflow = 0;
    for (let d = 0; d < 6; d++) {
      const n = nb[d];
      if (n < 0) continue;
      if (f.land[n]) {
        if (workable(f.biome[n])) workN++;
        if (f.river[n]) { neighborsByDir(n % W, (n / W) | 0, W, H, nb2); if (f.flowDir[n] >= 0 && nb2[f.flowDir[n]] === i && f.river[i]) riverInflow++; }
      } else if (b === COAST && !f.shallows[n]) {
        harbor = true; // coast next to deeper (non-shallow) ocean
      }
    }
    const confluence = f.river[i] === 1 && riverInflow >= 2;
    let s = 3 * (distFW[i] >= 0 && distFW[i] <= 1 ? 1 : 0) + 2 * (harbor ? 1 : 0) + (confluence ? 1 : 0) + Math.min(3, workN);
    if (b === SWAMP || b === BOG) s -= 2;
    if ((b === D_SANDY || b === D_ROCKY) && distFW[i] > 2) s -= 2;
    if (b === HIGHLAND) s -= 1;
    score[i] = s;
  }

  // Landmass areas for the per-landmass city cap.
  const area = new Map<number, number>();
  for (let i = 0; i < N; i++) { const lm = f.landmassId[i]; if (lm >= 0) area.set(lm, (area.get(lm) ?? 0) + 1); }

  // Sort buildable hexes by descending score, ties by the pass stream.
  buildIdx.sort((a, b) => (score[b] - score[a]) || (tie[b] - tie[a]));

  const settlements: Settlement[] = [];
  const axial = (i: number) => offsetToAxial(i % W, (i / W) | 0);
  const cityCount = new Map<number, number>();

  const farEnough = (i: number, spacing: number, tiers: number[]): boolean => {
    const a = axial(i), lm = f.landmassId[i];
    for (const st of settlements) {
      if (!tiers.includes(st.tier)) continue;
      if (f.landmassId[st.index] !== lm) continue;
      const b = axial(st.index);
      if (cubeDist(a.q, a.r, b.q, b.r) < spacing) return false;
    }
    return true;
  };

  // Cities.
  for (const i of buildIdx) {
    const lm = f.landmassId[i];
    const cap = Math.max(1, Math.ceil((area.get(lm) ?? 0) / 900));
    if ((cityCount.get(lm) ?? 0) >= cap) continue;
    if (!farEnough(i, cfg.citySpacing, [0])) continue;
    settlements.push({ index: i, tier: 0 });
    f.settlementTier[i] = 0;
    cityCount.set(lm, (cityCount.get(lm) ?? 0) + 1);
  }
  // Towns.
  for (const i of buildIdx) {
    if (f.settlementTier[i] >= 0 || score[i] < cfg.townScoreFloor) continue;
    if (!farEnough(i, cfg.townSpacing, [0, 1])) continue;
    settlements.push({ index: i, tier: 1 });
    f.settlementTier[i] = 1;
  }
  // Villages.
  for (const i of buildIdx) {
    if (f.settlementTier[i] >= 0 || score[i] < cfg.villageScoreFloor) continue;
    if (!farEnough(i, cfg.villageSpacing, [0, 1, 2])) continue;
    settlements.push({ index: i, tier: 2 });
    f.settlementTier[i] = 2;
  }

  f.settlements = settlements;
}
