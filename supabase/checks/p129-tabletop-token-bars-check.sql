-- supabase/checks/p129-tabletop-token-bars-check.sql (2026-11-09)
-- Read-only. Run after p129.

-- 1. The bars table, GM only. Expect one row: rls_on true, policies "vtt_token_bars_gm ALL".
select c.relname as table_name, c.relrowsecurity as rls_on,
       (select string_agg(policyname || ' ' || cmd, ', ') from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'vtt_token_bars';

-- 2. The functions. Expect all three definer true, anon false, authenticated true; and
--    tabletop_combat shows_health true (it now carries a creature's coarse health when the GM allows).
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
       case when p.proname = 'tabletop_combat' then position('healthToPlayers' in pg_get_functiondef(p.oid)) > 0 end as shows_health
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('tabletop_bars', 'tabletop_set_bar_value', 'tabletop_combat')
 order by 1;

-- 3. Bars so far, and tokens whose health players may see (none until the GM sets some).
select (select count(*) from public.vtt_token_bars) as bars,
       (select count(*) from public.vtt_tokens where coalesce(style ->> 'healthToPlayers', '') = 'true') as health_shown;
