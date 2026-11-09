-- supabase/checks/p123-roll-tables-check.sql (2026-11-08)
-- Read-only. Run after p123.

-- 1. The table, with row level security on. Expect one row: rls_on true.
select c.relname as table_name, c.relrowsecurity as rls_on
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'roll_tables';

-- 2. Its two policies. Expect roll_tables_gm (ALL) and roll_tables_player_read (SELECT).
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'roll_tables' order by policyname;

-- 3. Who may touch it. Expect anon false on every line, authenticated true.
select privilege_type,
       has_table_privilege('anon', 'public.roll_tables', privilege_type) as anon,
       has_table_privilege('authenticated', 'public.roll_tables', privilege_type) as authenticated
  from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege_type);

-- 4. Tables so far, per campaign (none until a GM makes one).
select campaign_id, count(*) as tables, count(*) filter (where players_can_roll) as players_can_roll
  from public.roll_tables group by campaign_id;
