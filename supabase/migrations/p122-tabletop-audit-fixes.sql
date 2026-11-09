-- supabase/migrations/p122-tabletop-audit-fixes.sql (2026-11-08)
--
-- Phase 5q: three fixes from the tabletop audit (doc "Six Axes Tabletop: audit and VTT comparison").
--
-- A1. tabletop_set_token_look (p120) only checked that a picture's URL CONTAINED this campaign's token
--     folder, so https://anywhere.example/storage/v1/object/public/campaign-maps/<campaign>/tokens/x.png
--     passed and a player could point a token at an outside host. The URL must now be exactly a file in
--     that folder on this project's storage host (public.tabletop_storage_host()). The same rule covers
--     an imported border. Before anything changes, a guard stops the migration if any token picture
--     already in that folder sits on another host, and names the host, so the constant is never a guess.
--
-- A2. combat_apply_outside_roll (p121) spent an ATTACK for every attack roll, so a spell attack cast
--     from D&D Beyond left a character with Extra Attack still able to swing. The capture extension
--     (2.2.0) now sends the roll's kind and the spell's casting time with each attack roll. A spell
--     attack spends the action, or the bonus action when its casting time says so; a weapon attack
--     spends an attack as before. Rolls from older extensions carry no kind and keep the p121 behaviour.
--
-- A3. Walls stopped a player's drag only in the browser (lib/tabletop/sight.ts moveStop, p5p). The move
--     RPC now runs the same test for players: the straight line from where the token is to where it is
--     going may not cross a map wall, a closed door (secret doors included), a sight wall, or the map's
--     edge. tabletop_wall_blocks mirrors wallSegments + moveStop exactly (same edges, same closed-door
--     rule, same end-point tolerance), so a move the browser allowed is never refused. The GM is never
--     checked. Only the centre line is tested, as in the browser: a large creature can still squeeze
--     through a one-square door, which the 5e rules allow.
--
-- Signatures and return types are unchanged, so CREATE OR REPLACE keeps the grants (restated anyway).
-- Idempotent. Run by hand after p121, then supabase/checks/p122-tabletop-audit-fixes-check.sql.

-- ---------------------------------------------------------------------------------------------------
-- A1: the storage host, and the guard.
create or replace function public.tabletop_storage_host()
 returns text
 language sql
 immutable
as $function$ select 'agafmvywayisxgvrfium.supabase.co'::text $function$;
revoke all on function public.tabletop_storage_host() from public, anon;
grant execute on function public.tabletop_storage_host() to authenticated, service_role;

do $guard$
declare
  v_bad text;
begin
  select substring(u from '^https?://([^/]+)') into v_bad
    from (select image_url as u from public.vtt_tokens
          union all
          select style -> 'frame' ->> 'importUrl' from public.vtt_tokens) x
   where u ~ '/storage/v1/object/public/campaign-maps/[0-9a-f-]{36}/tokens/'
     and u !~ ('^https://' || replace(public.tabletop_storage_host(), '.', '\.') || '/')
   limit 1;
  if v_bad is not null then
    raise exception 'p122 stopped: a token picture in the tokens folder is on host %, not %. Send this message to Claude before running again.', v_bad, public.tabletop_storage_host();
  end if;
end;
$guard$;

create or replace function public.tabletop_set_token_look(p_token uuid, p_image_url text default null, p_frame jsonb default null, p_clear_frame boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_t      public.vtt_tokens;
  v_ok     text;
  v_border text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  if not public.tabletop_can_edit_token(p_token, v_t.campaign_id) then
    raise exception 'that token is not yours to change';
  end if;
  -- p122: exactly one file in this campaign's token folder, on this project's storage host
  v_ok := '^https://' || replace(public.tabletop_storage_host(), '.', '\.')
       || '/storage/v1/object/public/campaign-maps/' || v_t.campaign_id::text || '/tokens/[A-Za-z0-9._-]+$';
  if p_image_url is not null and p_image_url !~ v_ok then
    raise exception 'that picture was not uploaded for this campaign';
  end if;
  if p_frame is not null then
    if jsonb_typeof(p_frame) <> 'object' or length(p_frame::text) > 2000 then
      raise exception 'that is not a token frame';
    end if;
    v_border := p_frame ->> 'importUrl';
    if v_border is not null and v_border !~ v_ok then
      raise exception 'that border was not uploaded for this campaign';
    end if;
  end if;

  update public.vtt_tokens
     set image_url = coalesce(p_image_url, image_url),
         style = case
                   when p_clear_frame then coalesce(style, '{}'::jsonb) - 'frame'
                   when p_frame is not null then jsonb_set(coalesce(style, '{}'::jsonb), '{frame}', p_frame)
                   else style
                 end,
         updated_at = now()
   where id = p_token;
end;
$function$;
revoke all on function public.tabletop_set_token_look(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.tabletop_set_token_look(uuid, text, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- A2: combat_apply_outside_roll as p121 left it, except which cost an attack roll spends.
create or replace function public.combat_apply_outside_roll(p_combat uuid, p_target text, p_events uuid[], p_half boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_cb     public.combats;
  v_gm     boolean;
  v_c      jsonb;
  v_ord    bigint;
  v_n      integer;
  v_found  integer;
  v_attack integer;
  v_crit   boolean := false;
  v_fumble boolean := false;
  v_arolls jsonb;
  v_kind   text;
  v_cost   text := 'attack';
  v_ac     integer;
  v_hit    boolean := true;
  v_dmg    integer;
  v_char   uuid;
  v_att    jsonb;
  v_aord   bigint;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_events is null or cardinality(p_events) = 0 or cardinality(p_events) > 20 then raise exception 'Pick the rolls to apply.'; end if;
  select * into v_cb from public.combats where id = p_combat for update;
  if v_cb.id is null then raise exception 'fight not found'; end if;
  if v_cb.status <> 'active' then raise exception 'that fight is over'; end if;
  v_gm := public.is_campaign_gm(v_cb.campaign_id);
  if not v_gm and not public.tabletop_is_player(v_cb.campaign_id) then raise exception 'not at this table'; end if;

  -- the rows: this table's outside rolls, none applied yet, locked while we work
  perform 1 from public.vtt_events where id = any(p_events) for update;
  select count(*) into v_found from public.vtt_events e
   where e.id = any(p_events) and e.campaign_id = v_cb.campaign_id and e.source in ('beyond20', 'foundry');
  if v_found <> cardinality(p_events) then raise exception 'Those rolls are not from this table.'; end if;
  -- applied once; a player's miss is marked too, but the GM may overrule a miss
  if exists (select 1 from public.vtt_events where id = any(p_events) and applied_at is not null
              and not (v_gm and coalesce(applied_to, '') like 'missed %')) then
    raise exception 'That damage was already applied.';
  end if;

  if not v_gm then
    -- a player applies only their own character's rolls, on that character's turn
    if exists (select 1 from public.vtt_events e where e.id = any(p_events)
                and (e.character_id is null or not exists (select 1 from public.characters ch where ch.id = e.character_id and ch.profile_id = v_uid))) then
      raise exception 'Only your own character''s rolls.';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_cb.combatants) with ordinality as t(c, ord)
       where t.ord - 1 = v_cb.turn and (t.c ->> 'kind') = 'pc'
         and coalesce(t.c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
         and exists (select 1 from public.vtt_events e where e.id = any(p_events) and e.character_id = (t.c ->> 'characterId')::uuid)
    ) then
      raise exception 'it is not your turn';
    end if;
  end if;

  select e.c, e.ord into v_c, v_ord
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where e.c ->> 'id' = p_target
   limit 1;
  if v_c is null then raise exception 'no such combatant'; end if;
  if not v_gm and coalesce((v_c ->> 'hidden')::boolean, false) then raise exception 'no such combatant'; end if;

  -- the attack roll, if one came with the damage (the last one not discarded by advantage)
  select (e.rolls ->> 'total')::numeric::integer,
         coalesce((e.rolls ->> 'critical_success')::boolean, false),
         coalesce((e.rolls ->> 'critical_failure')::boolean, false),
         e.rolls
    into v_attack, v_crit, v_fumble, v_arolls
    from public.vtt_events e
   where e.id = any(p_events) and e.event_type = 'to-hit' and coalesce((e.rolls ->> 'discarded')::boolean, false) = false
     and jsonb_typeof(e.rolls -> 'total') = 'number'
   order by e.received_at desc limit 1;

  select coalesce(sum((e.rolls ->> 'total')::numeric), 0)::integer, count(*) into v_dmg, v_n
    from public.vtt_events e
   where e.id = any(p_events) and e.event_type = 'damage' and jsonb_typeof(e.rolls -> 'total') = 'number';
  if v_n = 0 then raise exception 'No damage in those rolls.'; end if;

  v_ac := case when jsonb_typeof(v_c -> 'ac') = 'number' then (v_c ->> 'ac')::numeric::integer end;
  if not v_gm and v_attack is not null and v_ac is not null then
    v_hit := not v_fumble and (v_crit or v_attack >= v_ac);
  end if;

  -- p122: what the attack roll spends. A spell attack (extension 2.2.0 sends roll_type / request_type)
  -- spends the action, or the bonus action when its casting time says so; anything else an attack.
  v_kind := lower(coalesce(v_arolls ->> 'roll_type', '') || ' ' || coalesce(v_arolls ->> 'request_type', ''));
  if v_kind ~ '(^|\s)spell' then
    v_cost := case when lower(coalesce(v_arolls ->> 'casting_time', '')) like '%bonus%' then 'bonus' else 'action' end;
  end if;

  -- p121: an attack roll spends the roller's attack (p122: or action), hit or miss (combat_spend raises
  -- for a player with nothing left, which undoes the whole apply)
  if v_attack is not null then
    select min(e.character_id::text)::uuid into v_char from public.vtt_events e where e.id = any(p_events) and e.character_id is not null;
    if v_char is not null then
      select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
       where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = v_char::text limit 1;
      if v_att is not null and v_aord <> v_ord then
        v_att := public.combat_lock_last(public.combat_spend(v_att, v_cost,
          left(case when v_cost = 'attack' then 'Attack on ' else 'Spell at ' end
               || coalesce(v_c ->> 'name', 'a target') || ' (rolled outside)', 60), v_gm));
        update public.combats
           set combatants = jsonb_set(combatants, array[(v_aord - 1)::text], v_att), updated_at = now()
         where id = v_cb.id;
      end if;
    end if;
  end if;

  v_dmg := greatest(0, least(9999, case when p_half then v_dmg / 2 else v_dmg end));
  if v_hit then
    v_c := public.combat_hurt(v_c, v_dmg);
    update public.combats
       set combatants = jsonb_set(combatants, array[(v_ord - 1)::text], v_c), updated_at = now()
     where id = v_cb.id;
  end if;
  update public.vtt_events
     set applied_at = now(), applied_to = left(case when v_hit then '' else 'missed ' end || coalesce(v_c ->> 'name', 'a creature'), 200)
   where id = any(p_events);

  return jsonb_build_object('target', v_c ->> 'name', 'damage', case when v_hit then v_dmg else 0 end, 'hit', v_hit,
    'attack', v_attack, 'ac', case when v_gm then v_ac end, 'critical', v_crit, 'spent', v_cost);
end;
$function$;
revoke all on function public.combat_apply_outside_roll(uuid, text, uuid[], boolean) from public, anon;
grant execute on function public.combat_apply_outside_roll(uuid, text, uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- A3: walls on the server.

-- Is square (c, r) walled? As lib/tabletop/fog.ts walledAt: indoors any painted square (or a custom
-- tile); outdoors only structures (lib/dungeon/classic.ts isStructure: corridor 1, room 2, dungeon 3,
-- cave 4, castle 6, crypt 7, mine 8, temple 12, ship 13, spaceship 14 in lib/dungeon/render CELL_TYPES).
create or replace function public.tabletop_walled_at(p_grid jsonb, p_custom jsonb, p_n integer, p_outdoor boolean, p_c integer, p_r integer)
 returns boolean
 language plpgsql
 immutable
as $function$
declare
  v_i integer;
  v_v jsonb;
  v_t integer := 0;
begin
  if p_c < 0 or p_r < 0 or p_c >= p_n or p_r >= p_n then return false; end if;
  v_i := p_r * p_n + p_c;
  v_v := p_grid -> v_i;
  if jsonb_typeof(v_v) = 'number' and (v_v #>> '{}')::numeric >= 0 and (v_v #>> '{}')::numeric < 26 then
    v_t := floor((v_v #>> '{}')::numeric)::integer;
  end if;
  if p_outdoor then return v_t in (1, 2, 3, 4, 6, 7, 8, 12, 13, 14); end if;
  return v_t > 0 or coalesce(jsonb_typeof(p_custom -> v_i::text) = 'string' and (p_custom ->> v_i::text) <> '', false);
end;
$function$;
revoke all on function public.tabletop_walled_at(jsonb, jsonb, integer, boolean, integer, integer) from public, anon, authenticated;

-- Does the straight move from (ax, ay) to (bx, by), in squares, cross a wall? As lib/tabletop/sight.ts:
-- wallSegments (grid edges between a walled and an open square, closed doors, the map's edge) plus the
-- level's sight walls, and moveStop's test (a crossing just past the start up to and including the end).
create or replace function public.tabletop_wall_blocks(p_map public.battle_maps, p_level integer, p_ds jsonb,
  p_ax double precision, p_ay double precision, p_bx double precision, p_by double precision)
 returns boolean
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare
  v_n      integer := greatest(1, coalesce(p_map.n, 25));
  v_lv     integer := coalesce(p_level, 0);
  v_grid   jsonb := coalesce(p_map.levels -> coalesce(p_level, 0), '[]'::jsonb);
  v_custom jsonb := coalesce(p_map.custom_cells -> coalesce(p_level, 0), '{}'::jsonb);
  v_doors  jsonb := coalesce(p_map.doors -> coalesce(p_level, 0), '{}'::jsonb);
  v_ds     jsonb := coalesce(p_ds, '{}'::jsonb);
  v_out    boolean := coalesce(p_map.kind, '') = 'outdoor';
  v_dx     double precision := p_bx - p_ax;
  v_dy     double precision := p_by - p_ay;
  v_t      double precision;
  v_p      double precision;
  v_line   integer;
  v_cell   integer;
  v_key    text;
  v_kind   text;
  v_a      boolean;
  v_b      boolean;
  v_w      jsonb;
  v_sx     double precision; v_sy double precision; v_ex double precision; v_ey double precision;
  v_den    double precision;
  v_u      double precision;
begin
  if abs(v_dx) < 1e-9 and abs(v_dy) < 1e-9 then return false; end if;

  -- vertical grid lines x = v_line crossed by the move
  if abs(v_dx) > 1e-12 then
    for v_line in ceil(least(p_ax, p_bx))::integer .. floor(greatest(p_ax, p_bx))::integer loop
      v_t := (v_line - p_ax) / v_dx;
      continue when v_t <= 1e-9 or v_t > 1;
      v_p := p_ay + v_t * v_dy;
      if (v_line = 0 or v_line = v_n) and v_p >= -1e-9 and v_p <= v_n + 1e-9 then return true; end if;
      continue when v_line <= 0 or v_line >= v_n;
      -- the edge of the row crossed; exactly on a corner, the edge above it counts too
      foreach v_cell in array (case when v_p = floor(v_p) then array[floor(v_p)::integer, floor(v_p)::integer - 1] else array[floor(v_p)::integer] end) loop
        continue when v_cell < 0 or v_cell >= v_n;
        v_key := (v_cell * v_n + v_line)::text || 'v';
        v_kind := case when jsonb_typeof(v_doors -> v_key) = 'string' then v_doors ->> v_key end;
        if v_kind is not null then
          if v_kind <> 'arch' and not (v_ds ? v_key and (v_ds -> v_key) not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb)) then return true; end if;
        else
          v_a := public.tabletop_walled_at(v_grid, v_custom, v_n, v_out, v_line, v_cell);
          v_b := public.tabletop_walled_at(v_grid, v_custom, v_n, v_out, v_line - 1, v_cell);
          if v_a <> v_b then return true; end if;
        end if;
      end loop;
    end loop;
  end if;

  -- horizontal grid lines y = v_line
  if abs(v_dy) > 1e-12 then
    for v_line in ceil(least(p_ay, p_by))::integer .. floor(greatest(p_ay, p_by))::integer loop
      v_t := (v_line - p_ay) / v_dy;
      continue when v_t <= 1e-9 or v_t > 1;
      v_p := p_ax + v_t * v_dx;
      if (v_line = 0 or v_line = v_n) and v_p >= -1e-9 and v_p <= v_n + 1e-9 then return true; end if;
      continue when v_line <= 0 or v_line >= v_n;
      foreach v_cell in array (case when v_p = floor(v_p) then array[floor(v_p)::integer, floor(v_p)::integer - 1] else array[floor(v_p)::integer] end) loop
        continue when v_cell < 0 or v_cell >= v_n;
        v_key := (v_line * v_n + v_cell)::text || 'h';
        v_kind := case when jsonb_typeof(v_doors -> v_key) = 'string' then v_doors ->> v_key end;
        if v_kind is not null then
          if v_kind <> 'arch' and not (v_ds ? v_key and (v_ds -> v_key) not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb)) then return true; end if;
        else
          v_a := public.tabletop_walled_at(v_grid, v_custom, v_n, v_out, v_cell, v_line);
          v_b := public.tabletop_walled_at(v_grid, v_custom, v_n, v_out, v_cell, v_line - 1);
          if v_a <> v_b then return true; end if;
        end if;
      end loop;
    end loop;
  end if;

  -- the level's sight walls, [ax, ay, bx, by] in squares (lib/dungeon/battle.ts normSightWalls rules)
  for v_w in select w from jsonb_array_elements(case when jsonb_typeof(p_map.meta -> 'sightWalls' -> v_lv) = 'array'
                                                     then p_map.meta -> 'sightWalls' -> v_lv else '[]'::jsonb end) as a(w) loop
    continue when jsonb_typeof(v_w) <> 'array' or jsonb_array_length(v_w) <> 4;
    continue when exists (select 1 from jsonb_array_elements(v_w) x(v) where jsonb_typeof(x.v) <> 'number' or (x.v #>> '{}')::numeric < 0 or (x.v #>> '{}')::numeric > v_n);
    v_sx := round((v_w ->> 0)::numeric * 100) / 100.0; v_sy := round((v_w ->> 1)::numeric * 100) / 100.0;
    v_ex := round((v_w ->> 2)::numeric * 100) / 100.0 - v_sx; v_ey := round((v_w ->> 3)::numeric * 100) / 100.0 - v_sy;
    continue when sqrt(v_ex * v_ex + v_ey * v_ey) < 0.01;
    v_den := v_dx * v_ey - v_dy * v_ex;
    continue when abs(v_den) < 1e-12;
    v_t := ((v_sx - p_ax) * v_ey - (v_sy - p_ay) * v_ex) / v_den;
    v_u := ((v_sx - p_ax) * v_dy - (v_sy - p_ay) * v_dx) / v_den;
    if v_t > 1e-9 and v_t <= 1 and v_u >= -1e-9 and v_u <= 1 + 1e-9 then return true; end if;
  end loop;
  return false;
end;
$function$;
revoke all on function public.tabletop_wall_blocks(public.battle_maps, integer, jsonb, double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- tabletop_move_token as p112 left it, plus the wall test for players.
create or replace function public.tabletop_move_token(p_token uuid, p_x real, p_y real, p_rot real default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  v_gm := public.is_campaign_gm(v_t.campaign_id);
  if not (
    v_gm
    or (not v_t.hidden and v_t.layer <> 'gm' and (
          v_uid = any (v_t.controlled_by)
          or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)))
  ) then
    raise exception 'that token is not yours to move';
  end if;
  select b.n, b.feet_per_square, s.settings ->> 'diagonal' into v_n, v_fps, v_rule
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
revoke all on function public.tabletop_move_token(uuid, real, real, real) from public, anon;
grant execute on function public.tabletop_move_token(uuid, real, real, real) to authenticated;
