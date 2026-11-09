-- supabase/checks/p128-tabletop-notes-pins-check.sql (2026-11-09)
-- Read-only. Run after p128.

-- 1. The two tables, GM only. Expect two rows, rls_on true, and one policy each (vtt_pins_gm,
--    vtt_token_notes_gm), both ALL. No player policy: players reach pins only through tabletop_pins.
select c.relname as table_name, c.relrowsecurity as rls_on,
       (select string_agg(policyname || ' ' || cmd, ', ') from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('vtt_pins', 'vtt_token_notes')
 order by 1;

-- 2. The functions. Expect:
--    tabletop_pin_entry           definer true, anon false, authenticated true
--    tabletop_pins                definer true, anon false, authenticated true
--    tabletop_player_reads_entry  definer true, anon false, authenticated false (used inside the two above)
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('tabletop_pins', 'tabletop_pin_entry', 'tabletop_player_reads_entry')
 order by 1;

-- 3. Pins and notes so far (none until the GM adds some).
select (select count(*) from public.vtt_pins) as pins, (select count(*) from public.vtt_token_notes) as token_notes;
