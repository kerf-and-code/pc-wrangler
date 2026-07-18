-- supabase/migrations/p7-capture-heartbeat.sql
--
-- Crash recovery for the voice sidecar.
--
-- THE PROBLEM THIS SOLVES
--
-- All recording state lives in the sidecar process (Sidecar.recordings, keyed by
-- capture_control.id). On 2026-07-18 Fly OOM-killed the machine mid-session. It
-- restarted in seven seconds and reconnected to Discord cleanly, but it came back with
-- an empty recordings dict, so:
--
--   1. Nothing rejoined the voice channel. The in-process reconnect handler in
--      maintain_recordings never ran, because there was no process left to run it.
--   2. The capture_control row stayed 'active' forever, owned by nobody.
--   3. capture_control_one_open_per_guild is a UNIQUE index over exactly
--      ('requested','active','stopping'), so that orphan row blocked every subsequent
--      /record in the guild, at the database level, until someone ran /stop.
--
-- An 'active' row is therefore ambiguous today: it means either "a healthy recording is
-- in progress" or "a process died holding this". Nothing in the schema can tell them
-- apart, because updated_at is only written on state TRANSITIONS, so a healthy
-- three-hour recording and a row orphaned three hours ago look identical.
--
-- WHAT THIS ADDS
--
-- heartbeat_at: written by the sidecar on every poll tick for rows it is actively
-- holding. Fresh heartbeat means a live process owns it; stale heartbeat on an open row
-- means it is an orphan and may be adopted or cleared.
--
-- owner: which process holds it (Fly machine id). Diagnostic, and the guard against
-- split brain if the app is ever scaled past one machine. `fly scale show` currently
-- reports COUNT 2, and two machines running the same bot token would both poll this
-- table, so knowing who claimed a row matters.
--
-- ADDITIVE AND IDEMPOTENT. No column is dropped, no constraint changes, and the unique
-- index is untouched: recovery works by ADOPTING an orphaned row rather than inserting
-- alongside it, so the one-open-per-guild guarantee is preserved rather than relaxed.
-- Safe to run more than once, and safe to run while a recording is in progress.

alter table public.capture_control
  add column if not exists heartbeat_at timestamptz;

alter table public.capture_control
  add column if not exists owner text;

comment on column public.capture_control.heartbeat_at is
  'Last time the owning sidecar process confirmed it is still holding this recording. Written every poll tick while active. A NULL or stale value on an open row (requested/active/stopping) means the process died and the row is an orphan.';

comment on column public.capture_control.owner is
  'Identifier of the sidecar process holding this row (Fly machine id). Diagnostic, and guards against two machines claiming the same recording.';

-- Finding orphans is the hot path for both boot reconciliation and the /record adoption
-- check, and both filter on open status then sort by staleness.
create index if not exists capture_control_open_heartbeat_idx
  on public.capture_control (heartbeat_at)
  where status in ('requested', 'active', 'stopping');

-- Backfill. Existing open rows have never had a heartbeat, and seeding them from
-- updated_at is the honest reading: that is genuinely the last time anything touched
-- them. Any row already stale therefore reads as an orphan immediately, which is the
-- correct answer for the one sitting open right now.
update public.capture_control
set heartbeat_at = updated_at
where heartbeat_at is null
  and status in ('requested', 'active', 'stopping');

-- Verification. Run after applying. Anything with a stale_seconds in the thousands is an
-- orphan holding the guild lock.
select
  id,
  guild_id,
  session_id,
  channel_id,
  status,
  owner,
  heartbeat_at,
  round(extract(epoch from (now() - coalesce(heartbeat_at, updated_at))))::int as stale_seconds
from public.capture_control
where status in ('requested', 'active', 'stopping')
order by heartbeat_at nulls first;
