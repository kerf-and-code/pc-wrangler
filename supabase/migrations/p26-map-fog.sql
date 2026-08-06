-- ============================================================================
-- p26-map-fog.sql
-- Fog of war on campaign maps.
--
-- SHAPE: A GRID OF FRACTIONAL CELLS, ONE BIT EACH
--   map_pins already stores x and y as fractions of the image (0-1) so a pin survives any image
--   size or zoom. Fog follows the same rule: the map is divided into cols x rows cells, and a bit
--   per cell says whether it has been revealed.
--
--   At the default 64 x 48 that is 3072 bits, about 400 bytes base64 - small enough to write on
--   every brush stroke and push over Realtime without thinking about it. A bitmap mask would look
--   smoother and would be orders of magnitude larger to store and sync; the blocky edge mostly
--   disappears under a blur on the rendered mask.
--
-- WHY A SEPARATE TABLE, NOT A COLUMN ON maps
--   Painting fog writes constantly during play. Keeping it off the maps row means the map itself is
--   not churned, and a Realtime subscription can watch only this table instead of waking every
--   client for an unrelated rename.
--
-- NO ROW MEANS NO FOG
--   A map without a row here is simply not fogged, which is every map that exists today. Fog starts
--   existing when a GM turns it on, so nothing already in use suddenly goes dark.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

create table if not exists public.map_fog (
  map_id      uuid primary key references public.maps (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  cols        integer not null default 64,
  rows        integer not null default 48,
  -- base64 of a bit-per-cell array, row-major. 1 = revealed.
  cells       text not null default '',
  updated_at  timestamptz not null default now()
);

comment on table public.map_fog is
  'Fog of war, one bit per grid cell over the map image. Cells are FRACTIONAL like map_pins.x/y, so '
  'the mask is independent of image size and zoom. Absent row = the map has no fog.';

create index if not exists map_fog_campaign_idx on public.map_fog (campaign_id);

alter table public.map_fog enable row level security;

-- The GM owns it.
drop policy if exists "gm all map fog" on public.map_fog;
create policy "gm all map fog"
  on public.map_fog for all
  to authenticated
  using (public.is_campaign_gm(campaign_id))
  with check (public.is_campaign_gm(campaign_id));

-- Players read it, and read is all they get: revealing fog is a GM action.
drop policy if exists "members read map fog" on public.map_fog;
create policy "members read map fog"
  on public.map_fog for select
  to authenticated
  using (public.is_campaign_member(campaign_id));

-- The player map is reached with a share code and no session, so anon needs a way in. Same shape as
-- the other share-code readers: one SECURITY DEFINER function, scoped to maps that are already
-- visible to players, so this cannot widen what a share code reveals.
create or replace function public.map_fog_for_share(p_share text)
returns table (map_id uuid, cols integer, rows integer, cells text, updated_at timestamptz)
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select f.map_id, f.cols, f.rows, f.cells, f.updated_at
  from public.map_fog f
  join public.maps m on m.id = f.map_id
  join public.campaigns c on c.id = f.campaign_id
  where c.share_code = p_share
    and m.visibility <> 'gm';
$$;

revoke all on function public.map_fog_for_share(text) from public;
grant execute on function public.map_fog_for_share(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- AFTER RUNNING THIS: enable Realtime on the table, or the player map will only
-- update on refresh. Supabase dashboard -> Database -> Replication -> add public.map_fog.
--
-- Verify:
--   select * from public.map_fog;
--   select * from public.map_fog_for_share('<campaign share code>');
-- ----------------------------------------------------------------------------
