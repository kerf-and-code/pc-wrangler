// lib/worldmap/gen/pass9-fantasy.ts
// Pass 9: inject fantasy biomes, gated and capped. Runs AFTER cohesion so injections are not smoothed
// away, from its own RNG stream. Budget <= fantasyDensityCap of land. Gates: enchanted/feywild grow
// only over forest-base hexes; crystal caverns seed mountain-adjacent; blighted seeds next to volcanic
// or from GM-provided source hexes. Each blob is a bounded cluster (radius 2-4). Faithful to Pass 9.

import { type Fields, type GenConfig } from "./types";
import { hashSeed, passStream } from "./rng";
import { neighborsByDir } from "./grid";

const BLIGHTED = 24, ENCHANTED = 25, CRYSTAL = 26, FEYWILD = 27, MOUNTAINS = 20, VOLCANIC = 21;

export function pass9Fantasy(f: Fields, cfg: GenConfig, blightSources: number[] = []): void {
  const { width: W, height: H } = f;
  const N = W * H;
  const rnd = passStream(hashSeed(cfg.seed), "fantasy");
  const nb = new Int32Array(6);

  let landCount = 0;
  for (let i = 0; i < N; i++) if (f.land[i]) landCount++;
  let budget = Math.floor(cfg.fantasyDensityCap * landCount);
  if (budget <= 0) return;

  const isWater = (b: number) => b >= 15 && b <= 19;
  const isForestBase = (b: number) => b === 3 || b === 4 || b === 5 || b === 6;
  const convertible = (i: number) => f.land[i] === 1 && !isWater(f.biome[i]) && f.biome[i] < 24;

  const forestSeeds: number[] = [], crystalSeeds: number[] = [], blightSeeds: number[] = [...blightSources];
  for (let i = 0; i < N; i++) {
    if (!f.land[i]) continue;
    if (isForestBase(f.biome[i])) forestSeeds.push(i);
    neighborsByDir(i % W, (i / W) | 0, W, H, nb);
    let mtnAdj = false, volAdj = false;
    for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0) continue; if (f.biome[n] === MOUNTAINS) mtnAdj = true; if (f.biome[n] === VOLCANIC) volAdj = true; }
    if (mtnAdj && convertible(i)) crystalSeeds.push(i);
    if (volAdj) blightSeeds.push(i);
  }

  const pick = (arr: number[]) => (arr.length ? arr[Math.floor(rnd() * arr.length)] : -1);

  const growBlob = (seed: number, biome: number, gate: (i: number) => boolean) => {
    if (seed < 0 || budget <= 0 || !gate(seed)) return;
    const radius = 2 + Math.floor(rnd() * 3); // 2-4
    const dist = new Map<number, number>();
    dist.set(seed, 0);
    const q = [seed];
    let h = 0;
    while (h < q.length) {
      const c = q[h++];
      const dc = dist.get(c) as number;
      if (dc >= radius) continue;
      neighborsByDir(c % W, (c / W) | 0, W, H, nb);
      for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0 || dist.has(n)) continue; dist.set(n, dc + 1); q.push(n); }
    }
    for (const c of dist.keys()) { if (budget <= 0) break; if (gate(c)) { f.biome[c] = biome; budget--; } }
  };

  const forestGate = (i: number) => convertible(i) && isForestBase(f.biome[i]);
  const anyGate = (i: number) => convertible(i);
  const mtnAdjacent = (i: number) => {
    neighborsByDir(i % W, (i / W) | 0, W, H, nb);
    for (let d = 0; d < 6; d++) { const n = nb[d]; if (n >= 0 && f.biome[n] === MOUNTAINS) return true; }
    return false;
  };
  // Crystal must stay mountain-adjacent for EVERY grown cell (not just the seed), and never eat a
  // mountain hex - crystal caverns nestle against ranges.
  const crystalGate = (i: number) => convertible(i) && f.biome[i] !== MOUNTAINS && mtnAdjacent(i);
  const plans: [number[], number, (i: number) => boolean][] = [
    [forestSeeds, ENCHANTED, forestGate],
    [forestSeeds, FEYWILD, forestGate],
    [crystalSeeds, CRYSTAL, crystalGate],
    [blightSeeds, BLIGHTED, anyGate],
  ];

  let guard = 0;
  while (budget > 0 && guard++ < 300) {
    let progressed = false;
    for (const [pool, biome, gate] of plans) {
      if (budget <= 0) break;
      const s = pick(pool);
      if (s < 0) continue;
      const before = budget;
      growBlob(s, biome, gate);
      if (budget < before) progressed = true;
    }
    if (!progressed) break;
  }
}
