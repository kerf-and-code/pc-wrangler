-- p109-tabletop-fog-doors-check.sql
--
-- Read-only checks after running supabase/migrations/p109-tabletop-fog-doors.sql. Each row should say ok.

select 'vtt_scenes fog and door columns' as check_name,
       case when count(*) = 3 then 'ok' else 'MISSING: ' || (3 - count(*))::text || ' column(s)' end as result
  from information_schema.columns
 where table_schema = 'public' and table_name = 'vtt_scenes' and column_name in ('fog_on', 'revealed', 'door_state')

union all
select 'functions present',
       case when count(*) = 5 then 'ok' else 'MISSING: found ' || count(*)::text || ' of 5' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('tabletop_revealed', 'tabletop_token_visible', 'tabletop_set_fog', 'tabletop_set_doors', 'tabletop_state')

union all
select 'player token policy uses the fog test',
       case when bool_or(coalesce(qual, '') like '%tabletop_token_visible%') then 'ok' else 'MISSING: policy not replaced' end
  from pg_policies
 where schemaname = 'public' and tablename = 'vtt_tokens' and policyname = 'vtt_tokens_player_read'

union all
select 'tabletop_state returns fog, door_state and walls',
       case when pg_get_functiondef('public.tabletop_state(uuid)'::regprocedure) like '%''door_state''%'
             and pg_get_functiondef('public.tabletop_state(uuid)'::regprocedure) like '%''fog''%'
             and pg_get_functiondef('public.tabletop_state(uuid)'::regprocedure) like '%''walls''%' then 'ok' else 'OLD VERSION' end

union all
select 'anon cannot run the fog and door functions',
       case when not has_function_privilege('anon', 'public.tabletop_set_fog(uuid, boolean, text)', 'execute')
             and not has_function_privilege('anon', 'public.tabletop_set_doors(uuid, text[], boolean)', 'execute') then 'ok' else 'anon can execute' end

union all
select 'bit order (square 6 of 0x63 is revealed, square 2 is not)',
       case when public.tabletop_revealed('\x63'::bytea, true, 5, 1, 1) and not public.tabletop_revealed('\x63'::bytea, true, 5, 2, 0) then 'ok' else 'WRONG' end

union all
select 'scenes with fog on (information)', count(*)::text from public.vtt_scenes where fog_on;
