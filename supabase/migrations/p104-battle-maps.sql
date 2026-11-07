-- p104-battle-maps.sql
--
-- The map maker (2026-11-06): many named grid maps per campaign, each indoor or outdoor, replacing the
-- single dungeon_maps workspace. One row per map:
--
--   name             what the GM calls it ("Goblin Caves", "Forest Road Ambush")
--   kind             'indoor' (unpainted squares are solid rock) or 'outdoor' (unpainted squares are open
--                    ground in the map's ground terrain)
--   n                grid side in squares (25, 50, 75 or 100)
--   feet_per_square  scale shown on the map
--   levels           jsonb: one int array of n*n terrain codes per level (codes are lib/dungeon/render
--                    CELL_TYPES indices, 0 = unpainted)
--   custom_cells     jsonb: per level { "<cell>": "<custom_tiles.id>" }, as in p88
--   doors            jsonb: per level { "<cell>h" | "<cell>v": "door" | "double" | "locked" | "secret" |
--                    "portcullis" | "arch" }, a door on the top (h) or left (v) edge of a square
--   elements         jsonb: per level [ { "id", "k", "x", "y", "rot", "s", "text"? } ], freely placed
--                    pieces: x and y are in squares from the top-left, rot in degrees, s a size multiplier
--   meta             jsonb: title, level names, auto-numbering, ground terrain, grid look
--
-- The old dungeon_maps row is NOT touched or dropped. The map maker copies it into a first map named
-- after it the first time a campaign with no maps opens the tab, so nothing is lost and the old row can
-- be checked and retired later.
--
-- GM-only through RLS (is_campaign_gm), like encounters and combats (p101). Idempotent; run by hand.

create table if not exists public.battle_maps (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  name             text not null default 'Untitled map',
  kind             text not null default 'indoor' check (kind in ('indoor', 'outdoor')),
  n                integer not null default 25 check (n between 5 and 200),
  feet_per_square  integer not null default 5 check (feet_per_square between 1 and 1000),
  levels           jsonb not null default '[]'::jsonb,
  custom_cells     jsonb not null default '[]'::jsonb,
  doors            jsonb not null default '[]'::jsonb,
  elements         jsonb not null default '[]'::jsonb,
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists battle_maps_campaign_idx on public.battle_maps (campaign_id, created_at);

alter table public.battle_maps enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'battle_maps' and policyname = 'battle_maps_gm') then
    create policy battle_maps_gm on public.battle_maps
      for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));
  end if;
end $$;
