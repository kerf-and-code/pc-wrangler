-- p109-tabletop-fog-doors.sql
--
-- The tabletop, phase 3a (2026-11-07): fog of war the GM controls, and doors that open and close.
--
-- Fog. Each scene gets fog_on and a revealed bitmap (one bit per square, square i = row * n + col at
-- byte i / 8, bit i % 8 counted from the low bit, the order get_bit uses). With fog on, a player gets
-- NOTHING from a hidden square: tabletop_state blanks its terrain, drops its custom tile, its pieces and
-- the doors that only touch hidden squares, and leaves out every token standing in it (or off the map)
-- that the player does not control. The token read policy applies the same test, so Realtime never
-- delivers a hidden monster's row either. The GM sees everything, with the hidden squares shaded.
--   Not covered, by decision (2026-11-07): the battle map's Gemini painting is one image, so it is sent
--   whole and the fog is drawn over it; a player reading the network could see the painting.
--
-- Doors. door_state lists the doors standing open on the scene ({"<edge>": true}). Players see an open
-- door as open; a secret door reaches players only once it is open, and then as a plain door. Until
-- then its edge comes to players in 'walls', drawn and treated as plain wall (p105 left it out
-- entirely, which drew an open gap between the room and the passage behind it). The GM
-- opens or closes any door. A player opens or closes a plain or double door on a revealed square with
-- a token they control within a square and a half of it; locked doors, portcullises and secret doors
-- stay with the GM.
--
-- Changes to vtt_scenes already reach every table through Realtime (both roles can read it), and each
-- table reloads its state, so fog and doors need no new channel.
--
-- Idempotent. Run by hand after p105 to p108, then supabase/checks/p109-tabletop-fog-doors-check.sql.

alter table public.vtt_scenes add column if not exists fog_on boolean not null default false;
alter table public.vtt_scenes add column if not exists revealed bytea not null default '\x'::bytea;
alter table public.vtt_scenes add column if not exists door_state jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------------------------------
-- Is the square at column x, row y visible to players? Off the map counts as hidden while fog is on.
create or replace function public.tabletop_revealed(p_rev bytea, p_on boolean, p_n integer, p_x integer, p_y integer)
 returns boolean
 language sql
 immutable
as $function$
  select not coalesce(p_on, false) or (
    p_x >= 0 and p_y >= 0 and p_x < p_n and p_y < p_n
    and (p_y * p_n + p_x) < length(p_rev) * 8
    and get_bit(p_rev, p_y * p_n + p_x) = 1
  );
$function$;
revoke all on function public.tabletop_revealed(bytea, boolean, integer, integer, integer) from public, anon;
grant execute on function public.tabletop_revealed(bytea, boolean, integer, integer, integer) to authenticated;

-- May the signed-in player see this token? The GM test is separate (the GM policy admits everything).
-- A token the player controls is always visible to them; any other token only on a revealed square.
create or replace function public.tabletop_token_visible(p_scene uuid, p_x real, p_y real, p_character uuid, p_controlled uuid[])
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth.uid() = any (coalesce(p_controlled, '{}'))
      or exists (select 1 from public.characters c where c.id = p_character and c.profile_id = auth.uid())
      or exists (
        select 1 from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id
        where s.id = p_scene
          and public.tabletop_revealed(s.revealed, s.fog_on, b.n, floor(p_x)::integer, floor(p_y)::integer)
      );
$function$;
revoke all on function public.tabletop_token_visible(uuid, real, real, uuid, uuid[]) from public, anon;
grant execute on function public.tabletop_token_visible(uuid, real, real, uuid, uuid[]) to authenticated;

-- The player read policy gains the fog test. Replaced in place, so the name and the GM policy stay.
drop policy if exists vtt_tokens_player_read on public.vtt_tokens;
create policy vtt_tokens_player_read on public.vtt_tokens
  for select using (
    tabletop_is_player(campaign_id) and not hidden and layer <> 'gm'
    and tabletop_token_visible(scene_id, x, y, character_id, controlled_by)
  );

-- ---------------------------------------------------------------------------------------------------
-- Fog: the GM turns it on or off and sends the whole revealed bitmap as hex. Either may be null to
-- leave it as it is.
create or replace function public.tabletop_set_fog(p_scene uuid, p_on boolean default null, p_revealed text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_s public.vtt_scenes;
  v_n integer;
  v_rev bytea;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_s.campaign_id) then raise exception 'only the GM can change the fog'; end if;
  select n into v_n from public.battle_maps where id = v_s.battle_map_id;
  if p_revealed is not null then
    if p_revealed !~ '^([0-9a-f]{2})*$' then raise exception 'the fog bitmap is not hex'; end if;
    v_rev := decode(p_revealed, 'hex');
    if length(v_rev) > (coalesce(v_n, 100) * coalesce(v_n, 100) + 7) / 8 then raise exception 'the fog bitmap is larger than the map'; end if;
  end if;
  update public.vtt_scenes
     set fog_on = coalesce(p_on, fog_on),
         revealed = coalesce(v_rev, revealed),
         updated_at = now()
   where id = p_scene;
end;
$function$;
revoke all on function public.tabletop_set_fog(uuid, boolean, text) from public, anon;
grant execute on function public.tabletop_set_fog(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Doors: open or close one or more doors on a scene in one call.
create or replace function public.tabletop_set_doors(p_scene uuid, p_edges text[], p_open boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_s     public.vtt_scenes;
  v_map   public.battle_maps;
  v_gm    boolean;
  v_doors jsonb;
  v_state jsonb;
  v_edge  text;
  v_kind  text;
  v_i     integer;
  v_side  text;
  v_r     integer;
  v_c     integer;
  v_mx    real;
  v_my    real;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  v_gm := public.is_campaign_gm(v_s.campaign_id);
  if not v_gm and not (v_s.is_active and public.tabletop_is_player(v_s.campaign_id)) then
    raise exception 'not at this table';
  end if;
  select * into v_map from public.battle_maps where id = v_s.battle_map_id;
  v_doors := coalesce(v_map.doors -> v_s.level, '{}'::jsonb);
  v_state := coalesce(v_s.door_state, '{}'::jsonb);
  if coalesce(array_length(p_edges, 1), 0) = 0 then return; end if;
  if array_length(p_edges, 1) > 500 then raise exception 'too many doors at once'; end if;

  foreach v_edge in array p_edges loop
    v_kind := v_doors ->> v_edge;
    if v_kind is null or v_edge !~ '^[0-9]+[hv]$' then raise exception 'there is no door there'; end if;
    if not v_gm then
      -- a closed secret door is a wall to players, so it answers like one
      if v_kind = 'secret' and not (v_state ? v_edge) then raise exception 'there is no door there'; end if;
      v_i := substring(v_edge from '^[0-9]+')::integer;
      v_side := right(v_edge, 1);
      v_r := v_i / v_map.n; v_c := v_i % v_map.n;
      -- the door must touch a revealed square
      if not (public.tabletop_revealed(v_s.revealed, v_s.fog_on, v_map.n, v_c, v_r)
              or (v_side = 'h' and public.tabletop_revealed(v_s.revealed, v_s.fog_on, v_map.n, v_c, v_r - 1))
              or (v_side = 'v' and public.tabletop_revealed(v_s.revealed, v_s.fog_on, v_map.n, v_c - 1, v_r))) then
        raise exception 'there is no door there';
      end if;
      if v_kind not in ('door', 'double') then raise exception 'only the GM can open that door'; end if;
      -- and a token the player controls must stand next to it
      if v_side = 'h' then v_mx := v_c + 0.5; v_my := v_r; else v_mx := v_c; v_my := v_r + 0.5; end if;
      if not exists (
        select 1 from public.vtt_tokens t
        where t.scene_id = p_scene and not t.hidden and t.layer <> 'gm'
          and (v_uid = any (t.controlled_by)
               or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid))
          and sqrt(power(t.x - v_mx, 2) + power(t.y - v_my, 2)) <= 1.5 + t.size / 2.0 - 0.5
      ) then
        raise exception 'move a token next to the door first';
      end if;
    end if;
    if p_open then v_state := v_state || jsonb_build_object(v_edge, true);
    else v_state := v_state - v_edge; end if;
  end loop;

  update public.vtt_scenes set door_state = v_state, updated_at = now() where id = p_scene;
end;
$function$;
revoke all on function public.tabletop_set_doors(uuid, text[], boolean) from public, anon;
grant execute on function public.tabletop_set_doors(uuid, text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tabletop_state, phase 3a. Same as p105 with the fog and door handling above; the parts that did not
-- change (party, scene and map lists for the GM) are restated as they were.
create or replace function public.tabletop_state(p_campaign uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_gm      boolean;
  v_player  boolean;
  v_camp    public.campaigns;
  v_scene   public.vtt_scenes;
  v_map     public.battle_maps;
  v_lv      integer;
  v_n       integer;
  v_labels  boolean;
  v_fog     boolean := false;
  v_rev     bytea := '\x'::bytea;
  v_ds      jsonb := '{}'::jsonb;
  v_doors   jsonb := '{}'::jsonb;
  v_walls   jsonb := '[]'::jsonb;
  v_mapjson jsonb := null;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  v_player := public.tabletop_is_player(p_campaign);
  if not v_gm and not v_player then raise exception 'not at this table'; end if;

  select * into v_camp from public.campaigns where id = p_campaign;
  select * into v_scene from public.vtt_scenes where campaign_id = p_campaign and is_active limit 1;
  if v_scene.id is not null then
    select * into v_map from public.battle_maps where id = v_scene.battle_map_id;
    v_fog := v_scene.fog_on;
    v_rev := v_scene.revealed;
    v_ds := coalesce(v_scene.door_state, '{}'::jsonb);
  end if;

  if v_map.id is not null then
    v_lv := v_scene.level;
    v_n := v_map.n;
    v_labels := v_gm or coalesce((v_scene.settings ->> 'show_labels')::boolean, false);

    if v_gm then
      v_doors := coalesce(v_map.doors -> v_lv, '{}'::jsonb);
    else
      -- a door reaches players when it touches a revealed square; a secret door only once it is open,
      -- and then as a plain door
      select coalesce(jsonb_object_agg(d.key, case when d.value = '"secret"'::jsonb then '"door"'::jsonb else d.value end), '{}'::jsonb)
        into v_doors
        from jsonb_each(coalesce(v_map.doors -> v_lv, '{}'::jsonb)) d,
             lateral (select substring(d.key from '^[0-9]+')::integer as i, right(d.key, 1) as side) e
       where d.key ~ '^[0-9]+[hv]$'
         and (d.value <> '"secret"'::jsonb or v_ds ? d.key)
         and (public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n)
              or (e.side = 'h' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n - 1))
              or (e.side = 'v' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n - 1, e.i / v_n)));
      select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) into v_ds
        from jsonb_each(v_ds) k where v_doors ? k.key;
      -- a closed secret door is plain wall to players: the edge comes as a wall to draw and to block
      -- sight, with nothing to say it is a door (two floor squares otherwise show an open gap)
      select coalesce(jsonb_agg(d.key), '[]'::jsonb)
        into v_walls
        from jsonb_each(coalesce(v_map.doors -> v_lv, '{}'::jsonb)) d,
             lateral (select substring(d.key from '^[0-9]+')::integer as i, right(d.key, 1) as side) e
       where d.key ~ '^[0-9]+[hv]$' and d.value = '"secret"'::jsonb and not (coalesce(v_scene.door_state, '{}'::jsonb) ? d.key)
         and (public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n)
              or (e.side = 'h' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n - 1))
              or (e.side = 'v' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n - 1, e.i / v_n)));
    end if;

    v_mapjson := jsonb_build_object(
      'id', v_map.id,
      'kind', v_map.kind,
      'n', v_map.n,
      'feet_per_square', v_map.feet_per_square,
      'grid', case when v_gm or not v_fog then coalesce(v_map.levels -> v_lv, '[]'::jsonb)
                   else (select coalesce(jsonb_agg(case when public.tabletop_revealed(v_rev, v_fog, v_n, ((g.ord - 1) % v_n)::integer, ((g.ord - 1) / v_n)::integer)
                                                    then g.v else '0'::jsonb end order by g.ord), '[]'::jsonb)
                         from jsonb_array_elements(coalesce(v_map.levels -> v_lv, '[]'::jsonb)) with ordinality g(v, ord)) end,
      'custom', case when v_gm or not v_fog then coalesce(v_map.custom_cells -> v_lv, '{}'::jsonb)
                     else (select coalesce(jsonb_object_agg(cc.key, cc.value), '{}'::jsonb)
                           from jsonb_each(coalesce(v_map.custom_cells -> v_lv, '{}'::jsonb)) cc
                           where cc.key ~ '^[0-9]+$'
                             and public.tabletop_revealed(v_rev, v_fog, v_n, cc.key::integer % v_n, cc.key::integer / v_n)) end,
      'doors', v_doors,
      'door_state', v_ds,
      'walls', v_walls,
      'elements', (select coalesce(jsonb_agg(e.value), '[]'::jsonb)
                   from jsonb_array_elements(coalesce(v_map.elements -> v_lv, '[]'::jsonb)) e
                   where (v_labels or coalesce(e.value ->> 'k', '') <> 'label')
                     and (v_gm or public.tabletop_revealed(v_rev, v_fog, v_n,
                                    floor(coalesce((e.value ->> 'x')::real, 0))::integer,
                                    floor(coalesce((e.value ->> 'y')::real, 0))::integer))),
      'fog', jsonb_build_object('on', v_fog, 'revealed', encode(v_rev, 'hex')),
      'meta', jsonb_build_object(
        'title', v_map.meta -> 'title',
        'levelNames', v_map.meta -> 'levelNames',
        'autoNumber', v_map.meta -> 'autoNumber',
        'showGrid', v_map.meta -> 'showGrid',
        'ground', v_map.meta -> 'ground',
        'grid', v_map.meta -> 'grid',
        'topGrid', v_map.meta -> 'topGrid',
        'overlay', v_map.meta -> 'overlays' -> v_lv
      )
    );
  end if;

  return jsonb_build_object(
    'role', case when v_gm then 'gm' else 'player' end,
    'me', v_uid,
    'campaign', jsonb_build_object('id', v_camp.id, 'name', v_camp.name, 'gm_id', v_camp.gm_id),
    'session_id', public.tabletop_open_session(p_campaign),
    'scene', case when v_scene.id is null then null else jsonb_build_object(
      'id', v_scene.id, 'name', v_scene.name, 'battle_map_id', v_scene.battle_map_id,
      'level', v_scene.level, 'settings', v_scene.settings) end,
    'map', v_mapjson,
    'tokens', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'kind', t.kind, 'character_id', t.character_id, 'stat_block_id', t.stat_block_id,
        'name', t.name, 'image_url', t.image_url, 'x', t.x, 'y', t.y, 'size', t.size, 'rot', t.rot,
        'layer', t.layer, 'hidden', t.hidden, 'controlled_by', to_jsonb(t.controlled_by), 'style', t.style,
        'mine', v_gm or v_uid = any (t.controlled_by)
                or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid)
      ) order by t.created_at), '[]'::jsonb)
      from public.vtt_tokens t
      where v_scene.id is not null and t.scene_id = v_scene.id
        and (v_gm or (not t.hidden and t.layer <> 'gm'
                      and (v_uid = any (t.controlled_by)
                           or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid)
                           or public.tabletop_revealed(v_rev, v_fog, coalesce(v_n, 0), floor(t.x)::integer, floor(t.y)::integer))))
    ),
    -- who is at the table, for whispers and token owners: the GM and every claimed pc
    'party', (
      select coalesce(jsonb_agg(x.p), '[]'::jsonb) from (
        select jsonb_build_object('profile_id', v_camp.gm_id, 'name', 'GM', 'character_id', null, 'portrait_url', null) as p
        union all
        select jsonb_build_object('profile_id', c.profile_id, 'name', c.name, 'character_id', c.id, 'portrait_url', c.portrait_url)
        from public.characters c
        where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id is not null and c.active
      ) x
    ),
    -- GM only: the scenes and battle maps to pick from
    'scenes', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'battle_map_id', s.battle_map_id,
        'level', s.level, 'is_active', s.is_active) order by s.updated_at desc), '[]'::jsonb)
      from public.vtt_scenes s where s.campaign_id = p_campaign) else '[]'::jsonb end,
    'battle_maps', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind,
        'levelNames', b.meta -> 'levelNames') order by b.created_at), '[]'::jsonb)
      from public.battle_maps b where b.campaign_id = p_campaign) else '[]'::jsonb end
  );
end;
$function$;
revoke all on function public.tabletop_state(uuid) from public, anon;
grant execute on function public.tabletop_state(uuid) to authenticated;

