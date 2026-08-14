-- p60: free-floating text labels the GM places to name areas (mountain ranges, seas, deserts...).
-- A label is just text at a world point, independent of regions and POIs. GM-only for now; a member
-- read path (visibility-filtered) is added when the viewer is wired.

create table if not exists public.map_labels (
  id uuid primary key default gen_random_uuid(),
  world_map_id uuid not null references public.world_maps(id) on delete cascade,
  x double precision not null,
  y double precision not null,
  text text not null default 'Label',
  size integer not null default 18,
  color text,
  visibility text not null default 'common',
  created_at timestamptz not null default now()
);

create index if not exists map_labels_world_map_id_idx on public.map_labels(world_map_id);

alter table public.map_labels enable row level security;

-- GM of the map's campaign (the primary owner) has full access. Owner check joins
-- world_maps.campaign_id -> campaigns.gm_id (the p32-safe pattern; never is_campaign_member here).
drop policy if exists map_labels_gm_all on public.map_labels;
create policy map_labels_gm_all on public.map_labels
  for all
  using (
    exists (
      select 1
      from public.world_maps wm
      join public.campaigns c on c.id = wm.campaign_id
      where wm.id = map_labels.world_map_id
        and c.gm_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.world_maps wm
      join public.campaigns c on c.id = wm.campaign_id
      where wm.id = map_labels.world_map_id
        and c.gm_id = auth.uid()
    )
  );
