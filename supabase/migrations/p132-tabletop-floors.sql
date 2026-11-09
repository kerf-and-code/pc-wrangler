-- supabase/migrations/p132-tabletop-floors.sql (2026-11-09)
--
-- Phase 6c: multi-level maps (gap 13 in the tabletop audit doc).
--
-- A battle map has up to three levels, and each level goes on the table as its own scene (with its own
-- fog, walls, terrain, pins and light). Until now those scenes knew nothing of each other. Now the
-- scenes made from one battle map are the floors of one place:
--
--   tabletop_floors        the floors of a scene's map that are on the table: level, name, and for the GM
--                          the scene. Anyone at the table may ask about their own scene.
--   tabletop_token_floor   takes a token to another floor, to the same spot. The GM anytime. A player,
--                          with their own token on their own scene, when it stands on stairs, a ladder,
--                          a trapdoor or a pit, or anywhere when the GM allows it (the scene setting
--                          freeFloors), and not into solid rock. The token's players go with it: their
--                          view moves to the new floor (as tabletop_place does), so a player always
--                          sees the floor their character is on.
--   tabletop_on_connector  whether a point is on a stairs, ladder, trapdoor or pit piece of a level.
--
-- Needs p130 (tabletop_card_seat). Idempotent. Run by hand after p131, then
-- supabase/checks/p132-tabletop-floors-check.sql.

do $$
begin
  if to_regprocedure('public.tabletop_card_seat(uuid, uuid)') is null then
    raise exception 'run p130-tabletop-card-decks.sql first (p132 uses tabletop_card_seat)';
  end if;
end;
$$;

-- Pieces are placed by their top-left corner and are s squares across; a token's x and y are its centre.
-- A quarter square of slack, so a token nudged to the edge of the stairs still counts.
create or replace function public.tabletop_on_connector(p_map public.battle_maps, p_level integer, p_x double precision, p_y double precision)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select exists (
    select 1
      from jsonb_array_elements(case when jsonb_typeof(p_map.elements -> p_level) = 'array' then p_map.elements -> p_level else '[]'::jsonb end) e,
           lateral (select case when jsonb_typeof(e.value -> 's') = 'number' then greatest((e.value ->> 's')::double precision, 0.5) else 1 end as s) z
     where e.value ->> 'k' in ('stairs', 'ladder', 'trapdoor', 'pit')
       and jsonb_typeof(e.value -> 'x') = 'number' and jsonb_typeof(e.value -> 'y') = 'number'
       and p_x between (e.value ->> 'x')::double precision - 0.25 and (e.value ->> 'x')::double precision + z.s + 0.25
       and p_y between (e.value ->> 'y')::double precision - 0.25 and (e.value ->> 'y')::double precision + z.s + 0.25);
$function$;
revoke all on function public.tabletop_on_connector(public.battle_maps, integer, double precision, double precision) from public, anon, authenticated;

create or replace function public.tabletop_floors(p_scene uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_sc  public.vtt_scenes;
  v_gm  boolean;
  v_m   public.battle_maps;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_sc from public.vtt_scenes where id = p_scene;
  if v_sc.id is null then raise exception 'scene not found'; end if;
  v_gm := public.is_campaign_gm(v_sc.campaign_id);
  if not v_gm then
    if not public.tabletop_is_player(v_sc.campaign_id) then raise exception 'not at this table'; end if;
    if public.tabletop_scene_for(v_sc.campaign_id, v_uid) is distinct from p_scene then return '[]'::jsonb; end if;
  end if;
  select * into v_m from public.battle_maps where id = v_sc.battle_map_id;
  -- one scene per floor: the active one, else the most recently changed
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'level', f.level,
             'name', coalesce(nullif(v_m.meta -> 'levelNames' ->> f.level, ''), 'Level ' || (f.level + 1)),
             'current', f.id = p_scene)
           || case when v_gm then jsonb_build_object('sceneId', f.id, 'active', f.is_active) else '{}'::jsonb end
           order by f.level)
      from (select distinct on (s.level) s.id, s.level, s.is_active from public.vtt_scenes s
             where s.campaign_id = v_sc.campaign_id and s.battle_map_id = v_sc.battle_map_id
             order by s.level, (s.id = p_scene) desc, s.is_active desc, s.updated_at desc) f
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.tabletop_floors(uuid) from public, anon;
grant execute on function public.tabletop_floors(uuid) to authenticated;

create or replace function public.tabletop_token_floor(p_token uuid, p_level integer)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_t    public.vtt_tokens;
  v_sc   public.vtt_scenes;
  v_to   public.vtt_scenes;
  v_m    public.battle_maps;
  v_gm   boolean;
  v_gmid uuid;
  v_p    uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_level is null or p_level not between 0 and 2 then raise exception 'floors are levels 1 to 3'; end if;
  select * into v_t from public.vtt_tokens where id = p_token for update;
  if v_t.id is null then raise exception 'token not found'; end if;
  select * into v_sc from public.vtt_scenes where id = v_t.scene_id;
  select * into v_m from public.battle_maps where id = v_sc.battle_map_id;
  if v_sc.level = p_level then return v_sc.id; end if;
  v_gm := public.is_campaign_gm(v_t.campaign_id);
  if not v_gm then
    if not public.tabletop_is_player(v_t.campaign_id) then raise exception 'not at this table'; end if;
    if v_t.hidden or v_t.layer = 'gm' or not (
         v_uid = any (v_t.controlled_by)
         or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)) then
      raise exception 'that token is not yours';
    end if;
    if public.tabletop_scene_for(v_t.campaign_id, v_uid) is distinct from v_t.scene_id then raise exception 'that token is not on your floor'; end if;
    if not coalesce((v_sc.settings ->> 'freeFloors')::boolean, false)
       and not public.tabletop_on_connector(v_m, v_sc.level, v_t.x, v_t.y) then
      raise exception 'stand on stairs, a ladder, a trapdoor or a pit to change floor';
    end if;
  end if;

  select * into v_to from public.vtt_scenes s
   where s.campaign_id = v_sc.campaign_id and s.battle_map_id = v_sc.battle_map_id and s.level = p_level
   order by s.is_active desc, s.updated_at desc limit 1;
  if v_to.id is null then raise exception 'that floor is not on the table yet: the GM adds it with the floor buttons'; end if;
  if not v_gm and public.tabletop_walled_at(coalesce(v_m.levels -> p_level, '[]'::jsonb), coalesce(v_m.custom_cells -> p_level, '{}'::jsonb),
                                            v_m.n, coalesce(v_m.kind, '') = 'outdoor', floor(v_t.x)::integer, floor(v_t.y)::integer) then
    raise exception 'that spot is solid rock on the other floor';
  end if;

  update public.vtt_tokens set scene_id = v_to.id where id = v_t.id;

  -- the token's players go with it (never the GM, whose view is their own)
  select gm_id into v_gmid from public.campaigns where id = v_t.campaign_id;
  for v_p in
    select distinct p from (
      select c.profile_id as p from public.characters c where c.id = v_t.character_id
      union select unnest(coalesce(v_t.controlled_by, '{}'::uuid[]))) x
     where p is not null and p is distinct from v_gmid and public.tabletop_card_seat(v_t.campaign_id, p)
  loop
    if v_to.is_active then
      delete from public.vtt_scene_players where campaign_id = v_t.campaign_id and profile_id = v_p;
    else
      insert into public.vtt_scene_players (campaign_id, profile_id, scene_id) values (v_t.campaign_id, v_p, v_to.id)
      on conflict (campaign_id, profile_id) do update set scene_id = excluded.scene_id, updated_at = now();
    end if;
  end loop;
  return v_to.id;
end;
$function$;
revoke all on function public.tabletop_token_floor(uuid, integer) from public, anon;
grant execute on function public.tabletop_token_floor(uuid, integer) to authenticated;
