-- supabase/checks/p171-keeping-it-running-check.sql (push 50). Read only. The first rows should say ok.

select 'migration recorded' as what,
       case when exists (select 1 from public._migrations where name = 'p171-keeping-it-running') then 'ok' else 'MISSING' end as result
union all
select 'cron_runs, server only',
       case when to_regclass('public.cron_runs') is null then 'MISSING'
            when has_table_privilege('authenticated', 'public.cron_runs', 'select') then 'OPEN' else 'ok' end
union all
select 'six jobs listed',
       case when (select count(*) from public.cron_runs) >= 6 then 'ok' else 'MISSING' end;

-- each job's last good run; after a deploy with push 50 these move forward on their own
select name, last_ok_at, last_error_at, last_error, alerted_at from public.cron_runs order by name;
