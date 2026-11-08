-- p115-combat-followup-attacks-check.sql
--
-- Read-only checks after running supabase/migrations/p115-combat-followup-attacks.sql. Each row should say ok.

select 'combat_attack_resolve takes follow-ups' as check_name,
       case when pg_get_functiondef('public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean, text)'::regprocedure) like '%followup%' then 'ok' else 'OLD VERSION' end as result

union all
select 'still one combat_attack_resolve',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'combat_attack_resolve') = 1 then 'ok' else 'DUPLICATE' end

union all
select 'players still cannot call it directly',
       case when not has_function_privilege('authenticated', 'public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean, text)', 'execute') then 'ok' else 'authenticated can execute' end

union all
select 'the server can call it',
       case when has_function_privilege('service_role', 'public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean, text)', 'execute') then 'ok' else 'service_role cannot execute' end;
