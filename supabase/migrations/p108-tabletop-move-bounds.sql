-- p108-tabletop-move-bounds.sql
--
-- Let tokens stand off the map (2026-11-07). tabletop_move_token (p105) kept every move within one
-- square of the map's edge, so a token staged beside the map (an ambush waiting, a reinforcement) was
-- pulled back to the edge. Moves are now kept within one whole map's width of the map on every side:
-- room to stage anything, while a runaway value still cannot send a token to the far end of the plane.
--
-- Everything else is unchanged from p105: the same signature, the same permission rule (the GM moves
-- anything; a player moves a visible token whose character they own or which lists them as a
-- controller). CREATE OR REPLACE keeps the grants; they are restated anyway. Idempotent; run by hand.

create or replace function public.tabletop_move_token(p_token uuid, p_x real, p_y real, p_rot real default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
  v_n   integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  if not (
    public.is_campaign_gm(v_t.campaign_id)
    or (not v_t.hidden and v_t.layer <> 'gm' and (
          v_uid = any (v_t.controlled_by)
          or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)))
  ) then
    raise exception 'that token is not yours to move';
  end if;
  select b.n into v_n from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id where s.id = v_t.scene_id;
  v_n := coalesce(v_n, 100);
  update public.vtt_tokens
     set x = greatest(-v_n, least(2 * v_n, p_x)),
         y = greatest(-v_n, least(2 * v_n, p_y)),
         rot = coalesce(p_rot, rot),
         updated_at = now()
   where id = p_token;
end;
$function$;
revoke all on function public.tabletop_move_token(uuid, real, real, real) from public, anon;
grant execute on function public.tabletop_move_token(uuid, real, real, real) to authenticated;
