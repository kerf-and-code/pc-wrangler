-- p165-access-holes.sql (2026-11-12, push 41: audit round 2, the access holes)
--
-- Six places where someone could reach a table, a campaign or a roll they should not:
--
--   B1  activity_identity    A Discord user became the GM inside the Discord Activity when /claim had
--                            linked them to a character the GM's own account owns (or a GM typed their
--                            Discord id on the narrator card). A profile found through a character link or
--                            a GM identity is now used only when it is NOT a GM of the campaign; only the
--                            account actually signed in with that Discord id can be the GM.
--       activity_call        Moving a token or using a card now checks the token or card belongs to the
--                            campaign the call is for, so a profile cannot reach another campaign.
--   B2  discord_setup_codes  /setup used to take the campaign's share code, which every player has, and
--                            re-link the campaign to any server. The Workspace now hands out a one-time
--                            setup code (a day, once); the share code still works only for a Discord user
--                            who is the campaign's GM or co-GM (signed in with Discord) or its narrator.
--   R6  tabletop_is_player   A player who left the table, or was removed by the GM (characters.active =
--                            false), kept the live table, chat, rolls and the Discord Activity.
--   B6  tabletop_feed        A Roll20 roll made in private (/gmroll, a whisper to the GM) carries
--                            rolls.gm_only from the extension; it now reaches the GM only.
--   B10 world_map_poi_detail_for_player
--                            A marker's linked NPC name is returned only when players may see that NPC.
--   T7  campaigns.activity_watchers
--                            Watching the table in the Discord Activity without a character is now off
--                            unless the GM turns it on (Workspace). The API reads the switch.
--
-- Each function is restated from its latest definition (named on each), with the p165 change marked.
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p165-access-holes-check.sql

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'activity_call') then
    raise exception 'run p158 and p159 first';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'campaign_gm_of') then
    raise exception 'run p149-co-gm.sql first';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'world_map_poi_detail_for_player') then
    raise exception 'run p162-player-access-fixes.sql first';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- T7: the watcher switch, off unless the GM turns it on
alter table public.campaigns add column if not exists activity_watchers boolean not null default false;

-- ---------------------------------------------------------------------------------------------------
-- R6: tabletop_is_player as in p139, plus the active test
create or replace function public.tabletop_is_player(p_campaign uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.characters ch
    where ch.campaign_id = p_campaign and ch.profile_id = auth.uid() and ch.kind = 'pc'
      and coalesce(ch.active, true)   -- p165 (audit R6): a player who left or was removed is not at the table
  ) and not exists (
    select 1 from public.campaigns c where c.id = p_campaign and c.deleted_at is not null
  );
$function$;

-- ---------------------------------------------------------------------------------------------------
-- B6: tabletop_feed as in p142, plus the gm_only test on outside rolls
CREATE OR REPLACE FUNCTION public.tabletop_feed(p_campaign uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_gm      boolean;
  v_session uuid;
  v_lim     integer := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  v_session := public.tabletop_open_session(p_campaign);

  return jsonb_build_object(
    'messages', (
      select coalesce(jsonb_agg(to_jsonb(m) - 'campaign_id' order by m.created_at), '[]'::jsonb)
      from (
        select * from public.vtt_messages m
        where m.campaign_id = p_campaign
          and (p_since is null or m.created_at > p_since)
          and (m.author_profile = v_uid
               or (m.whisper_to is not null and v_uid = any (m.whisper_to))
               or (m.whisper_to is null and v_gm)
               or (m.whisper_to is null and not m.gm_only))
        order by m.created_at desc
        limit v_lim
      ) m
    ),
    'outside_rolls', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'actor_name', e.actor_name, 'character_id', e.character_id, 'source', e.source,
        'event_type', e.event_type, 'name', e.name, 'rolls', e.rolls, 'at', coalesce(e.rolled_at, e.received_at),
        'applied_to', e.applied_to
      ) order by coalesce(e.rolled_at, e.received_at)), '[]'::jsonb)
      from (
        select * from public.vtt_events e
        where v_session is not null and e.session_id = v_session
          and e.source not in ('six_axes_tabletop', 'demo')
          -- p142 (audit B9): the GM's own roller and transcribed spoken rolls are for the GM only
          and (v_gm or e.source not in ('six_axes_roller', 'spoken'))
          -- p165 (audit B6): a roll made in private outside (Roll20 /gmroll, a whisper) is for the GM only
          and (v_gm or coalesce(e.rolls ->> 'gm_only', 'false') <> 'true')
          and (p_since is null or e.received_at > p_since)
        order by e.received_at desc
        limit v_lim
      ) e
    )
  );
end;
$function$;
revoke all on function public.tabletop_feed(uuid, timestamptz, integer) from public, anon;
grant execute on function public.tabletop_feed(uuid, timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- B10: world_map_poi_detail_for_player as in p162, plus the NPC's visibility
create or replace function public.world_map_poi_detail_for_player(p_share text, p_poi uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with p as (
    select mp.entry_id, mp.character_id, c.id as campaign_id
      from public.map_pois mp
      join public.world_maps wm on wm.id = mp.world_map_id
      join public.campaigns c on c.id = wm.campaign_id and c.deleted_at is null
     where mp.id = p_poi and c.share_code = p_share and mp.visibility in ('common', 'player')
     limit 1
  )
  select case when not exists (select 1 from p) then null::jsonb else jsonb_build_object(
    'entry', (select jsonb_build_object('title', e.title, 'body', e.body)
                from p join public.entries e on e.id = p.entry_id and e.campaign_id = p.campaign_id
               where e.visibility in ('common', 'player')
                  or exists (select 1 from public.entry_reveals r
                              join public.characters me on me.id = r.revealed_to_character_id
                             where r.target_type = 'entry' and r.target_id = e.id
                               and me.campaign_id = p.campaign_id and me.profile_id = auth.uid())),
    'character', (select jsonb_build_object('name', ch.name)
                    from p join public.characters ch on ch.id = p.character_id and ch.campaign_id = p.campaign_id
                   -- p165 (audit B10): only a person the players may see, or one revealed to the caller
                   where coalesce(ch.visibility, 'player') in ('common', 'player')
                      or exists (select 1 from public.entry_reveals r
                                  join public.characters me on me.id = r.revealed_to_character_id
                                 where r.target_type = 'character' and r.target_id = ch.id
                                   and me.campaign_id = p.campaign_id and me.profile_id = auth.uid())))
  end;
$function$;
revoke all on function public.world_map_poi_detail_for_player(text, uuid) from public;
grant execute on function public.world_map_poi_detail_for_player(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- B1: activity_identity as in p158; a profile reached through a character or a GM identity may never be
-- a GM of the campaign, only the account signed in with this Discord id can be
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
  r record;
begin
  if coalesce(p_discord, '') = '' or coalesce(p_guild, '') = '' then return; end if;
  for c in
    select cm.id, cm.name from public.campaigns cm
    where cm.discord_guild_id = p_guild and cm.deleted_at is null
    order by cm.name
  loop
    v_prof := null; v_role := 'watch';
    for r in
      select x.uid, x.pri from (
        select i.user_id as uid, 1 as pri from auth.identities i where i.provider = 'discord' and i.provider_id = p_discord
        union all
        select g.profile_id, 2 from public.gm_identities g where g.campaign_id = c.id and g.discord_user_id = p_discord and g.profile_id is not null
        union all
        select ch.profile_id, 3 from public.characters ch where ch.campaign_id = c.id and ch.discord_user_id = p_discord and ch.profile_id is not null
      ) x order by x.pri
    loop
      perform set_config('request.jwt.claim.sub', r.uid::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
      if public.is_campaign_gm(c.id) then
        -- p165 (audit B1): only the account signed in with this Discord id is the GM here. A GM account
        -- reached through a /claim link or a typed narrator id is somebody else's account: skip it.
        if r.pri = 1 then v_prof := r.uid; v_role := 'gm'; exit; end if;
        continue;
      end if;
      if public.tabletop_is_player(c.id) and v_prof is null then v_prof := r.uid; v_role := 'player'; end if;
    end loop;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    campaign_id := c.id; name := c.name; role := v_role; profile_id := v_prof;
    return next;
  end loop;
end;
$$;

-- B1: activity_call as in p159; a token or card must belong to the campaign the call names
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
      -- p165 (audit B1): only a token of this campaign
      if v_c is null or not exists (select 1 from public.vtt_tokens t where t.id = (p_args ->> 'token')::uuid and t.campaign_id = v_c) then
        raise exception 'token not found';
      end if;
      perform public.tabletop_move_token((p_args ->> 'token')::uuid, (p_args ->> 'x')::real, (p_args ->> 'y')::real, null);
      return 'true'::jsonb;
    when 'tabletop_open_session' then return to_jsonb(public.tabletop_open_session(v_c));
    when 'is_campaign_gm' then return to_jsonb(public.is_campaign_gm(v_c));
    when 'tabletop_is_player' then return to_jsonb(public.tabletop_is_player(v_c));
    when 'tabletop_cards' then return public.tabletop_cards(v_c);
    when 'tabletop_card_use' then
      -- p165 (audit B1): only a card of this campaign
      if v_c is null or not exists (select 1 from public.vtt_cards k where k.id = (p_args ->> 'card')::uuid and k.campaign_id = v_c) then
        raise exception 'card not found';
      end if;
      perform public.tabletop_card_use((p_args ->> 'card')::uuid);
      return 'true'::jsonb;
    when 'tabletop_card_move' then
      if v_c is null or not exists (select 1 from public.vtt_cards k where k.id = (p_args ->> 'card')::uuid and k.campaign_id = v_c) then
        raise exception 'card not found';
      end if;
      perform public.tabletop_card_move((p_args ->> 'card')::uuid, p_args ->> 'to', coalesce((p_args ->> 'face_up')::boolean, true), null);
      return 'true'::jsonb;
    else raise exception 'activity_call: % is not allowed', p_fn;
  end case;
end;
$$;
revoke all on function public.activity_identity(text, text) from public, anon, authenticated;
revoke all on function public.activity_call(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.activity_identity(text, text) to service_role;
grant execute on function public.activity_call(uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- B2: one-time setup codes for /setup
create table if not exists public.discord_setup_codes (
  code        text primary key,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '1 day',
  used_at     timestamptz,
  used_by     text
);
create index if not exists discord_setup_codes_campaign_idx on public.discord_setup_codes (campaign_id);
alter table public.discord_setup_codes enable row level security;
revoke all on public.discord_setup_codes from anon, authenticated;

-- The Workspace's Copy /setup command: a fresh code for a campaign the caller runs (owner or co-GM).
-- Older unused codes for the campaign are retired, so only the newest one works.
create or replace function public.create_discord_setup_code(p_campaign uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only this campaign''s GM can link Discord'; end if;
  delete from public.discord_setup_codes where campaign_id = p_campaign and used_at is null;
  delete from public.discord_setup_codes where expires_at < now() - interval '7 days';
  v_code := 'sx' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 14);
  insert into public.discord_setup_codes (code, campaign_id, created_by) values (v_code, p_campaign, auth.uid());
  return v_code;
end;
$$;
revoke all on function public.create_discord_setup_code(uuid) from public, anon;
grant execute on function public.create_discord_setup_code(uuid) to authenticated;

-- The bot's /setup: which campaign a code links, for this Discord user. A setup code works once, for a
-- day, for anyone the GM gives it to. A share code works only for a Discord user who is the campaign's
-- GM or co-GM (the account they signed in with Discord) or its narrator (gm_identities). Returns no row
-- when neither holds; `how` says which path matched.
create or replace function public.discord_setup_resolve(p_code text, p_discord text)
returns table (campaign_id uuid, name text, how text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text := lower(trim(coalesce(p_code, '')));
  v_c    uuid;
begin
  if v_code = '' or coalesce(p_discord, '') = '' then return; end if;

  update public.discord_setup_codes s set used_at = now(), used_by = p_discord
   where s.code = v_code and s.used_at is null and s.expires_at > now()
  returning s.campaign_id into v_c;
  if v_c is not null then
    return query select cm.id, cm.name, 'setup_code'::text from public.campaigns cm where cm.id = v_c and cm.deleted_at is null;
    return;
  end if;

  return query
    select cm.id, cm.name, 'gm'::text
      from public.campaigns cm
     where cm.share_code = v_code and cm.deleted_at is null
       and (exists (select 1 from auth.identities i
                     where i.provider = 'discord' and i.provider_id = p_discord
                       and public.campaign_gm_of(cm.id, i.user_id))
            or exists (select 1 from public.gm_identities g
                        where g.campaign_id = cm.id and g.discord_user_id = p_discord))
     limit 1;
end;
$$;
revoke all on function public.discord_setup_resolve(text, text) from public, anon, authenticated;
grant execute on function public.discord_setup_resolve(text, text) to service_role;

insert into public._migrations (name) values ('p165-access-holes') on conflict do nothing;
