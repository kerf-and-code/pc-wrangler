-- p53-world-map-collab.sql
-- Collaborative editing. editable_by (text, default 'gm') gates it: 'gm' = GM-only, 'party' = open to
-- members. Two write paths, because terrain and POIs differ:
--   - POIs are whole rows a member owns, so member insert/update/delete go through RLS policies that
--     apply only when the map is open AND the caller is a member, and only for common/player markers
--     (a member can never mint or reach gm/private ones, matching the read RPC). A scoped member
--     SELECT (visible markers only) lets the viewer read a marker back after inserting it, and mirrors
--     the RPC's filter so it opens no new door.
--   - Terrain is one column on a shared row; a table UPDATE grant would hand members every column
--     (editable_by, size), so member terrain painting goes through world_map_paint, a security-definer
--     RPC that writes ONLY terrain and ONLY when the map is open. The GM keeps their direct writes.
-- These policies are ADDITIVE to "map_pois gm all" (the GM keeps full access). Idempotent.

-- ---- member POI access ----
drop policy if exists "map_pois member read visible" on public.map_pois;
create policy "map_pois member read visible" on public.map_pois for select
  using (
    visibility in ('common','player')
    and exists (select 1 from world_maps wm where wm.id = world_map_id and is_campaign_member(wm.campaign_id))
  );

drop policy if exists "map_pois member insert when open" on public.map_pois;
create policy "map_pois member insert when open" on public.map_pois for insert
  with check (
    visibility in ('common','player')
    and exists (select 1 from world_maps wm where wm.id = world_map_id and wm.editable_by = 'party' and is_campaign_member(wm.campaign_id))
  );

drop policy if exists "map_pois member update when open" on public.map_pois;
create policy "map_pois member update when open" on public.map_pois for update
  using (
    visibility in ('common','player')
    and exists (select 1 from world_maps wm where wm.id = world_map_id and wm.editable_by = 'party' and is_campaign_member(wm.campaign_id))
  )
  with check (
    visibility in ('common','player')
    and exists (select 1 from world_maps wm where wm.id = world_map_id and wm.editable_by = 'party' and is_campaign_member(wm.campaign_id))
  );

drop policy if exists "map_pois member delete when open" on public.map_pois;
create policy "map_pois member delete when open" on public.map_pois for delete
  using (
    visibility in ('common','player')
    and exists (select 1 from world_maps wm where wm.id = world_map_id and wm.editable_by = 'party' and is_campaign_member(wm.campaign_id))
  );

-- ---- member terrain painting (the controlled door) ----
create or replace function public.world_map_paint(p_campaign uuid, p_terrain text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from world_maps wm
    where wm.campaign_id = p_campaign
      and (is_campaign_gm(p_campaign) or (wm.editable_by = 'party' and is_campaign_member(p_campaign)))
  ) then
    raise exception 'not permitted to edit this map';
  end if;
  update world_maps set terrain = p_terrain, updated_at = now() where campaign_id = p_campaign;
end;
$function$;

grant execute on function public.world_map_paint(uuid, text) to authenticated;
