-- p54-world-map-snapshot.sql
-- Publishing the world map to the wiki is a flat snapshot image, not the live map. This adds where
-- that image lives and whether the GM has published it. snapshot_url holds the uploaded PNG's public
-- URL; published gates whether the wiki shows it. Both are written by the publish flow (the GM's
-- direct world_maps RLS covers the update; the image bytes go up via a service-role route, like the
-- other map uploads). The public wiki read (next step) will return snapshot_url only when published.
-- Idempotent.

alter table public.world_maps add column if not exists snapshot_url text;
alter table public.world_maps add column if not exists published boolean not null default false;
