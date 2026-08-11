-- p43-world-map.sql
-- Phase 1 of the hex world map: the storage foundation, shared with the Phase 6 generator.
--
-- Terrain is a PACKED BLOB on the world_maps row (2 bytes per hex: biome id + render flags), stored
-- base64 in a text column the way map_fog packs its bits, NOT a row per hex. Sparse hex rows (region
-- links) arrive in Phase 2; river/road polylines and generation metadata are Phase 6. Biomes are
-- seeded as data with STABLE ids, because byte 0 of the blob is an index into this table, so an id
-- must never move once a map has been painted or generated against it.
--
-- Idempotent: create-if-not-exists, RLS re-assert is harmless, policies are drop-then-create, and
-- the biome seed is an upsert on the fixed id (so re-running refreshes labels/colours safely).

-- ---- biomes: the seeded lookup the terrain blob's byte 0 indexes into ----
create table if not exists public.biomes (
  id       smallint primary key,        -- 0..254; the value stored in blob byte 0 (255 = unset)
  key      text not null unique,
  label    text not null,
  category text not null,               -- terrestrial | wetland | water | geologic | fantasy
  color    text not null,               -- Phase 1 renders flat colours; real hex art is a later track
  sort     smallint not null default 0
);

alter table public.biomes enable row level security;
-- Reference data, readable by everyone: the world map is seen by all, and goes public on the wiki
-- later. No write policies, it is seeded here and maintained by the service role.
drop policy if exists "biomes readable by all" on public.biomes;
create policy "biomes readable by all" on public.biomes for select using (true);

insert into public.biomes (id, key, label, category, color, sort) values
  (0,  'plains',            'Plains / grassland',                    'terrestrial', '#b7c26a', 0),
  (1,  'savanna',           'Savanna',                               'terrestrial', '#cbb35e', 1),
  (2,  'prairie_steppe',    'Prairie / steppe',                      'terrestrial', '#c2c07a', 2),
  (3,  'forest_temperate',  'Forest (temperate)',                    'terrestrial', '#4f8a4c', 3),
  (4,  'taiga',             'Taiga / boreal forest',                 'terrestrial', '#3f6b52', 4),
  (5,  'rainforest',        'Rainforest (tropical)',                 'terrestrial', '#2f7d3a', 5),
  (6,  'jungle',            'Jungle',                                'terrestrial', '#3d8f3a', 6),
  (7,  'mediterranean',     'Mediterranean scrubland / chaparral',   'terrestrial', '#a8a25a', 7),
  (8,  'desert_sandy',      'Desert (sandy)',                        'terrestrial', '#e3cf8f', 8),
  (9,  'desert_rocky',      'Desert (rocky / badlands)',             'terrestrial', '#c19a6b', 9),
  (10, 'tundra',            'Tundra',                                'terrestrial', '#ccd3cf', 10),
  (11, 'alpine',            'Alpine / high mountain',                'terrestrial', '#b9c4cc', 11),
  (12, 'highland_plateau',  'Highland plateau',                      'terrestrial', '#a7a06f', 12),
  (13, 'swamp_marsh',       'Swamp / marsh',                         'wetland',     '#5c6e4a', 13),
  (14, 'bog_fen',           'Bog / fen',                             'wetland',     '#6b6f4e', 14),
  (15, 'river',             'River',                                 'water',       '#4a86c4', 15),
  (16, 'lake',              'Lake',                                  'water',       '#3f7fbf', 16),
  (17, 'sea_ocean',         'Sea / ocean',                           'water',       '#2c5f8a', 17),
  (18, 'coast',             'Coast / coastline',                     'water',       '#6fa8c9', 18),
  (19, 'reef_lagoon',       'Reef / lagoon',                         'water',       '#4fb3b0', 19),
  (20, 'mountains',         'Mountains',                             'geologic',    '#8a8378', 20),
  (21, 'volcanic',          'Volcanic',                              'geologic',    '#6e4a45', 21),
  (22, 'canyon_badlands',   'Canyon / badlands',                     'geologic',    '#b5764a', 22),
  (23, 'cave_entrance',     'Cave / underground entrance',           'geologic',    '#5a5550', 23),
  (24, 'blighted',          'Corrupted / blighted lands',            'fantasy',     '#6b4a6b', 24),
  (25, 'enchanted_forest',  'Enchanted forest',                      'fantasy',     '#4a8f8a', 25),
  (26, 'crystal_caverns',   'Crystal caverns',                       'fantasy',     '#7fa8d0', 26),
  (27, 'feywild',           'Feywild-touched region',                'fantasy',     '#9a6fbf', 27)
on conflict (id) do update
  set key = excluded.key, label = excluded.label, category = excluded.category,
      color = excluded.color, sort = excluded.sort;

-- ---- world_maps: one per campaign for now, terrain lives here as a base64 blob ----
create table if not exists public.world_maps (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  name           text not null default 'World map',
  width          smallint not null default 100,
  height         smallint not null default 100,
  origin_col     smallint not null default -50,   -- logical coord of the stored rectangle's (0,0)
  origin_row     smallint not null default -50,
  format_version smallint not null default 1,
  terrain        text,                             -- base64 of the packed blob; null until painted
  editable_by    text not null default 'gm',       -- 'gm' | 'players' (collaborative), Phase 5
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint world_maps_size_ck     check (width between 1 and 250 and height between 1 and 250),
  constraint world_maps_editable_ck check (editable_by in ('gm', 'players'))
);

-- One world map per campaign for now (Terry's call). Dropping this index is how we relax it later.
create unique index if not exists world_maps_one_per_campaign on public.world_maps (campaign_id);

alter table public.world_maps enable row level security;

-- Phase 1 is GM-only: the campaign's GM reads and writes their map. Player read and the public wiki
-- view come in Phase 5 through a SECURITY DEFINER RPC, deliberately NOT is_campaign_member: players
-- never get membership rows in this app, so a membership-keyed policy would hide the map from every
-- player (the p32 characters bug). Keyed on campaigns.gm_id, the owner, which every player is not.
drop policy if exists "world_maps gm all" on public.world_maps;
create policy "world_maps gm all" on public.world_maps for all
  using      (exists (select 1 from public.campaigns c where c.id = campaign_id and c.gm_id = (select auth.uid())))
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and c.gm_id = (select auth.uid())));
