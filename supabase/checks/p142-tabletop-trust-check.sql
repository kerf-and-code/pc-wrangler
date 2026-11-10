-- supabase/checks/p142-tabletop-trust-check.sql (2026-11-09)
-- Read-only. Run after p142.

-- 1. Functions and rules in place. Expect all true.
select has_function_privilege('service_role', 'public.tabletop_set_initiative(uuid, uuid, integer)', 'execute') as server_sets_initiative,
       not has_function_privilege('authenticated', 'public.tabletop_set_initiative(uuid, uuid, integer)', 'execute') as players_cannot,
       position('six_axes_roller' in pg_get_functiondef('public.tabletop_feed(uuid, timestamp with time zone, integer)'::regprocedure)) > 0 as feed_hides_gm_rolls,
       position('tabletop_scene_for' in lower((select qual from pg_policies where schemaname = 'public' and tablename = 'vtt_scenes' and policyname = 'vtt_scenes_player_read'))) > 0 as players_own_scene_only;

-- 2. The live-channel policies on realtime.messages. Expect two rows: tabletop members receive (SELECT)
--    and tabletop members send (INSERT). Any other rows listed are policies that were already there.
select policyname, cmd, roles from pg_policies where schemaname = 'realtime' and tablename = 'messages' order by policyname;

-- 3. The columns realtime.messages has on this project (for the record).
select column_name, data_type from information_schema.columns where table_schema = 'realtime' and table_name = 'messages' order by ordinal_position;
