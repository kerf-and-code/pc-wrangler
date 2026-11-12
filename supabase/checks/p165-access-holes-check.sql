-- supabase\checks\p165-access-holes-check.sql (2026-11-12, push 41, read only)
-- Run after p165-access-holes.sql. Every row should say ok = true.

select 'migration recorded' as what, exists (select 1 from public._migrations where name = 'p165-access-holes') as ok
union all
select 'campaigns.activity_watchers exists, default off',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'campaigns'
                and column_name = 'activity_watchers' and column_default = 'false')
union all
select 'tabletop_is_player checks active', pg_get_functiondef('public.tabletop_is_player'::regproc) like '%ch.active%'
union all
select 'tabletop_feed hides gm_only outside rolls', pg_get_functiondef('public.tabletop_feed'::regproc) like '%gm_only''%'
union all
select 'POI detail checks NPC visibility', pg_get_functiondef('public.world_map_poi_detail_for_player'::regproc) like '%ch.visibility%'
union all
select 'activity_identity: GM only through the Discord sign-in', pg_get_functiondef('public.activity_identity'::regproc) like '%r.pri = 1%'
union all
select 'activity_call checks the campaign of tokens and cards', pg_get_functiondef('public.activity_call'::regproc) like '%t.campaign_id = v_c%'
union all
select 'setup codes table locked to the server', not has_table_privilege('authenticated', 'public.discord_setup_codes', 'SELECT')
union all
select 'GMs can make a setup code', has_function_privilege('authenticated', 'public.create_discord_setup_code(uuid)', 'EXECUTE')
union all
select 'only the server resolves a setup code', not has_function_privilege('authenticated', 'public.discord_setup_resolve(text, text)', 'EXECUTE')
union all
select 'activity functions closed to signed-in accounts', not has_function_privilege('authenticated', 'public.activity_call(uuid, text, jsonb)', 'EXECUTE');

-- B1 in live data: characters /claimed by a Discord user while owned by an account that is not signed in
-- with that Discord id. Before p165 a row here whose owner is the campaign's GM let that Discord user act
-- as the GM in the Activity. Read only; nothing to fix by hand, the function now skips these.
select c.id as character_id, c.name, cm.name as campaign, (cm.gm_id = c.profile_id) as owner_is_gm
  from public.characters c
  join public.campaigns cm on cm.id = c.campaign_id
 where c.discord_user_id is not null and c.profile_id is not null
   and not exists (select 1 from auth.identities i
                    where i.user_id = c.profile_id and i.provider = 'discord' and i.provider_id = c.discord_user_id)
 order by cm.name, c.name;
