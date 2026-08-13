-- p58-map-feature-names.sql
-- Rivers get names. Features carry an optional name (rivers use it; roads stay null), and the member
-- read RPC returns it alongside kind/class/path. Recreating world_map_features_read with the extra
-- field, same gate as before. Idempotent; run by hand.

alter table public.map_features add column if not exists name text;

create or replace function public.world_map_features_read(p_campaign uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when public.is_campaign_gm(p_campaign) or public.is_campaign_member(p_campaign) then
      coalesce((
        select jsonb_agg(jsonb_build_object('kind', mf.kind, 'class', mf.class, 'path', mf.path, 'name', mf.name))
        from public.map_features mf
        join public.world_maps wm on wm.id = mf.world_map_id
        where wm.campaign_id = p_campaign
      ), '[]'::jsonb)
    else null
  end;
$function$;

grant execute on function public.world_map_features_read(uuid) to authenticated;
