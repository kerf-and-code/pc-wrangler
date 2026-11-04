-- supabase/checks/p102-precheck.sql
--
-- Read-only. Run BEFORE p102-human-coding-sample.sql. That migration adds foreign keys to these three
-- tables and assumes each id is a uuid; their CREATE TABLE statements are not in the repo, so this
-- confirms it rather than guessing. Every row should say uuid. It also confirms the columns the
-- coding route reads, and that coding_samples does not exist yet.

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'capture_jobs'        and column_name in ('id', 'campaign_id', 'session_id', 'status'))
 or (table_name = 'campaigns'           and column_name in ('id'))
 or (table_name = 'transcript_segments' and column_name in ('id', 'job_id', 'character_id', 'start_ms', 'text'))
 or (table_name = 'proposed_events'     and column_name in ('job_id', 'segment_id', 'event_type', 'confidence'))
 or (table_name = 'event_types'         and column_name in ('key', 'label', 'category'))
 or (table_name = 'coding_samples')
  )
order by table_name, column_name;
