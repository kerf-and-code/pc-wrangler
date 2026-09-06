-- p87-custom-tiles.sql
-- A GM's GLOBAL custom-tile library. A custom tile is a cropped image (a hexagon for the world map, a
-- square for the dungeon) plus an average colour and a label. It is owned by the GM and shared across
-- ALL their campaigns (not campaign-scoped), so it appears as an extra brush/hex type in every map they
-- build. The cropped PNG lives in the existing public 'campaign-maps' bucket under
--   custom-tiles/<profile_id>/<tile_id>.png
-- and is written server-side by the /api/custom-tiles route using the service-role client, so no new
-- storage bucket or storage RLS policy is required (the bucket is already public-read).
--
-- profile_id has no FK here on purpose: the owning id is always auth.uid() (defaulted and RLS-enforced),
-- and not hard-binding to a specific profiles/users table keeps this migration independent of that
-- table's exact name. Rows are cheap and owner-scoped; orphan cleanup is not a concern.
--
-- Idempotent. Run by hand in the Supabase SQL editor BEFORE deploying the code that reads/writes it.

create table if not exists public.custom_tiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null default auth.uid(),
  scope text not null check (scope in ('dungeon', 'world')),
  label text not null default 'Custom tile',
  color text not null default '#888888',
  image_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists custom_tiles_owner_scope on public.custom_tiles (profile_id, scope, created_at desc);

alter table public.custom_tiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'custom_tiles' and policyname = 'custom_tiles_owner') then
    create policy custom_tiles_owner on public.custom_tiles
      for all
      using (profile_id = auth.uid())
      with check (profile_id = auth.uid());
  end if;
end $$;

-- Verify:
--   select id, scope, label, color, image_url from public.custom_tiles where profile_id = auth.uid();
