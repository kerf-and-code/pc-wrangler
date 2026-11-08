-- p114-tabletop-split-effects-check.sql
--
-- Read-only checks after running supabase/migrations/p114-tabletop-split-effects.sql. Each row should
-- say ok, except the row marked (information).

select 'tables present' as check_name,
       case when to_regclass('public.vtt_scene_players') is not null and to_regclass('public.vtt_effects') is not null then 'ok' else 'MISSING' end as result

union all
select 'row level security on both',
       case when (select bool_and(relrowsecurity) from pg_class where oid in ('public.vtt_scene_players'::regclass, 'public.vtt_effects'::regclass)) then 'ok' else 'RLS OFF' end

union all
select 'functions present',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                   and p.proname in ('tabletop_scene_for', 'tabletop_place', 'tabletop_view_scene', 'tabletop_token_seen', 'tabletop_effect_kinds')) = 5 then 'ok' else 'MISSING' end

union all
select 'tabletop_state follows each person''s scene',
       case when pg_get_functiondef('public.tabletop_state(uuid)'::regprocedure) like '%tabletop_scene_for%' then 'ok' else 'OLD VERSION' end

union all
select 'putting a scene on the table regroups everyone',
       case when pg_get_functiondef('public.tabletop_activate_scene(uuid)'::regprocedure) like '%vtt_scene_players%' then 'ok' else 'OLD VERSION' end

union all
select 'doors follow the player''s scene',
       case when pg_get_functiondef('public.tabletop_set_doors(uuid, text[], boolean)'::regprocedure) like '%tabletop_scene_for%' then 'ok' else 'OLD VERSION' end

union all
select 'players read only their own scene (tokens, templates, drawings)',
       case when (select count(*) from pg_policies where schemaname = 'public'
                   and ((tablename = 'vtt_tokens' and policyname = 'vtt_tokens_player_read')
                     or (tablename = 'vtt_templates' and policyname = 'vtt_templates_player_read')
                     or (tablename = 'vtt_drawings' and policyname = 'vtt_drawings_player_read'))
                   and qual like '%tabletop_scene_for%') = 3 then 'ok' else 'CHECK THE POLICIES' end

union all
select 'template effects allowed list',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vtt_templates' and column_name = 'effect')
             and exists (select 1 from pg_constraint where conname = 'vtt_templates_effect_check') then 'ok' else 'MISSING' end

union all
select 'effect policies (gm, player read, insert, delete)',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vtt_effects') = 4 then 'ok'
            else 'found ' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vtt_effects')::text || ' of 4' end

union all
select 'published to Realtime (placements, effects)',
       case when (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
                   and tablename in ('vtt_scene_players', 'vtt_effects')) = 2 then 'ok' else 'MISSING' end

union all
select 'players placed off the active scene right now (information)', (select count(*) from public.vtt_scene_players)::text;
