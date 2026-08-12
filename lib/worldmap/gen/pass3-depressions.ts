// lib/worldmap/gen/pass3-depressions.ts
// Pass 3: priority-flood (Barnes et al.) from the ocean inward (F5). Produces a filled surface on
// which steepest descent provably reaches the ocean, per-hex flowDir (ties broken toward the ocean
// so flats still drain), a distance-to-ocean field, and depression components for lake gating later.

import { type Fields } from "./types";
import { neighborsByDir } from "./grid";

export function pass3Depressions(f: Fields): void {
  const { width: W, height: H, elevation, land } = f;
  const N = W * H;
  const filled = f.filled;
  const processed = new Uint8Array(N);

  // Binary min-heap keyed by filled value.
  const hIdx = new Int32Array(N + 1), hKey = new Float32Array(N + 1);
  let hn = 0;
  const push = (idx: number, key: number) => {
    hn++; hIdx[hn] = idx; hKey[hn] = key;
    let c = hn;
    while (c > 1) {
      const p = c >> 1;
      if (hKey[p] <= hKey[c]) break;
      const ti = hIdx[p]; hIdx[p] = hIdx[c]; hIdx[c] = ti;
      const tk = hKey[p]; hKey[p] = hKey[c]; hKey[c] = tk;
      c = p;
    }
  };
  const pop = (): number => {
    const top = hIdx[1];
    hIdx[1] = hIdx[hn]; hKey[1] = hKey[hn]; hn--;
    let c = 1;
    for (;;) {
      const l = c * 2, r = l + 1; let m = c;
      if (l <= hn && hKey[l] < hKey[m]) m = l;
      if (r <= hn && hKey[r] < hKey[m]) m = r;
      if (m === c) break;
      const ti = hIdx[m]; hIdx[m] = hIdx[c]; hIdx[c] = ti;
      const tk = hKey[m]; hKey[m] = hKey[c]; hKey[c] = tk;
      c = m;
    }
    return top;
  };

  const nb = new Int32Array(6);
  for (let i = 0; i < N; i++) if (!land[i]) { filled[i] = elevation[i]; processed[i] = 1; push(i, filled[i]); }
  while (hn > 0) {
    const c = pop();
    const col = c % W, row = (c / W) | 0;
    neighborsByDir(col, row, W, H, nb);
    for (let d = 0; d < 6; d++) {
      const n = nb[d];
      if (n < 0 || processed[n]) continue;
      filled[n] = Math.max(elevation[n], filled[c]);
      // n drains to c, the neighbour that reached it first (lowest filled, popped earlier). The
      // reverse of direction d is (d+3)%6 because AXIAL_DIRS are arranged in opposite pairs. Ocean
      // seeds keep flowDir -1. Following flowDir walks this flood tree to an ocean root: no cycles.
      f.flowDir[n] = ((d + 3) % 6);
      processed[n] = 1;
      push(n, filled[n]);
    }
  }

  // Distance to ocean over land (multi-source BFS).
  const dist = f.distToOcean;
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (!land[i]) { dist[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const c = q[qh++]; const col = c % W, row = (c / W) | 0;
    neighborsByDir(col, row, W, H, nb);
    for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0 || !land[n] || dist[n] >= 0) continue; dist[n] = dist[c] + 1; q[qt++] = n; }
  }


  // Depression components: connected land where the surface was raised.
  const eps = 1e-6;
  const basin = f.basinId;
  let nextBasin = 0;
  for (let start = 0; start < N; start++) {
    if (!land[start] || basin[start] !== -1 || filled[start] <= elevation[start] + eps) continue;
    let bh = 0, bt = 0; q[bt++] = start; basin[start] = nextBasin;
    while (bh < bt) {
      const c = q[bh++]; const col = c % W, row = (c / W) | 0;
      neighborsByDir(col, row, W, H, nb);
      for (let d = 0; d < 6; d++) { const n = nb[d]; if (n < 0 || !land[n] || basin[n] !== -1 || filled[n] <= elevation[n] + eps) continue; basin[n] = nextBasin; q[bt++] = n; }
    }
    nextBasin++;
  }
}
