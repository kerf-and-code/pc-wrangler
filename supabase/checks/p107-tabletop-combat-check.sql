-- p107-tabletop-combat-check.sql: READ-ONLY. Run after p107-tabletop-combat.sql.

-- 1. The function exists and is SECURITY DEFINER (expect one row, true)
select p.proname, p.prosecdef as security_definer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'tabletop_combat';

-- 2. combats is published to Realtime (expect combats among the rows)
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;

-- 3. combats still has only the GM policy (players read through tabletop_combat, never directly)
select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'combats';
