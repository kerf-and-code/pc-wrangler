-- p117-outside-roll-damage-check.sql
--
-- Read-only checks after running supabase/migrations/p117-outside-roll-damage.sql. Each row should
-- say ok; the last query (information) shows the newest D&D Beyond rolls and how they group.

select 'vtt_events has applied_at and applied_to' as check_name,
       case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vtt_events'
                   and column_name in ('applied_at', 'applied_to')) = 2 then 'ok' else 'MISSING' end as result
union all
select 'combat_apply_outside_roll callable by players, not anon',
       case when has_function_privilege('authenticated', 'public.combat_apply_outside_roll(uuid, text, uuid[], boolean)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.combat_apply_outside_roll(uuid, text, uuid[], boolean)', 'EXECUTE') then 'ok' else 'CHECK GRANTS' end
union all
select 'combat_hurt present (the function uses it)',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'combat_hurt') then 'ok' else 'MISSING (run p111)' end
union all
select 'tabletop_feed returns applied_to',
       case when (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tabletop_feed') like '%applied_to%' then 'ok' else 'OLD VERSION' end;

-- (information) the last 20 outside rolls: one attack's rows share the actor, the name and a moment
select received_at, rolled_at, actor_name, name, event_type,
       rolls ->> 'total' as total, rolls ->> 'damage_type' as damage_type,
       rolls ->> 'critical_success' as crit, applied_to
  from public.vtt_events
 where source in ('beyond20', 'foundry')
 order by received_at desc
 limit 20;
