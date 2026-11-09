-- supabase/checks/p124-tabletop-sound-check.sql (2026-11-08)
-- Read-only. Run after p124.

-- 1. The two tables, row level security on, and vtt_audio sent live. Expect two rows, rls_on true;
--    vtt_audio realtime true.
select c.relname as table_name, c.relrowsecurity as rls_on,
       exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = c.relname) as realtime
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('vtt_sounds', 'vtt_audio')
 order by 1;

-- 2. Policies. Expect vtt_audio_gm_read, vtt_audio_player_read (SELECT) and vtt_sounds_gm (ALL).
select tablename, policyname, cmd from pg_policies
 where schemaname = 'public' and tablename in ('vtt_sounds', 'vtt_audio') order by 1, 2;

-- 3. The functions. Expect both definer false/true as shown, anon false, authenticated true:
--    tabletop_server_ms  definer false; tabletop_set_audio  definer true.
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('tabletop_server_ms', 'tabletop_set_audio')
 order by 1;

-- 4. The bucket the sounds go into. If file_size_limit is set below 26214400 (25 MB), or
--    allowed_mime_types is set and leaves out audio types, uploads will be refused: send this row to
--    Claude. Both empty (null) means no limit beyond the project's own.
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'campaign-maps';
