-- A1 Scheduling: Discord availability polls + web grid that create the next session.
-- Idempotent: safe to re-run against the live DB. Matches live schema exactly.

alter table public.campaigns add column if not exists recur_rule jsonb;

create table if not exists public.session_polls (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_by  uuid,
  status      text not null default 'open',
  slots       jsonb not null default '[]'::jsonb,
  recurring   boolean not null default false,
  channel_id  text,
  message_id  text,
  chosen_slot text,
  session_id  uuid references public.sessions(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.poll_responses (
  id              uuid primary key default gen_random_uuid(),
  poll_id         uuid not null references public.session_polls(id) on delete cascade,
  discord_user_id text,
  character_id    uuid references public.characters(id) on delete set null,
  available       jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now(),
  unique (poll_id, discord_user_id)
);

alter table public.session_polls  enable row level security;
alter table public.poll_responses enable row level security;

-- GM read; writes happen via service-role routes (Discord interactions + confirm).
drop policy if exists "gm reads polls" on public.session_polls;
create policy "gm reads polls" on public.session_polls
  for select using (is_campaign_gm(campaign_id));

drop policy if exists "gm reads poll responses" on public.poll_responses;
create policy "gm reads poll responses" on public.poll_responses
  for select using (exists (
    select 1 from public.session_polls p
    where p.id = poll_responses.poll_id and is_campaign_gm(p.campaign_id)
  ));
