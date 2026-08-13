// lib/worldmap/gen/bake.ts
// Turns a generated Fields into the persistence artifacts the accept flow writes: the terrain blob
// (same format the hand-paint path uses; biome byte + packed render flags), river/road polylines as
// axial [q,r] paths for a features table, and settlements/bridges/POIs as map_pois rows with base-set
// icon keys and generic labels (NO codex entries - linking a pin to an entry stays a GM act). Pure.

import { type Fields, type GenConfig } from "./types";
import {
  createTerrain, encodeTerrain, bytesToBase64, offsetToAxial,
  FLAG_SHALLOWS, FLAG_CLIFF, FLAG_DELTA, FLAG_GORGE, FLAG_FROZEN, FLAG_SALTPAN, FLAG_GLACIER,
} from "../hex";

export type BakedFeature = { kind: "river" | "road"; klass: number; path: [number, number][] };
export type BakedPoi = { col: number; row: number; iconKey: string; name: string };
export type BakedWorld = { terrain: string; features: BakedFeature[]; pois: BakedPoi[]; metadata: Record<string, unknown> };

const SETTLE_ICON = ["city_walled", "town", "village"];
const SETTLE_NAME = ["City", "Town", "Village"];
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
  const features: BakedFeature[] = [];
  for (const r of f.rivers) features.push({ kind: "river", klass: r.width, path: toPath(r.path) });
  for (const rd of f.roads) features.push({ kind: "road", klass: rd.class, path: toPath(rd.path) });

  const pois: BakedPoi[] = [];
  const push = (i: number, iconKey: string, name: string) => pois.push({ col: i % W, row: (i / W) | 0, iconKey, name });
  for (const st of f.settlements) push(st.index, SETTLE_ICON[st.tier], SETTLE_NAME[st.tier]);
  for (let i = 0; i < N; i++) { if (f.bridge[i] === 2) push(i, "bridge", "Bridge"); else if (f.bridge[i] === 1) push(i, "ford", "Ford"); }
  for (const p of f.pois) push(p.index, POI_ICON[p.kind] ?? "unknown_poi", POI_NAME[p.kind] ?? "Site");

  const metadata: Record<string, unknown> = { config: cfg, seed: cfg.seed };
  return { terrain, features, pois, metadata };
}
