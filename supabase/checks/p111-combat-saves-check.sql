-- p111-combat-saves-check.sql
--
-- Read-only checks after running supabase/migrations/p111-combat-saves.sql. Each row should say ok.

select 'functions present' as check_name,
       case when count(*) = 3 then 'ok' else 'MISSING: found ' || count(*)::text || ' of 3' end as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('combat_hurt', 'combat_request_save', 'combat_resolve_save')

union all
select 'players cannot call the save functions directly',
       case when not has_function_privilege('authenticated', 'public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean)', 'execute')
             and not has_function_privilege('authenticated', 'public.combat_resolve_save(uuid, uuid, text, integer)', 'execute') then 'ok' else 'authenticated can execute' end

union all
select 'the server can call the save functions',
       case when has_function_privilege('service_role', 'public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean)', 'execute')
             and has_function_privilege('service_role', 'public.combat_resolve_save(uuid, uuid, text, integer)', 'execute') then 'ok' else 'service_role cannot execute' end

union all
select 'tabletop_combat shows pending saves',
       case when pg_get_functiondef('public.tabletop_combat(uuid)'::regprocedure) like '%awaitingSave%' then 'ok' else 'OLD VERSION' end

union all
select 'damage math (10 on 5 temp and 20 HP leaves 15 HP, 0 temp)',
       case when public.combat_hurt('{"kind":"pc","hp":20,"tempHp":5}'::jsonb, 10) = '{"kind":"pc","hp":15,"tempHp":0}'::jsonb then 'ok' else 'WRONG' end

union all
select 'pending saves waiting right now (information)',
       coalesce(sum(jsonb_array_length(x -> 'pendingSaves')), 0)::text
  from public.combats cb, jsonb_array_elements(cb.combatants) x
 where cb.status = 'active' and jsonb_typeof(x -> 'pendingSaves') = 'array';
