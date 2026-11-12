-- supabase/checks/p168-fights-and-saves-check.sql (push 45). Read only. Every row should say ok.

select 'migration recorded' as what,
       case when exists (select 1 from public._migrations where name = 'p168-fights-and-saves') then 'ok' else 'MISSING' end as result
union all
select 'combats.version column',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'combats' and column_name = 'version') then 'ok' else 'MISSING' end
union all
select 'version trigger',
       case when exists (select 1 from pg_trigger where tgname = 'combats_version' and tgrelid = 'public.combats'::regclass and not tgisinternal) then 'ok' else 'MISSING' end
union all
select 'calibration trigger still attached',
       case when exists (select 1 from pg_trigger where tgname = 'combats_calibration' and tgrelid = 'public.combats'::regclass and not tgisinternal) then 'ok' else 'MISSING' end
union all
select 'calibration cannot block a save',
       case when pg_get_functiondef('public.combat_calibration()'::regprocedure) like '%exception when others%' then 'ok' else 'MISSING' end
union all
select 'calibration reads a combatant''s own CR',
       case when pg_get_functiondef('public.combat_calibration()'::regprocedure) like '%e ->> ''cr''%' then 'ok' else 'MISSING' end
union all
select 'tabletop_gm_ids for signed-in only',
       case when to_regprocedure('public.tabletop_gm_ids(uuid)') is null then 'MISSING'
            when has_function_privilege('anon', 'public.tabletop_gm_ids(uuid)', 'execute') then 'OPEN' else 'ok' end
union all
select 'initiative_my_characters for signed-in only',
       case when to_regprocedure('public.initiative_my_characters(text)') is null then 'MISSING'
            when has_function_privilege('anon', 'public.initiative_my_characters(text)', 'execute') then 'OPEN' else 'ok' end;

-- fights still running, oldest first (Calibration now names these; end any that are over)
select id, name, status, created_at, updated_at from public.combats where status <> 'ended' order by created_at limit 20;
