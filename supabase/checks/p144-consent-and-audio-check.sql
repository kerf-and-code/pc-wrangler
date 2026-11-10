-- supabase/checks/p144-consent-and-audio-check.sql (2026-11-10)
-- Read-only. Run after supabase/migrations/p144-consent-and-audio.sql.

-- 1. Expect two trues.
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'storage_purge_queue') as purge_queue_table,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'my_recording_consents'
             and pg_get_functiondef(p.oid) like '%p144 (audit T11)%') as consent_carried_flag;

-- 2. Audit T11 scope: standing consents the backfill carried over and that are still in force, and how
--    many players they belong to. Each of those players now sees a confirm prompt on their settings page.
select count(*) as carried_consents, count(distinct profile_id) as players
  from public.recording_consents
 where method = 'backfill_blanket' and session_id is null and consented;

-- 3. Audit T9 backlog: recordings past 60 days still waiting to be deleted. The cron now works through
--    them all each run; expect this to fall to 0 after the next run.
select count(*) as audio_overdue from public.v_audio_due_for_purge;

-- 4. The queue, by reason (empty right after the migration).
select reason, count(*) as files, min(not_before) as earliest_due
  from public.storage_purge_queue group by reason order by reason;
