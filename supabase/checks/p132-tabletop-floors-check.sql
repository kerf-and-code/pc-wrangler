-- supabase/checks/p132-tabletop-floors-check.sql (2026-11-09)
-- Read-only. Run after p132.

-- 1. The functions. Expect:
--    tabletop_floors        definer true,  anon false, authenticated true
--    tabletop_on_connector  definer false, anon false, authenticated false (used inside the next one)
--    tabletop_token_floor   definer true,  anon false, authenticated true
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('tabletop_floors', 'tabletop_on_connector', 'tabletop_token_floor')
 order by 1;

-- 2. Places that already have more than one floor on the table (scenes from one battle map's
--    different levels), and how many ways between floors (stairs, ladders, trapdoors, pits) each
--    floor's map level has. A floor with 0 needs the GM's "change floors anywhere", or pieces added.
select s.campaign_id, b.name as battle_map, s.level, s.name as scene, s.is_active,
       coalesce(s.settings ->> 'freeFloors', 'false') as free_floors,
       (select count(*) from jsonb_array_elements(case when jsonb_typeof(b.elements -> s.level) = 'array' then b.elements -> s.level else '[]'::jsonb end) e
         where e.value ->> 'k' in ('stairs', 'ladder', 'trapdoor', 'pit')) as ways_between_floors
  from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id
 where (select count(distinct s2.level) from public.vtt_scenes s2 where s2.campaign_id = s.campaign_id and s2.battle_map_id = s.battle_map_id) > 1
 order by s.campaign_id, b.name, s.level;
