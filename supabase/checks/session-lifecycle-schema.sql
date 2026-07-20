-- supabase/checks/session-lifecycle-schema.sql
--
-- Read-only. Dumps everything needed to design the session lifecycle change:
-- columns, constraints, indexes, triggers, enum labels, the two functions that
-- read session status, and the status values actually present in live data.
--
-- Written as ONE statement on purpose. The Supabase SQL editor runs a script as a
-- single transaction and shows only the LAST result set, so several separate
-- SELECTs would silently hide all but the last. The union below keeps it to one
-- result you can copy whole.
--
-- Safe to run repeatedly. It reads catalog views and counts rows, and writes nothing.

with targets(tbl) as (
  values ('sessions'), ('capture_control'), ('capture_jobs'), ('audio_tracks')
)

select section, object, detail
from (

  -- 1. Columns, in declaration order, with nullability and defaults.
  select
    1                                                             as sort,
    'column'::text                                                as section,
    c.table_name::text                                            as object,
    (lpad(c.ordinal_position::text, 2, '0') || '  ' || c.column_name
      || '  ' || c.data_type
      || case when c.is_nullable = 'NO' then '  NOT NULL' else '' end
      || coalesce('  DEFAULT ' || c.column_default, ''))::text     as detail,
    c.table_name::text                                            as k1,
    lpad(c.ordinal_position::text, 4, '0')                        as k2
  from information_schema.columns c
  join targets t on t.tbl = c.table_name
  where c.table_schema = 'public'

  union all

  -- 2. Constraints, including the check constraints that pin status values and
  --    the partial unique index guard on capture_control.
  select
    2,
    'constraint'::text,
    rel.relname::text,
    (con.conname || '  ' || pg_get_constraintdef(con.oid))::text,
    rel.relname::text,
    con.conname::text
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join targets t on t.tbl = rel.relname
  where nsp.nspname = 'public'

  union all

  -- 3. Indexes.
  select
    3,
    'index'::text,
    i.tablename::text,
    (i.indexname || '  ' || i.indexdef)::text,
    i.tablename::text,
    i.indexname::text
  from pg_indexes i
  join targets t on t.tbl = i.tablename
  where i.schemaname = 'public'

  union all

  -- 4. Triggers. Anything that fires on a status change matters here.
  select
    4,
    'trigger'::text,
    rel.relname::text,
    (tg.tgname || '  ' || pg_get_triggerdef(tg.oid))::text,
    rel.relname::text,
    tg.tgname::text
  from pg_trigger tg
  join pg_class rel on rel.oid = tg.tgrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join targets t on t.tbl = rel.relname
  where nsp.nspname = 'public'
    and not tg.tgisinternal

  union all

  -- 5. Enum types in public, in case status is an enum rather than text plus check.
  select
    5,
    'enum'::text,
    typ.typname::text,
    string_agg(enm.enumlabel, ', ' order by enm.enumsortorder)::text,
    typ.typname::text,
    ''::text
  from pg_type typ
  join pg_enum enm on enm.enumtypid = typ.oid
  join pg_namespace nsp on nsp.oid = typ.typnamespace
  where nsp.nspname = 'public'
  group by typ.typname

  union all

  -- 6. The functions that read session state. chat_locked keys off status, and
  --    session_consent_ok has already blocked the pipeline once by requiring
  --    attendance rows, so both need to be read before the status model changes.
  select
    6,
    'function'::text,
    pro.proname::text,
    pg_get_functiondef(pro.oid)::text,
    pro.proname::text,
    pro.oid::text
  from pg_proc pro
  join pg_namespace nsp on nsp.oid = pro.pronamespace
  where nsp.nspname = 'public'
    and pro.proname in ('chat_locked', 'session_consent_ok', 'my_character')

  union all

  -- 7. Status values actually present in live data, with counts. Tells us which
  --    states are real versus aspirational, and how many sessions are sitting
  --    open right now.
  select
    7,
    'live data'::text,
    'sessions.status'::text,
    (coalesce(s.status::text, '(null)')
      || '  rows=' || count(*)::text
      || '  started_at set=' || count(s.started_at)::text
      || '  ended_at set=' || count(s.ended_at)::text)::text,
    'sessions.status'::text,
    coalesce(s.status::text, '(null)')
  from public.sessions s
  group by s.status

  union all

  select
    8,
    'live data'::text,
    'capture_control.status'::text,
    (coalesce(cc.status::text, '(null)')
      || '  rows=' || count(*)::text
      || '  newest=' || coalesce(max(cc.updated_at)::text, '(none)'))::text,
    'capture_control.status'::text,
    coalesce(cc.status::text, '(null)')
  from public.capture_control cc
  group by cc.status

) rows
order by sort, k1, k2;
