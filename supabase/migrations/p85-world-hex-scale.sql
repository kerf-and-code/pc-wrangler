-- ============================================================================
-- p85-world-hex-scale.sql
-- Let the world map set its own hex scale, independent of map size.
--
-- WHY
--   Miles-per-hex was DERIVED from the map's larger side (60->6, 100->15, ... 250->60), so a GM could
--   not, say, draw a 100-wide map at 5 miles/hex for a tight regional map. Grid size (how many hexes)
--   and scale (how many miles each hex spans) are separate choices; this adds an explicit, GM-set scale
--   that feeds both the region measurements and the render's scale hint.
--
-- BACK-COMPAT
--   Nullable, no default. Null means "derive from map size" exactly as before, so every existing
--   world_maps row is unchanged until the GM sets a value.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

alter table public.world_maps
  add column if not exists miles_per_hex int;

comment on column public.world_maps.miles_per_hex is
  'GM-set miles per hex. Null = derive from map size (the piecewise 60->6 .. 250->60 default). '
  'Map size sets how many hexes; this sets how many miles each one spans.';

-- Verify:
--   select campaign_id, width, height, miles_per_hex from public.world_maps;
