-- supabase/checks/backup-row-counts.sql (push 50, audit round 2 T13). Read only.
--
-- Every table in public with its exact row count, plus the auth users. Run it on the database you
-- backed up and on the copy you restored (docs/backup-and-restore.md), then compare the two lists: a
-- restore is good when every count matches. Counting every table takes a few seconds on a small database.

select table_name,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::bigint as row_count
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'auth.users', (select count(*) from auth.users)
order by 1;
