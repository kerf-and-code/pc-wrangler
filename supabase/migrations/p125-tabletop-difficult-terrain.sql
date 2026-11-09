-- supabase/migrations/p125-tabletop-difficult-terrain.sql (2026-11-09)
--
-- Phase 5u: difficult terrain (gap 5 in the tabletop audit doc). The GM paints squares of a scene as
-- difficult at the table; they are kept in vtt_scenes.settings.difficult (square numbers, row * n +
-- column), which the scene already carries to everyone, so no new column. Every foot of a move through
-- them costs one extra foot (5e), and a player's move in a fight now spends that cost.
--
--   tabletop_difficult_extra  the extra feet of a straight move: the share of the line in difficult
--                             squares (sampled every tenth of a square, at the middle of each step) times
--                             the move's cost, in whole squares. The same sums as lib/tabletop/terrain.ts,
--                             in the same order, so the ruler and the turn tracker agree.
--   tabletop_move_token       as p122 left it, with that extra added to the feet the move spends.
--
-- Idempotent. Run by hand after p124, then supabase/checks/p125-tabletop-difficult-terrain-check.sql.

create or replace function public.tabletop_difficult_extra(p_cells jsonb, p_n integer,
  p_ax double precision, p_ay double precision, p_bx double precision, p_by double precision,
  p_base integer, p_fps real)
 returns integer
 language plpgsql
 immutable
as $function$
declare
  v_n    integer := greatest(1, coalesce(p_n, 1));
  v_fps  double precision := case when coalesce(p_fps, 0) > 0 then p_fps else 5 end;
  v_on   boolean[];
  v_dx   double precision := p_bx - p_ax;
  v_dy   double precision := p_by - p_ay;
  v_len  double precision;
  v_k    integer;
  v_hit  integer := 0;
  v_t    double precision;
  v_c    integer;
  v_r    integer;
  v_cell jsonb;
  v_any  boolean := false;
begin
  if p_cells is null or jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) = 0 or coalesce(p_base, 0) <= 0 then return 0; end if;
  v_len := sqrt(v_dx * v_dx + v_dy * v_dy);
  if v_len < 1e-9 then return 0; end if;
  v_on := array_fill(false, array[v_n * v_n]);
  for v_cell in select c from jsonb_array_elements(p_cells) as x(c) loop
    if jsonb_typeof(v_cell) = 'number' and (v_cell #>> '{}') ~ '^[0-9]+$' and (v_cell #>> '{}')::bigint < v_n * v_n then
      v_on[(v_cell #>> '{}')::integer + 1] := true; v_any := true;
    end if;
  end loop;
  if not v_any then return 0; end if;
  v_k := greatest(1, ceil(v_len / 0.1)::integer);
  for i in 0 .. v_k - 1 loop
    v_t := (i + 0.5) / v_k;
    v_c := floor(p_ax + v_dx * v_t)::integer;
    v_r := floor(p_ay + v_dy * v_t)::integer;
    if v_c >= 0 and v_r >= 0 and v_c < v_n and v_r < v_n and v_on[v_r * v_n + v_c + 1] then v_hit := v_hit + 1; end if;
  end loop;
  -- floor(x + 0.5), as JavaScript's Math.round: Postgres rounds a double's exact halves to even
  return (floor((v_hit::double precision / v_k) * p_base / v_fps + 0.5) * v_fps)::integer;
end;
$function$;
revoke all on function public.tabletop_difficult_extra(jsonb, integer, double precision, double precision, double precision, double precision, integer, real) from public, anon;
grant execute on function public.tabletop_difficult_extra(jsonb, integer, double precision, double precision, double precision, double precision, integer, real) to authenticated;

-- tabletop_move_token as p122 left it, plus the cost of difficult terrain.
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
  v_set  jsonb;
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
revoke all on function public.tabletop_move_token(uuid, real, real, real) from public, anon;
grant execute on function public.tabletop_move_token(uuid, real, real, real) to authenticated;
