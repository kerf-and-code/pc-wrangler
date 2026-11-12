-- p158-discord-activity.sql (2026-11-11, push 34, audit P7: the Discord Activity)
--
-- The Six Axes Activity runs inside Discord (a voice channel's Activities shelf), in an iframe on
-- discordsays.com where the website's login cookies do not exist. So it has no Supabase session:
-- the server checks the Discord identity (OAuth through the Discord client), works out which Six Axes
-- profile that is, and makes every read and write AS that profile through the functions below. The
-- table's own functions (tabletop_state, tabletop_combat, tabletop_feed, tabletop_move_token) then
-- apply exactly the rules they apply on the website: hidden tokens, fog, whose turn it is.
--
--   activity_identity(discord, guild)   the campaigns linked to this Discord server (campaigns.
--                                        discord_guild_id, set by /setup) and who the Discord user is
--                                        in each: gm, player, or watch (no linked profile)
--   activity_call(profile, fn, args)    one table function, run as that profile; a fixed list
--   activity_watch_profile(campaign)    whose eyes a watcher borrows: a player's (the API strips
--                                        everything personal: their tokens, whispers, their name)
--
-- Who a Discord user is, in order: the Six Axes account they signed in to with Discord (its Discord
-- identity's provider_id is the Discord user id, as p11 relies on), a character linked by /claim
-- (characters.discord_user_id), or a GM identity (gm_identities.discord_user_id).
--
-- All three are for the service role only: the API (app/api/activity) is the only caller, after it
-- has verified the Discord token itself.
--
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p158-discord-activity-check.sql

create or replace function public.activity_identity(p_discord text, p_guild text)
returns table (campaign_id uuid, name text, role text, profile_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_prof uuid;
  v_role text;
  cand uuid;
begin
  if coalesce(p_discord, '') = '' or coalesce(p_guild, '') = '' then return; end if;
  for c in
    select cm.id, cm.name from public.campaigns cm
    where cm.discord_guild_id = p_guild and cm.deleted_at is null
    order by cm.name
  loop
    v_prof := null; v_role := 'watch';
    for cand in
      select x.uid from (
        select i.user_id as uid, 1 as pri from auth.identities i where i.provider = 'discord' and i.provider_id = p_discord
        union all
        select g.profile_id, 2 from public.gm_identities g where g.campaign_id = c.id and g.discord_user_id = p_discord and g.profile_id is not null
        union all
        select ch.profile_id, 3 from public.characters ch where ch.campaign_id = c.id and ch.discord_user_id = p_discord and ch.profile_id is not null
      ) x order by x.pri
    loop
      perform set_config('request.jwt.claim.sub', cand::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', cand, 'role', 'authenticated')::text, true);
      if public.is_campaign_gm(c.id) then v_prof := cand; v_role := 'gm'; exit; end if;
      if public.tabletop_is_player(c.id) and v_prof is null then v_prof := cand; v_role := 'player'; end if;
    end loop;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    campaign_id := c.id; name := c.name; role := v_role; profile_id := v_prof;
    return next;
  end loop;
end;
$$;

create or replace function public.activity_watch_profile(p_campaign uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v uuid;
begin
  -- a player on the active scene if there is one, else any player with a character here
  for v in
    select distinct ch.profile_id from public.characters ch
    where ch.campaign_id = p_campaign and ch.kind = 'pc' and ch.profile_id is not null
  loop
    perform set_config('request.jwt.claim.sub', v::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    if public.tabletop_is_player(p_campaign) then
      if exists (select 1 from public.vtt_scenes s where s.campaign_id = p_campaign and s.is_active
                 and s.id = public.tabletop_scene_for(p_campaign, v)) then
        return v;
      end if;
    end if;
  end loop;
  for v in
    select distinct ch.profile_id from public.characters ch
    where ch.campaign_id = p_campaign and ch.kind = 'pc' and ch.profile_id is not null
  loop
    perform set_config('request.jwt.claim.sub', v::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    if public.tabletop_is_player(p_campaign) then return v; end if;
  end loop;
  return null;
end;
$$;

create or replace function public.activity_call(p_profile uuid, p_fn text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c uuid := (p_args ->> 'campaign')::uuid;
begin
  if p_profile is null then raise exception 'no profile'; end if;
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
  case p_fn
    when 'tabletop_state' then return public.tabletop_state(v_c);
    when 'tabletop_combat' then return public.tabletop_combat(v_c);
    when 'tabletop_feed' then
      return public.tabletop_feed(v_c, nullif(p_args ->> 'since', '')::timestamptz, coalesce((p_args ->> 'limit')::int, 60));
    when 'tabletop_move_token' then
      perform public.tabletop_move_token((p_args ->> 'token')::uuid, (p_args ->> 'x')::real, (p_args ->> 'y')::real, null);
      return 'true'::jsonb;
    when 'tabletop_open_session' then return to_jsonb(public.tabletop_open_session(v_c));
    when 'is_campaign_gm' then return to_jsonb(public.is_campaign_gm(v_c));
    when 'tabletop_is_player' then return to_jsonb(public.tabletop_is_player(v_c));
    else raise exception 'activity_call: % is not allowed', p_fn;
  end case;
end;
$$;

revoke all on function public.activity_identity(text, text) from public, anon, authenticated;
revoke all on function public.activity_watch_profile(uuid) from public, anon, authenticated;
revoke all on function public.activity_call(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.activity_identity(text, text) to service_role;
grant execute on function public.activity_watch_profile(uuid) to service_role;
grant execute on function public.activity_call(uuid, text, jsonb) to service_role;

insert into public._migrations (name) values ('p158-discord-activity') on conflict do nothing;
