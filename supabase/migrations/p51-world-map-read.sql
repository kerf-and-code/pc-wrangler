-- p51-world-map-read.sql
-- Phase 5a: the single read door for the world map. A security-definer RPC that returns the whole
-- visible map in one call so a party member (or the GM) can load it, with visibility applied on the
-- server. The base tables stay GM-only in RLS; this function is the only path a non-GM reads through.
--
-- Access: the caller must be the campaign's GM (is_campaign_gm covers gm_id + gm/co-gm memberships)
-- or any active member (is_campaign_member). Role: a GM sees everything; a player sees only regions
-- and POIs whose visibility is 'common' or 'player'. Terrain, biomes, and placed images are shown to
-- every viewer who can load the map at all (the map is seen by all; only detail is gated).
--
-- Returns a jsonb bundle { map, biomes, images, layers, regions, hexes, pois } or null if not allowed.
-- Idempotent (create or replace).

create or replace function public.world_map_read(p_campaign uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with allowed as (
    select
      is_campaign_gm(p_campaign) as is_gm,
      (is_campaign_gm(p_campaign) or is_campaign_member(p_campaign)) as can_read
  ),
  wm as (
    select * from world_maps where campaign_id = p_campaign
  )
  select case
    when not (select can_read from allowed) then null::jsonb
    else jsonb_build_object(
      'map',    (select to_jsonb(w) - 'campaign_id' from wm w),
      'biomes', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from biomes b),
      'images', (select coalesce(jsonb_agg(to_jsonb(i) order by i.z), '[]'::jsonb)
                 from map_images i where i.world_map_id = (select id from wm)),
      'layers', (select coalesce(jsonb_agg(to_jsonb(l) order by l.ord), '[]'::jsonb)
                 from map_layers l where l.world_map_id = (select id from wm)),
      'regions', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
                  from regions r
                  where r.world_map_id = (select id from wm)
                    and ((select is_gm from allowed) or r.visibility in ('common','player'))),
      'hexes', (select coalesce(jsonb_agg(jsonb_build_object('col', h.col, 'row', h.row, 'region_id', h.region_id)), '[]'::jsonb)
                from world_hexes h
                join regions r on r.id = h.region_id
                where h.world_map_id = (select id from wm)
                  and ((select is_gm from allowed) or r.visibility in ('common','player'))),
      'pois', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
               from map_pois p
               where p.world_map_id = (select id from wm)
                 and ((select is_gm from allowed) or p.visibility in ('common','player')))
    )
  end;
$function$;

grant execute on function public.world_map_read(uuid) to authenticated;
