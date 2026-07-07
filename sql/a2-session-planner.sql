-- A2 Session Planner: manual next-session beats on Prep, linked to threads/NPCs.
-- (Includes the `source` column added by B2; b2-prep-assist.sql re-adds it defensively.)

create table if not exists public.session_plan_items (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.campaigns(id) on delete cascade,
  title               text not null,
  note                text,
  kind                text not null default 'scene',
  difficulty          text,
  linked_event_id     uuid references public.gm_events(id) on delete set null,
  linked_character_id uuid references public.characters(id) on delete set null,
  position            integer not null default 0,
  done                boolean not null default false,
  created_at          timestamptz not null default now(),
  source              text not null default 'gm'
);

alter table public.session_plan_items enable row level security;
drop policy if exists "gm all plan items" on public.session_plan_items;
create policy "gm all plan items" on public.session_plan_items
  for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));
