-- Base schema dump, in pure SQL. No Docker, no CLI.
--
-- WHY THIS EXISTS: `supabase db dump` shells out to pg_dump inside a Docker
-- container. Without Docker running it creates the output file, fails, and exits
-- without writing, which is the 0-byte file you got.
--
-- This reconstructs the same thing from the catalogs. It emits ONE text column of
-- runnable DDL, in dependency order:
--
--   1. extensions
--   2. tables (columns, types, defaults, not-null)
--   3. primary keys, unique constraints, check constraints
--   4. foreign keys (after all tables exist, so order does not matter)
--   5. indexes
--   6. functions (the ~20 uncommitted RPCs: this is the part that cannot be
--      reconstructed by inspection and is the real reason to do this)
--   7. views
--   8. triggers
--   9. RLS: enable statements and every policy
--
-- HOW TO USE:
--   Run it. In the results pane, use "Download CSV". Open the CSV, take the `ddl`
--   column, strip the header and any quoting, and save as
--   supabase/migrations/0000-base-schema.sql. Commit it.
--
-- CAVEATS. This is a faithful reconstruction, not a byte-exact pg_dump:
--   - no data, no sequences' current values, no storage/auth schema objects
--   - grants are emitted for the app roles only (anon, authenticated, service_role)
--   - column order within a table is preserved; table order is alphabetical
--   Re-run a real pg_dump later if you ever get Docker up. Until then this is the
--   difference between "the RPCs exist only in a live database" and "the RPCs are
--   in the repo".
--
-- Read-only. Generates text; changes nothing.

with

-- 1. extensions ---------------------------------------------------------------
ext as (
  select 1 as sort, 0 as sub, e.extname as obj,
    'create extension if not exists "' || e.extname || '" with schema ' ||
      quote_ident(n.nspname) || ';' as ddl
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname not in ('plpgsql')
),

-- 2. tables -------------------------------------------------------------------
cols as (
  select
    c.oid as reloid,
    c.relname,
    string_agg(
      '  ' || quote_ident(a.attname) || ' ' ||
      format_type(a.atttypid, a.atttypmod) ||
      coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') ||
      case when a.attnotnull then ' not null' else '' end,
      E',\n' order by a.attnum
    ) as body
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
  group by c.oid, c.relname
),
tbl as (
  select 2 as sort, 0 as sub, relname as obj,
    'create table if not exists public.' || quote_ident(relname) || E' (\n' || body || E'\n);'
    as ddl
  from cols
),

-- 3. pk / unique / check ------------------------------------------------------
cons_local as (
  select 3 as sort,
    case con.contype when 'p' then 0 when 'u' then 1 else 2 end as sub,
    c.relname as obj,
    'alter table public.' || quote_ident(c.relname) ||
    ' add constraint ' || quote_ident(con.conname) || ' ' ||
    pg_get_constraintdef(con.oid) || ';' as ddl
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and con.contype in ('p','u','c')
),

-- 4. foreign keys (emitted last among constraints, so table order is irrelevant)
cons_fk as (
  select 4 as sort, 0 as sub, c.relname as obj,
    'alter table public.' || quote_ident(c.relname) ||
    ' add constraint ' || quote_ident(con.conname) || ' ' ||
    pg_get_constraintdef(con.oid) || ';' as ddl
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and con.contype = 'f'
),

-- 5. indexes (skip those backing a constraint: already emitted above) ----------
idx as (
  select 5 as sort, 0 as sub, i.tablename as obj, i.indexdef || ';' as ddl
  from pg_indexes i
  where i.schemaname = 'public'
    and not exists (
      select 1 from pg_constraint con
      join pg_class ic on ic.oid = con.conindid
      where ic.relname = i.indexname
    )
),

-- 6. functions: THE IMPORTANT PART --------------------------------------------
fns as (
  select 6 as sort, 0 as sub, p.proname as obj,
    pg_get_functiondef(p.oid) || ';' as ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and not exists (
      select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
    )
),

-- 7. views --------------------------------------------------------------------
vws as (
  select 7 as sort, 0 as sub, c.relname as obj,
    'create or replace view public.' || quote_ident(c.relname) || ' as ' ||
    pg_get_viewdef(c.oid, true) as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
),

-- 8. triggers -----------------------------------------------------------------
trg as (
  select 8 as sort, 0 as sub, c.relname as obj,
    pg_get_triggerdef(t.oid) || ';' as ddl
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
),

-- 9. RLS ----------------------------------------------------------------------
rls_on as (
  select 9 as sort, 0 as sub, c.relname as obj,
    'alter table public.' || quote_ident(c.relname) || ' enable row level security;' as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
),
pol as (
  select 9 as sort, 1 as sub, p.tablename as obj,
    'drop policy if exists ' || quote_ident(p.policyname) ||
      ' on public.' || quote_ident(p.tablename) || E';\n' ||
    'create policy ' || quote_ident(p.policyname) ||
      ' on public.' || quote_ident(p.tablename) ||
      ' for ' || lower(p.cmd) ||
      ' to ' || array_to_string(p.roles, ', ') ||
      coalesce(' using (' || p.qual || ')', '') ||
      coalesce(' with check (' || p.with_check || ')', '') || ';' as ddl
  from pg_policies p
  where p.schemaname = 'public'
),

-- 10. grants to the app roles -------------------------------------------------
grants as (
  select 10 as sort, 0 as sub, table_name as obj,
    'grant ' || string_agg(distinct lower(privilege_type), ', ') ||
    ' on public.' || quote_ident(table_name) || ' to ' || grantee || ';' as ddl
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon','authenticated','service_role')
  group by table_name, grantee
),

all_ddl as (
  select * from ext
  union all select * from tbl
  union all select * from cons_local
  union all select * from cons_fk
  union all select * from idx
  union all select * from fns
  union all select * from vws
  union all select * from trg
  union all select * from rls_on
  union all select * from pol
  union all select * from grants
)

select
  sort as section,
  case sort
    when 1  then '01 extensions'
    when 2  then '02 tables'
    when 3  then '03 constraints'
    when 4  then '04 foreign keys'
    when 5  then '05 indexes'
    when 6  then '06 functions'
    when 7  then '07 views'
    when 8  then '08 triggers'
    when 9  then '09 rls'
    when 10 then '10 grants'
  end as section_name,
  obj as object_name,
  ddl
from all_ddl
order by sort, sub, obj;
