-- p48-map-icons.sql
-- Phase 4 (icons): personal uploaded POI icons, tracked per campaign against a byte budget. The 169
-- built-in icons live in code (lib/worldmap/poi-icons.ts); this table is only the GM's own uploads.
-- bytes is stored so the ~1 MB per-campaign budget is a cheap sum() the upload route enforces. RLS =
-- GM of the campaign. Idempotent.

create table if not exists public.map_icons (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  key         text not null,
  label       text not null,
  url         text not null,
  bytes       integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists map_icons_campaign_idx on public.map_icons (campaign_id);

alter table public.map_icons enable row level security;

drop policy if exists "map_icons gm all" on public.map_icons;
create policy "map_icons gm all" on public.map_icons for all
  using      (exists (select 1 from public.campaigns c where c.id = campaign_id and c.gm_id = (select auth.uid())))
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and c.gm_id = (select auth.uid())));
