-- supabase/checks/catalog-discovery.sql
--
-- Finds where class, subclass, species, and lineage actually live before anything tries to
-- read them. Read-only, safe to run any time.
--
-- WHY THIS EXISTS AS ITS OWN STEP
--
-- The repo has class_capabilities, catalog.sql, p4-catalog.sql, catalog-species.sql,
-- p4-trickster.sql, and p4-retag-partnered.sql. That is enough to know a catalog layer
-- exists and not enough to know its shape: species could be a column on characters, a row
-- in a shared catalog table keyed by kind, or its own table, and each needs a different
-- query. Guessing produces a script that either errors or, worse, returns something
-- plausible and wrong.
--
-- Sections returned:
--   table       public tables whose NAME suggests a catalog, with an estimated row count
--   column      any column anywhere in public whose NAME matches the concepts, with type
--   fk          foreign keys into those tables, which is how characters reach the catalog
--   enum        enum types whose name or labels match, in case the values are typed
--   check       check constraints on matching columns, which often enumerate valid values
--
-- Written as ONE statement on purpose: the Supabase SQL editor runs a script as a single
-- transaction and shows only the LAST result set.
--
-- Row counts are pg_class.reltuples ESTIMATES, not exact counts. They are there to tell a
-- populated table from an empty one, nothing more.

with pat as (
  select '(class|subclass|species|lineage|ancestry|heritage|race|catalog|archetype|origin)'::text as rx
)

select section, object, detail
from (

  select
    1                                                              as sort,
    'table'::text                                                  as section,
    c.relname::text                                                as object,
    (case c.relkind when 'r' then 'table' when 'v' then 'view'
                    when 'm' then 'matview' else c.relkind::text end
      || '  ~' || greatest(c.reltuples, 0)::bigint::text || ' rows')::text as detail,
    c.relname::text                                                as k1,
    ''::text                                                       as k2
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join pat
  where n.nspname = 'public'
    and c.relkind in ('r', 'v', 'm')
    and c.relname ~* pat.rx

  union all

  select
    2,
    'column'::text,
    col.table_name::text,
    (col.column_name || '  ' || col.data_type
      || case when col.is_nullable = 'NO' then '  NOT NULL' else '' end
      || coalesce('  DEFAULT ' || col.column_default, ''))::text,
    col.table_name::text,
    col.column_name::text
  from information_schema.columns col
  cross join pat
  where col.table_schema = 'public'
    and col.column_name::text ~* pat.rx

  union all

  select
    3,
    'fk'::text,
    rel.relname::text,
    (con.conname || '  ' || pg_get_constraintdef(con.oid))::text,
    rel.relname::text,
    con.conname::text
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace n on n.oid = rel.relnamespace
  cross join pat
  where n.nspname = 'public'
    and con.contype = 'f'
    and (tgt.relname ~* pat.rx or rel.relname ~* pat.rx)

  union all

  select
    4,
    'enum'::text,
    t.typname::text,
    string_agg(e.enumlabel, ', ' order by e.enumsortorder)::text,
    t.typname::text,
    ''::text
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  cross join pat
  where n.nspname = 'public'
    and t.typname ~* pat.rx
  group by t.typname

  union all

  -- Check constraints frequently ARE the vocabulary, the same way sessions.status is a
  -- text column with a CHECK listing every legal value rather than an enum.
  select
    5,
    'check'::text,
    rel.relname::text,
    (con.conname || '  ' || pg_get_constraintdef(con.oid))::text,
    rel.relname::text,
    con.conname::text
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  cross join pat
  where n.nspname = 'public'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ~* pat.rx

) found
order by sort, k1, k2;
