-- p113-tabletop-drawings-handouts-check.sql
--
-- Read-only checks after running supabase/migrations/p113-tabletop-drawings-handouts.sql. Each row
-- should say ok, except the rows marked (information).

select 'tables present' as check_name,
       case when to_regclass('public.vtt_drawings') is not null and to_regclass('public.vtt_handouts') is not null then 'ok' else 'MISSING' end as result

union all
select 'row level security on both',
       case when (select bool_and(relrowsecurity) from pg_class where oid in ('public.vtt_drawings'::regclass, 'public.vtt_handouts'::regclass)) then 'ok' else 'RLS OFF' end

union all
select 'drawing policies (gm, player read, insert, update, delete)',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vtt_drawings') = 5 then 'ok'
            else 'found ' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vtt_drawings')::text || ' of 5' end

union all
select 'players never read the GM layer',
       case when (select qual from pg_policies where schemaname = 'public' and tablename = 'vtt_drawings' and policyname = 'vtt_drawings_player_read') like '%''table''%' then 'ok' else 'CHECK THE POLICY' end

union all
select 'drawings published to Realtime',
       case when exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vtt_drawings') then 'ok' else 'MISSING' end

union all
select 'handout functions present',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                   and p.proname in ('tabletop_show_handout', 'tabletop_hide_handout', 'tabletop_handouts')) = 3 then 'ok' else 'MISSING' end

union all
select 'entries has every column the handouts read',
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'entries'
                   and column_name in ('id', 'campaign_id', 'type', 'title', 'summary', 'body', 'blocks', 'image_url', 'visibility')) = 9 then 'ok'
            else 'MISSING: ' || (select string_agg(c, ', ') from unnest(array['id','campaign_id','type','title','summary','body','blocks','image_url','visibility']) c
                                  where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entries' and column_name = c)) end

union all
select 'entry_reveals has the unique key a showing relies on',
       case when exists (
         select 1 from pg_constraint k
          where k.conrelid = 'public.entry_reveals'::regclass and k.contype = 'u'
            and (select array_agg(a.attname::text order by a.attname) from unnest(k.conkey) x join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x)
                = array['revealed_to_character_id', 'target_id', 'target_type']) then 'ok' else 'MISSING' end

union all
select 'campaign-maps bucket: public, size limit, types (information)',
       coalesce((select 'public=' || public::text || ', file_size_limit=' || coalesce(file_size_limit::text, 'none') || ', types=' || coalesce(array_to_string(allowed_mime_types, ' '), 'any')
                   from storage.buckets where id = 'campaign-maps'), 'NO SUCH BUCKET')

union all
select 'drawings and handouts so far (information)',
       (select count(*) from public.vtt_drawings)::text || ' drawings, ' || (select count(*) from public.vtt_handouts)::text || ' handouts';
