-- p44-world-map-image.sql
-- Upload-your-own-map: an optional background image for a world map. When it is set, the renderer
-- draws the image and turns the biome fill off, leaving the hex grid as an outline over it; the
-- biome bytes stay as manual per-hex metadata the GM can still designate. The image itself lives in
-- the existing campaign-maps storage bucket under <campaign_id>/world/<file>, which the p18
-- is_campaign_gm_segment() upload policy already guards (first path segment is the campaign uuid),
-- so no new bucket or storage policy is needed here.
--
-- Idempotent: add-column-if-not-exists.

alter table public.world_maps add column if not exists image_url text;
