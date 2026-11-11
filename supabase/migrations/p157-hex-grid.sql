-- p157-hex-grid.sql (2026-11-11, push 33, audit P16: a hex battle grid)
--
-- A tabletop scene can be played on hexes (vtt_scenes.settings.grid, lib/tabletop/hex.ts). Moves in
-- a fight are counted on the server by tabletop_feet(), which reads the scene's settings.diagonal;
-- a hex scene stores "hexp" (pointed top) or "hexf" (flat top) there, and this teaches tabletop_feet
-- to count those as hexes: the shortest path in hex steps, each worth the map's feet per square
-- (one hex is one square across, flat side to flat side).
--
-- The square rules ("five", "alternate", "euclid") are restated exactly as p112 left them. Same
-- signature, so every caller (tabletop_move_token, p122, p125) keeps working unchanged.
--
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p157-hex-grid-check.sql

create or replace function public.tabletop_feet(p_dx real, p_dy real, p_rule text, p_fps real)
returns integer
language plpgsql
immutable
as $function$
declare
  v_dx real := abs(p_dx);
  v_dy real := abs(p_dy);
  v_diag real := least(abs(p_dx), abs(p_dy));
  v_sq real;
  v_h double precision := sqrt(3.0) / 2;
  v_q double precision; v_r double precision; v_s double precision;
  v_rq double precision; v_rr double precision; v_rs double precision;
begin
  if p_rule in ('hexp', 'hexf') then
    -- the move as axial hex coordinates (one hex = one square across), rounded to the nearest hex
    if p_rule = 'hexf' then v_q := p_dx / v_h; v_r := p_dy - v_q / 2;
    else v_r := p_dy / v_h; v_q := p_dx - v_r / 2;
    end if;
    v_s := -v_q - v_r;
    v_rq := round(v_q); v_rr := round(v_r); v_rs := round(v_s);
    if abs(v_rq - v_q) > abs(v_rr - v_r) and abs(v_rq - v_q) > abs(v_rs - v_s) then v_rq := -v_rr - v_rs;
    elsif abs(v_rr - v_r) > abs(v_rs - v_s) then v_rr := -v_rq - v_rs;
    end if;
    v_sq := (abs(v_rq) + abs(v_rr) + abs(v_rq + v_rr)) / 2;
  elsif p_rule = 'euclid' then v_sq := sqrt(v_dx * v_dx + v_dy * v_dy);
  elsif p_rule = 'alternate' then v_sq := greatest(v_dx, v_dy) + floor(round(v_diag) / 2);
  else v_sq := greatest(v_dx, v_dy);
  end if;
  return round(v_sq * coalesce(nullif(p_fps, 0), 5))::integer;
end;
$function$;

insert into public._migrations (name) values ('p157-hex-grid') on conflict do nothing;
