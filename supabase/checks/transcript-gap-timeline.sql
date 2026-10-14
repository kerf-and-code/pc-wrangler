-- supabase/checks/transcript-gap-timeline.sql
--
-- Read-only. WHEN did each track of the recent sessions land, relative to the moment the sidecar
-- finished (capture_control 'done' stamp)? Tests one specific theory for the tracks stuck at
-- 'pending' with no transcript:
--
--   The advance-jobs cron submits a 'draft' job once its newest track is more than 5 minutes old,
--   even with no 'done' marker (the aged-audio fallback). The sidecar uploads speakers ONE AT A
--   TIME, and each speaker now takes minutes (silence detection on a 2.5h track). If a gap between
--   two uploads passed 5 minutes, the cron submitted only the tracks that existed so far, those
--   finished, the job moved on to extraction and review, and the speakers uploaded afterwards were
--   never looked at again.
--
-- If the theory holds: the 'pending' tracks were created AFTER the 'done' tracks, the gap before the
-- first pending track is over 5 minutes, and the sidecar's done stamp comes after all of them.
--
-- SELECT only: no insert, update, delete or DDL. Safe to run repeatedly.
-- Written as ONE statement: the Supabase SQL editor shows only the LAST result set.

select
  c.name                                                            as campaign,
  left(j.id::text, 8)                                               as job,
  j.status::text                                                    as job_status,
  to_char(j.created_at at time zone 'America/Los_Angeles', 'MM-DD HH24:MI:SS') as job_created_pt,
  to_char(t.created_at at time zone 'America/Los_Angeles', 'MM-DD HH24:MI:SS') as track_created_pt,
  round(extract(epoch from (t.created_at - lag(t.created_at) over (partition by j.id order by t.created_at))) / 60.0, 1)
                                                                    as minutes_after_previous_track,
  case when t.gm_identity_id is not null then 'GM'
       else coalesce(ch.name, '-') end                              as speaker,
  t.status::text                                                    as track_status,
  (select count(*) from public.transcript_segments s where s.track_id = t.id) as segments,
  (select to_char(max(cc.updated_at) at time zone 'America/Los_Angeles', 'MM-DD HH24:MI:SS')
     from public.capture_control cc where cc.capture_job_id = j.id) as sidecar_done_pt
from public.audio_tracks t
join public.capture_jobs j on j.id = t.job_id
join public.campaigns c on c.id = j.campaign_id
left join public.characters ch on ch.id = t.character_id
where t.created_at >= timestamptz '2026-10-10 00:00:00-07'
order by j.created_at desc, t.created_at;
