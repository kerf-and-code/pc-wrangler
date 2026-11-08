-- p116-party-inventory-check.sql
--
-- Read-only checks after running supabase/migrations/p116-party-inventory.sql. Each row should say ok.

select 'tables present' as check_name,
       case when to_regclass('public.party_items') is not null and to_regclass('public.party_funds') is not null then 'ok' else 'MISSING' end as result

union all
select 'row level security on both',
       case when (select bool_and(relrowsecurity) from pg_class where oid in ('public.party_items'::regclass, 'public.party_funds'::regclass)) then 'ok' else 'RLS OFF' end

union all
select 'one policy each (items: the table; funds: read)',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'party_items') = 1
             and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'party_funds') = 1 then 'ok' else 'CHECK THE POLICIES' end

union all
select 'coins cannot be written directly',
       case when not has_table_privilege('authenticated', 'public.party_funds', 'UPDATE')
             and not has_table_privilege('authenticated', 'public.party_funds', 'INSERT') then 'ok' else 'WRITABLE' end

union all
select 'both published to Realtime',
       case when (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename in ('party_items', 'party_funds')) = 2 then 'ok' else 'MISSING' end

union all
select 'functions present and callable by players',
       case when has_function_privilege('authenticated', 'public.party_take(uuid, integer)', 'EXECUTE')
             and has_function_privilege('authenticated', 'public.party_fund_change(uuid, jsonb)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.party_take(uuid, integer)', 'EXECUTE') then 'ok' else 'CHECK GRANTS' end

union all
select 'access helpers the policies use exist',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('is_campaign_gm', 'tabletop_is_player')) >= 2 then 'ok' else 'MISSING' end;
