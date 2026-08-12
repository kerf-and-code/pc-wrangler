-- p50-map-poi-color.sql
-- Per-POI colour override. Built-in icons use fill="currentColor" and are drawn in one default tint;
-- this lets the GM recolour a marker when that tint reads poorly against the chosen map. null = the
-- default. Uploaded icons carry their own colours and ignore this. Idempotent.

alter table public.map_pois add column if not exists color text;
