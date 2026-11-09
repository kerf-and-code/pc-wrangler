-- supabase/checks/p133-tabletop-pictures-check.sql (2026-11-09)
-- Read-only. Run after p133.

-- 1. The private bucket. Expect one row: table-files, public false. (file_size_limit and
--    allowed_mime_types show in the second query, where this storage version has them.)
select id, name, public from storage.buckets where id = 'table-files';
select * from storage.buckets where id = 'table-files';

-- 2. The new columns. Expect five rows: vtt_cards.image_path, vtt_decks.back_path,
--    vtt_handouts.image_path, vtt_handouts.note, vtt_handouts.title (all text), and entry_id now nullable
--    (the sixth row, is_nullable YES).
select table_name, column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'vtt_handouts' and column_name in ('title', 'image_path', 'note', 'entry_id'))
        or (table_name = 'vtt_decks' and column_name = 'back_path')
        or (table_name = 'vtt_cards' and column_name = 'image_path'))
 order by 1, 2;

-- 3. The checks that keep each picture in its own campaign's folder. Expect four rows.
select conname from pg_constraint
 where conname in ('vtt_handouts_entry_or_picture', 'vtt_handouts_picture_folder', 'vtt_decks_back_folder', 'vtt_cards_picture_folder')
 order by 1;

-- 4. The functions. Expect:
--    tabletop_file_in_use         definer true, anon false, authenticated false, server true
--    tabletop_file_ok             definer true, anon false, authenticated true
--    tabletop_show_image_handout  definer true, anon false, authenticated true
--    tabletop_handouts, tabletop_cards  definer true, anon false, authenticated true
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
       has_function_privilege('service_role', p.oid, 'execute') as server_can_run
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('tabletop_file_in_use', 'tabletop_file_ok', 'tabletop_show_image_handout', 'tabletop_handouts', 'tabletop_cards')
 order by 1;

-- 5. Wiki handouts shown before p133 still list (expect the same number as before p133).
select count(*) as wiki_handouts from public.vtt_handouts where entry_id is not null;
