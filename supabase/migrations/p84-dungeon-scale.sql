-- ============================================================================
-- p84-dungeon-scale.sql
-- Let the dungeon builder set its own map scale, independent of grid size.
--
-- WHY
--   The dungeon's "1 square = X feet" was DERIVED from the grid side (side/5), so a 50x50 map was
--   always 10 ft/square and there was no way to draw, say, a 50x50 map at the standard 5 ft/square.
--   Grid dimensions (how many squares) and scale (how big each square is) are two different choices,
--   and a battle map needs both. This adds an explicit, GM-set scale.
--
-- BACK-COMPAT
--   Nullable, no default. A null value means "derive from grid size" exactly as before, so every
--   existing dungeon_maps row renders unchanged until the GM sets a value.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

alter table public.dungeon_maps
  add column if not exists feet_per_square int;

comment on column public.dungeon_maps.feet_per_square is
  'GM-set real feet per grid square. Null = derive from grid size (side / 5), the pre-p84 behavior. '
  'Grid size sets how many squares; this sets how big each one is.';

-- Verify:
--   select campaign_id, feet_per_square from public.dungeon_maps;
