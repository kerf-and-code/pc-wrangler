-- p105-tabletop-check.sql: READ-ONLY. Run after p105-tabletop.sql.

-- 1. Three tables, RLS on (expect 3 rows, all true)
select c.relname, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('vtt_scenes', 'vtt_tokens', 'vtt_messages') order by 1;

-- 2. Six policies (scenes gm + player read, tokens gm + player read, messages read + gm delete)
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('vtt_scenes', 'vtt_tokens', 'vtt_messages') order by 1, 2;

-- 3. Realtime now publishes the three tables next to map_fog (expect 4 rows)
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;

-- 4. The seven functions, each SECURITY DEFINER (expect 7 rows, all true)
select p.proname, p.prosecdef as security_definer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('tabletop_is_player', 'tabletop_open_session', 'tabletop_state',
  'tabletop_activate_scene', 'tabletop_move_token', 'tabletop_say', 'tabletop_feed') order by 1;

-- 5. export_my_data now carries table_chat (expect true)
select position('table_chat' in pg_get_functiondef('public.export_my_data()'::regprocedure)) > 0 as export_has_table_chat;

-- 6. Only one active scene per campaign can exist (expect the unique partial index)
select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname = 'vtt_scenes_one_active';
