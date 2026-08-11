-- p47-world-regions.sql
-- Phase 2a: regions. Nestable GM-named tiers (map_layers) hold regions; a region optionally nests
-- inside a parent one tier up, points at a codex entry for its description, and carries visibility.
-- Hexes are assigned to their LOWEST region only (world_hexes, one sparse row per assigned hex);
-- the higher tiers are derived by walking parent_region_id. Terrain stays in the world_maps blob;
-- this is relational data only. RLS on all three = the GM of the map's campaign, via the
-- world_maps -> campaigns.gm_id join that already works elsewhere (never is_campaign_member, which
-- would hide it from every player, the p32 trap).
--
-- Idempotent: create-if-not-exists, RLS re-assert, policies drop-then-create, and the default-tier
-- seed is guarded per map by NOT EXISTS.

-- ---- map_layers: the GM-defined tiers; the lowest ord is the base tier hexes attach to ----
create table if not exists public.map_layers (
  id           uuid primary key default gen_random_uuid(),
  world_map_id uuid not null references public.world_maps(id) on delete cascade,
  name         text not null,
  ord          integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists map_layers_world_map_id_idx on public.map_layers (world_map_id, ord);

-- ---- regions: a named area at one tier, optionally nested, optionally linked to a codex entry ----
create table if not exists public.regions (
  id               uuid primary key default gen_random_uuid(),
  world_map_id     uuid not null references public.world_maps(id) on delete cascade,
  layer_id         uuid not null references public.map_layers(id) on delete restrict,
  name             text not null,
  parent_region_id uuid references public.regions(id) on delete set null,
  entry_id         uuid references public.entries(id) on delete set null,
  visibility       text not null default 'common',
  tint             text,                       -- per-region colour override; null = app auto-assigns
  created_at       timestamptz not null default now(),
  constraint regions_visibility_ck check (visibility in ('common', 'player', 'gm', 'private'))
);
create index if not exists regions_world_map_id_idx on public.regions (world_map_id);
create index if not exists regions_layer_id_idx on public.regions (layer_id);
create index if not exists regions_parent_idx on public.regions (parent_region_id);

-- ---- world_hexes: sparse membership, one row per assigned hex, at its LOWEST (base-tier) region ----
create table if not exists public.world_hexes (
  id           uuid primary key default gen_random_uuid(),
  world_map_id uuid not null references public.world_maps(id) on delete cascade,
  col          smallint not null,
  row          smallint not null,
  region_id    uuid not null references public.regions(id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint world_hexes_cell_uq unique (world_map_id, col, row)
);
create index if not exists world_hexes_region_idx on public.world_hexes (region_id);

-- ---- RLS: GM of the map's campaign, on all three ----
alter table public.map_layers enable row level security;
alter table public.regions enable row level security;
alter table public.world_hexes enable row level security;

drop policy if exists "map_layers gm all" on public.map_layers;
create policy "map_layers gm all" on public.map_layers for all
  using      (exists (select 1 from public.world_maps wm join public.campaigns c on c.id = wm.campaign_id where wm.id = world_map_id and c.gm_id = (select auth.uid())))
  with check (exists (select 1 from public.world_maps wm join public.campaigns c on c.id = wm.campaign_id where wm.id = world_map_id and c.gm_id = (select auth.uid())));

drop policy if exists "regions gm all" on public.regions;
create policy "regions gm all" on public.regions for all
  using      (exists (select 1 from public.world_maps wm join public.campaigns c on c.id = wm.campaign_id where wm.id = world_map_id and c.gm_id = (select auth.uid())))
  with check (exists (select 1 from public.world_maps wm join public.campaigns c on c.id = wm.campaign_id where wm.id = world_map_id and c.gm_id = (select auth.uid())));

drop policy if exists "world_hexes gm all" on public.world_hexes;
create policy "world_hexes gm all" on public.world_hexes for all
  using      (exists (select 1 from public.world_maps wm join public.campaigns c on c.id = wm.campaign_id where wm.id = world_map_id and c.gm_id = (select auth.uid())))
  with check (exists (select 1 from public.world_maps wm join public.campaigns c on c.id = wm.campaign_id where wm.id = world_map_id and c.gm_id = (select auth.uid())));

-- ---- seed a default tier set for any existing world map that has none, so the GM starts with
-- something to rename rather than an empty list. Terry's example tiers; guarded per map. ----
insert into public.map_layers (world_map_id, name, ord)
select wm.id, v.name, v.ord
from public.world_maps wm
cross join (values ('Area', 1), ('Region', 2), ('State', 3), ('World', 4)) as v(name, ord)
where not exists (select 1 from public.map_layers ml where ml.world_map_id = wm.id);
