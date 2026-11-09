-- supabase/migrations/p126-tabletop-wall-types.sql (2026-11-09)
--
-- Phase 5v: wall types (gap 6 in the tabletop audit doc). A sight wall (battle_maps.meta.sightWalls) may
-- carry a fifth number, its kind: 1 window (stops feet, not eyes), 2 screen (stops eyes, not feet:
-- curtains, foliage, an illusory wall), 3 one-way (stops feet; stops eyes from behind only). A wall
-- with four numbers is a plain wall, as every wall saved before this was. Sight is worked out in each
-- browser (lib/tabletop/sight.ts forSight); movement is checked here as well.
--
-- tabletop_wall_blocks (p122) skipped any sight wall that was not exactly four numbers, so without this
-- a player could walk through a window or a one-way wall. It now reads the kind: windows, one-way walls
-- and plain walls stop a player's move, screens do not. Everything else is exactly as p122 left it.
-- Same signature, so CREATE OR REPLACE keeps tabletop_move_token's call working.
--
-- Idempotent. Run by hand after p125, then supabase/checks/p126-tabletop-wall-types-check.sql.

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
    -- p126: four numbers, or five with the wall's kind; a screen (kind 2) does not stop feet
    continue when jsonb_typeof(v_w) <> 'array' or jsonb_array_length(v_w) not in (4, 5);
    continue when jsonb_array_length(v_w) = 5 and jsonb_typeof(v_w -> 4) = 'number' and (v_w ->> 4)::numeric = 2;
    continue when exists (select 1 from jsonb_array_elements(v_w) with ordinality x(v, o) where x.o <= 4 and (jsonb_typeof(x.v) <> 'number' or (x.v #>> '{}')::numeric < 0 or (x.v #>> '{}')::numeric > v_n));
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
