// lib/worldmap/gen/pass6-rivers.ts
// Pass 6: flow accumulation turns moisture into rivers (F6), confirms lakes in the closed basins,
// marks deltas, and applies the fertile-corridor moisture bonus (closing F4's cycle). Rivers are
// overlay polylines, never a biome (F7). Thresholds are quantiles of land flowAccum, so river
// density auto-calibrates to map size and rainfall (riverQuantile is the single density knob).

import { type Fields, type GenConfig, type RiverPolyline } from "./types";
import { neighborsByDir } from "./grid";

export function pass6Rivers(f: Fields, cfg: GenConfig): void {
  const { width: W, height: H } = f;
  const N = W * H;
  const nb = new Int32Array(6);
  const nb2 = new Int32Array(6);

  // 1) Flow accumulation: rainfall = moisture over land; propagate in descending filled order.
  const acc = f.flowAccum;
  const landIdx: number[] = [];
  for (let i = 0; i < N; i++) { acc[i] = f.land[i] ? f.moisture[i] : 0; if (f.land[i]) landIdx.push(i); }
  landIdx.sort((a, b) => f.filled[b] - f.filled[a]);
  for (const c of landIdx) {
    const dir = f.flowDir[c];
    if (dir < 0) continue;
    neighborsByDir(c % W, (c / W) | 0, W, H, nb);
    const n = nb[dir];
    if (n >= 0 && f.land[n]) acc[n] += acc[c];
  }

  // 2) Thresholds from quantiles of land flowAccum.
  const av = landIdx.map((i) => acc[i]).sort((a, b) => a - b);
  const q = (p: number) => (av.length ? av[Math.min(av.length - 1, Math.floor(p * (av.length - 1)))] : Infinity);
  const tFlow = q(cfg.riverQuantile);
  const tMajor = q(cfg.majorQuantile);

  // 3) Lakes: a closed basin whose peak inflow reaches river level becomes a lake.
  const basinMax = new Map<number, number>();
  for (let i = 0; i < N; i++) { const b = f.basinId[i]; if (b >= 0) { const cur = basinMax.get(b) ?? 0; if (acc[i] > cur) basinMax.set(b, acc[i]); } }
  for (let i = 0; i < N; i++) { const b = f.basinId[i]; if (b >= 0 && (basinMax.get(b) ?? 0) >= tFlow) f.lake[i] = 1; }

  // 4) River candidates: land, at/above threshold, not a lake cell. The final f.river flag is set
  //    from the kept polylines below, so the flag matches exactly what is drawn.
  const cand = new Uint8Array(N);
  for (let i = 0; i < N; i++) cand[i] = f.land[i] && !f.lake[i] && acc[i] >= tFlow ? 1 : 0;

  // 5) Polylines from sources (a candidate no candidate flows into) down flowDir to ocean/lake.
  const isSource = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!cand[i]) continue;
    neighborsByDir(i % W, (i / W) | 0, W, H, nb);
    let upstream = false;
    for (let d = 0; d < 6; d++) {
      const nn = nb[d];
      if (nn < 0 || !cand[nn]) continue;
      neighborsByDir(nn % W, (nn / W) | 0, W, H, nb2);
      if (f.flowDir[nn] >= 0 && nb2[f.flowDir[nn]] === i) { upstream = true; break; }
    }
    if (!upstream) isSource[i] = 1;
  }
  const visited = new Uint8Array(N);
  const rivers: RiverPolyline[] = [];
  for (let s = 0; s < N; s++) {
    if (!isSource[s]) continue;
    const path: number[] = [];
    let cur = s, maxAcc = 0;
    for (;;) {
      if (cur < 0) break;
      if (visited[cur]) { path.push(cur); break; } // join an already-drawn trunk at the confluence
      if (!cand[cur]) break;
      visited[cur] = 1;
      path.push(cur);
      if (acc[cur] > maxAcc) maxAcc = acc[cur];
      neighborsByDir(cur % W, (cur / W) | 0, W, H, nb);
      const n = f.flowDir[cur] >= 0 ? nb[f.flowDir[cur]] : -1;
      if (n < 0 || !f.land[n] || f.lake[n]) break; // terminate at ocean / lake / edge
      cur = n;
    }
    if (path.length >= cfg.minRiverLength) rivers.push({ path, width: maxAcc >= tMajor ? 2 : 1 });
  }
  f.rivers = rivers;
  for (const r of rivers) for (const c of r.path) f.river[c] = 1; // flag = the drawn river cells

  // 6) Deltas: the last land hex of a major river that meets ocean.
  for (const r of rivers) {
    if (r.width < 2) continue;
    const last = r.path[r.path.length - 1];
    neighborsByDir(last % W, (last / W) | 0, W, H, nb);
    for (let d = 0; d < 6; d++) { const nn = nb[d]; if (nn >= 0 && !f.land[nn]) { f.delta[last] = 1; break; } }
  }

  // 7) Fertile-corridor bonus + riverAdjacent (cohesion exemption) + frozen tag.
  for (let i = 0; i < N; i++) {
    if (!f.land[i]) continue;
    let adj = f.river[i] === 1 || f.lake[i] === 1;
    if (!adj) {
      neighborsByDir(i % W, (i / W) | 0, W, H, nb);
      for (let d = 0; d < 6; d++) { const nn = nb[d]; if (nn >= 0 && (f.river[nn] || f.lake[nn])) { adj = true; break; } }
    }
    if (adj) { f.riverAdjacent[i] = 1; if (f.moistureBand[i] < 4) f.moistureBand[i]++; }
  }
  for (let i = 0; i < N; i++) if ((f.river[i] || f.lake[i]) && f.tempBand[i] === 0) f.frozen[i] = 1;
}
