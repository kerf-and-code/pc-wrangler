-- p112-combat-action-economy-check.sql
--
-- Read-only checks after running supabase/migrations/p112-combat-action-economy.sql. Each row should say ok.

select 'helper functions present' as check_name,
       case when count(*) = 8 then 'ok' else 'MISSING: found ' || count(*)::text || ' of 8' end as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('combat_fresh_econ', 'combat_econ', 'combat_speed', 'combat_cant_act', 'combat_spend',
                     'combat_lock_last', 'combat_move', 'tabletop_feet')

union all
select 'one combat_act, the new one (seven arguments)',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'combat_act') = 1
             and to_regprocedure('public.combat_act(uuid, text, text, integer, text, integer, text)') is not null then 'ok' else 'OLD OR DUPLICATE VERSION' end

union all
select 'one combat_attack_resolve, with a cost',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'combat_attack_resolve') = 1
             and to_regprocedure('public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean, text)') is not null then 'ok' else 'OLD OR DUPLICATE VERSION' end

union all
select 'one combat_request_save, with a cost',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'combat_request_save') = 1
             and to_regprocedure('public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean, text)') is not null then 'ok' else 'OLD OR DUPLICATE VERSION' end

union all
select 'players can run combat_act',
       case when has_function_privilege('authenticated', 'public.combat_act(uuid, text, text, integer, text, integer, text)', 'execute') then 'ok' else 'authenticated cannot execute' end

union all
select 'players cannot call the attack and save functions directly',
       case when not has_function_privilege('authenticated', 'public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean, text)', 'execute')
             and not has_function_privilege('authenticated', 'public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean, text)', 'execute') then 'ok' else 'authenticated can execute' end

union all
select 'the server can call the attack and save functions',
       case when has_function_privilege('service_role', 'public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean, text)', 'execute')
             and has_function_privilege('service_role', 'public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean, text)', 'execute') then 'ok' else 'service_role cannot execute' end

union all
select 'fresh turn trigger on combats',
       case when exists (select 1 from pg_trigger where tgname = 'combat_turn_econ' and tgrelid = 'public.combats'::regclass and not tgisinternal) then 'ok' else 'MISSING' end

union all
select 'token moves check movement in a fight',
       case when pg_get_functiondef('public.tabletop_move_token(uuid, real, real, real)'::regprocedure) like '%wait for your turn to move%' then 'ok' else 'OLD VERSION' end

union all
select 'tabletop_combat shows the action economy',
       case when pg_get_functiondef('public.tabletop_combat(uuid)'::regprocedure) like '%speedNow%' then 'ok' else 'OLD VERSION' end

union all
select 'speed math (25 ft: Hasted 50, Slowed 12, Grappled 0)',
       case when public.combat_speed('{"speed":25,"conditions":["Hasted"]}') = 50
             and public.combat_speed('{"speed":25,"conditions":["Slowed"]}') = 12
             and public.combat_speed('{"speed":25,"conditions":["Grappled"]}') = 0 then 'ok' else 'WRONG' end

union all
select 'distance math (3 across, 2 down: 15 ft, alternating 20 ft)',
       case when public.tabletop_feet(3, 2, 'five', 5) = 15 and public.tabletop_feet(3, 2, 'alternate', 5) = 20 then 'ok' else 'WRONG' end

union all
select 'Extra Attack (two attacks, then the action is spent)',
       case when (public.combat_econ(public.combat_spend('{"attacksPerAction":2}'::jsonb, 'attack', 'Sword', false)) ->> 'attacks') = '1'
             and (public.combat_econ(public.combat_spend('{"attacksPerAction":2}'::jsonb, 'attack', 'Sword', false)) ->> 'action') = 'true' then 'ok' else 'WRONG' end

union all
select 'active fights right now (information)', count(*)::text
  from public.combats where status = 'active';
