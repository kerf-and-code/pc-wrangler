-- Audio retention: 60-day deletion of session audio.
--
-- Implements the Part A locked decision ("audio auto-deletes 60 days after
-- recording") which was decided but never built. This is the database half:
-- a view of what is due, and a function the cron route calls to mark rows
-- purged after the storage objects are removed.
--
-- Storage objects themselves are deleted by the cron route using the service
-- role client, because Postgres cannot reach into the storage API. The order
-- matters: delete the object first, then mark the row. If the object delete
-- fails, the row stays due and the next run retries it.
--
-- Idempotent: safe to re-run.

-- 1. Track what has been purged, so we do not re-attempt forever and so we can
--    prove deletion happened (which is the point of making the promise).
alter table public.audio_tracks
  add column if not exists purged_at timestamptz;

comment on column public.audio_tracks.purged_at is
  'Set when the storage object was deleted under the 60-day retention policy. Null means the audio is still present.';

create index if not exists audio_tracks_retention_idx
  on public.audio_tracks (created_at)
  where purged_at is null;

-- 2. What is due for deletion right now.
--    Transcripts and extracted events are NOT deleted. Only the raw audio goes.
--    That is the whole design: the analysis survives, the voices do not.
create or replace view public.v_audio_due_for_purge as
select
  t.id            as track_id,
  t.campaign_id,
  t.job_id,
  t.storage_path,
  t.created_at,
  now() - t.created_at as age
from public.audio_tracks t
where t.purged_at is null
  and t.storage_path is not null
  and t.created_at < now() - interval '60 days';

comment on view public.v_audio_due_for_purge is
  'Session audio older than 60 days that has not yet been purged. Read by the retention cron.';

-- 3. Mark a track purged. Called by the cron route AFTER the storage object is
--    actually gone. Service-role only; there is no player or GM path to this.
create or replace function public.mark_audio_purged(p_track_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.audio_tracks
     set purged_at = now(),
         storage_path = null
   where id = p_track_id
     and purged_at is null;
$$;

revoke all on function public.mark_audio_purged(uuid) from public, anon, authenticated;

-- 4. Let the GM see retention state for their own campaigns, so the promise is
--    visible in the product and not just in the policy text.
create or replace view public.v_campaign_audio_retention as
select
  t.campaign_id,
  count(*) filter (where t.purged_at is null and t.storage_path is not null) as audio_present,
  count(*) filter (where t.purged_at is not null)                            as audio_purged,
  min(t.created_at) filter (where t.purged_at is null)                       as oldest_retained_at
from public.audio_tracks t
group by t.campaign_id;

comment on view public.v_campaign_audio_retention is
  'Per-campaign audio retention summary for the GM. Backs the visible retention state in the app.';
