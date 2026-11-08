-- p118-tabletop-sight-walls-check.sql
--
-- Read-only check for p118-tabletop-sight-walls.sql. Every row in the first query should read ok.

select 'tabletop_state sends sightWalls' as item,
       case when exists (
         select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname = 'public' and p.proname = 'tabletop_state'
            and pg_get_functiondef(p.oid) like '%''sightWalls''%') then 'ok' else 'MISSING' end as status
union all
select 'tabletop_state still places players (p114)',
       case when exists (
         select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname = 'public' and p.proname = 'tabletop_state'
            and pg_get_functiondef(p.oid) like '%vtt_scene_players%') then 'ok' else 'MISSING' end
union all
select 'authenticated can run tabletop_state',
       case when has_function_privilege('authenticated', 'public.tabletop_state(uuid)', 'execute') then 'ok' else 'MISSING' end
union all
select 'anon cannot run tabletop_state',
       case when not has_function_privilege('anon', 'public.tabletop_state(uuid)', 'execute') then 'ok' else 'OPEN TO ANON' end;

-- Information: battle maps that have sight walls, with how many on each level.
select b.name, b.kind, b.n,
       jsonb_array_length(coalesce(b.meta -> 'sightWalls' -> 0, '[]'::jsonb)) as level_1,
       jsonb_array_length(coalesce(b.meta -> 'sightWalls' -> 1, '[]'::jsonb)) as level_2,
       jsonb_array_length(coalesce(b.meta -> 'sightWalls' -> 2, '[]'::jsonb)) as level_3,
       b.updated_at
  from public.battle_maps b
 where jsonb_typeof(b.meta -> 'sightWalls') = 'array'
 order by b.updated_at desc
 limit 20;
