// lib/worldmap/gen/pass11-roads.ts
// Pass 11: connect settlements with roads, per landmass with 2+ city/town. A biome cost surface makes
// easy ground cheap and mountains/swamps dear; crossing a river hex adds bridgeCost and mints a
// bridge (major river) or ford (minor). An MST over cities+towns is grown by Prim over the surface,
// realized so laid road drops to 0.5 and later routes consolidate into trunks; villages hook in when
// close enough. Roads are polylines with a class, like rivers. Faithful to the blueprint's Pass 11.

import { type Fields, type GenConfig, type RoadPolyline } from "./types";
import { neighborsByDir } from "./grid";

const ROAD_SURF = 0.5;

function baseCost(f: Fields, i: number, cfg: GenConfig): number {
  if (!f.land[i] || f.lake[i]) return Infinity;
  const b = f.biome[i];
  let c: number;
  if (b === 0 || b === 2 || b === 18) c = 1;
  else if (b === 1) c = 1.5;
  else if (b === 3) c = 2;
  else if (b === 4) c = 2.5;
  else if (b === 8 || b === 9) c = 3;
  else if (b === 5 || b === 6) c = 3.5;
  else if (b === 13 || b === 14) c = 4;
  else if (b === 20 || b === 11) c = cfg.mountainRoadCost;
  else if (b === 21) c = 5;
  else if (b === 22) c = 4;
  else c = b >= 24 ? 4 : 2;
  if (f.elevBand[i] === 1) c = Math.max(c, 2);
  else if (f.elevBand[i] === 2) c = Math.max(c, 3);
  else if (f.elevBand[i] >= 3) c = cfg.mountainRoadCost;
  if (f.river[i]) c += cfg.bridgeCost;
  return c;
}

// Multi-source Dijkstra over the surface; returns dist + predecessor for path reconstruction.
function dijkstra(sources: number[], surf: Float32Array, W: number, H: number, dist: Float32Array, pred: Int32Array): void {
  const N = W * H;
  dist.fill(Infinity);
  pred.fill(-1);
  const hIdx = new Int32Array(N + 1), hKey = new Float32Array(N + 1);
  let hn = 0;
  const push = (idx: number, key: number) => {
    hn++; hIdx[hn] = idx; hKey[hn] = key; let c = hn;
    while (c > 1) { const p = c >> 1; if (hKey[p] <= hKey[c]) break; const ti = hIdx[p]; hIdx[p] = hIdx[c]; hIdx[c] = ti; const tk = hKey[p]; hKey[p] = hKey[c]; hKey[c] = tk; c = p; }
  };
  const pop = (): number => {
    const top = hIdx[1]; hIdx[1] = hIdx[hn]; hKey[1] = hKey[hn]; hn--;
    let c = 1;
    for (;;) { const l = c * 2, r = l + 1; let m = c; if (l <= hn && hKey[l] < hKey[m]) m = l; if (r <= hn && hKey[r] < hKey[m]) m = r; if (m === c) break; const ti = hIdx[m]; hIdx[m] = hIdx[c]; hIdx[c] = ti; const tk = hKey[m]; hKey[m] = hKey[c]; hKey[c] = tk; c = m; }
    return top;
  };
  for (const s of sources) { dist[s] = 0; push(s, 0); }
  const nb = new Int32Array(6);
  while (hn > 0) {
    const u = pop();
    const du = dist[u];
    neighborsByDir(u % W, (u / W) | 0, W, H, nb);
    for (let d = 0; d < 6; d++) {
      const v = nb[d];
      if (v < 0) continue;
      const w = surf[v];
      if (!isFinite(w)) continue;
      const nd = du + w;
      if (nd < dist[v]) { dist[v] = nd; pred[v] = u; push(v, nd); }
    }
  }
}

export function pass11Roads(f: Fields, cfg: GenConfig): void {
  const { width: W, height: H } = f;
  const N = W * H;

  const majorRiver = new Uint8Array(N);
  for (const r of f.rivers) if (r.width >= 2) for (const c of r.path) majorRiver[c] = 1;

  const surf = new Float32Array(N);
  for (let i = 0; i < N; i++) surf[i] = baseCost(f, i, cfg);
  for (const st of f.settlements) surf[st.index] = ROAD_SURF; // settlements are road anchors

  const dist = new Float32Array(N), pred = new Int32Array(N);
  const roads: RoadPolyline[] = [];

  const layPath = (path: number[], cls: number) => {
    for (const c of path) {
      if (!f.road[c]) {
        f.road[c] = 1;
        if (f.river[c]) f.bridge[c] = majorRiver[c] ? 2 : 1;
      }
      surf[c] = ROAD_SURF;
    }
    if (path.length >= 2) roads.push({ path, class: cls });
  };

  // Group city/town nodes by landmass.
  const nodesByLm = new Map<number, { index: number; tier: number }[]>();
  for (const st of f.settlements) {
    if (st.tier > 1) continue; // cities + towns only
    const lm = f.landmassId[st.index];
    if (!nodesByLm.has(lm)) nodesByLm.set(lm, []);
    (nodesByLm.get(lm) as { index: number; tier: number }[]).push(st);
  }

  for (const [, nodes] of nodesByLm) {
    if (nodes.length < 2) continue;
    nodes.sort((a, b) => a.tier - b.tier); // cities first as the seed
    const connected = new Set<number>([nodes[0].index]);
    const treeCells: number[] = [nodes[0].index];
    while (connected.size < nodes.length) {
      dijkstra(treeCells, surf, W, H, dist, pred);
      let target = -1, best = Infinity;
      for (const n of nodes) { if (connected.has(n.index)) continue; if (dist[n.index] < best) { best = dist[n.index]; target = n.index; } }
      if (target < 0 || !isFinite(best)) break; // unreachable (mountains forbidden): leave disconnected
      const node = nodes.find((n) => n.index === target) as { index: number; tier: number };
      const path: number[] = [];
      let c = target;
      while (c >= 0) { path.push(c); c = pred[c]; }
      layPath(path, node.tier === 0 ? 0 : 1);
      for (const cell of path) treeCells.push(cell);
      connected.add(target);
    }
  }

  // Villages hook into the nearest road/settlement if close enough.
  const anchors: number[] = [];
  for (let i = 0; i < N; i++) if (f.road[i]) anchors.push(i);
  for (const st of f.settlements) if (st.tier <= 1) anchors.push(st.index);
  if (anchors.length > 0) {
    dijkstra(anchors, surf, W, H, dist, pred);
    for (const st of f.settlements) {
      if (st.tier !== 2) continue;
      if (dist[st.index] > cfg.villageRoadMax || !isFinite(dist[st.index])) continue;
      const path: number[] = [];
      let c = st.index;
      while (c >= 0) { path.push(c); c = pred[c]; }
      layPath(path, 1);
    }
  }

  f.roads = roads;
}
