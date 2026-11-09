-- supabase/checks/p127-tabletop-token-elevation-check.sql (2026-11-09)
-- Read-only. Run after p127.

-- 1. The function. Expect one row: definer true, anon_can_run false, authenticated_can_run true.
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'tabletop_set_token_elevation';

-- 2. Tokens off the ground so far (none until someone lifts one).
select id, name, (style ->> 'elevation')::integer as elevation_ft
  from public.vtt_tokens where style ? 'elevation' order by updated_at desc limit 20;
