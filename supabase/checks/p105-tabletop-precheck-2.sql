-- p105-precheck-2.sql: READ-ONLY. Second and last check before the tabletop migration (p105).
-- The first paste stopped at memberships, and the data-rights functions must be read live before
-- p105 extends them (table chat is a player's words, so export and delete have to cover it).

-- 1. Live definitions of the data-rights functions p105 will extend.
select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('export_my_data', 'delete_my_account', 'my_deletion_blockers');

-- 2. Columns of the tables the first paste cut off.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('profiles', 'sessions', 'stat_blocks', 'vtt_events', 'custom_tiles')
order by table_name, ordinal_position;

-- 3. RLS switched on? (chat tables showed no policies, which means either RLS-on-and-closed or RLS off)
select c.relname, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('chat_messages', 'chat_grants', 'vtt_events', 'custom_tiles', 'stat_blocks');

-- 4. The session status values in use, so "the open session" matches what roll ingestion uses.
select status, count(*) as n, count(*) filter (where ended_at is null) as still_open
from public.sessions group by status order by n desc;
