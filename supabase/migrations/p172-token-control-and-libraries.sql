-- supabase/migrations/p172-token-control-and-libraries.sql (2026-11-12, push 51: token control and libraries)
--
-- Terry's additions of 12 November, and audit round 2 LV29 and B15 (B15 is in the app, not here).
--
-- 1. Who controls a token. A player controls a token of their own character, or one the GM has handed to
--    one of their characters (a familiar, a summon, a mount). vtt_tokens.controlled_by now holds
--    CHARACTER ids, so control follows the character if it changes hands; profile ids already there are
--    converted below, and are still honoured if one slips through. tabletop_controls() is the one rule,
--    and the eight functions that each had their own copy of it are restated to call it: can_edit_token,
--    move_token, set_token_markers, set_token_elevation, set_doors, token_floor, state and token_visible.
--    A retired character controls nothing. Each is restated from its definition in the files after p170,
--    and the migration stops before changing anything if production's copy differs from that (send
--    pg_get_functiondef of the one it names).
-- 2. LV29: a player could put effects (Fire, Faerie Fire) on any token they could see, the monsters
--    included. Now only on tokens they control; the GM still puts them anywhere.
-- 3. Token libraries: vtt_token_library holds saved tokens (name, picture, size, frame), one library per
--    person. A GM's own library is their rows; a player's is theirs; the GM can give a token into a
--    player's library (token_library_give), and take back what they gave. A player places a token from
--    their library onto the table with tabletop_place_library_token, controlled by the character they
--    choose, and removes it again with tabletop_remove_placed_token. Up to 200 saved tokens a person,
--    and 6 placed tokens a character on a scene.
-- 4. A monster's picture follows it. When the GM changes the picture on a monster token, a token from a
--    stat block puts it on the stat block (and on that block's other tokens in the campaign); any other
--    monster puts it on every token of that name in the campaign ("Goblin 2" counts as Goblin), and it is
--    kept in monster_looks. A new monster token without a picture takes it from the same place. It stays
--    until the GM changes it again.
--
-- Idempotent. Run by hand after p171, then supabase/checks/p172-token-control-and-libraries-check.sql.

-- 0 ---------------------------------------------------------------------------------------------------
-- the eight functions must be the ones the files say, or restating them would undo a change (line endings
-- are ignored, in case a file was pasted with Windows ones)
do $chk$
declare r record; v text;
begin
  for r in select * from (values
    ('tabletop_can_edit_token', 'p_token uuid, p_campaign uuid', 'ec452f361345614a3c8658fab5bbb6f5'),
    ('tabletop_move_token', 'p_token uuid, p_x real, p_y real, p_rot real', '1cef7d00b133972b39770052ca515fb3'),
    ('tabletop_set_token_markers', 'p_token uuid, p_markers text[]', 'c08034b8eb7d62a99fa6a5fbda21147f'),
    ('tabletop_set_token_elevation', 'p_tokens uuid[], p_feet integer', 'c8cd9c1aaead4af4aeda420fc1661522'),
    ('tabletop_set_doors', 'p_scene uuid, p_edges text[], p_open boolean', 'd9a3b07b051d236b4a69f211f78c833f'),
    ('tabletop_token_floor', 'p_token uuid, p_level integer', '5f1fa0bfcc20f19834e53ee6dcfc8a44'),
    ('tabletop_state', 'p_campaign uuid', 'f8b96efb339cd1d2abf9eb1b46779f0c'),
    ('tabletop_token_visible', 'p_scene uuid, p_x real, p_y real, p_character uuid, p_controlled uuid[]', 'cbefea7b72fed459012f5a7013aa3c9a')
  ) as x(fn, args, body_md5) loop
    select md5(replace(p.prosrc, chr(13), '')) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn and pg_get_function_identity_arguments(p.oid) = r.args;
    if v is null then raise exception 'p172: public.%(%) is missing; run the earlier migrations first', r.fn, r.args; end if;
    -- a second run finds the restated copy, which calls tabletop_controls: that is fine
    if v <> r.body_md5 and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = r.fn and p.prosrc like '%tabletop_controls(%') then
      raise exception 'p172: public.% in this database is not the copy in the files; nothing was changed. Send its pg_get_functiondef.', r.fn;
    end if;
  end loop;
end $chk$;

-- 1 ---------------------------------------------------------------------------------------------------
create or replace function public.tabletop_controls(p_controlled uuid[], p_character uuid, p_uid uuid default auth.uid())
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_uid is not null and (
    p_uid = any (coalesce(p_controlled, '{}'::uuid[]))
    or exists (select 1 from public.characters c
                where c.profile_id = p_uid and coalesce(c.active, true)
                  and (c.id = p_character or c.id = any (coalesce(p_controlled, '{}'::uuid[])))));
$function$;
revoke all on function public.tabletop_controls(uuid[], uuid, uuid) from public, anon;
grant execute on function public.tabletop_controls(uuid[], uuid, uuid) to authenticated, service_role;

-- profile ids already in controlled_by become that player's characters in the token's campaign
update public.vtt_tokens t
   set controlled_by = coalesce((
     select array_agg(distinct x) from (
       select c.id as x from unnest(t.controlled_by) u(v) join public.characters c on c.id = u.v and c.campaign_id = t.campaign_id
       union
       select c.id from unnest(t.controlled_by) u(v) join public.characters c on c.profile_id = u.v and c.campaign_id = t.campaign_id
        where c.kind = 'pc' and coalesce(c.active, true)
     ) y), '{}'::uuid[])
 where cardinality(coalesce(t.controlled_by, '{}'::uuid[])) > 0
   and exists (select 1 from unnest(t.controlled_by) u(v) where not exists (select 1 from public.characters c where c.id = u.v));

CREATE OR REPLACE FUNCTION public.tabletop_can_edit_token(p_token uuid, p_campaign uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
begin
  if v_uid is null then return false; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null or v_t.campaign_id <> p_campaign then return false; end if;
  return public.is_campaign_gm(v_t.campaign_id)
      or (not v_t.hidden and v_t.layer <> 'gm' and (
            public.tabletop_controls(v_t.controlled_by, v_t.character_id, v_uid)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_move_token(p_token uuid, p_x real, p_y real, p_rot real DEFAULT NULL::real)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_t    public.vtt_tokens;
  v_n    integer;
  v_fps  real;
  v_rule text;
  v_gm   boolean;
  v_cb   public.combats;
  v_c    jsonb;
  v_ord  bigint;
  v_x    real;
  v_y    real;
  v_ft   integer;
  v_map  public.battle_maps;
  v_lv   integer;
  v_ds   jsonb;
  v_set  jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  v_gm := public.is_campaign_gm(v_t.campaign_id);
  if not (
    v_gm
    or (not v_t.hidden and v_t.layer <> 'gm' and (
          public.tabletop_controls(v_t.controlled_by, v_t.character_id, v_uid)))
  ) then
    raise exception 'that token is not yours to move';
  end if;
  select b.n, b.feet_per_square, s.settings ->> 'diagonal', s.settings into v_n, v_fps, v_rule, v_set
    from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id where s.id = v_t.scene_id;
  v_n := coalesce(v_n, 100);
  v_x := greatest(-v_n, least(2 * v_n, p_x));
  v_y := greatest(-v_n, least(2 * v_n, p_y));

  if not v_gm then
    -- p122: a player's token may not cross a wall, a closed door, a sight wall or the map's edge
    select s.level, s.door_state into v_lv, v_ds from public.vtt_scenes s where s.id = v_t.scene_id;
    select b.* into v_map
      from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id where s.id = v_t.scene_id;
    if v_map.id is not null
       and public.tabletop_wall_blocks(v_map, v_lv, v_ds, v_t.x::double precision, v_t.y::double precision, v_x::double precision, v_y::double precision) then
      raise exception 'a wall is in the way';
    end if;

    select * into v_cb from public.combats where campaign_id = v_t.campaign_id and status = 'active'
     order by updated_at desc limit 1 for update;
    if v_cb.id is not null then
      select e.c, e.ord into v_c, v_ord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
       where e.c ->> 'tokenId' = p_token::text
          or (v_t.character_id is not null and (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = v_t.character_id::text)
       order by (e.c ->> 'tokenId' = p_token::text) desc nulls last
       limit 1;
      if v_c is not null and not coalesce((v_c ->> 'defeated')::boolean, false) then
        v_ft := public.tabletop_feet(v_x - v_t.x, v_y - v_t.y, coalesce(v_rule, 'five'), coalesce(v_fps, 5));
        if v_ft > 0 then
          -- p125: every foot through difficult terrain costs one more
          v_ft := v_ft + public.tabletop_difficult_extra(v_set -> 'difficult', v_n, v_t.x::double precision, v_t.y::double precision,
                                                         v_x::double precision, v_y::double precision, v_ft, coalesce(v_fps, 5));
          if v_ord - 1 <> v_cb.turn then raise exception 'wait for your turn to move'; end if;
          v_c := public.combat_lock_last(public.combat_move(v_c, v_ft, false));
          update public.combats
             set combatants = (select jsonb_agg(case when e.ord = v_ord then v_c else e.c end order by e.ord)
                                 from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
                 updated_at = now()
           where id = v_cb.id;
        end if;
      end if;
    end if;
  end if;

  update public.vtt_tokens
     set x = v_x, y = v_y,
         rot = coalesce(p_rot, rot),
         updated_at = now()
   where id = p_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_set_token_markers(p_token uuid, p_markers text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
  v_m   text[] := coalesce(p_markers, '{}'::text[]);
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  if not (
    public.is_campaign_gm(v_t.campaign_id)
    or (not v_t.hidden and v_t.layer <> 'gm' and (
          public.tabletop_controls(v_t.controlled_by, v_t.character_id, v_uid)))
  ) then
    raise exception 'that token is not yours to mark';
  end if;
  if cardinality(v_m) > 16 then raise exception 'a token holds up to 16 markers'; end if;
  if exists (select 1 from unnest(v_m) as m(v) where v is null or v !~ '^[A-Za-z][A-Za-z0-9-]{0,31}(\|-?[0-9]{1,2})?$') then
    raise exception 'that is not a marker';
  end if;

  update public.vtt_tokens
     set style = jsonb_set(coalesce(style, '{}'::jsonb), '{markers}', to_jsonb(v_m)),
         updated_at = now()
   where id = p_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_set_token_elevation(p_tokens uuid[], p_feet integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
  v_n   integer := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_tokens is null or cardinality(p_tokens) = 0 or cardinality(p_tokens) > 50 then raise exception 'pick between 1 and 50 tokens'; end if;
  if p_feet is null or p_feet < -9999 or p_feet > 9999 then raise exception 'a height is between -9999 and 9999 ft'; end if;

  for v_t in select * from public.vtt_tokens where id = any(p_tokens) for update loop
    if not (
      public.is_campaign_gm(v_t.campaign_id)
      or (not v_t.hidden and v_t.layer <> 'gm' and (
            public.tabletop_controls(v_t.controlled_by, v_t.character_id, v_uid)))
    ) then
      raise exception 'that token is not yours to lift';
    end if;
    update public.vtt_tokens
       set style = case when p_feet = 0 then coalesce(style, '{}'::jsonb) - 'elevation'
                        else jsonb_set(coalesce(style, '{}'::jsonb), '{elevation}', to_jsonb(p_feet)) end,
           updated_at = now()
     where id = v_t.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_set_doors(p_scene uuid, p_edges text[], p_open boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not v_gm and not (public.tabletop_is_player(v_s.campaign_id) and v_s.id = public.tabletop_scene_for(v_s.campaign_id, v_uid)) then
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
          and (public.tabletop_controls(t.controlled_by, t.character_id, v_uid))
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

CREATE OR REPLACE FUNCTION public.tabletop_token_floor(p_token uuid, p_level integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_t    public.vtt_tokens;
  v_sc   public.vtt_scenes;
  v_to   public.vtt_scenes;
  v_m    public.battle_maps;
  v_gm   boolean;
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
         public.tabletop_controls(v_t.controlled_by, v_t.character_id, v_uid)) then
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

  -- the token's players go with it (never a GM or co-GM, whose view is their own)
  for v_p in
    select distinct p from (
      select c.profile_id as p from public.characters c where c.id = v_t.character_id
      union select unnest(coalesce(v_t.controlled_by, '{}'::uuid[]))
      union select c2.profile_id from public.characters c2 where c2.id = any (coalesce(v_t.controlled_by, '{}'::uuid[]))) x
     where p is not null and not public.campaign_gm_of(v_t.campaign_id, p) and public.tabletop_card_seat(v_t.campaign_id, p)
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

CREATE OR REPLACE FUNCTION public.tabletop_state(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- the scene this person is on: their own (a split party, or the GM viewing another), else the active one
  select * into v_scene from public.vtt_scenes where id = public.tabletop_scene_for(p_campaign, v_uid);
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
        'overlay', v_map.meta -> 'overlays' -> v_lv,
        'sightWalls', coalesce(v_map.meta -> 'sightWalls' -> v_lv, '[]'::jsonb)
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
        'mine', v_gm or public.tabletop_controls(t.controlled_by, t.character_id, v_uid)
      ) order by t.created_at), '[]'::jsonb)
      from public.vtt_tokens t
      where v_scene.id is not null and t.scene_id = v_scene.id
        and (v_gm or (not t.hidden and t.layer <> 'gm'
                      and (public.tabletop_controls(t.controlled_by, t.character_id, v_uid)
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
    -- GM only: who is on which scene. Anyone not listed is on the active scene.
    'placements', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('profile_id', sp.profile_id, 'scene_id', sp.scene_id)), '[]'::jsonb)
      from public.vtt_scene_players sp where sp.campaign_id = p_campaign) else '[]'::jsonb end,
    'battle_maps', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind,
        'levelNames', b.meta -> 'levelNames') order by b.created_at), '[]'::jsonb)
      from public.battle_maps b where b.campaign_id = p_campaign) else '[]'::jsonb end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_token_visible(p_scene uuid, p_x real, p_y real, p_character uuid, p_controlled uuid[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.tabletop_controls(p_controlled, p_character, auth.uid())
      or exists (
        select 1 from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id
        where s.id = p_scene
          and public.tabletop_revealed(s.revealed, s.fog_on, b.n, floor(p_x)::integer, floor(p_y)::integer)
      );
$function$;

-- 2 ---------------------------------------------------------------------------------------------------
drop policy if exists vtt_effects_player_insert on public.vtt_effects;
create policy vtt_effects_player_insert on public.vtt_effects for insert to public
  with check (owner = auth.uid() and public.tabletop_is_player(campaign_id)
              and public.tabletop_can_edit_token(token_id, campaign_id)
              and scene_id = (select t.scene_id from public.vtt_tokens t where t.id = vtt_effects.token_id));

-- 3 ---------------------------------------------------------------------------------------------------
create table if not exists public.vtt_token_library (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 80),
  image_url   text check (image_url is null or image_url ~ ('^https://' || replace(public.tabletop_storage_host(), '.', '\.')
                          || '/storage/v1/object/public/campaign-maps/[0-9a-fA-F-]{36}/tokens/[A-Za-z0-9._-]+$')),
  size        real not null default 1 check (size between 0.25 and 8),
  style       jsonb not null default '{}'::jsonb check (jsonb_typeof(style) = 'object' and length(style::text) <= 4000),
  kind        text not null default 'npc' check (kind in ('npc', 'monster', 'object')),
  assigned_by uuid references public.profiles (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists vtt_token_library_owner_idx on public.vtt_token_library (owner, created_at desc);
create index if not exists vtt_token_library_given_idx on public.vtt_token_library (assigned_by, campaign_id) where assigned_by is not null;
alter table public.vtt_token_library enable row level security;
revoke all on table public.vtt_token_library from anon;
grant select, insert, update, delete on table public.vtt_token_library to authenticated;
grant select, insert, update, delete on table public.vtt_token_library to service_role;

drop policy if exists vtt_token_library_read on public.vtt_token_library;
create policy vtt_token_library_read on public.vtt_token_library for select to authenticated
  using (owner = auth.uid() or assigned_by = auth.uid());
drop policy if exists vtt_token_library_own_insert on public.vtt_token_library;
create policy vtt_token_library_own_insert on public.vtt_token_library for insert to authenticated
  with check (owner = auth.uid() and assigned_by is null and campaign_id is null);
drop policy if exists vtt_token_library_own_update on public.vtt_token_library;
create policy vtt_token_library_own_update on public.vtt_token_library for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists vtt_token_library_delete on public.vtt_token_library;
create policy vtt_token_library_delete on public.vtt_token_library for delete to authenticated
  using (owner = auth.uid() or assigned_by = auth.uid());

create or replace function public.vtt_token_library_cap()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if (select count(*) from public.vtt_token_library where owner = new.owner) >= 200 then
    raise exception 'a token library holds up to 200 tokens';
  end if;
  return new;
end;
$function$;
drop trigger if exists vtt_token_library_cap on public.vtt_token_library;
create trigger vtt_token_library_cap before insert on public.vtt_token_library
  for each row execute function public.vtt_token_library_cap();

-- the GM gives a token into the library of the player who plays p_character
create or replace function public.token_library_give(p_campaign uuid, p_character uuid, p_name text, p_image_url text default null,
                                                     p_size real default 1, p_style jsonb default '{}'::jsonb, p_kind text default 'npc')
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_to  uuid;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only a GM of this campaign can give tokens'; end if;
  select c.profile_id into v_to from public.characters c
   where c.id = p_character and c.campaign_id = p_campaign and c.kind = 'pc' and coalesce(c.active, true);
  if v_to is null then raise exception 'that character is not played by anyone at this table yet'; end if;
  insert into public.vtt_token_library (owner, name, image_url, size, style, kind, assigned_by, campaign_id)
  values (v_to, left(trim(p_name), 80), p_image_url, coalesce(p_size, 1), coalesce(p_style, '{}'::jsonb) - 'placedBy',
          case when p_kind in ('npc', 'monster', 'object') then p_kind else 'npc' end, v_uid, p_campaign)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.token_library_give(uuid, uuid, text, text, real, jsonb, text) from public, anon;
grant execute on function public.token_library_give(uuid, uuid, text, text, real, jsonb, text) to authenticated;

-- a player puts a token from their library on the scene they are looking at, controlled by p_character
create or replace function public.tabletop_place_library_token(p_item uuid, p_character uuid, p_x real, p_y real)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_item  public.vtt_token_library;
  v_char  public.characters;
  v_scene uuid;
  v_n     integer;
  v_id    uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_item from public.vtt_token_library where id = p_item;
  if v_item.id is null or v_item.owner <> v_uid then raise exception 'that token is not in your library'; end if;
  select * into v_char from public.characters where id = p_character;
  if v_char.id is null or v_char.profile_id <> v_uid or v_char.kind <> 'pc' or not coalesce(v_char.active, true) then
    raise exception 'that character is not yours';
  end if;
  if not public.tabletop_is_player(v_char.campaign_id) then raise exception 'not at this table'; end if;
  v_scene := public.tabletop_scene_for(v_char.campaign_id, v_uid);
  if v_scene is null then raise exception 'there is no scene on the table yet'; end if;
  select count(*) into v_n from public.vtt_tokens
   where scene_id = v_scene and style ->> 'placedBy' = v_uid::text and p_character = any (controlled_by);
  if v_n >= 6 then raise exception 'one character can place up to 6 tokens on a scene; remove one first'; end if;
  select coalesce(b.n, 100) into v_n from public.vtt_scenes s left join public.battle_maps b on b.id = s.battle_map_id where s.id = v_scene;
  insert into public.vtt_tokens (campaign_id, scene_id, kind, character_id, stat_block_id, name, image_url, x, y, size, rot, layer, hidden, controlled_by, style)
  values (v_char.campaign_id, v_scene, v_item.kind, null, null, v_item.name, v_item.image_url,
          greatest(0, least(v_n - 1, coalesce(p_x, 1))), greatest(0, least(v_n - 1, coalesce(p_y, 1))),
          v_item.size, 0, 'token', false, array[p_character],
          (v_item.style - 'placedBy') || jsonb_build_object('placedBy', v_uid::text))
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.tabletop_place_library_token(uuid, uuid, real, real) from public, anon;
grant execute on function public.tabletop_place_library_token(uuid, uuid, real, real) to authenticated;

-- a player takes back a token they placed
create or replace function public.tabletop_remove_placed_token(p_token uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  if not (public.is_campaign_gm(v_t.campaign_id)
          or (v_t.style ->> 'placedBy' = v_uid::text and public.tabletop_controls(v_t.controlled_by, v_t.character_id, v_uid))) then
    raise exception 'only the player who placed that token, or the GM, can remove it';
  end if;
  delete from public.vtt_tokens where id = p_token;
end;
$function$;
revoke all on function public.tabletop_remove_placed_token(uuid) from public, anon;
grant execute on function public.tabletop_remove_placed_token(uuid) to authenticated;

-- 4 ---------------------------------------------------------------------------------------------------
create table if not exists public.monster_looks (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name_key    text not null,
  image_url   text not null,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (campaign_id, name_key)
);
alter table public.monster_looks enable row level security;
revoke all on table public.monster_looks from anon;
grant select, insert, update, delete on table public.monster_looks to authenticated, service_role;
drop policy if exists monster_looks_gm on public.monster_looks;
create policy monster_looks_gm on public.monster_looks for all to authenticated
  using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));

create or replace function public.tabletop_monster_key(p_name text)
 returns text
 language sql
 immutable
as $function$ select lower(trim(regexp_replace(coalesce(p_name, ''), '\s+\d+$', ''))) $function$;

create or replace function public.tabletop_picture_url(p_path text)
 returns text
 language sql
 immutable
as $function$
  select case when p_path is null or p_path = '' then null
              when p_path ~ '^https?://' then p_path
              else 'https://' || public.tabletop_storage_host() || '/storage/v1/object/public/campaign-maps/' || p_path end
$function$;

-- a new monster token with no picture takes its monster's
create or replace function public.vtt_tokens_monster_look_in()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_url text;
begin
  if new.kind <> 'monster' or new.image_url is not null then return new; end if;
  if new.stat_block_id is not null then
    select public.tabletop_picture_url(s.portrait_path) into v_url from public.stat_blocks s where s.id = new.stat_block_id;
  else
    select l.image_url into v_url from public.monster_looks l
     where l.campaign_id = new.campaign_id and l.name_key = public.tabletop_monster_key(new.name);
  end if;
  if v_url is not null then new.image_url := v_url; end if;
  return new;
end;
$function$;
drop trigger if exists vtt_tokens_monster_look_in on public.vtt_tokens;
create trigger vtt_tokens_monster_look_in before insert on public.vtt_tokens
  for each row execute function public.vtt_tokens_monster_look_in();

-- the GM changed a monster token's picture: it becomes that monster's picture
create or replace function public.vtt_tokens_monster_look_out()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_prefix text := 'https://' || public.tabletop_storage_host() || '/storage/v1/object/public/campaign-maps/';
begin
  if pg_trigger_depth() > 1 or new.kind <> 'monster' or new.image_url is null
     or new.image_url is not distinct from old.image_url or not public.is_campaign_gm(new.campaign_id) then
    return null;
  end if;
  if new.stat_block_id is not null then
    if left(new.image_url, length(v_prefix)) = v_prefix then
      update public.stat_blocks set portrait_path = substr(new.image_url, length(v_prefix) + 1), updated_at = now()
       where id = new.stat_block_id;
    end if;
    update public.vtt_tokens set image_url = new.image_url, updated_at = now()
     where campaign_id = new.campaign_id and stat_block_id = new.stat_block_id and id <> new.id
       and image_url is distinct from new.image_url;
  else
    insert into public.monster_looks (campaign_id, name_key, image_url, updated_by)
    values (new.campaign_id, public.tabletop_monster_key(new.name), new.image_url, auth.uid())
    on conflict (campaign_id, name_key) do update set image_url = excluded.image_url, updated_by = excluded.updated_by, updated_at = now();
    update public.vtt_tokens set image_url = new.image_url, updated_at = now()
     where campaign_id = new.campaign_id and kind = 'monster' and stat_block_id is null and id <> new.id
       and public.tabletop_monster_key(name) = public.tabletop_monster_key(new.name)
       and image_url is distinct from new.image_url;
  end if;
  return null;
end;
$function$;
drop trigger if exists vtt_tokens_monster_look_out on public.vtt_tokens;
create trigger vtt_tokens_monster_look_out after update of image_url on public.vtt_tokens
  for each row execute function public.vtt_tokens_monster_look_out();

insert into public._migrations (name) values ('p172-token-control-and-libraries') on conflict do nothing;
