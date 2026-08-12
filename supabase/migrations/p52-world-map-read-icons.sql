-- p52-world-map-read-icons.sql
-- Amend the read RPC to also return the campaign's uploaded icon urls (id -> url). A member viewer
-- renders POIs that use an uploaded icon by url, but members cannot read map_icons directly (it is
-- GM-only in RLS), so the security-definer RPC is their only path to these urls. Everything else is
-- unchanged from p51. create or replace, idempotent.

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
      'icons',  (select coalesce(jsonb_agg(jsonb_build_object('id', mi.id, 'url', mi.url)), '[]'::jsonb)
                 from map_icons mi where mi.campaign_id = p_campaign),
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
