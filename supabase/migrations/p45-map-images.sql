-- p45-map-images.sql
-- Move-and-stitch groundwork. Images become PLACED objects (a row each) rather than the single
-- world_maps.image_url, so a GM can drag an image to line it up with the grid and, later, place
-- several to stitch a vast world with no rework. Each row is one image with a world-space transform:
-- (x, y) is the top-left in the hex pixel frame (the same space hexes live in, where the render
-- constant BASE_SIZE is the fixed reference), scale is world pixels per image pixel, and z is the
-- stacking order low to high. The renderer draws these under the grid; the painted biome bytes are
-- untouched. world_maps.image_url is kept for now but the app stops reading it once it switches to
-- this table; existing single images migrate in here.
--
-- Idempotent: create-if-not-exists, RLS re-assert (harmless), policy drop-then-create, and the
-- migration is guarded by NOT EXISTS so re-running never duplicates a row.

create table if not exists public.map_images (
  id           uuid primary key default gen_random_uuid(),
  world_map_id uuid not null references public.world_maps(id) on delete cascade,
  url          text not null,
  x            double precision not null default 0,   -- world-space top-left, hex pixel frame
  y            double precision not null default 0,
  scale        double precision not null default 1,   -- world pixels per image pixel
  z            integer not null default 0,            -- stacking order, low to high
  created_at   timestamptz not null default now()
);
create index if not exists map_images_world_map_id_idx on public.map_images (world_map_id);

alter table public.map_images enable row level security;

-- The GM of the map's campaign owns its images: the same campaigns.gm_id gate as world_maps, reached
-- by joining through it. Deliberately not is_campaign_member (players get no membership rows, the p32
-- trap). Player and public read arrive with the Phase 5 world-map RPC.
drop policy if exists "map_images gm all" on public.map_images;
create policy "map_images gm all" on public.map_images for all
  using (exists (
    select 1 from public.world_maps wm
    join public.campaigns c on c.id = wm.campaign_id
    where wm.id = world_map_id and c.gm_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.world_maps wm
    join public.campaigns c on c.id = wm.campaign_id
    where wm.id = world_map_id and c.gm_id = (select auth.uid())
  ));

-- Migrate any existing single image into a placed row. It lands at the origin at natural scale, so a
-- previously-uploaded map may need one reposition after the app switches over; new uploads will be
-- auto-fit to the grid by the app. Guarded so re-running does not duplicate.
insert into public.map_images (world_map_id, url, x, y, scale, z)
select wm.id, wm.image_url, 0, 0, 1, 0
from public.world_maps wm
where wm.image_url is not null
  and not exists (
    select 1 from public.map_images mi where mi.world_map_id = wm.id and mi.url = wm.image_url
  );
