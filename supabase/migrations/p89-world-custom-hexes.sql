-- p89-world-custom-hexes.sql
-- Let a world map remember which hexes were painted with a GM's custom tiles (see p87-custom-tiles).
--
-- Built-in biomes live in the packed terrain blob (world_maps.terrain, one byte per hex). Custom tiles
-- are referenced by uuid and can't fit that byte, so this adds a PARALLEL, SPARSE map: a single JSON
-- object keyed by the row-major hex index (row*width + col, as a string) -> custom-tile id. Absent keys
-- mean a built-in biome or an unpainted hex. Sparse keeps it small even on a large world.
--
--   custom_hexes = { "0": "<tile_uuid>", "412": "<tile_uuid>" }
--
-- BACK-COMPAT: nullable-safe, defaults to '{}'. Existing rows read as "no custom hexes". Idempotent.
-- Run by hand in the Supabase editor BEFORE deploying the world painter change.

alter table public.world_maps
  add column if not exists custom_hexes jsonb not null default '{}'::jsonb;

comment on column public.world_maps.custom_hexes is
  'Sparse custom-tile placements: { "<row*width+col>": "<custom_tiles.id>" }. Parallel to the terrain '
  'blob; absent keys mean a built-in biome or unpainted hex.';

-- Verify:
--   select campaign_id, jsonb_object_keys(custom_hexes) from public.world_maps limit 20;
