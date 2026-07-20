-- supabase/checks/catalog-dump.sql
--
-- Dumps the ACTUAL class, subclass, species, and lineage data, not just where it lives.
-- Read-only, safe to run any time.
--
-- HOW THIS READS TABLES WITHOUT KNOWING THEIR COLUMNS
--
-- query_to_xml() executes a query given as text and returns the result as XML, so a single
-- static statement can do `select * from <table>` for tables whose shape is unknown at the
-- time of writing. The list of tables is driven off pg_class, which means a table that does
-- not exist is simply never queried, rather than erroring the whole script the way a
-- hand-written `select * from catalog_species` would.
--
-- That matters here: the repo has class_capabilities, catalog.sql, p4-catalog.sql, and
-- catalog-species.sql, which proves a catalog layer exists but not whether species is its
-- own table, a row in a shared catalog keyed by kind, or a plain column on characters. This
-- covers all three without a round trip.
--
-- TWO SECTIONS
--
--   catalog row     every row of every catalog-ish TABLE, one output row per data row,
--                   rendered as <row><col>value</col>...</row>
--   column value    every distinct value of every catalog-ish COLUMN anywhere in public,
--                   with a count. This is what catches species or lineage being a column
--                   on characters rather than a table of its own.
--
-- Written as ONE statement on purpose: the Supabase SQL editor runs a script as a single
-- transaction and shows only the LAST result set.
--
-- SCOPE CONTROLS, if the output is unwieldy:
--   narrow the regex in the pat CTE
--   raise or lower the 20000 reltuples ceiling, which keeps a huge table from dumping
--   drop the 'column value' branch entirely if you only want the catalog tables
--
-- Views and materialized views are deliberately excluded. query_to_xml would execute them,
-- and one broken view would take the whole script down with it.

with pat as (
  select '(class|subclass|species|lineage|ancestry|heritage|archetype|catalog|origin)'::text as rx
),

-- Base tables matching the concepts, small enough to dump whole.
tabs as (
  select c.relname::text as tname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join pat
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname ~* pat.rx
    and greatest(c.reltuples, 0) < 20000
),

-- Columns matching the concepts, anywhere in public. uuid columns are skipped: a list of
-- distinct foreign keys tells you nothing you cannot get from the row dump.
cols as (
  select col.table_name::text as tname, col.column_name::text as cname
  from information_schema.columns col
  join pg_class c on c.relname = col.table_name
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  cross join pat
  where col.table_schema = 'public'
    and c.relkind = 'r'
    and col.column_name::text ~* pat.rx
    and col.data_type not in ('uuid', 'jsonb', 'json', 'bytea')
    and greatest(c.reltuples, 0) < 200000
)

select section, source, detail
from (

  -- Every row of every catalog table.
  select
    1                                             as sort,
    'catalog row'::text                           as section,
    t.tname                                       as source,
    r.row_xml::text                               as detail,
    t.tname                                       as k1,
    lpad(r.ord::text, 8, '0')                     as k2
  from tabs t
  cross join lateral (
    select query_to_xml(
             format('select * from public.%I', t.tname),
             true,   -- include nulls, so a missing subclass is visible rather than absent
             false,  -- one document with <row> children, not a forest
             ''
           ) as doc
  ) q
  cross join lateral unnest(xpath('/table/row', q.doc)) with ordinality as r(row_xml, ord)

  union all

  -- Every distinct value of every catalog-ish column, with how many rows carry it.
  select
    2,
    'column value'::text,
    (c.tname || '.' || c.cname)::text,
    v.val_xml::text,
    c.tname || '.' || c.cname,
    lpad(v.ord::text, 8, '0')
  from cols c
  cross join lateral (
    select query_to_xml(
             format(
               'select %1$I as value, count(*) as rows from public.%2$I '
               'where %1$I is not null group by 1 order by 2 desc, 1',
               c.cname, c.tname
             ),
             true, false, ''
           ) as doc
  ) q
  cross join lateral unnest(xpath('/table/row', q.doc)) with ordinality as v(val_xml, ord)

) dump
order by sort, k1, k2;
