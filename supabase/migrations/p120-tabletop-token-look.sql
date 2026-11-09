-- supabase/migrations/p120-tabletop-token-look.sql (2026-11-08)
--
-- The token maker (phase 5m). A token's look is its picture (vtt_tokens.image_url) and its frame
-- (vtt_tokens.style -> 'frame': shape, border design, colours, animated effect, motion; drawn live by
-- lib/tabletop/frames.ts). The GM could already write tokens directly; players could not. This adds:
--
--   tabletop_can_edit_token(token, campaign): may the caller change this token's look? The GM may change
--     any token; a player may change a visible token they control (same rule as tabletop_move_token in
--     p112). The upload route (app/api/tabletop/token-image) asks this before storing a player's picture.
--   tabletop_set_token_look(token, image_url, frame, clear_frame): sets the picture and the frame. Only
--     pictures uploaded for this campaign's tokens are accepted (the campaign-maps bucket, path
--     <campaign_id>/tokens/), so a token can never point at an outside address. The frame must be a small
--     JSON object; an imported border inside it follows the same picture rule.
--
-- Nothing else on the token changes. Safe to run more than once: create or replace, then the grants.

create or replace function public.tabletop_can_edit_token(p_token uuid, p_campaign uuid)
 returns boolean
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
begin
  if v_uid is null then return false; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null or v_t.campaign_id <> p_campaign then return false; end if;
  return public.is_campaign_gm(v_t.campaign_id)
      or (not v_t.hidden and v_t.layer <> 'gm' and (
            v_uid = any (v_t.controlled_by)
            or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)));
end;
$function$;
revoke all on function public.tabletop_can_edit_token(uuid, uuid) from public, anon;
grant execute on function public.tabletop_can_edit_token(uuid, uuid) to authenticated;

create or replace function public.tabletop_set_token_look(p_token uuid, p_image_url text default null, p_frame jsonb default null, p_clear_frame boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_t      public.vtt_tokens;
  v_prefix text;
  v_border text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  if not public.tabletop_can_edit_token(p_token, v_t.campaign_id) then
    raise exception 'that token is not yours to change';
  end if;
  v_prefix := '/storage/v1/object/public/campaign-maps/' || v_t.campaign_id::text || '/tokens/';
  if p_image_url is not null and (p_image_url !~ '^https://' or position(v_prefix in p_image_url) = 0) then
    raise exception 'that picture was not uploaded for this campaign';
  end if;
  if p_frame is not null then
    if jsonb_typeof(p_frame) <> 'object' or length(p_frame::text) > 2000 then
      raise exception 'that is not a token frame';
    end if;
    v_border := p_frame ->> 'importUrl';
    if v_border is not null and (v_border !~ '^https://' or position(v_prefix in v_border) = 0) then
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
