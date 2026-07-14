-- A4 Living Map: maps + map_pins + the public campaign-maps bucket.

create table if not exists public.maps (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name        text not null default 'Map',
  image_path  text not null,
  visibility  text not null default 'player',
  created_at  timestamptz not null default now()
);

create table if not exists public.map_pins (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references public.maps(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  x           double precision not null,
  y           double precision not null,
  label       text,
  linked_type text,
  linked_id   uuid,
  visibility  text not null default 'player',
  created_at  timestamptz not null default now()
);

alter table public.maps     enable row level security;
alter table public.map_pins enable row level security;

drop policy if exists "gm all maps" on public.maps;
create policy "gm all maps" on public.maps
  for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

drop policy if exists "gm all pins" on public.map_pins;
create policy "gm all pins" on public.map_pins
  for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

-- Public bucket for base map images (secrets live in pins, not the image).
insert into storage.buckets (id, name, public)
  values ('campaign-maps', 'campaign-maps', true)
  on conflict (id) do nothing;

-- Storage policies: public read; GM of the campaign may write. (Path convention:
-- <campaign_id>/<file>. If your live policies differ, keep the live ones.)
drop policy if exists "campaign-maps public read" on storage.objects;
create policy "campaign-maps public read" on storage.objects
  for select using (bucket_id = 'campaign-maps');

drop policy if exists "campaign-maps gm write" on storage.objects;
create policy "campaign-maps gm write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'campaign-maps'
    and is_campaign_gm((split_part(name, '/', 1))::uuid));

drop policy if exists "campaign-maps gm update" on storage.objects;
create policy "campaign-maps gm update" on storage.objects
  for update to authenticated
  using (bucket_id = 'campaign-maps'
    and is_campaign_gm((split_part(name, '/', 1))::uuid));

drop policy if exists "campaign-maps gm delete" on storage.objects;
create policy "campaign-maps gm delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'campaign-maps'
    and is_campaign_gm((split_part(name, '/', 1))::uuid));
