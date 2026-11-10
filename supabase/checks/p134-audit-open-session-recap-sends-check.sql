-- supabase/checks/p134-audit-open-session-recap-sends-check.sql (2026-11-09)
-- Read-only. Run after p134.

-- 1. The new open-session rule is in place. Expect true.
select position('started_at is not null' in pg_get_functiondef('public.tabletop_open_session(uuid)'::regprocedure)) > 0 as rule_in_place;

-- 2. recap_sends: RLS on, no policies, the server can write. Expect rls_on true, policies null, server_insert true.
select c.relrowsecurity as rls_on,
       (select string_agg(policyname, ', ') from pg_policies p where p.schemaname = 'public' and p.tablename = 'recap_sends') as policies,
       has_table_privilege('service_role', 'public.recap_sends', 'insert') as server_insert
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'recap_sends';

-- 3. Sessions the old rule treated as open and the new one does not: no start time and no end time.
--    Scheduled future sessions belong here (that is the fix). Anything else listed (an old session
--    that is really in progress but was never given a start time) would no longer receive rolls:
--    give it a start time or end it. A row with status live is the one to look at.
select s.campaign_id, s.id, s.session_number, s.status, s.scheduled_at, s.created_at
  from public.sessions s
 where s.ended_at is null and s.started_at is null
 order by s.created_at desc;
