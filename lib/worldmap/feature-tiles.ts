// lib/worldmap/feature-tiles.ts
// Connected-tile selection for the hex world map, implementing tile-connection-rules.md. Pure logic:
// build per-cell river/road edge bitmasks from the map_features polylines, then pick a tile name and
// a rotation for each cell from the verified edge sets of the delivered art. Edge indices follow
// DIR_NAMES [E, NE, NW, W, SW, SE] (bit d = 1 << d). Rotation k shifts an artwork edge d to
// (d + k) % 6; on the y-down canvas that is ctx.rotate(-k * PI / 3). Deterministic: variant picks
// hash the cell index, so the same map always renders the same tiles.

import { AXIAL_DIRS, offsetToAxial, axialToOffset, index } from "./hex";

export type MapFeatureLike = { kind: "river" | "road"; klass: number; path: [number, number][] };
export type TileChoice = { name: string; rot: number; flip: boolean; kind: "feature" | "terrain"; overlay: boolean; coversRiver?: boolean; coversRoad?: boolean };
export type FeatureEdges = { riverEdges: Uint8Array; roadEdges: Uint8Array; riverClass: Uint8Array };

const B = (...ds: number[]) => ds.reduce((m, d) => m | (1 << d), 0);
const rotMask = (m: number, k: number) => (((m << k) | (m >> (6 - k))) & 63);
const pop = (m: number) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };
// Horizontal mirror in edge space (reflection across the vertical axis): E<->W, NE<->NW, SW<->SE.
const FLIP = [3, 2, 1, 0, 5, 4];
const flipMask = (m: number) => { let o = 0; for (let d = 0; d < 6; d++) if (m & (1 << d)) o |= 1 << FLIP[d]; return o; };
// Returns [k, flip] so that (flip then rotate by k) maps the art's edges onto the target, or null.
const matchRotFlip = (art: number, target: number): [number, boolean] | null => {
  for (let k = 0; k < 6; k++) if (rotMask(art, k) === target) return [k, false];
  const fa = flipMask(art);
  for (let k = 0; k < 6; k++) if (rotMask(fa, k) === target) return [k, true];
  return null;
};
const hash = (i: number) => ((i * 2654435761) >>> 8) % 100;
// The edge index (DIR_NAMES) whose direction best represents a set of edges, by angle centroid.
const dominantDir = (mask: number): number => {
  let sx = 0, sy = 0;
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) { const a = (d * 60) * Math.PI / 180; sx += Math.cos(a); sy += Math.sin(a); }
  if (sx === 0 && sy === 0) return 0;
  let deg = Math.atan2(sy, sx) * 180 / Math.PI; if (deg < 0) deg += 360;
  return Math.round(deg / 60) % 6;
};

// Verified canonical edge sets of the art (tile-connection-rules.md).
const RIVER_TILES: [string, number][] = [
  ["river_source", B(0)], ["river_straight", B(0, 3)], ["river_bend_wide", B(0, 2)],
  ["river_bend_sharp", B(0, 1)], ["river_confluence_y", B(0, 2, 4)], ["river_confluence_t", B(0, 1, 3)],
];
const ROAD_TILES: [string, number][] = [
  ["road_end", B(0)], ["road_straight", B(0, 3)], ["road_bend_wide", B(0, 2)],
  ["road_bend_sharp", B(0, 1)], ["road_t", B(0, 1, 3)], ["road_y", B(0, 2, 4)], ["road_cross", B(0, 2, 3, 5)],
];
const CROSSINGS: { name: string; river: number; road: number }[] = [
  { name: "road_bridge_ew", river: B(0, 3), road: B(1, 4) },
  { name: "road_bridge_ns", river: B(1, 4), road: B(0, 3) },
];
const FORD = { name: "road_ford", river: B(0, 3), road: B(1, 4) };
const COAST3 = B(2, 3, 4), COAST4 = B(2, 3, 4, 5), COAST5 = B(1, 2, 3, 4, 5);
const DELTA_RIVER = B(0), DELTA_WATER = B(2, 3, 4);
const ISLAND_BIOMES = new Set([0, 1, 2, 3, 5, 6, 7, 18]);

export function buildFeatureEdges(width: number, height: number, features: readonly MapFeatureLike[]): FeatureEdges {
  const n = width * height;
  const riverEdges = new Uint8Array(n), roadEdges = new Uint8Array(n), riverClass = new Uint8Array(n);
  const cellOf = (q: number, r: number): number => {
    const o = axialToOffset(q, r);
    if (o.col < 0 || o.col >= width || o.row < 0 || o.row >= height) return -1;
    return index(o.col, o.row, width);
  };
  for (const f of features) {
    const edges = f.kind === "river" ? riverEdges : roadEdges;
    for (let s = 0; s + 1 < f.path.length; s++) {
      const [aq, ar] = f.path[s], [bq, br] = f.path[s + 1];
      let d = -1;
      for (let t = 0; t < 6; t++) if (aq + AXIAL_DIRS[t].q === bq && ar + AXIAL_DIRS[t].r === br) { d = t; break; }
      if (d < 0) continue; // non-adjacent points: leave to the polyline
      const ia = cellOf(aq, ar), ib = cellOf(bq, br);
      if (ia >= 0) edges[ia] |= 1 << d;
      if (ib >= 0) edges[ib] |= 1 << ((d + 3) % 6);
      if (f.kind === "river") {
        if (ia >= 0 && f.klass > riverClass[ia]) riverClass[ia] = f.klass;
        if (ib >= 0 && f.klass > riverClass[ib]) riverClass[ib] = f.klass;
      }
    }
  }
  return { riverEdges, roadEdges, riverClass };
}

export type SelectEnv = {
  width: number; height: number;
  biome: Uint8Array; flags: Uint8Array;
  edges: FeatureEdges;
};

const FL_CLIFF = 2, FL_DELTA = 4, FL_GORGE = 8, FL_FROZEN = 16, FL_SALTPAN = 32, FL_GLACIER = 64, FL_SNOWCAP = 128;

export function selectTile(col: number, row: number, env: SelectEnv): TileChoice | null {
  const { width, height, biome, flags, edges } = env;
  const i = index(col, row, width);
  const b = biome[i], fl = flags[i];
  const rE = edges.riverEdges[i], dE = edges.roadEdges[i];
  const a = offsetToAxial(col, row);
  const nbBiome = (d: number): number => {
    const o = axialToOffset(a.q + AXIAL_DIRS[d].q, a.r + AXIAL_DIRS[d].r);
    if (o.col < 0 || o.col >= width || o.row < 0 || o.row >= height) return -1;
    return biome[index(o.col, o.row, width)];
  };
  const nbFlag = (d: number): number => {
    const o = axialToOffset(a.q + AXIAL_DIRS[d].q, a.r + AXIAL_DIRS[d].r);
    if (o.col < 0 || o.col >= width || o.row < 0 || o.row >= height) return 0;
    return flags[index(o.col, o.row, width)];
  };

  // 1. River + road in one cell: bridge (major river) or ford (minor). Both features must match at
  // the SAME rotation+flip, so mirrored (120-degree) crossings resolve via the flip.
  if (rE && dE) {
    const arts = edges.riverClass[i] >= 2 ? CROSSINGS : [FORD];
    for (const art of arts) {
      for (const flip of [false, true]) {
        const ar = flip ? flipMask(art.river) : art.river;
        const ad = flip ? flipMask(art.road) : art.road;
        for (let k = 0; k < 6; k++) {
          if (rotMask(ar, k) === rE && rotMask(ad, k) === dE) return { name: art.name, rot: k, flip, kind: "feature", overlay: true, coversRiver: true, coversRoad: true };
        }
      }
    }
    // No EXACT match (road bends, or the road's edges differ from the tile's painted road). As long
    // as the RIVER runs straight-ish through this cell, still show a bridge/ford spanning it and let
    // the road polyline draw over the top - so a bridge appears at (almost) every crossing.
    const spanArt = edges.riverClass[i] >= 2 ? "road_bridge_ew" : "road_ford"; // both paint river E-W
    const dir = dominantDir(rE); // orient the bridge's river axis along the river's main direction
    return { name: spanArt, rot: dir, flip: false, kind: "feature", overlay: true, coversRiver: true, coversRoad: false };
  }

  // 2. Delta: river edge to upstream, sea filling the far side.
  if ((fl & FL_DELTA) && rE && pop(rE) === 1) {
    let d = 0; while (!(rE & (1 << d))) d++;
    const k = d; // art river edge is 0
    let waterHits = 0;
    for (let e = 0; e < 6; e++) if (rotMask(DELTA_WATER, k) & (1 << e)) { const nb = nbBiome(e); if (nb >= 15 && nb <= 19) waterHits++; }
    if (waterHits >= 2) return { name: "delta_fan", rot: k, flip: false, kind: "feature", overlay: true, coversRiver: true };
  }

  // 3. Waterfall: gorge/cliff river step with a wide (lake/sea) upstream pair.
  if ((fl & (FL_GORGE | FL_CLIFF)) && rE && pop(rE) === 1) {
    for (let k = 0; k < 6; k++) {
      const n1 = nbBiome((1 + k) % 6), n2 = nbBiome((2 + k) % 6);
      const wide = (x: number) => x === 16 || x === 17;
      if (wide(n1) && wide(n2) && (rE & (1 << ((5 + k) % 6)))) return { name: "waterfall", rot: k, flip: false, kind: "feature", overlay: true, coversRiver: true };
    }
  }

  // 4/5. Plain river or road path tiles.
  if (rE) { for (const [name, art] of RIVER_TILES) { const m = matchRotFlip(art, rE); if (m) return { name, rot: m[0], flip: m[1], kind: "feature", overlay: true, coversRiver: true }; } return null; }
  if (dE) { for (const [name, art] of ROAD_TILES) { const m = matchRotFlip(art, dE); if (m) return { name, rot: m[0], flip: m[1], kind: "feature", overlay: true, coversRoad: true }; } return null; }

  // 6-8. Flag terrain: salt pans, snowcaps, glacier sheet/margin.
  if (fl & FL_SALTPAN) return { name: "salt_flat", rot: 0, flip: false, kind: "terrain", overlay: false };
  if (fl & FL_SNOWCAP) return { name: "snowcap_peak", rot: 0, flip: false, kind: "terrain", overlay: false };
  if (fl & FL_GLACIER) {
    let iceMask = 0;
    for (let d = 0; d < 6; d++) if (nbFlag(d) & FL_GLACIER) iceMask |= 1 << d;
    if (iceMask !== 63) { const m = matchRotFlip(COAST3, iceMask); if (m) return { name: "glacier_margin", rot: m[0], flip: m[1], kind: "terrain", overlay: true }; }
    return { name: "glacier_sheet", rot: 0, flip: false, kind: "terrain", overlay: false };
  }

  // 9/10. Frozen seas and volcanoes (variants by hash so it is not wall-to-wall).
  if ((fl & FL_FROZEN) && (b === 17 || b === 18)) { if (hash(i) < 45) return { name: "iceberg_sea", rot: 0, flip: false, kind: "terrain", overlay: false }; return null; }
  if (b === 21) { if (hash(i) < 50) return { name: "volcanic_peak", rot: 0, flip: false, kind: "terrain", overlay: false }; return null; }

  // 11. One-hex islands: land completely ringed by open water.
  if (ISLAND_BIOMES.has(b)) {
    let allWater = true;
    for (let d = 0; d < 6; d++) { const nb = nbBiome(d); if (!(nb === 16 || nb === 17 || nb === 19)) { allWater = false; break; } }
    if (allWater) return { name: hash(i) < 70 ? "island_small" : "islet_rocky", rot: 0, flip: false, kind: "terrain", overlay: false };
  }

  // 12. Coast: exact shape when the water edges fit a tile, otherwise a straight shore rotated to
  // face the water centroid, so every shore hex gets a beach and the coastline never gaps.
  if (b === 18) {
    let w = 0;
    for (let d = 0; d < 6; d++) { const nb = nbBiome(d); if (nb === 16 || nb === 17 || nb === 19) w |= 1 << d; }
    const c = pop(w);
    if (c === 0) return null; // no water neighbor: leave to the biome fill
    if (c >= 5) { const m = matchRotFlip(COAST5, w); if (m) return { name: "coast_peninsula", rot: m[0], flip: m[1], kind: "terrain", overlay: true }; }
    if (c === 4) { const m = matchRotFlip(COAST4, w); if (m) return { name: "coast_bay", rot: m[0], flip: m[1], kind: "terrain", overlay: true }; }
    if (c === 3) {
      const m = matchRotFlip(COAST3, w);
      if (m) { const pick = hash(i); return { name: pick < 50 ? "coast_straight" : pick < 80 ? "coast_cape" : "coast_point", rot: m[0], flip: m[1], kind: "terrain", overlay: true }; }
    }
    // 1-2 water edges, or a non-contiguous set: face a straight/cape shore at the water.
    const k = (dominantDir(w) - 3 + 6) % 6; // canonical coast water side is W (index 3)
    return { name: hash(i) < 70 ? "coast_straight" : "coast_cape", rot: k, flip: false, kind: "terrain", overlay: true };
  }

  // 13. Reef: some cells render as an atoll.
  if (b === 19 && hash(i) < 12) return { name: "atoll_reef", rot: 0, flip: false, kind: "terrain", overlay: false };

  return null;
}
