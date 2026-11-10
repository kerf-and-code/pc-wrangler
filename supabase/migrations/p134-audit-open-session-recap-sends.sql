-- supabase/migrations/p134-audit-open-session-recap-sends.sql (2026-11-09)
--
-- Two audit fixes (Six Axes audit 1: Bugs).
--
-- B3  "The open session" is a session actually underway: started and not ended, newest start first.
--     tabletop_open_session (p105) took any session with no ended_at, ordered by when it was started OR
--     created; a session scheduled for next week has no ended_at either, so table rolls, chat and add-on
--     posts could be filed in a game that had not happened. Same rule as the Discord /record route; the
--     player roller, /api/vtt/ingest and the add-on API change with this migration's code.
-- B22 recap_sends: a log of recap emails, which /api/recap/send counts to cap sends (3 per session and
--     60 recipients per GM in any 24 hours). Server only: RLS on with no policies.
--
-- Idempotent. Run by hand after p133, then supabase/checks/p134-audit-open-session-recap-sends-check.sql.

create or replace function public.tabletop_open_session(p_campaign uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.id from public.sessions s
  where s.campaign_id = p_campaign and s.started_at is not null and s.ended_at is null
  order by s.started_at desc
  limit 1;
$function$;
revoke all on function public.tabletop_open_session(uuid) from public, anon;
grant execute on function public.tabletop_open_session(uuid) to authenticated;

create table if not exists public.recap_sends (
  id          bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  sent_by     uuid not null references public.profiles(id) on delete cascade,
  recipients  integer not null check (recipients between 0 and 100),
  created_at  timestamptz not null default now()
);
create index if not exists recap_sends_sender_idx on public.recap_sends (sent_by, created_at desc);
alter table public.recap_sends enable row level security;
revoke all on public.recap_sends from anon, authenticated;
grant select, insert on public.recap_sends to service_role;
