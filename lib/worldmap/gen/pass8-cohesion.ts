// lib/worldmap/gen/pass8-cohesion.ts
// Pass 8: cohesion repair (F10), run to a fixpoint with a hard cap of 3 rounds. Removes single-hex
// biome specks, repairs climatically impossible neighbours (a desert touching a swamp), and smooths
// ragged edges. Coasts, lakes, deltas, basin canyons, and river-adjacent hexes are exempt: a repair
// may target them, but they are never the victim converted. Faithful to the blueprint's Pass 8.

import { type Fields } from "./types";
import { neighborsByDir } from "./grid";

const D_SANDY = 8, D_ROCKY = 9, SWAMP = 13, BOG = 14, TUNDRA = 10, JUNGLE = 6, RAINFOREST = 5,
  VOLCANIC = 21, MEDITERRANEAN = 7, TAIGA = 4, CANYON = 22, COAST = 18, LAKE = 16;

// The transition biome to insert for a forbidden pair, or null when the pair is allowed.
function transitionFor(a: number, b: number): number | null {
  const desert = (x: number) => x === D_SANDY || x === D_ROCKY;
  const wet = (x: number) => x === SWAMP || x === BOG;
  const trop = (x: number) => x === JUNGLE || x === RAINFOREST;
  if ((desert(a) && wet(b)) || (desert(b) && wet(a))) return MEDITERRANEAN;
  if ((a === TUNDRA && trop(b)) || (b === TUNDRA && trop(a))) return TAIGA;
  if ((a === VOLCANIC && b === TUNDRA) || (b === VOLCANIC && a === TUNDRA)) return CANYON;
  return null;
}

export function pass8Cohesion(f: Fields, minBlobSize = 3): void {
  const { width: W, height: H } = f;
  const N = W * H;
  const nb = new Int32Array(6);

  const exempt = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    exempt[i] = !f.land[i] || f.delta[i] || f.biome[i] === COAST || f.biome[i] === LAKE ||
      (f.biome[i] === CANYON && f.basinId[i] >= 0) || f.riverAdjacent[i] ? 1 : 0;
  }

  const q = new Int32Array(N);
  for (let round = 0; round < 3; round++) {
    let changed = false;

    // 2. Minimum blob: same-biome components under minBlobSize (non-exempt) adopt their commonest neighbour.
    const comp = new Int32Array(N).fill(-1);
    const compCells: number[][] = [];
    for (let s = 0; s < N; s++) {
      if (comp[s] >= 0 || !f.land[s]) continue;
      const cid = compCells.length;
      let qh = 0, qt = 0; q[qt++] = s; comp[s] = cid;
      const cells = [s];
      while (qh < qt) {
        const c = q[qh++];
        neighborsByDir(c % W, (c / W) | 0, W, H, nb);
        for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0 || !f.land[n] || comp[n] >= 0 || f.biome[n] !== f.biome[c]) continue; comp[n] = cid; q[qt++] = n; cells.push(n); }
      }
      compCells.push(cells);
    }
    for (const cells of compCells) {
      if (cells.length >= minBlobSize || cells.some((x) => exempt[x])) continue;
      const votes = new Map<number, number>();
      for (const x of cells) {
        neighborsByDir(x % W, (x / W) | 0, W, H, nb);
        for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0 || !f.land[n] || comp[n] === comp[x]) continue; votes.set(f.biome[n], (votes.get(f.biome[n]) ?? 0) + 1); }
      }
      let best = -1, bestV = 0;
      for (const [bi, v] of votes) if (v > bestV) { bestV = v; best = bi; }
      if (best >= 0) { for (const x of cells) f.biome[x] = best; changed = true; }
    }

    // 3. Forbidden adjacency: convert the more common hex of the pair (keep the rarer), never an exempt victim.
    const counts = new Int32Array(28);
    for (let i = 0; i < N; i++) if (f.land[i]) counts[f.biome[i]]++;
    for (let i = 0; i < N; i++) {
      if (!f.land[i]) continue;
      neighborsByDir(i % W, (i / W) | 0, W, H, nb);
      for (let d = 0; d < 6; d++) {
        const n = nb[d];
        if (n < 0 || !f.land[n] || n < i) continue;
        const t = transitionFor(f.biome[i], f.biome[n]);
        if (t === null) continue;
        let victim = counts[f.biome[i]] >= counts[f.biome[n]] ? i : n;
        if (exempt[victim]) { const other = victim === i ? n : i; if (!exempt[other]) victim = other; else continue; }
        if (f.biome[victim] !== t) { f.biome[victim] = t; changed = true; }
      }
    }

    // 4. Majority smoothing (max 2 iterations): a non-exempt hex with 4+ like neighbours adopts that biome.
    for (let it = 0; it < 2; it++) {
      const next = f.biome.slice();
      let smoothed = false;
      for (let i = 0; i < N; i++) {
        if (!f.land[i] || exempt[i]) continue;
        neighborsByDir(i % W, (i / W) | 0, W, H, nb);
        const votes = new Map<number, number>();
        for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0 || !f.land[n]) continue; votes.set(f.biome[n], (votes.get(f.biome[n]) ?? 0) + 1); }
        let best = -1, bestV = 0;
        for (const [bi, v] of votes) if (v > bestV) { bestV = v; best = bi; }
        if (best >= 0 && best !== f.biome[i] && bestV >= 4) { next[i] = best; smoothed = true; }
      }
      if (smoothed) { f.biome.set(next); changed = true; } else break;
    }

    if (!changed) break;
  }
}
