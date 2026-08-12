-- p49-map-pois.sql
-- Phase 4a: POIs. A POI is a free point (x,y in the shared hex pixel frame that placed images and
-- region geometry already use) carrying an icon, a name, optional codex-entry and NPC links,
-- visibility, and a size. col/row = the hex the point falls in, stored for hierarchy context and
-- refreshed when the POI is moved. The icon is EITHER a built-in key (lib/worldmap/poi-icons.ts) OR
-- an uploaded map_icons row; if an uploaded icon is later deleted, icon_id goes null and the app
-- falls back to a default marker. RLS = GM of the map's campaign, the same gate as regions. Names
-- show on hover and in the click popup, not as on-map labels. Idempotent.

create table if not exists public.map_pois (
  id           uuid primary key default gen_random_uuid(),
  world_map_id uuid not null references public.world_maps(id) on delete cascade,
  x            double precision not null,
  y            double precision not null,
  col          smallint,
  row          smallint,
  icon_key     text,
  icon_id      uuid references public.map_icons(id) on delete set null,
  name         text not null default 'New marker',
  note         text,
  entry_id     uuid references public.entries(id) on delete set null,
  character_id uuid references public.characters(id) on delete set null,
  visibility   text not null default 'common',
  size         real not null default 1,
  created_at   timestamptz not null default now(),
  constraint map_pois_visibility_ck check (visibility in ('common', 'player', 'gm', 'private'))
);
create index if not exists map_pois_world_map_id_idx on public.map_pois (world_map_id);

alter table public.map_pois enable row level security;

drop policy if exists "map_pois gm all" on public.map_pois;
create policy "map_pois gm all" on public.map_pois for all
  using      (exists (select 1 from public.world_maps wm join public.campaigns c on c.id = wm.campaign_id where wm.id = world_map_id and c.gm_id = (select auth.uid())))
  with check (exists (select 1 from public.world_maps wm join public.campaigns c on c.id = wm.campaign_id where wm.id = world_map_id and c.gm_id = (select auth.uid())));
