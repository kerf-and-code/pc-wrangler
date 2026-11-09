-- supabase/migrations/p119-tabletop-token-markers.sql (2026-11-08)
--
-- Status markers on tokens (phase 5l). A token's own markers live in vtt_tokens.style -> 'markers', an
-- array of strings: a marker id ("bleeding", "Prone", "red") or an id with a number ("bleeding|3").
-- The GM already writes tokens directly (policy vtt_tokens_gm). Players had no way to change a token's
-- style, so this adds one narrow function: a player may set the markers on a token they control, with
-- the same ownership rule as tabletop_move_token (p112). Nothing else in style can be changed through it.
--
-- Safe to run more than once: create or replace, then the grants.

create or replace function public.tabletop_set_token_markers(p_token uuid, p_markers text[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
          v_uid = any (v_t.controlled_by)
          or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)))
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
revoke all on function public.tabletop_set_token_markers(uuid, text[]) from public, anon;
grant execute on function public.tabletop_set_token_markers(uuid, text[]) to authenticated;
