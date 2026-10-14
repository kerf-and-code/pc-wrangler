-- supabase/checks/recovery-prep.sql
--
-- Read-only. Everything needed to write the recovery for the speakers stranded at 'pending' on
-- CandleKeep Tuesday (job e242b73c, 2026-10-13) and Power of Love and Weed (job d44dc094, 2026-10-11):
--
--   1. the exact columns of capture_jobs and audio_tracks (with nullability and defaults), so the
--      recovery job row is inserted with real column names, not guessed ones
--   2. the check constraints on those two tables, so the statuses used are ones the table accepts
--   3. the stranded tracks themselves (full ids), confirming they still have audio and no segments
--
-- SELECT only: no insert, update, delete or DDL. Safe to run repeatedly.
-- Written as ONE statement: the Supabase SQL editor shows only the LAST result set.

select section, object, detail
from (

  select 1 as sort, 'column'::text as section, c.table_name::text as object,
         (lpad(c.ordinal_position::text, 2, '0') || '  ' || c.column_name || '  ' || c.data_type
          || case when c.is_nullable = 'NO' then '  NOT NULL' else '' end
          || coalesce('  DEFAULT ' || c.column_default, ''))::text as detail,
         c.table_name::text || lpad(c.ordinal_position::text, 4, '0') as k
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name in ('capture_jobs', 'audio_tracks')

  union all

  select 2, 'constraint', rel.relname::text,
         (con.conname || '  ' || pg_get_constraintdef(con.oid))::text,
         rel.relname::text || con.conname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname in ('capture_jobs', 'audio_tracks')

  union all

  select 3, 'stranded track', left(t.job_id::text, 8),
         (t.id::text || '  ' || coalesce(ch.name, '-') || '  status=' || t.status::text
          || '  minutes=' || round(coalesce(t.duration_seconds, 0) / 60.0)::text
          || '  has_audio=' || (t.storage_path is not null)::text
          || '  segments=' || (select count(*) from public.transcript_segments s where s.track_id = t.id)::text
          || '  job=' || t.job_id::text)::text,
         t.job_id::text || coalesce(ch.name, '')
  from public.audio_tracks t
  left join public.characters ch on ch.id = t.character_id
  where left(t.job_id::text, 8) in ('e242b73c', 'd44dc094')
    and t.status::text <> 'done'

) x
order by sort, k;
