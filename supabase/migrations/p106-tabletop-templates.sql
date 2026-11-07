-- p106-tabletop-templates.sql
--
-- Area templates on the tabletop (2026-11-06): a circle, cone, square or line left on the map, sized
-- in feet, that everyone sees and that can be moved, turned and removed.
--
--   shape     'circle' (sphere, radius), 'cone' (length), 'square' (cube, side), 'line' (length, width)
--   x, y      the point of origin, in squares from the grid's top-left (circles and cones sit on a
--             grid intersection by default)
--   size_ft   radius for a circle, length for a cone or line, side for a square
--   width_ft  a line's width (5 by default)
--   rot       direction in degrees, clockwise from east (cones, lines, squares)
--
-- Who may do what, matching Roll20: anyone at the table may place a template and move, turn or remove
-- their own; the GM manages every template. Players have no memberships rows, so the player rules go
-- through tabletop_is_player() (p105), which Realtime's RLS check also runs.
--
-- Idempotent. Run by hand after p105, then supabase/checks/p106-tabletop-templates-check.sql.

create table if not exists public.vtt_templates (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  scene_id    uuid not null references public.vtt_scenes(id) on delete cascade,
  owner       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  shape       text not null check (shape in ('circle', 'cone', 'square', 'line')),
  x           real not null,
  y           real not null,
  size_ft     real not null check (size_ft > 0 and size_ft <= 1000),
  width_ft    real not null default 5 check (width_ft > 0 and width_ft <= 200),
  rot         real not null default 0,
  color       text not null default '#e0703a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  label       text check (label is null or char_length(label) <= 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists vtt_templates_scene_idx on public.vtt_templates (scene_id);

alter table public.vtt_templates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_templates' and policyname = 'vtt_templates_gm') then
    create policy vtt_templates_gm on public.vtt_templates
      for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_templates' and policyname = 'vtt_templates_player_read') then
    create policy vtt_templates_player_read on public.vtt_templates
      for select using (tabletop_is_player(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_templates' and policyname = 'vtt_templates_player_insert') then
    create policy vtt_templates_player_insert on public.vtt_templates
      for insert with check (owner = auth.uid() and tabletop_is_player(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_templates' and policyname = 'vtt_templates_player_update') then
    create policy vtt_templates_player_update on public.vtt_templates
      for update using (owner = auth.uid() and tabletop_is_player(campaign_id))
      with check (owner = auth.uid() and tabletop_is_player(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_templates' and policyname = 'vtt_templates_player_delete') then
    create policy vtt_templates_player_delete on public.vtt_templates
      for delete using (owner = auth.uid() and tabletop_is_player(campaign_id));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vtt_templates') then
    alter publication supabase_realtime add table public.vtt_templates;
  end if;
end $$;
