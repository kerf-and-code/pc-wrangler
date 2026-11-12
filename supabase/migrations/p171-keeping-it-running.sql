-- supabase/migrations/p171-keeping-it-running.sql (2026-11-12, push 50: audit round 2, T15)
--
-- cron_runs: one row per scheduled job, stamped by the job itself every time it runs
-- (lib/cron-beat.ts). The every-minute job compares each row with how often that job should run and
-- alerts the ops channel when one has gone quiet; /api/health/crons answers the same question for an
-- outside uptime monitor, which is what notices if the scheduler itself stops.
--
-- The six jobs in vercel.json are seeded with last_ok_at = now(), so a job that never runs again shows
-- as late once its own interval has passed, instead of never being noticed because it has no row.
-- Service role only: row level security on, no policies.
--
-- Idempotent. Run by hand after p170, then supabase/checks/p171-keeping-it-running-check.sql.

create table if not exists public.cron_runs (
  name            text primary key,
  last_started_at timestamptz,
  last_ok_at      timestamptz,
  last_error_at   timestamptz,
  last_error      text,
  alerted_at      timestamptz,
  updated_at      timestamptz not null default now()
);
alter table public.cron_runs enable row level security;
revoke all on table public.cron_runs from anon, authenticated;
grant select, insert, update, delete on table public.cron_runs to service_role;

insert into public.cron_runs (name, last_ok_at)
values ('session-reminders', now()), ('audio-retention', now()), ('campaign-purge', now()),
       ('notification-digest', now()), ('advance-jobs', now()), ('addon-deliver', now())
on conflict (name) do nothing;

insert into public._migrations (name) values ('p171-keeping-it-running') on conflict do nothing;
