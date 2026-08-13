-- p56-map-features.sql
-- Rivers and roads are overlay polylines, not per-hex biomes, so they live in their own table: a few
-- dozen rows per world, each a path of axial [q,r] pairs with a kind and class. Generation metadata
-- (the config + seed) rides on the world_maps row so a baked world can be regenerated or audited.
-- GM-only RLS, mirroring the other map tables (members will read these through the world_map_read
-- RPC). Idempotent; run by hand.

create table if not exists public.map_features (
  id uuid primary key default gen_random_uuid(),
  world_map_id uuid not null references public.world_maps(id) on delete cascade,
  kind text not null check (kind in ('river', 'road')),
  class int not null default 1,          -- river: 1 minor / 2 major; road: 0 major / 1 minor
  path jsonb not null,                    -- array of [q, r] axial pairs
  created_at timestamptz not null default now()
);

create index if not exists map_features_world_map_id_idx on public.map_features (world_map_id);

alter table public.world_maps add column if not exists gen_config jsonb;
alter table public.world_maps add column if not exists gen_seed text;

alter table public.map_features enable row level security;

drop policy if exists "map_features gm all" on public.map_features;
create policy "map_features gm all" on public.map_features for all
  using (exists (
    select 1 from public.world_maps wm
    join public.campaigns c on c.id = wm.campaign_id
    where wm.id = map_features.world_map_id and c.gm_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.world_maps wm
    join public.campaigns c on c.id = wm.campaign_id
    where wm.id = map_features.world_map_id and c.gm_id = auth.uid()
  ));
