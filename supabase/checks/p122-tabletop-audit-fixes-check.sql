-- supabase/checks/p122-tabletop-audit-fixes-check.sql (2026-11-08)
-- Read-only. Run after p122.

-- 1. The functions and who may run them. Expect:
--    combat_apply_outside_roll   definer true,  anon false, authenticated true,  marker true
--    tabletop_move_token         definer true,  anon false, authenticated true,  marker true
--    tabletop_set_token_look     definer true,  anon false, authenticated true,  marker true
--    tabletop_storage_host       definer false, anon false, authenticated true,  marker true
--    tabletop_wall_blocks        definer false, anon false, authenticated false, marker true
--    tabletop_walled_at          definer false, anon false, authenticated false, marker true
select p.proname,
       p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
       case p.proname
         when 'combat_apply_outside_roll' then position('casting_time' in pg_get_functiondef(p.oid)) > 0
         when 'tabletop_move_token' then position('tabletop_wall_blocks' in pg_get_functiondef(p.oid)) > 0
         when 'tabletop_set_token_look' then position('tabletop_storage_host' in pg_get_functiondef(p.oid)) > 0
         else true
       end as marker
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('combat_apply_outside_roll', 'tabletop_move_token', 'tabletop_set_token_look',
                     'tabletop_storage_host', 'tabletop_wall_blocks', 'tabletop_walled_at')
 order by p.proname;

-- 2. Hosts of the token pictures already saved in token folders. Expect one row, host
--    agafmvywayisxgvrfium.supabase.co (or no rows if no token has a token-maker picture yet).
select substring(u from '^https?://([^/]+)') as host, count(*) as pictures
  from (select image_url as u from public.vtt_tokens
        union all
        select style -> 'frame' ->> 'importUrl' from public.vtt_tokens) x
 where u ~ '/storage/v1/object/public/campaign-maps/[0-9a-f-]{36}/tokens/'
 group by 1;

-- 3. Outside attack rolls that already carry the new kind fields (extension 2.2.0 or later). Zero until a
--    player with the updated extension rolls an attack.
select count(*) filter (where rolls ? 'request_type') as with_kind,
       count(*) filter (where not (rolls ? 'request_type')) as without_kind
  from public.vtt_events
 where event_type = 'to-hit' and source = 'beyond20' and received_at > now() - interval '30 days';
