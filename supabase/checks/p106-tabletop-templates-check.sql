-- p106-tabletop-templates-check.sql: READ-ONLY. Run after p106-tabletop-templates.sql.

-- 1. The table with RLS on (expect one row, true)
select c.relname, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'vtt_templates';

-- 2. Five policies: gm (all), player read, player insert, player update, player delete
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'vtt_templates' order by 1;

-- 3. Realtime publishes it (expect vtt_templates among the rows)
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
