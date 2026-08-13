-- p59-ai-map.sql
-- The optional AI "fantasy view": one painted image per world map, stored on the world_maps row, with
-- a per-GM rate-limit log (3 renders per rolling 24h) and a member-readable RPC so players can see it
-- when the GM turns the toggle on. Idempotent; run by hand.

alter table public.world_maps add column if not exists ai_image_url text;
alter table public.world_maps add column if not exists ai_image_at timestamptz;

create table if not exists public.ai_map_renders (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  profile_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_map_renders_profile_time_idx on public.ai_map_renders (profile_id, created_at);

alter table public.ai_map_renders enable row level security;
-- A GM may read their own render log (for the "N left today" counter); the route writes via service role.
drop policy if exists "ai_map_renders owner read" on public.ai_map_renders;
create policy "ai_map_renders owner read" on public.ai_map_renders for select using (profile_id = auth.uid());

-- Members (and the GM) read the campaign's AI image URL, gated the same way as the feature RPC.
create or replace function public.world_map_ai_image_read(p_campaign uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when public.is_campaign_gm(p_campaign) or public.is_campaign_member(p_campaign) then
      (select wm.ai_image_url from public.world_maps wm where wm.campaign_id = p_campaign limit 1)
    else null
  end;
$function$;

grant execute on function public.world_map_ai_image_read(uuid) to authenticated;
