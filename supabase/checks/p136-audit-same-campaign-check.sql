-- supabase/checks/p136-audit-same-campaign-check.sql (2026-11-09)
-- Read-only. Run after p136.

-- 1. The guard is on all ten tables. Expect 10.
select count(*) as guarded_tables
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relnamespace = 'public'::regnamespace and t.tgname like '%\_same_campaign' and not t.tgisinternal;

-- 2. The three reads join on the row's campaign. Expect all true.
select position('e.campaign_id = h.campaign_id' in pg_get_functiondef('public.tabletop_handouts(uuid)'::regprocedure)) > 0 as handouts,
       position('campaign_id = v_p.campaign_id' in pg_get_functiondef('public.tabletop_pin_entry(uuid)'::regprocedure)) > 0 as pin_entry,
       position('e.campaign_id = p.campaign_id' in pg_get_functiondef('public.tabletop_pins(uuid)'::regprocedure)) > 0 as pins;

-- 3. Rows that ALREADY cross campaigns (made before the guard). Expect no rows. Any row listed is either
--    an old mistake or someone reaching into another campaign; send me the list before changing anything.
select 'vtt_pins entry' as what, p.id, p.campaign_id from public.vtt_pins p join public.entries e on e.id = p.entry_id where e.campaign_id <> p.campaign_id
union all select 'vtt_pins scene', p.id, p.campaign_id from public.vtt_pins p join public.vtt_scenes s on s.id = p.scene_id where s.campaign_id <> p.campaign_id
union all select 'vtt_handouts entry', h.id, h.campaign_id from public.vtt_handouts h join public.entries e on e.id = h.entry_id where e.campaign_id <> h.campaign_id
union all select 'vtt_tokens scene', t.id, t.campaign_id from public.vtt_tokens t join public.vtt_scenes s on s.id = t.scene_id where s.campaign_id <> t.campaign_id
union all select 'vtt_tokens character', t.id, t.campaign_id from public.vtt_tokens t join public.characters ch on ch.id = t.character_id where ch.campaign_id <> t.campaign_id
union all select 'vtt_drawings scene', d.id, d.campaign_id from public.vtt_drawings d join public.vtt_scenes s on s.id = d.scene_id where s.campaign_id <> d.campaign_id
union all select 'vtt_templates scene', x.id, x.campaign_id from public.vtt_templates x join public.vtt_scenes s on s.id = x.scene_id where s.campaign_id <> x.campaign_id
union all select 'vtt_effects scene', x.id, x.campaign_id from public.vtt_effects x join public.vtt_scenes s on s.id = x.scene_id where s.campaign_id <> x.campaign_id
union all select 'vtt_effects token', x.id, x.campaign_id from public.vtt_effects x join public.vtt_tokens t on t.id = x.token_id where t.campaign_id <> x.campaign_id
union all select 'vtt_scene_players scene (profile id)', x.profile_id, x.campaign_id from public.vtt_scene_players x join public.vtt_scenes s on s.id = x.scene_id where s.campaign_id <> x.campaign_id
union all select 'vtt_token_notes token (token id)', x.token_id, x.campaign_id from public.vtt_token_notes x join public.vtt_tokens t on t.id = x.token_id where t.campaign_id <> x.campaign_id
union all select 'vtt_scenes battle map', s.id, s.campaign_id from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id where b.campaign_id <> s.campaign_id
union all select 'player_notes entry', n.id, n.campaign_id from public.player_notes n join public.entries e on e.id = n.entry_id where e.campaign_id <> n.campaign_id;
