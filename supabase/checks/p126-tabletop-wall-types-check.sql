-- supabase/checks/p126-tabletop-wall-types-check.sql (2026-11-09)
-- Read-only. Run after p126.

-- 1. The wall check reads wall kinds. Expect one row: reads_kinds true, anon_can_run false,
--    authenticated_can_run false (only tabletop_move_token calls it).
select p.proname,
       position('not in (4, 5)' in pg_get_functiondef(p.oid)) > 0 as reads_kinds,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'tabletop_wall_blocks';

-- 2. A move across one wall of each kind on an open 10 by 10 map (from (2.5, 5.5) to (7.5, 5.5), across
--    x = 5). Expect: wall true, window true, screen false, one_way true, no_wall false.
with m as (
  select k, jsonb_populate_record(null::public.battle_maps, jsonb_build_object(
           'n', 10, 'kind', 'indoor', 'levels', '[[]]'::jsonb, 'custom_cells', '[{}]'::jsonb, 'doors', '[{}]'::jsonb,
           'meta', jsonb_build_object('sightWalls', jsonb_build_array(w)))) as map
    from (values ('wall', '[[5, 0, 5, 10]]'::jsonb), ('window', '[[5, 0, 5, 10, 1]]'::jsonb), ('screen', '[[5, 0, 5, 10, 2]]'::jsonb),
                 ('one_way', '[[5, 0, 5, 10, 3]]'::jsonb), ('no_wall', '[]'::jsonb)) v(k, w)
)
select k as wall_kind, public.tabletop_wall_blocks(map, 0, '{}'::jsonb, 2.5, 5.5, 7.5, 5.5) as stops_a_player
  from m order by array_position(array['wall', 'window', 'screen', 'one_way', 'no_wall'], k);
