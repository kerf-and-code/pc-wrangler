-- p88-dungeon-custom-cells.sql
-- Let a dungeon map remember which cells were painted with a GM's custom tiles (see p87-custom-tiles).
--
-- The built-in cell types already live in dungeon_maps.levels (an array of 3 int grids). Custom tiles
-- are additive and referenced by their uuid, so they can't be squeezed into that int grid. This adds a
-- PARALLEL, SPARSE structure: one JSON object per level mapping a cell index (as a string key) to a
-- custom-tile id. Empty/built-in cells are simply absent. Sparse keeps it tiny even on a 100x100 grid.
--
--   custom_cells = [ { "0": "<tile_uuid>", "37": "<tile_uuid>" }, { ... }, { ... } ]   -- one per level
--
-- BACK-COMPAT: nullable, defaults to an empty array. Existing rows are unchanged and read as "no custom
-- cells". Idempotent. Run by hand in the Supabase editor BEFORE deploying the dungeon painter change.

alter table public.dungeon_maps
  add column if not exists custom_cells jsonb not null default '[]'::jsonb;

comment on column public.dungeon_maps.custom_cells is
  'Sparse custom-tile placements, one JSON object per level: { "<cellIndex>": "<custom_tiles.id>" }. '
  'Parallel to levels; absent keys mean a built-in or empty cell.';

-- Verify:
--   select campaign_id, jsonb_array_length(custom_cells) as levels_with_custom from public.dungeon_maps;
