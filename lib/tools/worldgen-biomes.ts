// lib/tools/worldgen-biomes.ts
//
// Static biome palette for the free, no-login world-map generator. In the app the biomes come from the
// `biomes` DB table; a logged-out tool can't query it, so the rows are baked in here (exported from that
// table, verbatim: id, key, label, category, color). Indexed arrays feed renderWorldSnapshot: BIOME_COLORS
// is the flat-fill fallback, BIOME_ART points at the same public tile art the product uses. Keep in sync
// with the biomes table if new biomes are added.

export type WorldBiome = { id: number; key: string; label: string; category: string; color: string };

export const WORLD_BIOMES: WorldBiome[] = [
  { id: 0, key: "plains", label: "Plains / grassland", category: "terrestrial", color: "#b7c26a" },
  { id: 1, key: "savanna", label: "Savanna", category: "terrestrial", color: "#cbb35e" },
  { id: 2, key: "prairie_steppe", label: "Prairie / steppe", category: "terrestrial", color: "#c2c07a" },
  { id: 3, key: "forest_temperate", label: "Forest (temperate)", category: "terrestrial", color: "#4f8a4c" },
  { id: 4, key: "taiga", label: "Taiga / boreal forest", category: "terrestrial", color: "#3f6b52" },
  { id: 5, key: "rainforest", label: "Rainforest (tropical)", category: "terrestrial", color: "#2f7d3a" },
  { id: 6, key: "jungle", label: "Jungle", category: "terrestrial", color: "#3d8f3a" },
  { id: 7, key: "mediterranean", label: "Mediterranean scrubland / chaparral", category: "terrestrial", color: "#a8a25a" },
  { id: 8, key: "desert_sandy", label: "Desert (sandy)", category: "terrestrial", color: "#e3cf8f" },
  { id: 9, key: "desert_rocky", label: "Desert (rocky / badlands)", category: "terrestrial", color: "#c19a6b" },
  { id: 10, key: "tundra", label: "Tundra", category: "terrestrial", color: "#ccd3cf" },
  { id: 11, key: "alpine", label: "Alpine / high mountain", category: "terrestrial", color: "#b9c4cc" },
  { id: 12, key: "highland_plateau", label: "Highland plateau", category: "terrestrial", color: "#a7a06f" },
  { id: 13, key: "swamp_marsh", label: "Swamp / marsh", category: "wetland", color: "#5c6e4a" },
  { id: 14, key: "bog_fen", label: "Bog / fen", category: "wetland", color: "#6b6f4e" },
  { id: 15, key: "river", label: "River", category: "water", color: "#4a86c4" },
  { id: 16, key: "lake", label: "Lake", category: "water", color: "#3f7fbf" },
  { id: 17, key: "sea_ocean", label: "Sea / ocean", category: "water", color: "#2c5f8a" },
  { id: 18, key: "coast", label: "Coast / coastline", category: "water", color: "#6fa8c9" },
  { id: 19, key: "reef_lagoon", label: "Reef / lagoon", category: "water", color: "#4fb3b0" },
  { id: 20, key: "mountains", label: "Mountains", category: "geologic", color: "#8a8378" },
  { id: 21, key: "volcanic", label: "Volcanic", category: "geologic", color: "#6e4a45" },
  { id: 22, key: "canyon_badlands", label: "Canyon / badlands", category: "geologic", color: "#b5764a" },
  { id: 23, key: "cave_entrance", label: "Cave / underground entrance", category: "geologic", color: "#5a5550" },
  { id: 24, key: "blighted", label: "Corrupted / blighted lands", category: "fantasy", color: "#6b4a6b" },
  { id: 25, key: "enchanted_forest", label: "Enchanted forest", category: "fantasy", color: "#4a8f8a" },
  { id: 26, key: "crystal_caverns", label: "Crystal caverns", category: "fantasy", color: "#7fa8d0" },
  { id: 27, key: "feywild", label: "Feywild-touched region", category: "fantasy", color: "#9a6fbf" },
];

// Indexed by biome id, for renderWorldSnapshot's `colors` and `biomeArt`.
export const BIOME_COLORS: string[] = (() => {
  const a: string[] = [];
  for (const b of WORLD_BIOMES) a[b.id] = b.color;
  return a;
})();

export const BIOME_ART: string[] = (() => {
  const a: string[] = [];
  for (const b of WORLD_BIOMES) a[b.id] = `/worldmap/biomes/${b.key}.png`;
  return a;
})();
