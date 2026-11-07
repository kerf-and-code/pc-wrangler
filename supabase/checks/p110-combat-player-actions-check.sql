-- p110-combat-player-actions-check.sql
--
-- Read-only checks after running supabase/migrations/p110-combat-player-actions.sql. Each row should say ok.

select 'functions present' as check_name,
       case when count(*) = 5 then 'ok' else 'MISSING: found ' || count(*)::text || ' of 5' end as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('combat_markers', 'combat_act', 'combat_attack_resolve', 'combat_attack_damage', 'tabletop_combat')

union all
select 'combat_act has the turn gate',
       case when pg_get_functiondef('public.combat_act(uuid, text, text, integer, text, integer)'::regprocedure) like '%it is not your turn%' then 'ok' else 'OLD VERSION' end

union all
select 'tabletop_combat says whose character is whose',
       case when pg_get_functiondef('public.tabletop_combat(uuid)'::regprocedure) like '%''mine''%' then 'ok' else 'OLD VERSION' end

union all
select 'players can run combat_act',
       case when has_function_privilege('authenticated', 'public.combat_act(uuid, text, text, integer, text, integer)', 'execute') then 'ok' else 'authenticated cannot execute' end

union all
select 'players cannot call the attack functions directly',
       case when not has_function_privilege('authenticated', 'public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean)', 'execute')
             and not has_function_privilege('authenticated', 'public.combat_attack_damage(uuid, uuid, text, integer)', 'execute') then 'ok' else 'authenticated can execute' end

union all
select 'the server can call the attack functions',
       case when has_function_privilege('service_role', 'public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean)', 'execute')
             and has_function_privilege('service_role', 'public.combat_attack_damage(uuid, uuid, text, integer)', 'execute') then 'ok' else 'service_role cannot execute' end

union all
select 'marker list matches the app (28 entries)',
       case when array_length(public.combat_markers(), 1) = 28 then 'ok' else 'found ' || array_length(public.combat_markers(), 1)::text end

union all
select 'combats published to Realtime (from p107)',
       case when exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'combats') then 'ok' else 'MISSING: run p107' end;
