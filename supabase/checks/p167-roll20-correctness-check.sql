-- supabase/checks/p167-roll20-correctness-check.sql (push 44). Read only. Every row should say ok.

select 'migration recorded' as what,
       case when exists (select 1 from public._migrations where name = 'p167-roll20-correctness') then 'ok' else 'MISSING' end as result
union all
select 'apply accepts Roll20 rows',
       case when pg_get_functiondef('public.combat_apply_outside_roll(uuid, text, uuid[], boolean)'::regprocedure) like '%''roll20''%' then 'ok' else 'MISSING' end
union all
select 'apply still not callable by anon',
       case when has_function_privilege('anon', 'public.combat_apply_outside_roll(uuid, text, uuid[], boolean)', 'execute') then 'OPEN' else 'ok' end
union all
select 'name links table',
       case when to_regclass('public.vtt_name_links') is not null then 'ok' else 'MISSING' end
union all
select 'name links row level security on',
       case when (select relrowsecurity from pg_class where oid = 'public.vtt_name_links'::regclass) then 'ok' else 'OFF' end
union all
select 'name links not writable by signed-in users',
       case when has_table_privilege('authenticated', 'public.vtt_name_links', 'insert')
              or has_table_privilege('authenticated', 'public.vtt_name_links', 'update')
              or has_table_privilege('authenticated', 'public.vtt_name_links', 'delete') then 'OPEN' else 'ok' end
union all
select 'name links GM read policy',
       case when exists (select 1 from pg_policies where tablename = 'vtt_name_links' and policyname = 'gm reads name links') then 'ok' else 'MISSING' end;

-- Roll20 rows stored so far, by whether a character got them (for comparing before and after links)
select campaign_id, count(*) as roll20_rows, count(*) filter (where character_id is null) as unattributed
  from public.vtt_events where source = 'roll20' group by campaign_id order by roll20_rows desc;
