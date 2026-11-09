-- supabase/checks/p125-tabletop-difficult-terrain-check.sql (2026-11-09)
-- Read-only. Run after p125.

-- 1. The functions. Expect:
--    tabletop_difficult_extra  definer false, anon false, authenticated true, charges_terrain true
--    tabletop_move_token       definer true,  anon false, authenticated true, charges_terrain true
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
       case when p.proname = 'tabletop_move_token' then position('tabletop_difficult_extra' in pg_get_functiondef(p.oid)) > 0 else true end as charges_terrain
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('tabletop_difficult_extra', 'tabletop_move_token')
 order by 1;

-- 2. The sums, on a 10 by 10 grid with rubble in squares 12 and 13 (row 1, columns 2 and 3). Expect:
--    open_ground 0, all_rubble 10, three_quarters 10, half_square 5
select public.tabletop_difficult_extra('[12, 13]', 10, 0.5, 5.5, 4.5, 5.5, 20, 5) as open_ground,
       public.tabletop_difficult_extra('[12, 13]', 10, 2.1, 1.5, 3.9, 1.5, 10, 5) as all_rubble,
       public.tabletop_difficult_extra('[12, 13]', 10, 1.5, 1.5, 3.5, 1.5, 10, 5) as three_quarters,
       public.tabletop_difficult_extra('[1]', 5, 0.5, 0.5, 1.5, 0.5, 5, 5) as half_square;

-- 3. Scenes with difficult terrain so far (none until a GM paints some).
select id, name, jsonb_array_length(settings -> 'difficult') as difficult_squares
  from public.vtt_scenes where jsonb_typeof(settings -> 'difficult') = 'array' and jsonb_array_length(settings -> 'difficult') > 0;
