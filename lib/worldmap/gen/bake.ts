// lib/worldmap/gen/bake.ts
// Turns a generated Fields into the persistence artifacts the accept flow writes: the terrain blob
// (same format the hand-paint path uses; biome byte + packed render flags), river/road polylines as
// axial [q,r] paths for a features table, and settlements/bridges/POIs as map_pois rows with base-set
// icon keys and generic labels (NO codex entries - linking a pin to an entry stays a GM act). Pure.

import { type Fields, type GenConfig } from "./types";
import { hexToPixel, BASE_SIZE } from "../layout";
import { settlementName, dungeonName, caveName, riverName } from "./names";
import {
  createTerrain, encodeTerrain, bytesToBase64, offsetToAxial,
  FLAG_SHALLOWS, FLAG_CLIFF, FLAG_DELTA, FLAG_GORGE, FLAG_FROZEN, FLAG_SALTPAN, FLAG_GLACIER,
} from "../hex";

export type BakedFeature = { kind: "river" | "road"; klass: number; path: [number, number][]; name: string | null };
export type BakedPoi = { col: number; row: number; x: number; y: number; iconKey: string; name: string };
export type BakedWorld = { terrain: string; features: BakedFeature[]; pois: BakedPoi[]; metadata: Record<string, unknown> };

const SETTLE_ICON = ["city_walled", "town", "village"];
const POI_ICON: Record<string, string> = { ore: "mine_generic", gems: "gem_mine", lumber: "lumber_camp", farmland: "farmland", fishing: "fishing_spot", herbs: "herb_node", cave: "cave_entrance", dungeon: "dungeon_entrance", hazard: "unstable_ground" };
const POI_NAME: Record<string, string> = { ore: "Ore vein", gems: "Gem deposit", lumber: "Lumber camp", farmland: "Farmland", fishing: "Fishing ground", herbs: "Herb grove", cave: "Cave entrance", dungeon: "Ruins", hazard: "Hazard" };

export function bakeWorld(f: Fields, cfg: GenConfig, originCol: number, originRow: number): BakedWorld {
  const W = f.width, H = f.height, N = W * H;

  const t = createTerrain(W, H, originCol, originRow);
  t.biome.set(f.biome);
  for (let i = 0; i < N; i++) {
    let fl = 0;
    if (f.shallows[i]) fl |= FLAG_SHALLOWS;
    if (f.cliff[i]) fl |= FLAG_CLIFF;
    if (f.delta[i]) fl |= FLAG_DELTA;
    if (f.gorge[i]) fl |= FLAG_GORGE;
    if (f.frozen[i]) fl |= FLAG_FROZEN;
    if (f.saltPan[i]) fl |= FLAG_SALTPAN;
    if (f.glacier[i]) fl |= FLAG_GLACIER;
    t.flags[i] = fl;
  }
  const terrain = bytesToBase64(encodeTerrain(t));

  const toPath = (idxs: number[]): [number, number][] => idxs.map((i) => { const a = offsetToAxial(i % W, (i / W) | 0); return [a.q, a.r]; });
  // Group river polylines into systems (share a cell => same river) so a river is named once, on its
  // trunk (longest segment). Tiny systems stay unnamed.
  const R = f.rivers;
  const parent = R.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const firstSeen = new Map<number, number>();
  R.forEach((r, pi) => { for (const cell of r.path) { const seen = firstSeen.get(cell); if (seen !== undefined) parent[find(pi)] = find(seen); else firstSeen.set(cell, pi); } });
  const sysLen = new Map<number, number>();
  const sysTrunk = new Map<number, number>();
  const sysAnchor = new Map<number, number>();
  R.forEach((r, pi) => {
    const root = find(pi);
    sysLen.set(root, (sysLen.get(root) ?? 0) + r.path.length);
    const t = sysTrunk.get(root);
    if (t === undefined || r.path.length > R[t].path.length) sysTrunk.set(root, pi);
    const a = sysAnchor.get(root);
    if (a === undefined || r.path[0] < a) sysAnchor.set(root, r.path[0]);
  });
  const trunkName = new Map<number, string>();
  for (const [root, len] of sysLen) {
    if (len < 8) continue; // skip tiny creeks
    const trunk = sysTrunk.get(root);
    const anchor = sysAnchor.get(root);
    if (trunk !== undefined && anchor !== undefined) trunkName.set(trunk, riverName(cfg.seed, anchor));
  }

  const features: BakedFeature[] = [];
  R.forEach((r, pi) => features.push({ kind: "river", klass: r.width, path: toPath(r.path), name: trunkName.get(pi) ?? null }));
  for (const rd of f.roads) features.push({ kind: "road", klass: rd.class, path: toPath(rd.path), name: null });

  const pois: BakedPoi[] = [];
  const push = (i: number, iconKey: string, name: string) => {
    const col = i % W, row = (i / W) | 0;
    const p = hexToPixel(col, row, BASE_SIZE);
    pois.push({ col, row, x: p.x, y: p.y, iconKey, name });
  };
  for (const st of f.settlements) push(st.index, SETTLE_ICON[st.tier], settlementName(cfg.seed, st.index, f.biome[st.index]));
  for (let i = 0; i < N; i++) { if (f.bridge[i] === 2) push(i, "bridge", "Bridge"); else if (f.bridge[i] === 1) push(i, "ford", "Ford"); }
  for (const p of f.pois) {
    const nm = p.kind === "dungeon" ? dungeonName(cfg.seed, p.index)
      : p.kind === "cave" ? caveName(cfg.seed, p.index)
      : (POI_NAME[p.kind] ?? "Site");
    push(p.index, POI_ICON[p.kind] ?? "unknown_poi", nm);
  }

  const metadata: Record<string, unknown> = { config: cfg, seed: cfg.seed };
  return { terrain, features, pois, metadata };
}
