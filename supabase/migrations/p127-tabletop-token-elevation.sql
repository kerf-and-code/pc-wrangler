-- supabase/migrations/p127-tabletop-token-elevation.sql (2026-11-09)
--
-- Phase 5w: token elevation (gap 7 in the tabletop audit doc). A token's height above the ground, in
-- whole feet (negative below it), kept in vtt_tokens.style -> 'elevation' and shown as a badge on the
-- token; the ruler counts it in the distance between two tokens (lib/tabletop/elevation.ts).
--
-- tabletop_set_token_elevation(tokens, feet): sets the height of each token the caller may change: the
-- GM any token of the campaign, a player a visible token they control (the rule of tabletop_move_token,
-- p112, and tabletop_set_token_markers, p119). Nothing else in style changes; 0 removes the key. Tokens
-- the caller may not change are refused, and nothing is written when any is.
--
-- Idempotent. Run by hand after p126, then supabase/checks/p127-tabletop-token-elevation-check.sql.

create or replace function public.tabletop_set_token_elevation(p_tokens uuid[], p_feet integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
            v_uid = any (v_t.controlled_by)
            or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)))
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
revoke all on function public.tabletop_set_token_elevation(uuid[], integer) from public, anon;
grant execute on function public.tabletop_set_token_elevation(uuid[], integer) to authenticated;
