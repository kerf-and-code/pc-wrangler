-- supabase/checks/trim-history.sql
--
-- Read-only. Has silence trimming EVER applied in production, and if so, when did it stop?
-- SELECT only: no insert, update, delete or DDL. Safe to run repeatedly.
--
-- A track the sidecar trimmed carries a timeline_map; an untrimmed one does not. Groq only
-- takes trimmed tracks, so a week with zero trimmed speaker tracks is a week where every
-- Discord track went to Deepgram.
--
-- One row per week (Monday start, Pacific time) of speaker tracks since 2026-08-01, plus the
-- time of the most recent trimmed track in that week.
--
-- Written as ONE statement: the Supabase SQL editor shows only the LAST result set.

select
  to_char(date_trunc('week', t.created_at at time zone 'America/Los_Angeles'), 'YYYY-MM-DD') as week_of_pt,
  count(*)                                                     as speaker_tracks,
  count(*) filter (where t.timeline_map is not null)           as trimmed,
  count(*) filter (where t.timeline_map is null)               as untrimmed,
  count(distinct t.job_id)                                     as sessions,
  to_char(max(t.created_at) filter (where t.timeline_map is not null)
            at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI') as last_trimmed_pt
from public.audio_tracks t
where coalesce(t.kind, 'speaker') = 'speaker'
  and t.created_at >= timestamptz '2026-08-01 00:00:00-07'
group by 1
order by 1;
