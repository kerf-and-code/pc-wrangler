-- supabase/checks/migration-ledger-check.sql (2026-11-10)
-- Read-only. What the migration ledger (public._migrations, p146) says has run, newest first.
-- A migration you just ran should be at the top; if it is missing, it did not finish.

select name, applied_at, note from public._migrations order by applied_at desc, name desc;

-- The four views that must run with the caller's permissions (p3-security-fixes.sql, re-asserted by p146).
-- Expect security_invoker=true on each.
select c.relname as view, c.reloptions
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('v_audio_due_for_purge', 'v_campaign_audio_retention', 'v_session_spotlight', 'v_session_equity')
 order by 1;

-- The roll announcement trigger (p146, audit T25). Expect one row, enabled 'O'. No row means
-- realtime.send was not available and tables keep polling every 6 seconds.
select tgname, tgenabled from pg_trigger where tgrelid = 'public.vtt_events'::regclass and tgname = 'vtt_events_feed_signal';
