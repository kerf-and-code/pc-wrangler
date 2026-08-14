-- p61: member-facing read for GM area labels, visibility-filtered. Mirrors world_map_features_read:
-- a small standalone RPC so world_map_read stays untouched. Returns null for non-members; a GM sees
-- every label, a member sees only common/player (party) labels.

create or replace function public.world_map_labels_read(p_campaign uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when public.is_campaign_gm(p_campaign) or public.is_campaign_member(p_campaign) then
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id, 'x', l.x, 'y', l.y, 'text', l.text, 'size', l.size, 'color', l.color
        ))
        from public.map_labels l
        join public.world_maps wm on wm.id = l.world_map_id
        where wm.campaign_id = p_campaign
          and (public.is_campaign_gm(p_campaign) or l.visibility in ('common', 'player'))
      ), '[]'::jsonb)
    else null
  end
$$;

grant execute on function public.world_map_labels_read(uuid) to authenticated;
