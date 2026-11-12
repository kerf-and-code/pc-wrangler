-- supabase/migrations/0000-base-schema.sql (2026-11-12, push 50: audit round 2, T13)
--
-- The public schema as the migrations in this folder leave it after p170. Refreshed from the version of
-- 2026-11-09 (after p133), which had fallen 37 migrations behind and, because it came from a catalog
-- query rather than pg_dump, missed identity columns and every function grant.
--
-- How it was made (docs/base-schema.md has the steps, to repeat after later migrations):
--   1. a fresh PostgreSQL 16 database with the Supabase stand-ins (roles anon, authenticated and
--      service_role; the auth, storage, realtime and extensions schemas; auth.uid(), auth.role(),
--      auth.jwt()), then the old base file, then p134 to p170 in order: every one ran without an error;
--   2. pg_dump --schema-only --schema=public of that database;
--   3. scripts/idempotent-schema.py, which makes every statement safe to run twice;
--   4. the realtime publication and the extensions added by hand (sections 1 and 3 below).
-- Tested: this file run twice on a second fresh database, with no error either time, gives a schema
-- identical to step 1 (pg_dump of both compared line for line: no difference).
--
-- What it is: the record of the schema, and the way to stand up a fresh copy (a staging project, a
-- restore drill, local testing). On a fresh database run this file, then every migration after p170.
--
-- What it is NOT: production's own catalog. It is what the files say production should be. Run
-- supabase/checks/schema-fingerprint-check.sql in production to see any difference (a function
-- changed in the SQL editor and never written down, a migration that was skipped).
--
-- Never run it on production: production already has all of it, and if anything there is newer than
-- these files this would put the older version back.
--
-- Not included: data, the auth and storage schemas (Supabase makes those), storage buckets and their
-- policies, vault secrets, scheduled jobs.
--
-- Counts: 111 tables, 243 functions, 10 views, 163 policies, 50 triggers, 148 indexes.

-- ================================================================================================
-- 1 extensions (Supabase provides these; the guards keep a plain PostgreSQL from stopping here)
-- ================================================================================================

create schema if not exists extensions;
do $ext$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_stat_statements') then
    create extension if not exists "pg_stat_statements" with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create schema if not exists vault;
    create extension if not exists "supabase_vault" with schema vault;
  end if;
end $ext$;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ================================================================================================
-- 2 the schema (pg_dump, made idempotent)
-- ================================================================================================

SET lock_timeout = 0;

SET idle_in_transaction_session_timeout = 0;

SET client_encoding = 'UTF8';

SET standard_conforming_strings = on;

SELECT pg_catalog.set_config('search_path', '', false);

SET check_function_bodies = false;

SET xmloption = content;

SET client_min_messages = warning;

SET row_security = off;

COMMENT ON SCHEMA public IS 'standard public schema';

CREATE OR REPLACE FUNCTION public.accept_campaign_transfer(p_token text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_t     public.campaign_transfers;
  v_c     public.campaigns;
  v_email text;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  select * into v_t from public.campaign_transfers where token = p_token for update;
  if v_t.id is null then raise exception 'this handover link does not exist'; end if;
  if v_t.accepted_at is not null then raise exception 'this handover was already accepted'; end if;
  if v_t.cancelled_at is not null then raise exception 'the GM cancelled this handover'; end if;
  if v_t.expires_at <= now() then raise exception 'this handover link has expired; ask the GM for a new one'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is distinct from v_t.to_email then raise exception 'this handover was sent to a different email address; sign in with that one'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and access_granted and access_role = 'gm') then
    raise exception 'you need GM access to take over a campaign: ask for GM access on your Campaigns page first';
  end if;
  select * into v_c from public.campaigns where id = v_t.campaign_id for update;
  if v_c.deleted_at is not null then raise exception 'this campaign is in the trash'; end if;
  if v_c.gm_id is distinct from v_t.from_id then raise exception 'this campaign has changed hands since the offer'; end if;

  -- p170: marked accepted FIRST, so the membership change below is recognised as a handover by
  -- notify_on_cogm (it compares accepted_at with now(), the time of this transaction)
  update public.campaign_transfers set accepted_at = now(), accepted_by = v_uid where id = v_t.id;
  update public.campaigns set gm_id = v_uid where id = v_c.id;
  insert into public.memberships (campaign_id, profile_id, role, active)
  values (v_c.id, v_uid, 'gm', true)
  on conflict (campaign_id, profile_id) do update set role = 'gm', active = true;
  update public.memberships set role = 'player'
   where campaign_id = v_c.id and profile_id = v_t.from_id and role = 'gm';
  update public.stat_blocks set gm_id = v_uid where campaign_id = v_c.id and gm_id = v_t.from_id;
  update public.compendium_entries set gm_id = v_uid where campaign_id = v_c.id and gm_id = v_t.from_id;
  update public.dm_boards set gm_id = v_uid where campaign_id = v_c.id and gm_id = v_t.from_id;
  -- p170 (R8): co-GM invites the old owner made and nobody used stop working with the handover
  update public.campaign_gm_invites set revoked_at = now()
   where campaign_id = v_c.id and accepted_at is null and revoked_at is null;
  -- p170 (G6): webhooks that no current GM made stop firing (addon_hooks_follow_gms does the same on
  -- every later change of who runs the campaign)
  perform public.addon_hooks_prune(v_c.id);
  return v_c.id;
end;
$$;

ALTER FUNCTION public.accept_campaign_transfer(p_token text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.accept_gm_invite(p_token uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_i   public.campaign_gm_invites;
  v_c   public.campaigns;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from auth.users u where u.id = v_uid and coalesce(u.is_anonymous, false)) then
    raise exception 'sign in with your own account to accept a co-GM invite';
  end if;
  select * into v_i from public.campaign_gm_invites where token = p_token for update;
  if v_i.id is null then raise exception 'that invite link is not valid'; end if;
  select * into v_c from public.campaigns where id = v_i.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then raise exception 'that campaign is no longer running'; end if;
  if v_c.gm_id = v_uid then raise exception 'this is your own campaign'; end if;
  if public.campaign_gm_of(v_c.id, v_uid) then return v_c.id; end if;
  if v_i.revoked_at is not null then raise exception 'the GM cancelled this invite'; end if;
  if v_i.accepted_at is not null then raise exception 'this invite has already been used: ask the GM for a new link'; end if;
  if v_i.expires_at <= now() then raise exception 'this invite has expired: ask the GM for a new link'; end if;
  insert into public.memberships (campaign_id, profile_id, role, active)
  values (v_c.id, v_uid, 'co-gm', true)
  on conflict (campaign_id, profile_id) do update set role = 'co-gm', active = true;
  update public.campaign_gm_invites set accepted_by = v_uid, accepted_at = now() where id = v_i.id;
  return v_c.id;
end;
$$;

ALTER FUNCTION public.accept_gm_invite(p_token uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.accept_terms(p_version text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_version is null or char_length(p_version) not between 1 and 32 then raise exception 'bad terms version'; end if;
  update public.profiles
     set terms_accepted_at = now(), terms_version = p_version, updated_at = now()
   where id = auth.uid();
end;
$$;

ALTER FUNCTION public.accept_terms(p_version text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.activity_call(p_profile uuid, p_fn text, p_args jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

ALTER FUNCTION public.activity_call(p_profile uuid, p_fn text, p_args jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.activity_identity(p_discord text, p_guild text) RETURNS TABLE(campaign_id uuid, name text, role text, profile_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

ALTER FUNCTION public.activity_identity(p_discord text, p_guild text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.activity_watch_profile(p_campaign uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

ALTER FUNCTION public.activity_watch_profile(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_auth(p_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_k public.addon_keys;
  v_c public.campaigns;
begin
  select * into v_k from public.addon_keys where key_hash = p_hash for update;
  if v_k.id is null or v_k.revoked_at is not null then return null; end if;
  select * into v_c from public.campaigns where id = v_k.campaign_id;
  -- p149: the key's maker must still be a GM of the campaign (owner or co-GM); a removed co-GM's keys stop.
  if v_c.id is null or not public.campaign_gm_of(v_c.id, v_k.created_by) then return null; end if;
  if now() - v_k.window_start > interval '1 minute' then
    update public.addon_keys set window_start = now(), window_count = 1, last_used_at = now() where id = v_k.id;
    v_k.window_count := 1;
  else
    update public.addon_keys set window_count = window_count + 1, last_used_at = now() where id = v_k.id;
    v_k.window_count := v_k.window_count + 1;
  end if;
  return jsonb_build_object('id', v_k.id, 'campaignId', v_k.campaign_id, 'campaignName', v_c.name, 'name', v_k.name,
                            'scopes', to_jsonb(v_k.scopes), 'owner', v_k.created_by, 'limited', v_k.window_count > 60);
end;
$$;

ALTER FUNCTION public.addon_auth(p_hash text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_claim(p_campaign uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_out jsonb;
begin
  with c as (
    select o.id from public.addon_outbox o join public.addon_hooks h on h.id = o.hook_id
     where o.delivered_at is null and o.dropped_at is null and o.next_at <= now()
       and (o.claimed_until is null or o.claimed_until < now())
       and h.enabled and (p_campaign is null or o.campaign_id = p_campaign)
     order by o.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update of o skip locked
  ), u as (
    update public.addon_outbox o set claimed_until = now() + interval '45 seconds'
      from c where o.id = c.id
    returning o.id, o.hook_id, o.campaign_id, o.event, o.payload, o.created_at, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'hookId', u.hook_id, 'event', u.event, 'payload', u.payload, 'createdAt', u.created_at, 'attempts', u.attempts,
           'url', h.url, 'secret', h.secret, 'campaignId', u.campaign_id, 'campaignName', cp.name) order by u.id), '[]'::jsonb)
    into v_out
    from u join public.addon_hooks h on h.id = u.hook_id join public.campaigns cp on cp.id = u.campaign_id;
  return v_out;
end;
$$;

ALTER FUNCTION public.addon_claim(p_campaign uuid, p_limit integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_hooks_follow_gms() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.addon_hooks_prune(coalesce(new.campaign_id, old.campaign_id));
  return null;
exception when others then
  raise warning 'addon_hooks_follow_gms: %', sqlerrm;
  return null;
end;
$$;

ALTER FUNCTION public.addon_hooks_follow_gms() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_hooks_follow_owner() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.gm_id is distinct from old.gm_id then perform public.addon_hooks_prune(new.id); end if;
  return null;
exception when others then
  raise warning 'addon_hooks_follow_owner: %', sqlerrm;
  return null;
end;
$$;

ALTER FUNCTION public.addon_hooks_follow_owner() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_hooks_prune(p_campaign uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_n integer;
begin
  update public.addon_hooks h set enabled = false
   where h.campaign_id = p_campaign and h.enabled
     and (h.created_by is null or not public.campaign_gm_of(p_campaign, h.created_by));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

ALTER FUNCTION public.addon_hooks_prune(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_on_combat() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_started boolean := new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active');
  v_ended   boolean := tg_op = 'UPDATE' and new.status is distinct from 'active' and old.status = 'active';
  v_turned  boolean := tg_op = 'UPDATE' and new.status = 'active' and old.status = 'active'
                       and (new.round is distinct from old.round or new.turn is distinct from old.turn);
  v_cur     jsonb;
begin
  if not (v_started or v_ended or v_turned) then return new; end if;
  if not exists (select 1 from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and h.events && array['turn', 'combat']) then
    return new;
  end if;
  if v_started or v_ended then
    insert into public.addon_outbox (hook_id, campaign_id, event, payload)
    select h.id, new.campaign_id, 'combat',
           jsonb_build_object('combatId', new.id, 'state', case when v_started then 'started' else 'ended' end, 'name', new.name, 'round', new.round, 'at', now())
      from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and 'combat' = any (h.events);
  end if;
  if v_turned or v_started then
    -- whose turn it is; a combatant the GM hides from the tracker stays hidden here too
    v_cur := new.combatants -> coalesce(new.turn, 0);
    insert into public.addon_outbox (hook_id, campaign_id, event, payload)
    select h.id, new.campaign_id, 'turn',
           jsonb_build_object('combatId', new.id, 'round', new.round,
             'current', case when v_cur is null or coalesce((v_cur ->> 'hidden')::boolean, false) then null
                             else jsonb_build_object('name', v_cur ->> 'name', 'kind', v_cur ->> 'kind') end,
             'at', now())
      from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and 'turn' = any (h.events);
  end if;
  return new;
exception when others then
  raise warning 'addon_on_combat: %', sqlerrm;
  return new;
end;
$$;

ALTER FUNCTION public.addon_on_combat() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_on_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ev      text;
  v_payload jsonb;
begin
  if new.whisper_to is not null then return new; end if;
  v_ev := case when new.kind = 'roll' then 'roll' when new.kind in ('say', 'emote') then 'chat' end;
  if v_ev is null then return new; end if;
  if not exists (select 1 from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and v_ev = any (h.events)) then
    return new;
  end if;
  v_payload := jsonb_build_object(
      'messageId', new.id,
      'who', coalesce(new.as_name, (select c.name from public.characters c where c.id = new.character_id),
                      public.tabletop_seat_name(new.campaign_id, new.author_profile)),
      'kind', new.kind,
      'text', new.body,
      'secret', new.gm_only,
      -- set when an add-on posted it, so a bot can skip its own lines
      'addon', new.roll ->> 'addon',
      'at', new.created_at)
    || case when v_ev = 'roll' and new.roll is not null then jsonb_build_object('roll', jsonb_strip_nulls(jsonb_build_object(
         'label', new.roll -> 'label', 'notation', new.roll -> 'notation', 'total', new.roll -> 'total',
         'natural', new.roll -> 'natural', 'dice', new.roll -> 'dice', 'table', new.roll -> 'table')))
       else '{}'::jsonb end;
  insert into public.addon_outbox (hook_id, campaign_id, event, payload)
  select h.id, new.campaign_id, v_ev, v_payload
    from public.addon_hooks h
   where h.campaign_id = new.campaign_id and h.enabled and v_ev = any (h.events) and (not new.gm_only or h.include_secret);
  return new;
exception when others then
  raise warning 'addon_on_message: %', sqlerrm;
  return new;
end;
$$;

ALTER FUNCTION public.addon_on_message() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_ping(p_hook uuid) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.addon_outbox (hook_id, campaign_id, event, payload)
  select h.id, h.campaign_id, 'ping', jsonb_build_object('message', 'A test from Six Axes. Your webhook works.', 'at', now())
    from public.addon_hooks h where h.id = p_hook
  returning id;
$$;

ALTER FUNCTION public.addon_ping(p_hook uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_prune() RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with d as (
    delete from public.addon_outbox
     where (coalesce(delivered_at, dropped_at) < now() - interval '7 days')
        or (delivered_at is null and created_at < now() - interval '2 days')
    returning 1)
  select count(*)::integer from d;
$$;

ALTER FUNCTION public.addon_prune() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.addon_settle(p_id bigint, p_ok boolean, p_status integer, p_error text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_o public.addon_outbox;
begin
  select * into v_o from public.addon_outbox where id = p_id for update;
  if v_o.id is null then return; end if;
  if p_ok then
    update public.addon_outbox set delivered_at = now(), claimed_until = null, attempts = attempts + 1 where id = p_id;
    update public.addon_hooks set fail_count = 0, last_status = p_status, last_error = null, last_attempt_at = now(), last_ok_at = now()
     where id = v_o.hook_id;
  else
    update public.addon_outbox
       set attempts = attempts + 1, claimed_until = null,
           dropped_at = case when attempts + 1 >= 6 then now() end,
           next_at = now() + make_interval(secs => 30 * power(2, least(attempts, 8)))
     where id = p_id;
    update public.addon_hooks
       set fail_count = fail_count + 1, last_status = p_status, last_error = left(coalesce(p_error, 'failed'), 300), last_attempt_at = now(),
           enabled = case when fail_count + 1 >= 25 then false else enabled end
     where id = v_o.hook_id;
  end if;
end;
$$;

ALTER FUNCTION public.addon_settle(p_id bigint, p_ok boolean, p_status integer, p_error text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.alter_ego_is_flat() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  n integer;
begin
  if new.alter_ego_of is null then
    return new;
  end if;
  if new.alter_ego_of = new.id then
    raise exception 'A character cannot be its own alter ego.';
  end if;
  if exists (
    select 1 from public.characters c
    where c.id = new.alter_ego_of and c.alter_ego_of is not null
  ) then
    raise exception 'That character is already an alter ego. Link to the primary instead.';
  end if;

  -- Excluding this row so an UPDATE that merely re-points an existing alter does not count itself
  -- and fail at the boundary.
  select count(*) into n
  from public.characters c
  where c.alter_ego_of = new.alter_ego_of and c.id <> new.id;
  if n >= 10 then
    raise exception 'A character can have at most 10 alter egos.';
  end if;

  return new;
end;
$$;

ALTER FUNCTION public.alter_ego_is_flat() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.ask_campaign_search(p_campaign uuid, p_terms text[], p_limit integer DEFAULT 24, p_recent integer DEFAULT 0) RETURNS TABLE(kind text, id uuid, title text, snippet text, session_id uuid, session_number integer, track_id uuid, t_seconds numeric, rank real)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
#variable_conflict use_column
declare
  v_terms text[];
  v_q tsquery;
  v_lim int := greatest(1, least(coalesce(p_limit, 24), 60));
  v_each int;
  v_hl text := 'StartSel="",StopSel="",MaxWords=45,MinWords=20,MaxFragments=2,FragmentDelimiter=" ... "';
begin
  if not public.is_campaign_gm(p_campaign) then
    raise exception 'not a GM of this campaign' using errcode = '42501';
  end if;

  -- Keep letters and digits only (any script), lower case, 2 to 40 characters, at most 12 terms.
  select array_agg(distinct t) into v_terms
  from (
    select left(lower(regexp_replace(x, '[^[:alnum:]]+', '', 'g')), 40) as t
    from unnest(coalesce(p_terms, '{}'::text[])) as x
  ) s
  where length(t) >= 2;
  v_terms := v_terms[1:12];

  if v_terms is not null and cardinality(v_terms) > 0 then
    v_q := to_tsquery('simple', array_to_string(array(select t || ':*' from unnest(v_terms) as t), ' | '));
  end if;

  -- Each source may fill up to half the limit, so a chatty transcript cannot crowd out the Codex.
  v_each := greatest(4, v_lim / 2);

  return query
  with hits as (
    (
      select 'transcript'::text as kind, s.id,
        coalesce(ch.name, case when s.gm_identity_id is not null then 'GM' end) as title,
        (
          select left(string_agg(coalesce(c2.name, case when n.gm_identity_id is not null then 'GM' end, '?') || ': ' || n.text, E'\n' order by n.start_ms, n.id), 900)
          from public.transcript_segments n
          left join public.characters c2 on c2.id = n.character_id
          where n.job_id = s.job_id
            and n.start_ms between s.start_ms - 20000 and s.start_ms + 25000
        ) as snippet,
        se.id as session_id, se.session_number, s.track_id,
        round(s.start_ms / 1000.0, 1) as t_seconds,
        ts_rank(to_tsvector('simple'::regconfig, coalesce(s.text, '')), v_q) as rank
      from public.transcript_segments s
      left join public.characters ch on ch.id = s.character_id
      left join public.capture_jobs j on j.id = s.job_id
      left join public.sessions se on se.id = j.session_id
      where v_q is not null
        and s.campaign_id = p_campaign
        and to_tsvector('simple'::regconfig, coalesce(s.text, '')) @@ v_q
      order by rank desc, s.start_ms
      limit v_each
    )
    union all
    (
      select 'event'::text, e.id,
        coalesce(k.label, e.kind, 'Story beat'),
        left(concat_ws(E'\n', e.summary, nullif(e.detail, ''), case when coalesce(e.quote, '') <> '' then '"' || e.quote || '"' end), 900),
        se.id, se.session_number, e.audio_track_id, e.t_start_seconds,
        ts_rank(to_tsvector('simple'::regconfig, coalesce(e.summary, '') || ' ' || coalesce(e.detail, '') || ' ' || coalesce(e.quote, '') || ' ' || coalesce(e.npc_name, '') || ' ' || coalesce(e.location_name, '') || ' ' || coalesce(e.faction_name, '')), v_q)
      from public.gm_events e
      left join public.gm_event_kinds k on k.kind = e.kind
      left join public.sessions se on se.id = e.session_id
      where v_q is not null
        and e.campaign_id = p_campaign
        and to_tsvector('simple'::regconfig, coalesce(e.summary, '') || ' ' || coalesce(e.detail, '') || ' ' || coalesce(e.quote, '') || ' ' || coalesce(e.npc_name, '') || ' ' || coalesce(e.location_name, '') || ' ' || coalesce(e.faction_name, '')) @@ v_q
      order by 9 desc
      limit v_each
    )
    union all
    (
      select 'entry'::text, en.id, en.title,
        ts_headline('simple', coalesce(en.summary, '') || ' ' || coalesce(en.body, ''), v_q, v_hl),
        null::uuid, null::int, null::uuid, null::numeric,
        (ts_rank(to_tsvector('simple'::regconfig, coalesce(en.title, '') || ' ' || coalesce(en.summary, '') || ' ' || coalesce(en.body, '')), v_q) * 1.5)::real
      from public.entries en
      where v_q is not null
        and en.campaign_id = p_campaign
        and to_tsvector('simple'::regconfig, coalesce(en.title, '') || ' ' || coalesce(en.summary, '') || ' ' || coalesce(en.body, '')) @@ v_q
      order by 9 desc
      limit v_each
    )
    union all
    (
      select 'character'::text, c.id, c.name,
        left(concat_ws(E'\n', nullif(concat_ws(' ', c.species, c.class), ''), nullif(c.summary, ''), nullif(c.description, '')), 700),
        null::uuid, null::int, null::uuid, null::numeric,
        (ts_rank(to_tsvector('simple'::regconfig, coalesce(c.name, '') || ' ' || coalesce(c.summary, '') || ' ' || coalesce(c.description, '')), v_q) * 1.5)::real
      from public.characters c
      where v_q is not null
        and c.campaign_id = p_campaign
        and c.alter_ego_of is null
        and to_tsvector('simple'::regconfig, coalesce(c.name, '') || ' ' || coalesce(c.summary, '') || ' ' || coalesce(c.description, '')) @@ v_q
      order by 9 desc
      limit v_each
    )
    union all
    (
      select 'recap'::text, se.id, 'Session ' || coalesce(se.session_number::text, '?'),
        ts_headline('simple', coalesce(se.recap, '') || ' ' || coalesce(se.notes, ''), v_q, v_hl),
        se.id, se.session_number, null::uuid, null::numeric,
        ts_rank(to_tsvector('simple'::regconfig, coalesce(se.recap, '') || ' ' || coalesce(se.notes, '')), v_q)
      from public.sessions se
      where v_q is not null
        and se.campaign_id = p_campaign
        and to_tsvector('simple'::regconfig, coalesce(se.recap, '') || ' ' || coalesce(se.notes, '')) @@ v_q
      order by 9 desc
      limit v_each
    )
  ),
  recent as (
    select 'recap'::text as kind, se.id, 'Session ' || coalesce(se.session_number::text, '?') as title,
      left(se.recap, 1500) as snippet,
      se.id as session_id, se.session_number, null::uuid as track_id, null::numeric as t_seconds,
      0::real as rank
    from public.sessions se
    where coalesce(p_recent, 0) > 0
      and se.campaign_id = p_campaign
      and coalesce(se.recap, '') <> ''
      and se.id not in (select h.id from hits h where h.kind = 'recap')
    order by se.session_number desc nulls last, se.created_at desc
    limit least(greatest(coalesce(p_recent, 0), 0), 4)
  )
  select * from (
    select * from (select * from hits order by rank desc limit v_lim) top
    union all
    select * from recent
  ) z
  order by z.rank desc, z.session_number desc nulls last;
end;
$$;

ALTER FUNCTION public.ask_campaign_search(p_campaign uuid, p_terms text[], p_limit integer, p_recent integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.assign_response_to_character(p_response uuid, p_character uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_campaign uuid; v_resp uuid;
begin
  select campaign_id, respondent_id into v_campaign, v_resp
  from public.tpdi_responses where id = p_response;
  if v_campaign is null then raise exception 'response not found or not tied to a campaign'; end if;
  if not public.is_campaign_gm(v_campaign) then raise exception 'not permitted'; end if;
  if not exists (
    select 1 from public.characters
    where id = p_character and campaign_id = v_campaign and kind = 'pc'
  ) then
    raise exception 'character is not a PC in this campaign';
  end if;

  -- one inventory per character: clear any prior binding on this PC
  update public.tpdi_responses set assigned_character_id = null
    where assigned_character_id = p_character and id <> p_response;

  update public.tpdi_responses set assigned_character_id = p_character where id = p_response;
  update public.characters set profile_id = v_resp where id = p_character;
end; $$;

ALTER FUNCTION public.assign_response_to_character(p_response uuid, p_character uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.audio_tracks_usage() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_session uuid;
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    select j.session_id into v_session from public.capture_jobs j where j.id = new.job_id;
    insert into public.usage_events (campaign_id, session_id, kind, provider, model, route, audio_seconds)
    values (new.campaign_id, v_session, 'transcription',
            case when new.kind = 'room' then 'room' else 'speaker' end, null, 'audio_tracks', new.duration_seconds);
  end if;
  return new;
end $$;

ALTER FUNCTION public.audio_tracks_usage() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.bump_arc_on_touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  update public.arcs
     set last_touched_session_id = coalesce(new.session_id, last_touched_session_id),
         status = case when status = 'open' then 'progressing' else status end,
         updated_at = now()
   where id = new.arc_id;
  return new;
end; $$;

ALTER FUNCTION public.bump_arc_on_touch() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.calendar_feed(p_token uuid) RETURNS TABLE(session_id uuid, campaign_id uuid, campaign_name text, session_number integer, scheduled_at timestamp with time zone, status text, is_gm boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with me as (select profile_id from public.calendar_feeds where token = p_token),
  mine as (
    select c.id, c.name, public.campaign_gm_of(c.id, (select profile_id from me)) as is_gm
      from public.campaigns c
     where c.deleted_at is null
       and (public.campaign_gm_of(c.id, (select profile_id from me))
            or exists (select 1 from public.characters ch
                        where ch.campaign_id = c.id and ch.profile_id = (select profile_id from me)
                          and ch.kind = 'pc' and coalesce(ch.active, true)))
  )
  select s.id, m.id, m.name, s.session_number, s.scheduled_at, s.status, m.is_gm
    from mine m join public.sessions s on s.campaign_id = m.id
   where exists (select 1 from me)
     and s.scheduled_at is not null
     and s.scheduled_at > now() - interval '30 days'
     and s.status in ('scheduled', 'live')
   order by s.scheduled_at
   limit 500;
$$;

ALTER FUNCTION public.calendar_feed(p_token uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.campaign_event_counts(p_campaign uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.is_campaign_gm(p_campaign) then raise exception 'not permitted'; end if;
  return coalesce((select jsonb_object_agg(character_id, n)
                     from (select character_id, count(*) as n from public.events
                            where campaign_id = p_campaign and character_id is not null group by character_id) c), '{}'::jsonb);
end;
$$;

ALTER FUNCTION public.campaign_event_counts(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.campaign_gm_ids(p_campaign uuid) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(array_agg(distinct x), '{}') from (
    select c.gm_id as x from public.campaigns c where c.id = p_campaign
    union
    select m.profile_id from public.memberships m
     where m.campaign_id = p_campaign and m.role in ('gm', 'co-gm') and m.active) g
  where x is not null;
$$;

ALTER FUNCTION public.campaign_gm_ids(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.campaign_gm_of(p_campaign uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p_uid is not null and (
    exists (select 1 from public.campaigns c where c.id = p_campaign and c.gm_id = p_uid)
    or exists (select 1 from public.memberships m
                where m.campaign_id = p_campaign and m.profile_id = p_uid
                  and m.role in ('gm', 'co-gm') and m.active));
$$;

ALTER FUNCTION public.campaign_gm_of(p_campaign uuid, p_uid uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.campaign_gms(p_campaign uuid) RETURNS TABLE(profile_id uuid, display_name text, role text, since timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select * from (
    select c.gm_id as profile_id, coalesce(p.display_name, 'GM') as display_name, 'owner'::text as role, c.created_at as since
      from public.campaigns c left join public.profiles p on p.id = c.gm_id
     where c.id = p_campaign
    union all
    select m.profile_id, coalesce(p.display_name, 'Co-GM'), 'co-gm'::text, m.joined_at
      from public.memberships m
      join public.campaigns c on c.id = m.campaign_id
      left join public.profiles p on p.id = m.profile_id
     where m.campaign_id = p_campaign and m.role in ('gm', 'co-gm') and m.active and m.profile_id <> c.gm_id
  ) g
  where public.is_campaign_member(p_campaign) or public.is_campaign_gm(p_campaign)
  order by (g.role = 'owner') desc, g.since;
$$;

ALTER FUNCTION public.campaign_gms(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.campaign_player_ids(p_campaign uuid) RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(array_agg(distinct ch.profile_id), '{}')
    from public.characters ch
   where ch.campaign_id = p_campaign and ch.kind = 'pc' and coalesce(ch.active, true)
     and ch.profile_id is not null
     and not (ch.profile_id = any (public.campaign_gm_ids(p_campaign)));
$$;

ALTER FUNCTION public.campaign_player_ids(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.campaign_transfer_info(p_token text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
           'campaignName', c.name,
           'fromName', coalesce(nullif(p.display_name, ''), 'Your GM'),
           'forYou', t.to_email = (select lower(u.email) from auth.users u where u.id = auth.uid()),
           'state', case
             when t.accepted_at is not null then 'accepted'
             when t.cancelled_at is not null then 'cancelled'
             when t.expires_at <= now() then 'expired'
             when c.deleted_at is not null then 'trashed'
             else 'open' end)
    from public.campaign_transfers t
    join public.campaigns c on c.id = t.campaign_id
    left join public.profiles p on p.id = t.from_id
   where t.token = p_token and auth.uid() is not null;
$$;

ALTER FUNCTION public.campaign_transfer_info(p_token text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.campaign_usage_summary(p_campaign uuid, p_since timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v jsonb;
begin
  if not public.is_campaign_gm(p_campaign) then raise exception 'not permitted'; end if;
  select jsonb_build_object(
    'rows', count(*),
    'aiCalls', count(*) filter (where kind = 'ai'),
    'tokensIn', coalesce(sum(input_tokens) filter (where kind in ('ai', 'image')), 0),
    'tokensOut', coalesce(sum(output_tokens) filter (where kind in ('ai', 'image')), 0),
    'images', coalesce(sum(coalesce(images, 1)) filter (where kind = 'image'), 0),
    'minutes', coalesce(sum(audio_seconds) filter (where kind = 'transcription'), 0) / 60.0,
    'speakerMinutes', coalesce(sum(audio_seconds) filter (where kind = 'transcription' and coalesce(provider, 'speaker') <> 'room'), 0) / 60.0,
    'roomMinutes', coalesce(sum(audio_seconds) filter (where kind = 'transcription' and provider = 'room'), 0) / 60.0,
    'sessions', count(distinct session_id) filter (where kind = 'transcription'),
    'roomSessions', count(distinct session_id) filter (where kind = 'transcription' and provider = 'room'))
    into v
    from public.usage_events
   where campaign_id = p_campaign and created_at >= p_since;
  return v || jsonb_build_object('byRoute', coalesce((
    select jsonb_agg(jsonb_build_array(route, n) order by n desc)
      from (select route, count(*) as n from public.usage_events
             where campaign_id = p_campaign and created_at >= p_since and kind <> 'transcription' and route is not null
             group by route) r), '[]'::jsonb));
end;
$$;

ALTER FUNCTION public.campaign_usage_summary(p_campaign uuid, p_since timestamp with time zone) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.campaigns_owner_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  if current_user in ('anon', 'authenticated') and old.gm_id is distinct from auth.uid()
     and (new.gm_id is distinct from old.gm_id or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'only the campaign''s owner can do that';
  end if;
  return new;
end;
$$;

ALTER FUNCTION public.campaigns_owner_guard() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.can_write_character_portrait(p_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
  select case
    when p_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then false
    else exists (
      select 1
      from public.characters c
      left join public.campaigns g on g.id = c.campaign_id
      where c.id = p_id::uuid
        and (c.profile_id = auth.uid() or (g.id is not null and public.is_campaign_gm(g.id)))
    )
  end;
$_$;

ALTER FUNCTION public.can_write_character_portrait(p_id text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.can_write_statblock_portrait(p_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
  select case
    when p_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then false
    else exists (
      select 1 from public.stat_blocks s
      where s.id = p_id::uuid and s.gm_id = auth.uid()
    )
  end;
$_$;

ALTER FUNCTION public.can_write_statblock_portrait(p_id text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.cancel_campaign_transfer(p_campaign uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (select 1 from public.campaigns where id = p_campaign and gm_id = auth.uid()) then
    raise exception 'only the campaign''s GM can cancel a handover';
  end if;
  update public.campaign_transfers set cancelled_at = now()
   where campaign_id = p_campaign and accepted_at is null and cancelled_at is null;
end;
$$;

ALTER FUNCTION public.cancel_campaign_transfer(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.character_campaign_public(p_character uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object('public_slug', c.public_slug, 'public_published_at', c.public_published_at)
    from public.characters ch
    join public.campaigns c on c.id = ch.campaign_id and c.deleted_at is null
   where ch.id = p_character
     and (ch.profile_id = auth.uid() or public.is_campaign_gm(c.id))
   limit 1;
$$;

ALTER FUNCTION public.character_campaign_public(p_character uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.character_identities_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

ALTER FUNCTION public.character_identities_touch_updated_at() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.character_wiki_fill() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  select ch.campaign_id, ch.profile_id
    into new.campaign_id, new.owner_id
  from public.characters ch
  where ch.id = new.character_id;
  new.updated_at := now();
  return new;
end;
$$;

ALTER FUNCTION public.character_wiki_fill() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.character_wiki_grant_fill() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  select ch.campaign_id into new.campaign_id from public.characters ch where ch.id = new.character_id;
  return new;
end;
$$;

ALTER FUNCTION public.character_wiki_grant_fill() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.chat_context(code text) RETURNS TABLE(campaign_name text, locked boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select c.name, public.chat_locked(code)
  from public.campaigns c where c.share_code = code limit 1;
$$;

ALTER FUNCTION public.chat_context(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.chat_fetch(code text) RETURNS TABLE(id uuid, author_profile uuid, display_name text, body text, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select m.id, m.author_profile, m.display_name, m.body, m.created_at
  from public.chat_messages m
  join public.campaigns c on c.id = m.campaign_id
  where c.share_code = code and not public.chat_locked(code)
  order by m.created_at asc;
$$;

ALTER FUNCTION public.chat_fetch(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.chat_grant(code text, p_from timestamp with time zone, p_to timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_campaign uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select id into v_campaign from public.campaigns where share_code = code limit 1;
  if v_campaign is null then raise exception 'invalid link'; end if;
  insert into public.chat_grants (campaign_id, player_profile, from_ts, to_ts)
    values (v_campaign, v_uid, p_from, p_to);
end; $$;

ALTER FUNCTION public.chat_grant(code text, p_from timestamp with time zone, p_to timestamp with time zone) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.chat_grant_revoke(grant_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  delete from public.chat_grants where id = grant_id and player_profile = auth.uid();
$$;

ALTER FUNCTION public.chat_grant_revoke(grant_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.chat_grants_mine(code text) RETURNS TABLE(id uuid, from_ts timestamp with time zone, to_ts timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select g.id, g.from_ts, g.to_ts
  from public.chat_grants g
  join public.campaigns c on c.id = g.campaign_id
  where c.share_code = code and g.player_profile = auth.uid()
  order by g.created_at desc;
$$;

ALTER FUNCTION public.chat_grants_mine(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.chat_locked(code text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  -- Party chat now stays open during live sessions.
  -- (Was: select exists (select 1 from campaigns c join sessions s on s.campaign_id = c.id
  --        where c.share_code = code and s.status = 'live');)
  select false;
$$;

ALTER FUNCTION public.chat_locked(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.chat_post(code text, p_body text, p_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_campaign uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_body),'') = '' then return; end if;
  select id into v_campaign from public.campaigns where share_code = code limit 1;
  if v_campaign is null then raise exception 'invalid link'; end if;
  if public.chat_locked(code) then raise exception 'chat is closed during a live session'; end if;
  insert into public.chat_messages (campaign_id, author_profile, display_name, body)
    values (v_campaign, v_uid, nullif(trim(p_name), ''), trim(p_body));
end; $$;

ALTER FUNCTION public.chat_post(code text, p_body text, p_name text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.claim_by_discord() RETURNS TABLE(out_share_code text, out_character_id uuid, out_character_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid       uuid := auth.uid();
  v_discord   text;
  v_char      record;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- The caller's Discord id, read from their OWN identity row. A caller cannot pass this
  -- in, so they can only claim characters bound to the Discord account they authenticated
  -- with. provider_id is the snowflake the bot also wrote to characters.discord_user_id.
  select i.provider_id
    into v_discord
  from auth.identities i
  where i.user_id = v_uid
    and i.provider = 'discord'
  limit 1;

  if v_discord is null then
    raise exception 'not signed in with discord';
  end if;

  -- Every PC bound to this Discord id, whoever currently owns it. Full transfer: an
  -- existing owner that is not this caller is re-pointed below.
  for v_char in
    select c.id, c.campaign_id, c.profile_id as old_owner
    from public.characters c
    where c.discord_user_id = v_discord
      and c.kind = 'pc'
  loop
    -- p135 (audit B4): never take a character from a real player. Transfer only from nobody, this caller,
    -- a guest account, the campaign's GM (a placeholder owner), or another account signed in with this
    -- same Discord id. Anything else is skipped: the GM sorts it out.
    if v_char.old_owner is not null and v_char.old_owner <> v_uid
       and not public.discord_claim_allowed(v_char.old_owner, v_char.campaign_id, v_discord) then
      continue;
    end if;

    -- Move the character.
    update public.characters
       set profile_id = v_uid
     where id = v_char.id;

    -- Move the history that is keyed on the PRIOR owner, so a transfer does not strand the
    -- player's own self-reports or disposition rows on an identity they no longer use.
    -- Only runs when there was a different prior owner; a first claim has none.
    -- p135: a GM's own rows (their dispositions and reveals) stay with the GM.
    if v_char.old_owner is not null and v_char.old_owner <> v_uid
       and not exists (select 1 from public.campaigns cg where cg.id = v_char.campaign_id and cg.gm_id = v_char.old_owner) then
      update public.tpdi_responses
         set respondent_id = v_uid
       where respondent_id = v_char.old_owner
         and campaign_id = v_char.campaign_id;

      update public.dispositions d
         set profile_id = v_uid
       where d.profile_id = v_char.old_owner
         and (d.character_id = v_char.id or d.scope = 'player');

      -- p143 (audit B6): a reveal is one row per profile. Move the old owner's reveal for this campaign
      -- only when the caller has none; when the caller already has one, theirs stands and the old
      -- owner's is left as it is. Moving onto an existing row broke the unique key and failed the claim.
      if not exists (select 1 from public.disposition_reveals where profile_id = v_uid) then
        update public.disposition_reveals
           set profile_id = v_uid
         where profile_id = v_char.old_owner
           and campaign_id = v_char.campaign_id;
      end if;
    end if;

    -- Back-assign TPDI responses this caller filled in before they had a character here,
    -- matching claim_character_invite's behaviour.
    update public.tpdi_responses
       set assigned_character_id = v_char.id
     where respondent_id = v_uid
       and campaign_id = v_char.campaign_id
       and assigned_character_id is null;
  end loop;

  -- Return everything now owned by this caller that matches the Discord id, so the page can
  -- route them (typically to the first, or a chooser if several).
  return query
    select cm.share_code, c.id, c.name
    from public.characters c
    join public.campaigns cm on cm.id = c.campaign_id
    where c.discord_user_id = v_discord
      and c.kind = 'pc'
      and c.profile_id = v_uid
    order by cm.share_code, c.name;
  -- Output columns are out_share_code / out_character_id / out_character_name; the select
  -- list maps to them positionally, so no table column can shadow an output name again.
end;
$$;

ALTER FUNCTION public.claim_by_discord() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.claim_character_invite(p_code text) RETURNS TABLE(campaign_share_code text, character_id uuid, character_name text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_char     uuid;
  v_campaign uuid;
  v_owner    uuid;
  v_uid      uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select c.id, c.campaign_id, c.profile_id
    into v_char, v_campaign, v_owner
  from public.characters c
  where c.invite_code = p_code and c.kind = 'pc';

  if v_char is null then
    raise exception 'invalid invite';
  end if;

  -- The fix.
  if v_owner is not null and v_owner <> v_uid then
    raise exception 'this character has already been claimed by another player';
  end if;

  update public.characters
     set profile_id = v_uid
   where id = v_char;

  -- Back-assign any TPDI responses this person filled in for this campaign before
  -- they had a character. Unchanged from the original.
  update public.tpdi_responses
     set assigned_character_id = v_char
   where respondent_id = v_uid
     and campaign_id = v_campaign
     and assigned_character_id is null;

  return query
    select cm.share_code, v_char, ch.name
    from public.campaigns cm, public.characters ch
    where cm.id = v_campaign and ch.id = v_char;
end;
$$;

ALTER FUNCTION public.claim_character_invite(p_code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.codex_for_campaign(p_campaign uuid) RETURNS TABLE(item_kind text, item_type text, id uuid, title text, summary text, body text, blocks jsonb, tags text[], image_url text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with me as (
    -- The gate AND the reveal target, in one: you must own a PC here to see anything, and reveals
    -- are addressed to that PC.
    select ch.id
    from public.characters ch
    where ch.campaign_id = p_campaign
      and ch.kind = 'pc'
      and ch.profile_id = auth.uid()
    limit 1
  ),
  revealed as (
    select er.target_type, er.target_id
    from public.entry_reveals er, me
    where er.revealed_to_character_id = me.id
  )
  select 'entry'::text, e.type, e.id, e.title, e.summary, e.body, e.blocks, e.tags, e.image_url
  from public.entries e
  where exists (select 1 from me)
    and e.campaign_id = p_campaign
    and (e.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type = 'entry' and r.target_id = e.id))
  union all
  select 'npc'::text, 'npc'::text, ch.id, ch.name, null::text, ch.description, null::jsonb, ch.tags, ch.portrait_url
  from public.characters ch
  where exists (select 1 from me)
    and ch.campaign_id = p_campaign
    and ch.kind = 'npc'
    and (ch.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type = 'character' and r.target_id = ch.id));
$$;

ALTER FUNCTION public.codex_for_campaign(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.codex_for_player(p_share text) RETURNS TABLE(item_kind text, item_type text, id uuid, title text, body text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with camp as (select id from public.campaigns where share_code = p_share),
  me as (
    select ch.id from public.characters ch, camp
    where ch.campaign_id = camp.id and ch.kind = 'pc' and ch.profile_id = auth.uid() limit 1
  ),
  revealed as (
    select er.target_type, er.target_id from public.entry_reveals er, me
    where er.revealed_to_character_id = me.id
  )
  select 'entry'::text, e.type, e.id, e.title, e.body
  from public.entries e, camp
  where e.campaign_id = camp.id
    and (e.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type='entry' and r.target_id=e.id))
  union all
  select 'npc'::text, 'npc'::text, ch.id, ch.name, ch.description
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'npc'
    and (ch.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type='character' and r.target_id=ch.id));
$$;

ALTER FUNCTION public.codex_for_player(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_act(p_combat uuid, p_target text, p_action text, p_value integer DEFAULT NULL::integer, p_condition text DEFAULT NULL::text, p_ac integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_uid   uuid := auth.uid();
  v_cb    public.combats;
  v_gm    boolean;
  v_c     jsonb;
  v_ord   bigint;
  v_mine  boolean;
  v_turn  boolean;
  v_hp    integer;
  v_max   integer;
  v_temp  integer;
  v_n     integer;
  v_conds jsonb;
  v_e     jsonb;
  v_last  jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_cb from public.combats where id = p_combat for update;
  if v_cb.id is null then raise exception 'fight not found'; end if;
  if v_cb.status <> 'active' then raise exception 'that fight is over'; end if;
  v_gm := public.is_campaign_gm(v_cb.campaign_id);
  if not v_gm and not public.tabletop_is_player(v_cb.campaign_id) then raise exception 'not at this table'; end if;

  select e.c, e.ord into v_c, v_ord
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where e.c ->> 'id' = p_target
   limit 1;
  if v_c is null then raise exception 'no such combatant'; end if;

  v_mine := (v_c ->> 'kind') = 'pc'
            and coalesce(v_c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
            and exists (select 1 from public.characters ch where ch.id = (v_c ->> 'characterId')::uuid and ch.profile_id = v_uid);
  v_turn := v_ord - 1 = v_cb.turn;

  if not v_gm then
    if coalesce((v_c ->> 'hidden')::boolean, false) then raise exception 'no such combatant'; end if;
    -- the turn gate: affecting anyone else needs your own character to hold the turn
    if not v_mine and not exists (
      select 1 from jsonb_array_elements(v_cb.combatants) with ordinality as t(c, ord)
       where t.ord - 1 = v_cb.turn and (t.c ->> 'kind') = 'pc'
         and coalesce(t.c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
         and exists (select 1 from public.characters ch where ch.id = (t.c ->> 'characterId')::uuid and ch.profile_id = v_uid)
    ) then
      raise exception 'it is not your turn';
    end if;
    if p_action in ('add_condition', 'remove_condition') then
      null;                                   -- anyone the players can see, on your turn
    elsif p_action in ('damage', 'heal', 'temp', 'sync_sheet', 'set_speed', 'set_attacks') and v_mine then
      null;                                   -- their own character
    elsif p_action in ('spend', 'undo', 'move') and v_mine then
      if not v_turn and not (p_action = 'spend' and p_condition = 'reaction') then
        raise exception 'it is not your turn';
      end if;
    else
      raise exception 'only the GM can do that';
    end if;
  end if;

  v_hp := case when jsonb_typeof(v_c -> 'hp') = 'number' then (v_c ->> 'hp')::numeric::integer end;
  v_max := case when jsonb_typeof(v_c -> 'maxHp') = 'number' then (v_c ->> 'maxHp')::numeric::integer end;
  v_temp := coalesce(case when jsonb_typeof(v_c -> 'tempHp') = 'number' then (v_c ->> 'tempHp')::numeric::integer end, 0);
  v_conds := case when jsonb_typeof(v_c -> 'conditions') = 'array' then v_c -> 'conditions' else '[]'::jsonb end;

  if p_action = 'damage' then
    v_n := greatest(0, coalesce(p_value, 0));
    if v_n > 9999 then raise exception 'that is too much damage for one hit'; end if;
    v_c := public.combat_hurt(v_c, v_n);
  elsif p_action = 'heal' then
    v_n := greatest(0, coalesce(p_value, 0));
    if v_n > 9999 then raise exception 'that is too much healing at once'; end if;
    if v_hp is not null then
      v_hp := case when v_max is null then v_hp + v_n else least(v_max, v_hp + v_n) end;
      v_c := v_c || jsonb_build_object('hp', v_hp);
      if v_hp > 0 then v_c := v_c || jsonb_build_object('defeated', false); end if;
    end if;
  elsif p_action = 'temp' then
    v_c := v_c || jsonb_build_object('tempHp', least(9999, greatest(0, coalesce(p_value, 0))));
  elsif p_action = 'sync_sheet' then
    if p_value is not null and p_value between 1 and 9999 and v_max is null then
      v_c := v_c || jsonb_build_object('maxHp', p_value);
      if v_hp is null then v_c := v_c || jsonb_build_object('hp', p_value); end if;
    end if;
    if p_ac is not null and p_ac between 1 and 60 and jsonb_typeof(v_c -> 'ac') is distinct from 'number' then
      v_c := v_c || jsonb_build_object('ac', p_ac);
    end if;
  elsif p_action = 'add_condition' then
    if p_condition is null or not (p_condition = any (public.combat_markers())) then raise exception 'not a condition the table knows'; end if;
    if not (v_conds ? p_condition) then v_c := v_c || jsonb_build_object('conditions', v_conds || to_jsonb(p_condition)); end if;
  elsif p_action = 'remove_condition' then
    v_c := v_c || jsonb_build_object('conditions', coalesce((select jsonb_agg(x) from jsonb_array_elements(v_conds) x where x <> to_jsonb(p_condition)), '[]'::jsonb));
  elsif p_action = 'spend' then
    v_c := public.combat_spend(v_c, coalesce(p_condition, ''), p_note, v_gm);
  elsif p_action = 'move' then
    v_c := public.combat_move(v_c, coalesce(p_value, 0), v_gm);
  elsif p_action = 'undo' then
    v_e := public.combat_econ(v_c);
    v_last := v_e -> 'log' -> -1;
    if v_last is null then raise exception 'nothing to undo this turn'; end if;
    if not v_gm and coalesce((v_last ->> 'locked')::boolean, false) then raise exception 'that already happened at the table; ask the GM to undo it'; end if;
    v_c := v_c || jsonb_build_object('econ', (public.combat_fresh_econ() || coalesce(v_last -> 'prev', '{}'::jsonb))
             || jsonb_build_object('log', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o)
                                                    where o < jsonb_array_length(v_e -> 'log')), '[]'::jsonb)));
  elsif p_action = 'set_speed' then
    if p_value is null or p_value < 0 or p_value > 300 then raise exception 'speed must be between 0 and 300 feet'; end if;
    v_c := v_c || jsonb_build_object('speed', p_value);
  elsif p_action = 'set_attacks' then
    if p_value is null or p_value < 1 or p_value > 8 then raise exception 'attacks per action must be between 1 and 8'; end if;
    v_c := v_c || jsonb_build_object('attacksPerAction', p_value);
  else
    raise exception 'unknown action';
  end if;

  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_ord then v_c else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = p_combat;
end;
$_$;

ALTER FUNCTION public.combat_act(p_combat uuid, p_target text, p_action text, p_value integer, p_condition text, p_ac integer, p_note text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_apply_outside_roll(p_combat uuid, p_target text, p_events uuid[], p_half boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
   where e.id = any(p_events) and e.campaign_id = v_cb.campaign_id and e.source in ('beyond20', 'foundry', 'roll20');
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
$_$;

ALTER FUNCTION public.combat_apply_outside_roll(p_combat uuid, p_target text, p_events uuid[], p_half boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_attack_damage(p_campaign uuid, p_character uuid, p_target text, p_amount integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cb    public.combats;
  v_aord  bigint;
  v_att   jsonb;
  v_tord  bigint;
  v_tgt   jsonb;
  v_la    jsonb;
  v_hp    integer;
  v_temp  integer;
  v_n     integer := greatest(0, least(9999, coalesce(p_amount, 0)));
begin
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  v_la := v_att -> 'lastAttack';
  if v_att is null or v_la is null or v_la ->> 'target' <> p_target or (v_la ->> 'hit') is distinct from 'true'
     or coalesce((v_la ->> 'applied')::boolean, false) or extract(epoch from now()) - (v_la ->> 'at')::numeric > 180 then
    raise exception 'roll a hit on them first';
  end if;
  select e.c, e.ord into v_tgt, v_tord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord) where e.c ->> 'id' = p_target limit 1;
  if v_tgt is null then raise exception 'no such combatant'; end if;
  v_hp := case when jsonb_typeof(v_tgt -> 'hp') = 'number' then (v_tgt ->> 'hp')::numeric::integer end;
  v_temp := coalesce(case when jsonb_typeof(v_tgt -> 'tempHp') = 'number' then (v_tgt ->> 'tempHp')::numeric::integer end, 0);
  v_tgt := v_tgt || jsonb_build_object('tempHp', v_temp - least(v_temp, v_n));
  if v_hp is not null then
    v_hp := greatest(0, v_hp - (v_n - least(v_temp, v_n)));
    v_tgt := v_tgt || jsonb_build_object('hp', v_hp);
    if v_hp = 0 and (v_tgt ->> 'kind') = 'monster' then v_tgt := v_tgt || jsonb_build_object('defeated', true); end if;
  end if;
  v_att := v_att || jsonb_build_object('lastAttack', v_la || jsonb_build_object('applied', true, 'damage', v_n));
  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_aord then v_att when e.ord = v_tord then v_tgt else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = v_cb.id;
  return jsonb_build_object('applied', true, 'target', v_tgt ->> 'name', 'defeated', coalesce((v_tgt ->> 'defeated')::boolean, false));
end;
$$;

ALTER FUNCTION public.combat_attack_damage(p_campaign uuid, p_character uuid, p_target text, p_amount integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_attack_resolve(p_campaign uuid, p_character uuid, p_target text, p_total integer, p_natural integer, p_label text, p_gm boolean, p_cost text DEFAULT 'attack'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cb    public.combats;
  v_aord  bigint;
  v_att   jsonb;
  v_tgt   jsonb;
  v_ac    integer;
  v_hit   boolean;
  v_crit  boolean := coalesce(p_natural, 0) = 20;
  v_cost  text := coalesce(p_cost, 'attack');
  v_e     jsonb;
  v_last  jsonb;
  v_stem  text := split_part(coalesce(nullif(p_label, ''), 'Attack'), ' (', 1);
  v_n     integer;
begin
  if v_cost not in ('attack', 'action', 'bonus', 'reaction', 'free', 'followup') or (v_cost = 'free' and not p_gm) then raise exception 'unknown cost'; end if;
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_att is null then raise exception 'your character is not in the fight'; end if;
  if not p_gm and v_cost <> 'reaction' and v_aord - 1 <> v_cb.turn then raise exception 'it is not your turn'; end if;
  -- a follow-up: another attack from the same casting (Eldritch Blast's beams, Scorching Ray's rays).
  -- Allowed when the attacker's last spend was that same spell within the last 90 seconds, up to ten
  -- in a row; it spends nothing more and is logged.
  if v_cost = 'followup' then
    v_e := public.combat_econ(v_att);
    v_last := v_e -> 'log' -> -1;
    if v_last is null or split_part(v_last ->> 'what', ' (', 1) <> v_stem
       or extract(epoch from now()) - coalesce((v_last ->> 'at')::numeric, 0) > 90 then
      raise exception 'cast the spell first';
    end if;
    select count(*) into v_n from jsonb_array_elements(v_e -> 'log') l where split_part(l ->> 'what', ' (', 1) = v_stem;
    if v_n >= 10 then raise exception 'that casting has no attacks left'; end if;
  end if;
  select e.c into v_tgt from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord) where e.c ->> 'id' = p_target limit 1;
  if v_tgt is null or (not p_gm and coalesce((v_tgt ->> 'hidden')::boolean, false)) then raise exception 'no such combatant'; end if;
  if v_tgt ->> 'id' = v_att ->> 'id' then raise exception 'pick someone else to attack'; end if;
  if v_cost = 'followup' then
    v_att := v_att || jsonb_build_object('econ', v_e || jsonb_build_object('log',
      (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (select x, o from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o) order by o desc limit 9) k)
      || jsonb_build_array(jsonb_build_object('cost', 'followup', 'what', left(coalesce(nullif(p_label, ''), 'Attack') || ' on ' || coalesce(v_tgt ->> 'name', 'a target'), 60),
                                              'at', extract(epoch from now()), 'locked', true, 'prev', v_e - 'log'))));
  else
    v_att := public.combat_lock_last(public.combat_spend(v_att, v_cost, coalesce(nullif(p_label, ''), 'Attack') || ' on ' || coalesce(v_tgt ->> 'name', 'a target'), p_gm));
  end if;
  v_ac := case when jsonb_typeof(v_tgt -> 'ac') = 'number' then (v_tgt ->> 'ac')::numeric::integer end;
  v_hit := case when coalesce(p_natural, 0) = 20 then true
                when coalesce(p_natural, 0) = 1 then false
                when v_ac is null then null
                else p_total >= v_ac end;
  v_att := v_att || jsonb_build_object('lastAttack', jsonb_build_object(
    'target', p_target, 'hit', v_hit, 'crit', v_crit and v_hit is true, 'label', left(coalesce(p_label, ''), 120),
    'at', extract(epoch from now()), 'applied', false));
  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_aord then v_att else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = v_cb.id;
  return jsonb_build_object('hit', v_hit, 'crit', v_crit and v_hit is true, 'target', v_tgt ->> 'name', 'combat', v_cb.id,
                            'attacksLeft', (public.combat_econ(v_att) ->> 'attacks')::integer);
end;
$$;

ALTER FUNCTION public.combat_attack_resolve(p_campaign uuid, p_character uuid, p_target text, p_total integer, p_natural integer, p_label text, p_gm boolean, p_cost text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_bump_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

ALTER FUNCTION public.combat_bump_version() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_calibration() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_cal   jsonb := coalesce(case when tg_op = 'UPDATE' then old.calibration end, new.calibration, '{}'::jsonb);
  v_start jsonb := coalesce(v_cal -> 'start', '{}'::jsonb);
  v_downs jsonb := coalesce(v_cal -> 'downs', '{}'::jsonb);
  e       jsonb;
  o       jsonb;
  v_id    text;
  v_lvl   integer;
  v_ends  jsonb;
begin
  -- p168 (T17): whatever goes wrong in here, the fight still saves; only the measurement is skipped
  begin
  for e in select x from jsonb_array_elements(case when jsonb_typeof(new.combatants) = 'array' then new.combatants else '[]'::jsonb end) x loop
    v_id := e ->> 'id';
    continue when v_id is null;
    -- first sight of this combatant
    if not v_start ? v_id then
      v_lvl := null;
      if e ->> 'kind' = 'pc' and coalesce(e ->> 'characterId', '') ~ '^[0-9a-f-]{36}$' then
        select ch.level into v_lvl from public.characters ch where ch.id = (e ->> 'characterId')::uuid;
      end if;
      v_start := v_start || jsonb_build_object(v_id, jsonb_build_object(
        'kind', e ->> 'kind', 'name', e ->> 'name', 'characterId', e -> 'characterId', 'level', v_lvl,
        'cr', coalesce(nullif(e -> 'block' ->> 'cr', ''), nullif(e ->> 'cr', '')), 'hp', e -> 'hp', 'maxHp', e -> 'maxHp', 'round', new.round));
    end if;
    -- a player character dropping to 0
    if tg_op = 'UPDATE' and e ->> 'kind' = 'pc' and jsonb_typeof(e -> 'hp') = 'number' and (e ->> 'hp')::numeric <= 0 then
      select x into o from jsonb_array_elements(case when jsonb_typeof(old.combatants) = 'array' then old.combatants else '[]'::jsonb end) x
       where x ->> 'id' = v_id limit 1;
      if o is not null and jsonb_typeof(o -> 'hp') = 'number' and (o ->> 'hp')::numeric > 0 then
        v_downs := v_downs || jsonb_build_object(v_id, coalesce(case when jsonb_typeof(v_downs -> v_id) = 'number' then (v_downs ->> v_id)::numeric::integer end, 0) + 1);
      end if;
    end if;
  end loop;

  v_cal := v_cal || jsonb_build_object('start', v_start, 'downs', v_downs);

  -- the fight ends: where everyone stands
  if tg_op = 'UPDATE' and new.status = 'ended' and old.status is distinct from 'ended' then
    select coalesce(jsonb_object_agg(x ->> 'id', jsonb_build_object('hp', x -> 'hp', 'maxHp', x -> 'maxHp',
             'defeated', coalesce(x -> 'defeated' = 'true'::jsonb, false))), '{}'::jsonb)
      into v_ends
      from jsonb_array_elements(case when jsonb_typeof(new.combatants) = 'array' then new.combatants else '[]'::jsonb end) x
     where x ->> 'id' is not null;
    v_cal := v_cal || jsonb_build_object('end', jsonb_build_object('round', new.round, 'at', now(), 'combatants', v_ends));
  end if;

  exception when others then
    raise warning 'combat_calibration: not measured for combat % (%)', new.id, sqlerrm;
    new.calibration := coalesce(case when tg_op = 'UPDATE' then old.calibration end, new.calibration, '{}'::jsonb);
    return new;
  end;

  new.calibration := v_cal;
  return new;
end;
$_$;

ALTER FUNCTION public.combat_calibration() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_cant_act(p_c jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select x from unnest(array['Unconscious', 'Petrified', 'Paralyzed', 'Stunned', 'Incapacitated']) x
   where jsonb_typeof(p_c -> 'conditions') = 'array' and (p_c -> 'conditions') ? x
   limit 1;
$$;

ALTER FUNCTION public.combat_cant_act(p_c jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_econ(p_c jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
  select public.combat_fresh_econ()
         || case when jsonb_typeof(p_c -> 'econ') = 'object' then p_c -> 'econ' else '{}'::jsonb end;
$$;

ALTER FUNCTION public.combat_econ(p_c jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_for_player(p_share text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with camp as (
    select id from public.campaigns where share_code = p_share limit 1
  ),
  cb as (
    select * from public.combats
    where campaign_id = (select id from camp) and status = 'active'
    order by updated_at desc
    limit 1
  )
  select case
    when (select id from cb) is null then null::jsonb
    else jsonb_build_object(
      'name',  (select name from cb),
      'round', (select round from cb),
      'order', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id',         e.c->>'id',
                 'name',       e.c->>'name',
                 'kind',       e.c->>'kind',
                 'initiative', e.c->'initiative',
                 'defeated',   coalesce((e.c->>'defeated')::boolean, false),
                 'is_turn',    (e.ord - 1) = (select turn from cb),
                 'conditions', case when e.c->>'kind' = 'pc' then coalesce(e.c->'conditions', '[]'::jsonb) else '[]'::jsonb end
               ) order by e.ord), '[]'::jsonb)
        from cb, jsonb_array_elements(cb.combatants) with ordinality as e(c, ord)
        where not coalesce((e.c->>'hidden')::boolean, false)
      )
    )
  end;
$$;

ALTER FUNCTION public.combat_for_player(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_fresh_econ() RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
  select '{"action":false,"bonus":false,"reaction":false,"moved":0,"dash":0,"attacks":0,"log":[]}'::jsonb;
$$;

ALTER FUNCTION public.combat_fresh_econ() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_hurt(p_c jsonb, p_amount integer) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_n    integer := greatest(0, least(9999, coalesce(p_amount, 0)));
  v_hp   integer := case when jsonb_typeof(p_c -> 'hp') = 'number' then (p_c ->> 'hp')::numeric::integer end;
  v_temp integer := coalesce(case when jsonb_typeof(p_c -> 'tempHp') = 'number' then (p_c ->> 'tempHp')::numeric::integer end, 0);
  v_c    jsonb := p_c;
begin
  v_c := v_c || jsonb_build_object('tempHp', v_temp - least(v_temp, v_n));
  if v_hp is not null then
    v_hp := greatest(0, v_hp - (v_n - least(v_temp, v_n)));
    v_c := v_c || jsonb_build_object('hp', v_hp);
    if v_hp = 0 and (v_c ->> 'kind') = 'monster' then v_c := v_c || jsonb_build_object('defeated', true); end if;
  end if;
  return v_c;
end;
$$;

ALTER FUNCTION public.combat_hurt(p_c jsonb, p_amount integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_lock_last(p_c jsonb) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    AS $$
  select case when jsonb_typeof(p_c -> 'econ' -> 'log') = 'array' and jsonb_array_length(p_c -> 'econ' -> 'log') > 0
              then jsonb_set(p_c, '{econ,log,-1,locked}', 'true'::jsonb) else p_c end;
$$;

ALTER FUNCTION public.combat_lock_last(p_c jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_markers() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  select array[
    'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
    'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating',
    'Blessed', 'Hasted', 'Inspired', 'Raging', 'Dodging', 'Shielded',
    'Baned', 'Slowed', 'Hexed', 'Marked', 'Outlined', 'Vulnerable'
  ]::text[];
$$;

ALTER FUNCTION public.combat_markers() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_move(p_c jsonb, p_feet integer, p_force boolean) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_e     jsonb := public.combat_econ(p_c);
  v_speed integer := public.combat_speed(p_c);
  v_moved integer := coalesce((v_e ->> 'moved')::integer, 0);
  v_left  integer;
begin
  if coalesce(p_feet, 0) <= 0 then return p_c; end if;
  if p_feet > 2000 then raise exception 'that is too far for one move'; end if;
  if not p_force and v_speed is not null then
    v_left := v_speed + coalesce((v_e ->> 'dash')::integer, 0) - v_moved;
    if v_speed = 0 and coalesce((v_e ->> 'dash')::integer, 0) = 0 then raise exception 'your speed is 0 right now'; end if;
    if p_feet > v_left then raise exception 'not enough movement left: % ft', greatest(0, v_left); end if;
  end if;
  v_e := v_e || jsonb_build_object('moved', v_moved + p_feet,
    'log', (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
              select x, o from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o) order by o desc limit 9) k)
           || jsonb_build_array(jsonb_build_object('cost', 'move', 'what', p_feet || ' ft', 'at', extract(epoch from now()), 'prev', v_e - 'log')));
  return p_c || jsonb_build_object('econ', v_e);
end;
$$;

ALTER FUNCTION public.combat_move(p_c jsonb, p_feet integer, p_force boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_request_save(p_campaign uuid, p_character uuid, p_targets text[], p_ability text, p_dc integer, p_damage integer, p_type text, p_half boolean, p_label text, p_gm boolean, p_cost text DEFAULT 'action'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cb    public.combats;
  v_att   jsonb;
  v_aord  bigint;
  v_names text[] := '{}';
  v_save  jsonb;
  v_new   jsonb;
  v_cost  text := coalesce(p_cost, 'action');
begin
  if v_cost not in ('action', 'bonus', 'reaction', 'free') or (v_cost = 'free' and not p_gm) then raise exception 'unknown cost'; end if;
  if p_ability not in ('str', 'dex', 'con', 'int', 'wis', 'cha') then raise exception 'pick an ability for the save'; end if;
  if p_dc is null or p_dc < 1 or p_dc > 40 then raise exception 'the DC must be between 1 and 40'; end if;
  if coalesce(array_length(p_targets, 1), 0) = 0 then raise exception 'pick at least one target'; end if;
  if array_length(p_targets, 1) > 30 then raise exception 'too many targets at once'; end if;
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_att is null then raise exception 'your character is not in the fight'; end if;
  if not p_gm and v_cost <> 'reaction' and v_aord - 1 <> v_cb.turn then raise exception 'it is not your turn'; end if;

  select coalesce(array_agg(e.c ->> 'name'), '{}') into v_names
    from jsonb_array_elements(v_cb.combatants) e(c)
   where e.c ->> 'id' = any (p_targets) and (p_gm or not coalesce((e.c ->> 'hidden')::boolean, false));
  if coalesce(array_length(v_names, 1), 0) = 0 then raise exception 'no such combatant'; end if;

  v_att := public.combat_lock_last(public.combat_spend(v_att, v_cost, left(coalesce(p_label, 'Save effect'), 60), p_gm));

  v_save := jsonb_build_object(
    'by', v_att ->> 'name', 'byId', v_att ->> 'id', 'label', left(coalesce(p_label, 'Save'), 120),
    'ability', p_ability, 'dc', p_dc, 'damage', greatest(0, least(9999, coalesce(p_damage, 0))),
    'type', left(coalesce(p_type, ''), 30), 'half', coalesce(p_half, true), 'conditions', '[]'::jsonb,
    'at', extract(epoch from now()));

  select jsonb_agg(
           case when e.ord = v_aord and not (e.c ->> 'id' = any (p_targets)) then v_att
                when e.c ->> 'id' = any (p_targets) and (p_gm or not coalesce((e.c ->> 'hidden')::boolean, false))
                then (case when e.ord = v_aord then v_att else e.c end) || jsonb_build_object('pendingSaves',
                       coalesce(case when jsonb_typeof(e.c -> 'pendingSaves') = 'array' then e.c -> 'pendingSaves' end, '[]'::jsonb)
                       || jsonb_build_array(v_save || jsonb_build_object('id', gen_random_uuid()::text)))
                when e.ord = v_aord then v_att
                else e.c end
           order by e.ord)
    into v_new
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord);
  update public.combats set combatants = v_new, updated_at = now() where id = v_cb.id;
  return jsonb_build_object('targets', to_jsonb(v_names));
end;
$$;

ALTER FUNCTION public.combat_request_save(p_campaign uuid, p_character uuid, p_targets text[], p_ability text, p_dc integer, p_damage integer, p_type text, p_half boolean, p_label text, p_gm boolean, p_cost text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_resolve_save(p_campaign uuid, p_character uuid, p_save text, p_total integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cb    public.combats;
  v_c     jsonb;
  v_ord   bigint;
  v_ps    jsonb;
  v_ok    boolean;
  v_dmg   integer;
  v_conds jsonb;
  v_x     jsonb;
begin
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_c, v_ord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_c is null then raise exception 'your character is not in the fight'; end if;
  select s into v_ps from jsonb_array_elements(case when jsonb_typeof(v_c -> 'pendingSaves') = 'array' then v_c -> 'pendingSaves' else '[]'::jsonb end) s
   where s ->> 'id' = p_save limit 1;
  if v_ps is null then raise exception 'that save is already settled'; end if;

  v_ok := coalesce(p_total, 0) >= (v_ps ->> 'dc')::integer;
  v_dmg := case when v_ok then (case when coalesce((v_ps ->> 'half')::boolean, true) then ((v_ps ->> 'damage')::integer / 2) else 0 end)
                else (v_ps ->> 'damage')::integer end;
  v_c := public.combat_hurt(v_c, v_dmg);
  if not v_ok and jsonb_typeof(v_ps -> 'conditions') = 'array' then
    v_conds := case when jsonb_typeof(v_c -> 'conditions') = 'array' then v_c -> 'conditions' else '[]'::jsonb end;
    for v_x in select * from jsonb_array_elements(v_ps -> 'conditions') loop
      if not (v_conds @> jsonb_build_array(v_x)) then v_conds := v_conds || jsonb_build_array(v_x); end if;
    end loop;
    v_c := v_c || jsonb_build_object('conditions', v_conds);
  end if;
  v_c := v_c || jsonb_build_object(
    'pendingSaves', coalesce((select jsonb_agg(s) from jsonb_array_elements(v_c -> 'pendingSaves') s where s ->> 'id' <> p_save), '[]'::jsonb),
    'lastSave', jsonb_build_object('label', v_ps ->> 'label', 'by', v_ps ->> 'by', 'total', p_total, 'dc', v_ps -> 'dc', 'saved', v_ok, 'damage', v_dmg, 'at', extract(epoch from now())));
  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_ord then v_c else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = v_cb.id;
  return jsonb_build_object('saved', v_ok, 'damage', v_dmg, 'dc', (v_ps ->> 'dc')::integer, 'label', v_ps ->> 'label', 'by', v_ps ->> 'by');
end;
$$;

ALTER FUNCTION public.combat_resolve_save(p_campaign uuid, p_character uuid, p_save text, p_total integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_speed(p_c jsonb) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_base  integer := case when jsonb_typeof(p_c -> 'speed') = 'number' then (p_c ->> 'speed')::numeric::integer end;
  v_conds jsonb := case when jsonb_typeof(p_c -> 'conditions') = 'array' then p_c -> 'conditions' else '[]'::jsonb end;
begin
  if v_base is null then return null; end if;
  if v_conds ?| array['Grappled', 'Restrained', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'] then return 0; end if;
  if v_conds ? 'Hasted' then v_base := v_base * 2; end if;
  if v_conds ? 'Slowed' then v_base := v_base / 2; end if;
  return v_base;
end;
$$;

ALTER FUNCTION public.combat_speed(p_c jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_spend(p_c jsonb, p_cost text, p_what text, p_force boolean) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_e    jsonb := public.combat_econ(p_c);
  v_prev jsonb;
  v_stop text := public.combat_cant_act(p_c);
  v_per  integer := greatest(1, least(8, coalesce(case when jsonb_typeof(p_c -> 'attacksPerAction') = 'number' then (p_c ->> 'attacksPerAction')::numeric::integer end, 1)));
  v_left integer;
  v_what text := left(coalesce(nullif(trim(p_what), ''), initcap(p_cost)), 60);
begin
  if p_cost = 'free' then return p_c; end if;
  if p_cost not in ('action', 'attack', 'bonus', 'reaction') then raise exception 'unknown cost'; end if;
  if not p_force and v_stop is not null then raise exception 'cannot act while %', v_stop; end if;
  v_prev := v_e - 'log';
  v_left := coalesce((v_e ->> 'attacks')::integer, 0);

  if p_cost = 'attack' and v_left > 0 then
    v_e := v_e || jsonb_build_object('attacks', v_left - 1);
  elsif p_cost in ('action', 'attack') then
    if not p_force and (v_e ->> 'action')::boolean then raise exception 'you have used your action this turn'; end if;
    v_e := v_e || jsonb_build_object('action', true, 'attacks', case when p_cost = 'attack' then v_per - 1 else 0 end);
  elsif p_cost = 'bonus' then
    if not p_force and (v_e ->> 'bonus')::boolean then raise exception 'you have used your bonus action this turn'; end if;
    v_e := v_e || jsonb_build_object('bonus', true);
  else
    if not p_force and (v_e ->> 'reaction')::boolean then raise exception 'you have used your reaction this round'; end if;
    v_e := v_e || jsonb_build_object('reaction', true);
  end if;

  if (lower(v_what) = 'dash' or lower(v_what) like '%: dash') and p_cost in ('action', 'bonus') then
    v_e := v_e || jsonb_build_object('dash', coalesce((v_e ->> 'dash')::integer, 0) + coalesce(public.combat_speed(p_c), 0));
  end if;

  v_e := v_e || jsonb_build_object('log',
    (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
       select x, o from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o)
        order by o desc limit 9) k)
    || jsonb_build_array(jsonb_build_object('cost', p_cost, 'what', v_what, 'at', extract(epoch from now()), 'prev', v_prev)));
  return p_c || jsonb_build_object('econ', v_e);
end;
$$;

ALTER FUNCTION public.combat_spend(p_c jsonb, p_cost text, p_what text, p_force boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.combat_turn_econ() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_n int := coalesce(jsonb_array_length(new.combatants), 0);
begin
  if v_n = 0 or new.turn is null or new.turn < 0 or new.turn >= v_n then return new; end if;
  if new.round is not distinct from old.round
     and (new.combatants -> new.turn ->> 'id') is not distinct from (old.combatants -> old.turn ->> 'id') then
    return new;
  end if;
  new.combatants := jsonb_set(new.combatants, array[new.turn::text, 'econ'], public.combat_fresh_econ());
  return new;
end;
$$;

ALTER FUNCTION public.combat_turn_econ() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.create_discord_setup_code(p_campaign uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

ALTER FUNCTION public.create_discord_setup_code(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.create_gm_invite(p_campaign uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_tok uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.campaigns where id = p_campaign and gm_id = v_uid and deleted_at is null) then
    raise exception 'only the campaign''s owner can invite a co-GM';
  end if;
  if (select count(*) from public.campaign_gm_invites
       where campaign_id = p_campaign and accepted_at is null and revoked_at is null and expires_at > now()) >= 10 then
    raise exception 'this campaign already has 10 open invites: cancel one first';
  end if;
  insert into public.campaign_gm_invites (campaign_id, created_by) values (p_campaign, v_uid)
  returning token into v_tok;
  return v_tok;
end;
$$;

ALTER FUNCTION public.create_gm_invite(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.delete_campaign(p_campaign uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- p149: deleting is an owner action; a co-GM is a GM but not the owner.
  if not exists (select 1 from public.campaigns where id = p_campaign and gm_id = auth.uid()) then
    raise exception 'only the campaign''s owner can delete it';
  end if;
  delete from public.campaigns where id = p_campaign;
end; $$;

ALTER FUNCTION public.delete_campaign(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.delete_my_account() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_paths    text[];
  v_maps     text[] := '{}';
  v_tiles    text[] := '{}';
  v_blockers jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  v_blockers := public.my_deletion_blockers();
  if not (v_blockers->>'can_delete')::boolean then
    raise exception 'You still run one or more campaigns. Hand each one to another GM first, or delete it, so your players do not lose their history along with you.';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  -- Collect the audio object paths BEFORE unlinking the characters that point to them.
  select coalesce(array_agg(a.storage_path), '{}')
    into v_paths
  from public.audio_tracks a
  join public.characters ch on ch.id = a.character_id
  where ch.profile_id = v_uid
    and a.storage_path is not null;

  -- p145: pictures that are only yours. Library portraits no campaign character still shows, and your
  -- custom tiles. Character portraits stay: the characters stay in their campaigns.
  select coalesce(array_agg(distinct l.portrait_url), '{}')
    into v_maps
  from public.pc_library l
  where l.profile_id = v_uid
    and nullif(l.portrait_url, '') is not null
    and l.portrait_url !~ '^https?://'
    and not exists (select 1 from public.characters ch where ch.portrait_url = l.portrait_url);

  if to_regclass('public.custom_tiles') is not null then
    execute $q$
      select coalesce(array_agg(split_part(t.image_url, '/campaign-maps/', 2)), '{}')
        from public.custom_tiles t
       where t.profile_id = $1 and t.image_url like '%/campaign-maps/%' $q$
      into v_tiles using v_uid;
    execute 'delete from public.custom_tiles where profile_id = $1' using v_uid;
  end if;

  -- --- DELETE: things that are ABOUT THE PERSON -----------------------------

  -- Your words. Deleted with the audio they came from.
  delete from public.transcript_segments ts
   using public.characters ch
   where ch.id = ts.character_id and ch.profile_id = v_uid;

  -- Your voice. The rows go; the route removes the objects.
  delete from public.audio_tracks a
   using public.characters ch
   where ch.id = a.character_id and ch.profile_id = v_uid;

  delete from public.tpdi_responses     where respondent_id = v_uid;
  delete from public.vibe_checks        where profile_id    = v_uid;
  delete from public.chat_messages      where author_profile = v_uid;
  delete from public.chat_grants        where player_profile = v_uid;
  delete from public.recording_consents where profile_id = v_uid or recorded_by = v_uid;
  delete from public.attendance         where profile_id = v_uid;
  delete from public.disposition_reveals where profile_id = v_uid or revealed_by = v_uid;
  -- p145: the character page sections you wrote, your AI render log, your email preferences.
  delete from public.character_wiki_sections where owner_id = v_uid;
  delete from public.ai_map_renders     where profile_id = v_uid;
  if v_email is not null then
    delete from public.email_prefs where email = v_email;
  end if;
  -- dispositions, threads, memberships, notes, library, identities, table chat, roll keys and the
  -- tabletop rows you own cascade from profiles or auth.users. Named here so the next reader does not
  -- have to go and check.

  -- --- RETAIN, UNLINKED: the campaign's own story ---------------------------
  -- The character stays in the campaign. The events still happened. What goes is the
  -- thread connecting them to a person.
  update public.events     set actor_profile_id = null where actor_profile_id = v_uid;
  update public.arcs       set profile_id       = null where profile_id       = v_uid;
  -- p145: capture jobs and codex entries you created keep existing for the campaign; these two
  -- references have no ON DELETE rule, so left in place they stopped the account being deleted.
  -- An entry must have a creator, so it passes to the campaign's GM (you no longer run it, or the
  -- check above would have stopped here).
  update public.capture_jobs set created_by = null where created_by = v_uid;
  update public.entries e set created_by = c.gm_id
    from public.campaigns c where c.id = e.campaign_id and e.created_by = v_uid;
  update public.poll_responses pr set discord_user_id = null
    from public.characters ch where ch.id = pr.character_id and ch.profile_id = v_uid;
  update public.characters set profile_id = null, discord_user_id = null, ddb_character_id = null
   where profile_id = v_uid;

  -- gm_identities is ON DELETE SET NULL already.

  return jsonb_build_object(
    'ok', true,
    'storage_paths', to_jsonb(v_paths),
    'map_paths', to_jsonb(v_maps || v_tiles),
    'note', 'Database rows removed. The caller must now delete the storage objects and then the auth user.'
  );
end;
$_$;

ALTER FUNCTION public.delete_my_account() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.digest_batch(p_limit integer DEFAULT 500) RETURNS TABLE(profile_id uuid, email text, items jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select n.profile_id, lower(u.email),
         jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'link', n.link, 'data', n.data,
                                      'created_at', n.created_at) order by n.created_at desc)
    from public.notifications n
    join auth.users u on u.id = n.profile_id and u.email is not null and not coalesce(u.is_anonymous, false)
    join public.email_prefs p on p.email = lower(u.email) and p.digest
   where n.read_at is null and n.emailed_at is null and n.created_at > now() - interval '2 days'
   group by n.profile_id, lower(u.email)
   limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

ALTER FUNCTION public.digest_batch(p_limit integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.discord_claim_allowed(p_owner uuid, p_campaign uuid, p_discord text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p_owner is null
      or exists (select 1 from auth.users u where u.id = p_owner and coalesce(u.is_anonymous, false))
      or exists (select 1 from public.campaigns c where c.id = p_campaign and c.gm_id = p_owner)
      or (p_discord is not null and exists (
            select 1 from auth.identities i
             where i.user_id = p_owner and i.provider = 'discord' and i.provider_id = p_discord));
$$;

ALTER FUNCTION public.discord_claim_allowed(p_owner uuid, p_campaign uuid, p_discord text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.discord_setup_resolve(p_code text, p_discord text) RETURNS TABLE(campaign_id uuid, name text, how text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

ALTER FUNCTION public.discord_setup_resolve(p_code text, p_discord text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.entries_set_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := public.free_entry_slug(new.campaign_id, new.title, new.id);
  end if;
  return new;
end;
$$;

ALTER FUNCTION public.entries_set_slug() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.export_my_data() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_out   jsonb;
  v_tiles jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  if to_regclass('public.custom_tiles') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('scope', t.scope, 'label', t.label, 'color', t.color,
               'image_url', t.image_url, 'created_at', t.created_at) order by t.created_at), '[]'::jsonb)
        from public.custom_tiles t where t.profile_id = $1 $q$
      into v_tiles using v_uid;
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'notice', 'Everything Six Axes holds that is linked to your account. Session audio is deleted automatically 60 days after recording, so older recordings will not appear here because they no longer exist. Campaigns you run as GM are listed here; their full contents (codex, sessions, recaps, maps and files) come from the campaign export in the GM workspace.',

    'profile', (
      select to_jsonb(p) - 'id'
      from public.profiles p where p.id = v_uid
    ),

    -- p145: the whole sheet as well (build), the character page blocks, portrait and system.
    'characters', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', ch.name, 'campaign', c.name, 'system', ch.system, 'species', ch.species,
        'species_variant', ch.species_variant, 'class', ch.class,
        'subclass', ch.subclass, 'level', ch.level, 'alignment', ch.alignment,
        'description', ch.description, 'summary', ch.summary, 'portrait_url', ch.portrait_url,
        'build', ch.build, 'page_blocks', ch.blocks, 'created_at', ch.created_at
      ) order by c.name, ch.name), '[]'::jsonb)
      from public.characters ch
      join public.campaigns c on c.id = ch.campaign_id
      where ch.profile_id = v_uid
    ),

    -- p145: the character page sections you wrote.
    'character_pages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'character', ch.name, 'title', w.title, 'body', w.body, 'visibility', w.visibility,
        'created_at', w.created_at, 'updated_at', w.updated_at
      ) order by ch.name, w."position"), '[]'::jsonb)
      from public.character_wiki_sections w
      left join public.characters ch on ch.id = w.character_id
      where w.owner_id = v_uid
    ),

    -- p145: your character library (builds kept outside any campaign).
    'library', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', l.name, 'system', l.system, 'species', l.species, 'species_variant', l.species_variant,
        'class', l.class, 'subclass', l.subclass, 'level', l.level, 'portrait_url', l.portrait_url,
        'build', l.build, 'created_at', l.created_at, 'updated_at', l.updated_at
      ) order by l.name), '[]'::jsonb)
      from public.pc_library l where l.profile_id = v_uid
    ),

    -- p145: the same character across campaigns.
    'character_identities', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', ci.name, 'species', ci.species, 'species_variant', ci.species_variant,
        'class', ci.class, 'subclass', ci.subclass, 'created_at', ci.created_at
      ) order by ci.name), '[]'::jsonb)
      from public.character_identities ci where ci.profile_id = v_uid
    ),

    -- p145: your private notes.
    'notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'campaign', c.name, 'about_entry', n.entry_id, 'body', n.body,
        'created_at', n.created_at, 'updated_at', n.updated_at
      ) order by n.created_at), '[]'::jsonb)
      from public.player_notes n
      left join public.campaigns c on c.id = n.campaign_id
      where n.profile_id = v_uid
    ),

    -- The self-perception series. Every snapshot, dated, not just the latest.
    'self_reports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scope', t.scope, 'taken_at', t.created_at,
        'instrument_version', t.instrument_version,
        'answers', t.answers, 'scores', t.scores, 'safety', t.safety
      ) order by t.created_at), '[]'::jsonb)
      from public.tpdi_responses t where t.respondent_id = v_uid
    ),

    'dispositions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'scope', d.scope, 'source', d.source, 'as_of', d.as_of,
        'model_version', d.model_version, 'axis_scores', d.axis_scores,
        'uncertainty', d.weights
      ) order by d.as_of desc), '[]'::jsonb)
      from public.dispositions d where d.profile_id = v_uid
    ),

    'threads', (
      select coalesce(jsonb_agg(to_jsonb(th) - 'profile_id' - 'id'), '[]'::jsonb)
      from public.threads th where th.profile_id = v_uid
    ),

    'check_ins', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'satisfaction', v.satisfaction, 'spotlight', v.spotlight_feeling,
        'note', v.note, 'at', v.created_at
      ) order by v.created_at), '[]'::jsonb)
      from public.vibe_checks v where v.profile_id = v_uid
    ),

    -- p145: which sessions you were at, and when you said you could play.
    'attendance', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'campaign', c.name, 'session', s.session_number, 'status', a.status
      ) order by c.name, s.session_number), '[]'::jsonb)
      from public.attendance a
      join public.sessions s on s.id = a.session_id
      join public.campaigns c on c.id = a.campaign_id
      where a.profile_id = v_uid
    ),
    'poll_answers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'character', ch.name, 'available', pr.available, 'updated_at', pr.updated_at
      ) order by pr.updated_at), '[]'::jsonb)
      from public.poll_responses pr
      join public.characters ch on ch.id = pr.character_id
      where ch.profile_id = v_uid
    ),

    'chat_messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'body', m.body, 'at', m.created_at
      ) order by m.created_at), '[]'::jsonb)
      from public.chat_messages m where m.author_profile = v_uid
    ),

    -- What you said and rolled in table chat on the tabletop (p105).
    'table_chat', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', tm.kind, 'as', tm.as_name, 'body', tm.body, 'roll', tm.roll, 'at', tm.created_at
      ) order by tm.created_at), '[]'::jsonb)
      from public.vtt_messages tm where tm.author_profile = v_uid
    ),

    -- Your words, as transcribed. This is the most personal thing in the system
    -- after the audio itself, and it belongs in an export.
    'transcript_segments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'text', ts.text, 'start_ms', ts.start_ms, 'at', ts.created_at
      ) order by ts.created_at), '[]'::jsonb)
      from public.transcript_segments ts
      join public.characters ch on ch.id = ts.character_id
      where ch.profile_id = v_uid
    ),

    'recordings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'recorded_at', a.created_at,
        'duration_seconds', a.duration_seconds,
        'status', case when a.purged_at is not null
                       then 'deleted under the 60-day retention policy'
                       else 'retained' end,
        'deleted_at', a.purged_at
      ) order by a.created_at desc), '[]'::jsonb)
      from public.audio_tracks a
      join public.characters ch on ch.id = a.character_id
      where ch.profile_id = v_uid
    ),

    'recording_consents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'consented', rc.consented, 'method', rc.method, 'at', rc.created_at,
        'scope', case when rc.session_id is null then 'standing (campaign-wide)'
                      else 'this session only' end
      ) order by rc.created_at), '[]'::jsonb)
      from public.recording_consents rc where rc.profile_id = v_uid
    ),

    -- p145: account-level settings and logs.
    'email_preferences', (
      select to_jsonb(ep) from public.email_prefs ep where ep.email = v_email
    ),
    'roll_keys', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'campaign', c.name, 'kind', k.kind, 'created_at', k.created_at,
        'last_used_at', k.last_used_at, 'retired_at', k.revoked_at
      ) order by k.created_at), '[]'::jsonb)
      from public.vtt_ingest_keys k
      left join public.campaigns c on c.id = k.campaign_id
      where k.profile_id = v_uid
    ),
    'ai_map_renders', (
      select coalesce(jsonb_agg(jsonb_build_object('campaign', c.name, 'kind', r.kind, 'at', r.created_at)
               order by r.created_at), '[]'::jsonb)
      from public.ai_map_renders r
      left join public.campaigns c on c.id = r.campaign_id
      where r.profile_id = v_uid
    ),
    'custom_tiles', v_tiles,

    -- p145: what you run as GM, and handovers you offered.
    'campaigns_you_run', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'created_at', c.created_at) order by c.name), '[]'::jsonb)
      from public.campaigns c where c.gm_id = v_uid
    ),
    'campaign_handovers_offered', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'campaign', c.name, 'to_email', t.to_email, 'offered_at', t.created_at,
        'accepted_at', t.accepted_at, 'cancelled_at', t.cancelled_at
      ) order by t.created_at), '[]'::jsonb)
      from public.campaign_transfers t
      left join public.campaigns c on c.id = t.campaign_id
      where t.from_id = v_uid
    )
  ) into v_out;

  return v_out;
end;
$_$;

ALTER FUNCTION public.export_my_data() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.forge_access(p_kind text, p_id uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_owner uuid;
  v_camp  uuid;
  v_gone  boolean;
begin
  if auth.uid() is null then return 'signed_out'; end if;
  if p_kind = 'library' then
    select l.profile_id into v_owner from public.pc_library l where l.id = p_id;
    if not found then return 'missing'; end if;
    return case when v_owner = auth.uid() then 'ok' else 'not_yours' end;
  end if;
  select ch.profile_id, ch.campaign_id, c.deleted_at is not null into v_owner, v_camp, v_gone
    from public.characters ch left join public.campaigns c on c.id = ch.campaign_id
   where ch.id = p_id;
  if not found then return 'missing'; end if;
  if v_gone then return 'trashed'; end if;
  return case when v_owner = auth.uid() or public.is_campaign_gm(v_camp) then 'ok' else 'not_yours' end;
end;
$$;

ALTER FUNCTION public.forge_access(p_kind text, p_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.free_entry_slug(p_campaign uuid, p_base text, p_self uuid) RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
declare
  base text := coalesce(public.slugify(p_base), 'entry');
  try  text := base;
  n    integer := 1;
begin
  while exists (
    select 1 from public.entries e
    where e.campaign_id = p_campaign
      and e.slug = try
      and (p_self is null or e.id <> p_self)
  ) loop
    n := n + 1;
    try := base || '-' || n;
  end loop;
  return try;
end;
$$;

ALTER FUNCTION public.free_entry_slug(p_campaign uuid, p_base text, p_self uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.gm_chat_read(p_campaign uuid) RETURNS TABLE(display_name text, body text, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select m.display_name, m.body, m.created_at
  from public.chat_messages m
  where m.campaign_id = p_campaign
    and public.is_campaign_gm(p_campaign)
    and exists (
      select 1 from public.chat_grants g
      where g.campaign_id = m.campaign_id
        and g.player_profile = m.author_profile
        and m.created_at between g.from_ts and g.to_ts
    )
  order by m.created_at asc;
$$;

ALTER FUNCTION public.gm_chat_read(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.gm_invite_preview(p_token uuid) RETURNS TABLE(campaign_id uuid, campaign_name text, owner_name text, state text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select c.id, c.name, coalesce(p.display_name, 'The GM'),
         case when c.gm_id = auth.uid() then 'owner'
              when public.campaign_gm_of(c.id, auth.uid()) then 'already'
              when i.revoked_at is not null then 'cancelled'
              when i.accepted_at is not null then 'used'
              when i.expires_at <= now() then 'expired'
              else 'open' end
    from public.campaign_gm_invites i
    join public.campaigns c on c.id = i.campaign_id and c.deleted_at is null
    left join public.profiles p on p.id = c.gm_id
   where i.token = p_token and auth.uid() is not null;
$$;

ALTER FUNCTION public.gm_invite_preview(p_token uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.gm_invites_open(p_campaign uuid) RETURNS TABLE(id uuid, token uuid, created_at timestamp with time zone, expires_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select i.id, i.token, i.created_at, i.expires_at
    from public.campaign_gm_invites i
    join public.campaigns c on c.id = i.campaign_id and c.gm_id = auth.uid()
   where i.campaign_id = p_campaign and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
   order by i.created_at desc;
$$;

ALTER FUNCTION public.gm_invites_open(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_anon boolean := coalesce((new.is_anonymous)::boolean, false);
  v_meta jsonb   := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, display_name, email, avatar_url, is_anonymous)
  values (
    new.id,
    nullif(coalesce(v_meta->>'full_name', v_meta->>'name', v_meta->>'user_name', ''), ''),
    nullif(coalesce(new.email, v_meta->>'email', ''), ''),
    nullif(coalesce(v_meta->>'avatar_url', v_meta->>'picture', ''), ''),
    v_anon
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.initiative_my_characters(p_share text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_camp uuid;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return null; end if;
  select c.id into v_camp from public.campaigns c where c.share_code = lower(trim(p_share)) limit 1;
  if v_camp is null then return null; end if;
  return jsonb_build_object('campaign', v_camp, 'characters', coalesce((
    select jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name, 'saves', ch.build -> 'sheetSnapshot' -> 'saves') order by ch.name)
      from public.characters ch
     where ch.campaign_id = v_camp and ch.profile_id = v_uid and ch.kind = 'pc' and coalesce(ch.active, true)), '[]'::jsonb));
end;
$$;

ALTER FUNCTION public.initiative_my_characters(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.is_campaign_gm(p_campaign uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from campaigns c
    where c.id = p_campaign and c.gm_id = auth.uid()
  ) or exists (
    select 1 from memberships m
    where m.campaign_id = p_campaign and m.profile_id = auth.uid()
      and m.role in ('gm','co-gm') and m.active
  );
$$;

ALTER FUNCTION public.is_campaign_gm(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.is_campaign_gm_segment(p_segment text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $_$
  select case
    when p_segment is null then false
    when p_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then false
    else public.is_campaign_gm(p_segment::uuid)
  end;
$_$;

ALTER FUNCTION public.is_campaign_gm_segment(p_segment text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.is_campaign_member(p_campaign uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from memberships m
    where m.campaign_id = p_campaign and m.profile_id = auth.uid() and m.active
  ) and not exists (
    select 1 from campaigns c where c.id = p_campaign and c.deleted_at is not null
  );
$$;

ALTER FUNCTION public.is_campaign_member(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.journal_for_share(p_share text) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select cj.content
  from public.campaign_journals cj
  join public.campaigns c on c.id = cj.campaign_id
  where c.share_code = p_share;
$$;

ALTER FUNCTION public.journal_for_share(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.latest_processed_session(code text) RETURNS TABLE(campaign_name text, session_id uuid, session_number integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select c.name, s.id, s.session_number
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code and s.status in ('processed','completed')
  order by s.session_number desc nulls last
  limit 1;
$$;

ALTER FUNCTION public.latest_processed_session(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.library_alter_ego_is_flat() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  n integer;
begin
  if new.alter_ego_of is null then
    return new;
  end if;
  if new.alter_ego_of = new.id then
    raise exception 'A build cannot be its own alter ego.';
  end if;
  if exists (
    select 1 from public.pc_library l
    where l.id = new.alter_ego_of and l.alter_ego_of is not null
  ) then
    raise exception 'That build is already an alter ego. Link to the primary instead.';
  end if;

  select count(*) into n
  from public.pc_library l
  where l.alter_ego_of = new.alter_ego_of and l.id <> new.id;
  if n >= 10 then
    raise exception 'A build can have at most 10 alter egos.';
  end if;

  return new;
end;
$$;

ALTER FUNCTION public.library_alter_ego_is_flat() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.map_fog_for_share(p_share text) RETURNS TABLE(map_id uuid, cols integer, rows integer, cells text, updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select f.map_id, f.cols, f.rows, f.cells, f.updated_at
  from public.map_fog f
  join public.maps m on m.id = f.map_id
  join public.campaigns c on c.id = f.campaign_id
  where c.share_code = p_share
    and m.visibility <> 'gm';
$$;

ALTER FUNCTION public.map_fog_for_share(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.map_for_player(p_share text) RETURNS TABLE(map_id uuid, map_name text, image_path text, pin_id uuid, x double precision, y double precision, label text, linked_type text, linked_title text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with camp as (
    select id from public.campaigns where share_code = p_share
  ),
  vis_maps as (
    select m.id, m.name, m.image_path
    from public.maps m, camp
    where m.campaign_id = camp.id and m.visibility in ('common', 'player')
  )
  select
    vm.id as map_id, vm.name as map_name, vm.image_path,
    p.id as pin_id, p.x, p.y, p.label, p.linked_type,
    case
      when p.linked_type = 'entry' then (select e.title from public.entries e where e.id = p.linked_id)
      when p.linked_type = 'character' then (select ch.name from public.characters ch where ch.id = p.linked_id)
      else null
    end as linked_title
  from vis_maps vm
  left join public.map_pins p
    on p.map_id = vm.id and p.visibility in ('common', 'player')
  order by vm.name;
$$;

ALTER FUNCTION public.map_for_player(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.mark_audio_purged(p_track_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.audio_tracks
     set purged_at = now(),
         storage_path = null
   where id = p_track_id
     and purged_at is null;
$$;

ALTER FUNCTION public.mark_audio_purged(p_track_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.memberships_gm_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_row   public.memberships := coalesce(new, old);
  v_owner boolean;
begin
  if current_user not in ('anon', 'authenticated') then return coalesce(new, old); end if;
  v_owner := exists (select 1 from public.campaigns c where c.id = v_row.campaign_id and c.gm_id = auth.uid());
  if tg_op = 'INSERT' then
    if new.role <> 'player' and not v_owner then raise exception 'only the campaign''s owner can add a GM'; end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.campaign_id is distinct from old.campaign_id or new.profile_id is distinct from old.profile_id then
      raise exception 'a membership cannot be moved';
    end if;
    if new.role is distinct from old.role and not v_owner then
      raise exception 'only the campaign''s owner can change who is a GM';
    end if;
    if old.role in ('gm', 'co-gm') and new.active is distinct from old.active and not v_owner and old.profile_id <> auth.uid() then
      raise exception 'only the campaign''s owner can change who is a GM';
    end if;
    return new;
  else
    if old.role in ('gm', 'co-gm') and not v_owner and old.profile_id <> auth.uid() then
      raise exception 'only the campaign''s owner can remove a GM';
    end if;
    return old;
  end if;
end;
$$;

ALTER FUNCTION public.memberships_gm_guard() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.mint_public_slug(p_campaign uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_catalog'
    AS $$
declare
  s text;
begin
  if not public.is_campaign_gm(p_campaign) then
    raise exception 'Only the GM of this campaign can publish it.';
  end if;
  loop
    -- 16 hex chars. Collisions are handled by the loop rather than assumed away.
    s := encode(gen_random_bytes(8), 'hex');
    exit when not exists (select 1 from public.campaigns where public_slug = s);
  end loop;
  update public.campaigns set public_slug = s where id = p_campaign;
  return s;
end;
$$;

ALTER FUNCTION public.mint_public_slug(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_calendar_token() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.calendar_feeds (profile_id) values (auth.uid()) on conflict (profile_id) do nothing;
  select token into v from public.calendar_feeds where profile_id = auth.uid();
  return v;
end $$;

ALTER FUNCTION public.my_calendar_token() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_campaign_transfer(p_campaign uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object('toEmail', t.to_email, 'expiresAt', t.expires_at)
    from public.campaign_transfers t
    join public.campaigns c on c.id = t.campaign_id and c.gm_id = auth.uid()
   where t.campaign_id = p_campaign and t.accepted_at is null and t.cancelled_at is null and t.expires_at > now()
   order by t.created_at desc limit 1;
$$;

ALTER FUNCTION public.my_campaign_transfer(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_campaigns() RETURNS TABLE(campaign_id uuid, campaign_name text, system text, share_code text, gm_name text, my_characters bigint, last_session_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    c.id,
    c.name,
    c.system,
    c.share_code,
    coalesce(nullif(gm.display_name, ''), 'Your GM'),
    count(ch.id),
    (select max(s.started_at)
       from public.sessions s
      where s.campaign_id = c.id and s.started_at is not null)
  from public.characters ch
  join public.campaigns c  on c.id = ch.campaign_id
  left join public.profiles gm on gm.id = c.gm_id
  where ch.profile_id = auth.uid()
    and ch.kind = 'pc'
    and coalesce(ch.active, true)
    and c.deleted_at is null
  group by c.id, c.name, c.system, c.share_code, gm.display_name
  order by c.name;
$$;

ALTER FUNCTION public.my_campaigns() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_character(p_share text) RETURNS TABLE(character_id uuid, name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select ch.id, ch.name
  from public.campaigns c
  join public.characters ch on ch.campaign_id = c.id
  where c.share_code = p_share and ch.kind = 'pc' and ch.profile_id = auth.uid()
  limit 1;
$$;

ALTER FUNCTION public.my_character(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_characters() RETURNS TABLE(character_id uuid, name text, campaign_id uuid, campaign_name text, species text, class text, subclass text, level smallint, alignment text, kind text, active boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select ch.id, ch.name, c.id, c.name,
         ch.species, ch.class, ch.subclass, ch.level, ch.alignment, ch.kind, ch.active
  from public.characters ch
  join public.campaigns c on c.id = ch.campaign_id
  where ch.profile_id = auth.uid()
  order by c.name, ch.name;
$$;

ALTER FUNCTION public.my_characters() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_deletion_blockers() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'campaigns_i_run', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)), '[]'::jsonb)
      from public.campaigns c where c.gm_id = auth.uid()
    ),
    'can_delete', not exists (select 1 from public.campaigns c where c.gm_id = auth.uid())
  );
$$;

ALTER FUNCTION public.my_deletion_blockers() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_email_prefs() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
           'email', u.email,
           'reminders', coalesce(p.reminders, true),
           'recaps', coalesce(p.recaps, true),
           'digest', coalesce(p.digest, false))
    from auth.users u
    left join public.email_prefs p on p.email = lower(u.email)
   where u.id = auth.uid() and u.email is not null;
$$;

ALTER FUNCTION public.my_email_prefs() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_next_sessions() RETURNS TABLE(campaign_id uuid, session_id uuid, session_number integer, scheduled_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select distinct on (s.campaign_id) s.campaign_id, s.id, s.session_number, s.scheduled_at
    from public.sessions s
    join public.campaigns c on c.id = s.campaign_id
   where c.deleted_at is null
     and s.status in ('scheduled', 'live')
     and s.scheduled_at is not null
     and s.scheduled_at > now() - interval '6 hours'
     and (public.is_campaign_gm(c.id)
          or exists (select 1 from public.characters ch
                      where ch.campaign_id = c.id and ch.profile_id = auth.uid()
                        and ch.kind = 'pc' and coalesce(ch.active, true)))
   order by s.campaign_id, s.scheduled_at;
$$;

ALTER FUNCTION public.my_next_sessions() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_recording_consents() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(x order by x ->> 'campaignName'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'campaignId', c.id,
               'campaignName', c.name,
               'characters', jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name) order by ch.name),
               -- withdrawn if any of the player's characters there has consent switched off; given only
               -- when every one of them has said yes; otherwise not yet given
               'state', case
                 when bool_or(rc.consented = false) then 'withdrawn'
                 when bool_and(rc.consented = true) then 'given'
                 else 'none' end,
               -- p144 (audit T11): a yes the backfill carried over, not one the player gave as standing consent
               'carried', coalesce(bool_or(rc.consented = true and rc.method = 'backfill_blanket'), false)) as x
        from public.characters ch
        join public.campaigns c on c.id = ch.campaign_id
        left join public.recording_consents rc
          on rc.campaign_id = ch.campaign_id and rc.character_id = ch.id and rc.session_id is null
       where ch.profile_id = auth.uid() and ch.kind = 'pc'
       group by c.id, c.name
    ) t;
$$;

ALTER FUNCTION public.my_recording_consents() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_rsvp_for_share(code text, p_session_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    return null;
  end if;
 
  -- The session must belong to the campaign behind this share code (same check rsvp_for_share makes).
  if not exists (
    select 1
    from public.campaigns c
    join public.sessions s on s.campaign_id = c.id
    where c.share_code = code and s.id = p_session_id
  ) then
    return null;
  end if;
 
  select a.status
    into v_status
  from public.attendance a
  where a.session_id = p_session_id
    and a.profile_id = v_uid;
 
  return v_status;
end;
$$;

ALTER FUNCTION public.my_rsvp_for_share(code text, p_session_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_terms() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object('accepted_at', p.terms_accepted_at, 'version', p.terms_version, 'is_anonymous', p.is_anonymous)
    from public.profiles p where p.id = auth.uid();
$$;

ALTER FUNCTION public.my_terms() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_trashed_campaigns() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'deletedAt', c.deleted_at,
           'eraseAt', c.deleted_at + interval '30 days') order by c.deleted_at desc), '[]'::jsonb)
    from public.campaigns c
   where c.gm_id = auth.uid() and c.deleted_at is not null;
$$;

ALTER FUNCTION public.my_trashed_campaigns() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.my_vibe_check(code text, p_session_number integer) RETURNS TABLE(satisfaction integer, spotlight_feeling text, note text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select v.satisfaction, v.spotlight_feeling, v.note
  from public.vibe_checks v
  join public.sessions s on s.id = v.session_id
  join public.campaigns c on c.id = s.campaign_id
  where c.share_code = code
    and s.session_number = p_session_number
    and v.profile_id = auth.uid()
  limit 1;
$$;

ALTER FUNCTION public.my_vibe_check(code text, p_session_number integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.next_scheduled_for_share(code text) RETURNS TABLE(session_id uuid, session_number integer, scheduled_at timestamp with time zone, campaign_name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select s.id, s.session_number::int, s.scheduled_at, c.name
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code
    and s.scheduled_at is not null
    and s.scheduled_at >= now()
  order by s.scheduled_at asc
  limit 1;
$$;

ALTER FUNCTION public.next_scheduled_for_share(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.notify(p_to uuid[], p_campaign uuid, p_kind text, p_title text, p_link text, p_data jsonb, p_key text, p_actor uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.notifications (profile_id, campaign_id, kind, title, link, data, dedupe_key, actor_id)
  select distinct t, p_campaign, p_kind, left(p_title, 300), p_link, coalesce(p_data, '{}'::jsonb), left(p_key, 200), p_actor
    from unnest(coalesce(p_to, '{}'::uuid[])) t
   where t is not null and t is distinct from p_actor
     and exists (select 1 from public.profiles pr where pr.id = t)
  on conflict (profile_id, dedupe_key) do update
    set kind = excluded.kind, title = excluded.title, link = excluded.link, data = excluded.data,
        actor_id = excluded.actor_id, created_at = now(), read_at = null, emailed_at = null;
$$;

ALTER FUNCTION public.notify(p_to uuid[], p_campaign uuid, p_kind text, p_title text, p_link text, p_data jsonb, p_key text, p_actor uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.notify_on_cogm() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_was boolean := tg_op <> 'INSERT' and old.role in ('gm', 'co-gm') and old.active;
  v_is  boolean := tg_op <> 'DELETE' and new.role in ('gm', 'co-gm') and new.active;
  v_row public.memberships := coalesce(new, old);
  v_c   public.campaigns;
  v_who text;
begin
  if v_was = v_is then return null; end if;
  select * into v_c from public.campaigns where id = v_row.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null or v_row.profile_id = v_c.gm_id then return null; end if;
  -- p170 (R8): the old owner in a handover accepted in this transaction is not a removed co-GM
  if exists (select 1 from public.campaign_transfers t
              where t.campaign_id = v_c.id and t.from_id = v_row.profile_id and t.accepted_at = now()) then
    return null;
  end if;
  select coalesce(nullif(trim(pr.display_name), ''), 'Your co-GM') into v_who from public.profiles pr where pr.id = v_row.profile_id;
  v_who := coalesce(v_who, 'Your co-GM');
  if v_is then
    perform public.notify(array[v_c.gm_id], v_c.id, 'cogm_joined', v_who || ' is now a co-GM of ' || v_c.name,
      '/gm?campaign=' || v_c.id, '{}'::jsonb, 'cogm:' || v_c.id || ':' || v_row.profile_id, v_row.profile_id);
  elsif auth.uid() is not distinct from v_row.profile_id then
    perform public.notify(array[v_c.gm_id], v_c.id, 'cogm_left', v_who || ' stepped down as co-GM of ' || v_c.name,
      '/gm?campaign=' || v_c.id, '{}'::jsonb, 'cogm:' || v_c.id || ':' || v_row.profile_id, v_row.profile_id);
  else
    perform public.notify(array[v_row.profile_id], v_c.id, 'cogm_removed', 'You are no longer a co-GM of ' || v_c.name,
      '/me/campaigns', '{}'::jsonb, 'cogm:' || v_c.id || ':' || v_row.profile_id, auth.uid());
  end if;
  return null;
exception when others then
  raise warning 'notify_on_cogm: %', sqlerrm;
  return null;
end;
$$;

ALTER FUNCTION public.notify_on_cogm() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.notify_on_job() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_c public.campaigns;
  v_n integer;
begin
  if new.status is not distinct from old.status or new.status not in ('review', 'error') then return null; end if;
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  select session_number into v_n from public.sessions where id = new.session_id;
  if new.status = 'review' then
    perform public.notify(public.campaign_gm_ids(v_c.id), v_c.id, 'review_ready',
      v_c.name || ': ' || initcap(left(public.notify_session_label(v_n), 1)) || substr(public.notify_session_label(v_n), 2) || ' is ready to review',
      '/gm/review?campaign=' || v_c.id,
      jsonb_build_object('job_id', new.id, 'session_id', new.session_id, 'session_number', v_n),
      'job:' || new.id, null);
  else
    perform public.notify(public.campaign_gm_ids(v_c.id), v_c.id, 'processing_failed',
      v_c.name || ': processing ' || public.notify_session_label(v_n) || ' failed',
      '/gm/reliability?campaign=' || v_c.id,
      jsonb_build_object('job_id', new.id, 'session_id', new.session_id, 'session_number', v_n),
      'job:' || new.id, null);
  end if;
  return null;
exception when others then
  raise warning 'notify_on_job: %', sqlerrm;
  return null;
end;
$$;

ALTER FUNCTION public.notify_on_job() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.notify_on_join() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_c   public.campaigns;
  v_who text;
begin
  if new.kind <> 'pc' or new.profile_id is null or new.campaign_id is null then return null; end if;
  if tg_op = 'UPDATE' and old.profile_id is not null then return null; end if;
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  if new.profile_id = any (public.campaign_gm_ids(v_c.id)) then return null; end if;
  select coalesce(nullif(trim(pr.display_name), ''), 'A player') into v_who from public.profiles pr where pr.id = new.profile_id;
  perform public.notify(public.campaign_gm_ids(v_c.id), v_c.id, 'player_joined',
    v_c.name || ': ' || coalesce(v_who, 'A player') || ' joined as ' || new.name,
    '/gm?campaign=' || v_c.id,
    jsonb_build_object('character_id', new.id),
    'join:' || new.id, new.profile_id);
  return null;
exception when others then
  raise warning 'notify_on_join: %', sqlerrm;
  return null;
end;
$$;

ALTER FUNCTION public.notify_on_join() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.notify_on_recap_send() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_c public.campaigns;
  v_n integer;
begin
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  select session_number into v_n from public.sessions where id = new.session_id;
  perform public.notify(public.campaign_player_ids(v_c.id), v_c.id, 'recap_sent',
    v_c.name || ': the ' || coalesce('Session ' || v_n || ' ', '') || 'recap is out',
    case when v_c.share_code is not null then '/recaps?share=' || v_c.share_code else '/me/campaigns' end,
    jsonb_build_object('session_id', new.session_id, 'session_number', v_n),
    'recap:' || new.session_id, new.sent_by);
  return null;
exception when others then
  raise warning 'notify_on_recap_send: %', sqlerrm;
  return null;
end;
$$;

ALTER FUNCTION public.notify_on_recap_send() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.notify_on_rsvp() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_c    public.campaigns;
  v_n    integer;
  v_who  text;
  v_verb text;
begin
  if new.status not in ('going', 'maybe', 'declined') then return null; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  select session_number into v_n from public.sessions where id = new.session_id;
  select coalesce(
           (select ch.name from public.characters ch where ch.id = new.character_id),
           (select ch.name from public.characters ch where ch.campaign_id = v_c.id and ch.kind = 'pc' and ch.profile_id = new.profile_id
             order by ch.active desc nulls last, ch.name limit 1),
           nullif(trim((select pr.display_name from public.profiles pr where pr.id = new.profile_id)), ''),
           'A player') into v_who;
  v_verb := case new.status when 'going' then ' is going to ' when 'maybe' then ' might make ' else ' can''t make ' end;
  perform public.notify(public.campaign_gm_ids(v_c.id), v_c.id, 'rsvp',
    v_c.name || ': ' || v_who || v_verb || public.notify_session_label(v_n),
    '/gm/sessions?campaign=' || v_c.id,
    jsonb_build_object('session_id', new.session_id, 'session_number', v_n, 'status', new.status),
    'rsvp:' || new.session_id || ':' || new.profile_id, new.profile_id);
  return null;
exception when others then
  raise warning 'notify_on_rsvp: %', sqlerrm;
  return null;
end;
$$;

ALTER FUNCTION public.notify_on_rsvp() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.notify_on_session() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_c    public.campaigns;
  v_kind text;
  v_what text;
  v_link text;
begin
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  if tg_op = 'INSERT' then
    if new.scheduled_at is null or new.status <> 'scheduled' or new.scheduled_at < now() then return null; end if;
    v_kind := 'session_scheduled'; v_what := 'is scheduled';
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_kind := 'session_cancelled'; v_what := 'is cancelled';
  elsif new.status = 'scheduled' and new.scheduled_at is not null and new.scheduled_at >= now()
        and new.scheduled_at is distinct from old.scheduled_at then
    v_kind := case when old.scheduled_at is null then 'session_scheduled' else 'session_moved' end;
    v_what := case when old.scheduled_at is null then 'is scheduled' else 'has moved' end;
  else
    return null;
  end if;
  v_link := case when v_c.share_code is not null then '/schedule?share=' || v_c.share_code else '/me/campaigns' end;
  perform public.notify(public.campaign_player_ids(v_c.id), v_c.id, v_kind,
    v_c.name || ': ' || initcap(left(public.notify_session_label(new.session_number), 1)) || substr(public.notify_session_label(new.session_number), 2) || ' ' || v_what,
    v_link, jsonb_build_object('session_id', new.id, 'session_number', new.session_number, 'scheduled_at', new.scheduled_at, 'time_zone', v_c.time_zone),
    'session:' || new.id, auth.uid());
  return null;
exception when others then
  raise warning 'notify_on_session: %', sqlerrm;
  return null;
end;
$$;

ALTER FUNCTION public.notify_on_session() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.notify_session_label(p_number integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case when p_number is null then 'a session' else 'Session ' || p_number end;
$$;

ALTER FUNCTION public.notify_session_label(p_number integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.offer_campaign_transfer(p_campaign uuid, p_email text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_c     public.campaigns;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_mine  text;
  v_token text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  v_exp   timestamptz := now() + interval '7 days';
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if v_c.id is null or v_c.gm_id is distinct from auth.uid() then raise exception 'only the campaign''s GM can hand it over'; end if;
  if v_c.deleted_at is not null then raise exception 'restore the campaign from the trash first'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'that does not look like an email address'; end if;
  select lower(email) into v_mine from auth.users where id = auth.uid();
  if v_email = v_mine then raise exception 'that is your own address'; end if;
  update public.campaign_transfers set cancelled_at = now()
   where campaign_id = p_campaign and accepted_at is null and cancelled_at is null;
  insert into public.campaign_transfers (campaign_id, from_id, to_email, token, expires_at)
  values (p_campaign, auth.uid(), v_email, v_token, v_exp);
  return jsonb_build_object('token', v_token, 'expiresAt', v_exp);
end;
$_$;

ALTER FUNCTION public.offer_campaign_transfer(p_campaign uuid, p_email text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.party_fund_change(p_campaign uuid, p_delta jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  f public.party_funds%rowtype;
  d record;
  k text;
begin
  if not (is_campaign_gm(p_campaign) or tabletop_is_player(p_campaign)) then raise exception 'not at this table'; end if;
  if p_delta is null or jsonb_typeof(p_delta) <> 'object' then raise exception 'Say which coins.'; end if;
  for k in select jsonb_object_keys(p_delta) loop
    if k not in ('pp', 'gp', 'ep', 'sp', 'cp') then raise exception 'Unknown coin: %', k; end if;
    if jsonb_typeof(p_delta -> k) <> 'number' or abs((p_delta ->> k)::numeric) > 10000000 then raise exception 'Bad amount for %', k; end if;
  end loop;
  insert into public.party_funds (campaign_id) values (p_campaign) on conflict (campaign_id) do nothing;
  select * into f from public.party_funds where campaign_id = p_campaign for update;
  select coalesce((p_delta ->> 'pp')::int, 0) as pp, coalesce((p_delta ->> 'gp')::int, 0) as gp, coalesce((p_delta ->> 'ep')::int, 0) as ep,
         coalesce((p_delta ->> 'sp')::int, 0) as sp, coalesce((p_delta ->> 'cp')::int, 0) as cp into d;
  if f.pp + d.pp < 0 or f.gp + d.gp < 0 or f.ep + d.ep < 0 or f.sp + d.sp < 0 or f.cp + d.cp < 0 then
    raise exception 'The party does not have that many coins.';
  end if;
  update public.party_funds
     set pp = pp + d.pp, gp = gp + d.gp, ep = ep + d.ep, sp = sp + d.sp, cp = cp + d.cp, updated_by = auth.uid(), updated_at = now()
   where campaign_id = p_campaign
   returning * into f;
  return jsonb_build_object('pp', f.pp, 'gp', f.gp, 'ep', f.ep, 'sp', f.sp, 'cp', f.cp);
end;
$$;

ALTER FUNCTION public.party_fund_change(p_campaign uuid, p_delta jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.party_take(p_item uuid, p_qty integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r public.party_items%rowtype;
  n integer;
begin
  select * into r from public.party_items where id = p_item for update;
  if not found then raise exception 'That item is no longer in the party inventory.'; end if;
  if not (is_campaign_gm(r.campaign_id) or tabletop_is_player(r.campaign_id)) then
    raise exception 'not at this table';
  end if;
  n := coalesce(p_qty, r.qty);
  if n < 1 then raise exception 'Take at least one.'; end if;
  if n > r.qty then raise exception 'The party has only % of those.', r.qty; end if;
  if n = r.qty then
    delete from public.party_items where id = r.id;
  else
    update public.party_items set qty = qty - n, updated_at = now() where id = r.id;
  end if;
  return jsonb_build_object('name', r.name, 'qty', n, 'weight', r.weight, 'note', r.note, 'custom', r.custom,
    'mod', r.mod, 'variant', r.variant, 'left', r.qty - n);
end;
$$;

ALTER FUNCTION public.party_take(p_item uuid, p_qty integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.pc_library_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

ALTER FUNCTION public.pc_library_touch_updated_at() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.player_journal(p_share text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_campaign uuid;
  v_char uuid;
  v_name text;
  v_post jsonb;
  v_beats jsonb;
begin
  select c.id into v_campaign from public.campaigns c where c.share_code = p_share;
  if v_campaign is null then return null; end if;

  select ch.id, ch.name into v_char, v_name
  from public.characters ch
  where ch.campaign_id = v_campaign and ch.kind = 'pc' and ch.profile_id = auth.uid()
  limit 1;
  if v_char is null then
    return jsonb_build_object('character', null);
  end if;

  select d.axis_scores into v_post
  from public.dispositions d
  where d.character_id = v_char and d.source = 'posterior'
  order by d.as_of desc limit 1;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.n nulls last), '[]'::jsonb) into v_beats
  from (
    select s.session_number as n,
           coalesce(nullif(e.payload->>'rationale',''), e.event_type) as summary,
           e.event_type as kind,
           'you'::text as who
    from public.events e
    left join public.sessions s on s.id = e.session_id
    where e.character_id = v_char
    union all
    select s.session_number as n, g.summary as summary, g.kind as kind, 'gm'::text as who
    from public.gm_events g
    left join public.sessions s on s.id = g.session_id
    where g.target_character_id = v_char
  ) b;

  return jsonb_build_object(
    'character', jsonb_build_object('id', v_char, 'name', v_name),
    'posterior', v_post,
    'beats', v_beats
  );
end;
$$;

ALTER FUNCTION public.player_journal(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.prune_growing_tables() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_out jsonb := '{}'::jsonb;
  v_n   integer;
begin
  delete from public.rate_hits where at < now() - interval '2 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('rate_hits', v_n);
  delete from public.addon_outbox where (delivered_at is not null or dropped_at is not null) and created_at < now() - interval '14 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('addon_outbox', v_n);
  delete from public.notifications where (read_at is not null and read_at < now() - interval '90 days') or created_at < now() - interval '365 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('notifications', v_n);
  delete from public.discord_setup_codes where coalesce(used_at, expires_at) < now() - interval '7 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('discord_setup_codes', v_n);
  delete from public.campaign_gm_invites where coalesce(accepted_at, revoked_at, expires_at) < now() - interval '90 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('campaign_gm_invites', v_n);
  delete from public.campaign_transfers where coalesce(accepted_at, cancelled_at, expires_at) < now() - interval '90 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('campaign_transfers', v_n);
  return v_out;
end;
$$;

ALTER FUNCTION public.prune_growing_tables() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.public_campaign(p_slug text) RETURNS TABLE(name text, blurb text, published_at timestamp with time zone, items bigint, codex_cover_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select c.name, c.public_blurb, c.public_published_at,
         (select count(*) from public.public_codex(p_slug)),
         c.codex_cover_url
  from public.campaigns c
  where c.public_slug = p_slug and c.public_published_at is not null;
$$;

ALTER FUNCTION public.public_campaign(p_slug text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.public_campaign_listing(p_slug text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select coalesce(
    (select c.public_listed from public.campaigns c
      where c.public_slug = p_slug and c.public_published_at is not null),
    false);
$$;

ALTER FUNCTION public.public_campaign_listing(p_slug text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.public_campaign_theme(p_slug text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select c.codex_theme
  from public.campaigns c
  where c.public_slug = p_slug and c.public_published_at is not null
  limit 1;
$$;

ALTER FUNCTION public.public_campaign_theme(p_slug text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.public_codex(p_slug text) RETURNS TABLE(item_kind text, item_type text, id uuid, title text, summary text, body text, blocks jsonb, tags text[], slug text, image_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  with camp as (
    select id from public.campaigns
    where public_slug = p_slug and public_published_at is not null
  )
  select 'entry'::text, e.type::text, e.id, e.title, e.summary, e.body, e.blocks, e.tags, e.slug, e.image_url
  from public.entries e, camp
  where e.campaign_id = camp.id and e.is_public
  union all
  -- NPCs bring the portrait the GM already uploaded in the Forge; no summary or blocks of their own.
  select 'npc'::text, 'npc'::text, ch.id, ch.name, null::text, ch.description, null::jsonb, ch.tags,
         public.slugify(ch.name), ch.portrait_url
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'npc' and ch.is_public
  union all
  -- Player characters the PLAYER has opted in (is_public, set by the owner via the existing character
  -- UPDATE policy). Unlike NPCs they carry their own summary + blocks (the player's rich page); the
  -- hero image reuses the Forge portrait. Campaign must still be published (the camp CTE gate).
  select 'pc'::text, 'pc'::text, ch.id, ch.name, ch.summary, ch.description, ch.blocks, ch.tags,
         public.slugify(ch.name), ch.portrait_url
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'pc' and ch.is_public;
$$;

ALTER FUNCTION public.public_codex(p_slug text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.public_codex_links(p_slug text) RETURNS TABLE(source_type text, source_id uuid, target_type text, target_id uuid, relation text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  with camp as (
    select id from public.campaigns
    where public_slug = p_slug and public_published_at is not null
  ),
  pub as (
    -- the publicly visible items, typed the way entity_links refers to them
    select 'entry'::text as etype, e.id
    from public.entries e, camp
    where e.campaign_id = camp.id and e.is_public
    union all
    select 'character'::text, ch.id
    from public.characters ch, camp
    where ch.campaign_id = camp.id and ch.kind in ('npc', 'pc') and ch.is_public
  )
  select l.source_type, l.source_id, l.target_type, l.target_id, l.relation
  from public.entity_links l, camp
  where l.campaign_id = camp.id
    and exists (select 1 from pub p where p.etype = l.source_type and p.id = l.source_id)
    and exists (select 1 from pub p where p.etype = l.target_type and p.id = l.target_id);
$$;

ALTER FUNCTION public.public_codex_links(p_slug text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.public_listed_campaigns() RETURNS TABLE(slug text, name text, published_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select c.public_slug, c.name, c.public_published_at
  from public.campaigns c
  where c.public_published_at is not null
    and c.public_listed
    and c.public_slug is not null
  order by c.public_published_at desc
  limit 5000;
$$;

ALTER FUNCTION public.public_listed_campaigns() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.public_world_snapshot(p_slug text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select wm.snapshot_url
  from public.campaigns c
  join public.world_maps wm on wm.campaign_id = c.id
  where c.public_slug = p_slug
    and c.public_published_at is not null
    and wm.published
    and wm.snapshot_url is not null
  limit 1;
$$;

ALTER FUNCTION public.public_world_snapshot(p_slug text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rate_hit(p_bucket text, p_key text, p_max integer, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_key text := coalesce(nullif(p_key, ''), 'unknown');
begin
  perform pg_advisory_xact_lock(hashtext('public.rate_hit:' || coalesce(p_bucket, '')));
  if (select count(*) from public.rate_hits
       where bucket = p_bucket and key = v_key and at > now() - make_interval(secs => p_window_seconds)) >= p_max then
    return false;
  end if;
  insert into public.rate_hits (bucket, key) values (p_bucket, v_key);
  if random() < 0.02 then delete from public.rate_hits where at < now() - interval '2 days'; end if;
  return true;
end;
$$;

ALTER FUNCTION public.rate_hit(p_bucket text, p_key text, p_max integer, p_window_seconds integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.recaps_for_share(code text) RETURNS TABLE(session_id uuid, session_number integer, recap text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select s.id, s.session_number::int, s.recap
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code
    and s.recap is not null
    and s.status in ('processed', 'completed', 'done')
  order by s.session_number desc nulls last;
$$;

ALTER FUNCTION public.recaps_for_share(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.record_consent_for_share(code text, p_session_number integer, p_character_id uuid, p_consented boolean, p_method text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_campaign uuid;
  v_session uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select id into v_campaign from public.campaigns where share_code = code;
  if v_campaign is null then raise exception 'campaign not found for share'; end if;

  if p_session_number is not null then
    select id into v_session from public.sessions
    where campaign_id = v_campaign and session_number = p_session_number;
  end if;

  if exists (
    select 1 from public.recording_consents
    where campaign_id = v_campaign and profile_id = v_uid
      and session_id is not distinct from v_session
  ) then
    update public.recording_consents
      set consented = p_consented, method = p_method, character_id = p_character_id,
          recorded_by = v_uid, created_at = now()
    where campaign_id = v_campaign and profile_id = v_uid
      and session_id is not distinct from v_session;
  else
    insert into public.recording_consents
      (campaign_id, session_id, character_id, profile_id, consented, method, recorded_by)
    values (v_campaign, v_session, p_character_id, v_uid, p_consented, p_method, v_uid);
  end if;
end;
$$;

ALTER FUNCTION public.record_consent_for_share(code text, p_session_number integer, p_character_id uuid, p_consented boolean, p_method text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.record_context(code text) RETURNS TABLE(campaign_name text, open boolean, session_number integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    c.name,
    exists (select 1 from public.capture_jobs j where j.campaign_id = c.id and j.status = 'draft'),
    (select s.session_number
       from public.capture_jobs j
       join public.sessions s on s.id = j.session_id
      where j.campaign_id = c.id and j.status = 'draft'
      order by j.created_at desc limit 1)
  from public.campaigns c
  where c.share_code = code
  limit 1;
$$;

ALTER FUNCTION public.record_context(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.regenerate_entry_slug(p_entry uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_campaign uuid;
  v_title    text;
  v_slug     text;
begin
  select e.campaign_id, e.title into v_campaign, v_title
  from public.entries e where e.id = p_entry;

  if v_campaign is null then
    raise exception 'No such entry.';
  end if;
  if not public.is_campaign_gm(v_campaign) then
    raise exception 'Only the GM of this campaign can change its URLs.';
  end if;

  -- Passing the entry's own id so the collision check ignores its CURRENT slug: without it, an
  -- entry whose title has not changed would collide with itself and come back as "-2".
  v_slug := public.free_entry_slug(v_campaign, v_title, p_entry);

  update public.entries set slug = v_slug where id = p_entry;
  return v_slug;
end;
$$;

ALTER FUNCTION public.regenerate_entry_slug(p_entry uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.remove_campaign_gm(p_campaign uuid, p_profile uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select gm_id into v_owner from public.campaigns where id = p_campaign;
  if v_owner is null then raise exception 'campaign not found'; end if;
  if p_profile = v_owner then raise exception 'the owner cannot be removed: hand the campaign over instead'; end if;
  if v_uid <> v_owner and v_uid <> p_profile then raise exception 'only the campaign''s owner can remove a co-GM'; end if;
  if exists (select 1 from public.characters ch
              where ch.campaign_id = p_campaign and ch.profile_id = p_profile and ch.kind = 'pc' and coalesce(ch.active, true)) then
    update public.memberships set role = 'player' where campaign_id = p_campaign and profile_id = p_profile and role in ('gm', 'co-gm');
  else
    delete from public.memberships where campaign_id = p_campaign and profile_id = p_profile and role in ('gm', 'co-gm');
  end if;
end;
$$;

ALTER FUNCTION public.remove_campaign_gm(p_campaign uuid, p_profile uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.reserved_slug(p_slug text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select p_slug = any (array[
    'admin','api','auth','login','logout','signup','sign-up','signin','sign-in',
    'new','edit','delete','settings','account','billing','support','help',
    'gm','me','play','chat','codex','journal','record','claim','join','setup',
    'privacy','terms','about','pricing','blog','docs','status','six-axes','sixaxes'
  ]);
$$;

ALTER FUNCTION public.reserved_slug(p_slug text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.reset_my_calendar_token() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.calendar_feeds (profile_id, token) values (auth.uid(), gen_random_uuid())
    on conflict (profile_id) do update set token = gen_random_uuid(), created_at = now()
    returning token into v;
  return v;
end $$;

ALTER FUNCTION public.reset_my_calendar_token() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.resolve_share_code(code text) RETURNS TABLE(campaign_id uuid, campaign_name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select id, name from public.campaigns where share_code = code limit 1;
$$;

ALTER FUNCTION public.resolve_share_code(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.restore_campaign(p_campaign uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_c    public.campaigns;
  v_code text;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if v_c.id is null or v_c.gm_id is distinct from auth.uid() then
    raise exception 'only the campaign''s GM can restore it';
  end if;
  if v_c.deleted_at is null then return; end if;
  if v_c.deleted_at < now() - interval '30 days' then
    raise exception 'this campaign has been in the trash for more than 30 days and is being erased';
  end if;
  v_code := v_c.trash_restore ->> 'share_code';
  -- codes are random, but never hand back one another campaign has taken meanwhile
  if v_code is null or exists (select 1 from public.campaigns o where o.share_code = v_code and o.id <> p_campaign) then
    v_code := substr(md5(gen_random_uuid()::text), 1, 10);
  end if;
  update public.campaigns
     set deleted_at = null,
         share_code = v_code,
         discord_channel_id = coalesce(discord_channel_id, v_c.trash_restore ->> 'discord_channel_id'),
         public_published_at = coalesce(public_published_at, (v_c.trash_restore ->> 'public_published_at')::timestamptz),
         trash_restore = null
   where id = p_campaign;
end;
$$;

ALTER FUNCTION public.restore_campaign(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.restore_scene_snapshot(p_snapshot uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_s     public.scene_snapshots;
  v_scene uuid;
  v_ids   uuid[];
begin
  select * into v_s from public.scene_snapshots where id = p_snapshot;
  if v_s.id is null then raise exception 'snapshot not found'; end if;
  if not public.is_campaign_gm(v_s.campaign_id) then raise exception 'only the GM can restore a scene'; end if;
  v_scene := v_s.scene_id;

  -- the scene as it is now, so this restore can be undone
  perform public.scene_snapshot_take(v_scene, 'Before restoring ' || to_char(v_s.taken_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC', null, auth.uid());

  update public.vtt_scenes
     set fog_on = coalesce((v_s.data -> 'scene' ->> 'fog_on')::boolean, fog_on),
         revealed = decode(coalesce(v_s.data -> 'scene' ->> 'revealed', ''), 'hex'),
         door_state = coalesce(v_s.data -> 'scene' -> 'door_state', '{}'::jsonb),
         settings = coalesce(v_s.data -> 'scene' -> 'settings', settings),
         updated_at = now()
   where id = v_scene;

  -- tokens: the scene's current ones go, and so does any snapshot token now standing on another floor
  select coalesce(array_agg((t ->> 'id')::uuid), '{}') into v_ids from jsonb_array_elements(v_s.data -> 'tokens') t;
  delete from public.vtt_tokens where scene_id = v_scene or id = any (v_ids);
  insert into public.vtt_tokens
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_tokens, t
             || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id,
                  'character_id', case when exists (select 1 from public.characters c where c.id = (t ->> 'character_id')::uuid and c.campaign_id = v_s.campaign_id) then t -> 'character_id' else 'null'::jsonb end,
                  'stat_block_id', case when exists (select 1 from public.stat_blocks b where b.id = (t ->> 'stat_block_id')::uuid) then t -> 'stat_block_id' else 'null'::jsonb end)) as r
      from jsonb_array_elements(v_s.data -> 'tokens') t) q;

  delete from public.vtt_drawings where scene_id = v_scene;
  insert into public.vtt_drawings
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_drawings, d || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id)) as r
      from jsonb_array_elements(v_s.data -> 'drawings') d
     where exists (select 1 from public.profiles pr where pr.id = (d ->> 'owner')::uuid)
       and not exists (select 1 from public.vtt_drawings x where x.id = (d ->> 'id')::uuid)) q;

  delete from public.vtt_templates where scene_id = v_scene;
  insert into public.vtt_templates
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_templates, jt || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id)) as r
      from jsonb_array_elements(v_s.data -> 'templates') jt
     where exists (select 1 from public.profiles pr where pr.id = (jt ->> 'owner')::uuid)
       and not exists (select 1 from public.vtt_templates y where y.id = (jt ->> 'id')::uuid)) q;

  delete from public.vtt_effects where scene_id = v_scene;
  insert into public.vtt_effects
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_effects, e || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id)) as r
      from jsonb_array_elements(v_s.data -> 'effects') e
     where exists (select 1 from public.vtt_tokens t where t.id = (e ->> 'token_id')::uuid)
       and exists (select 1 from public.profiles pr where pr.id = (e ->> 'owner')::uuid)
       and not exists (select 1 from public.vtt_effects y where y.id = (e ->> 'id')::uuid)) q;

  delete from public.vtt_pins where scene_id = v_scene;
  insert into public.vtt_pins
  select (r).* from (
    select jsonb_populate_record(null::public.vtt_pins, jp || jsonb_build_object('scene_id', v_scene, 'campaign_id', v_s.campaign_id,
             'entry_id', case when exists (select 1 from public.entries en where en.id = (jp ->> 'entry_id')::uuid) then jp -> 'entry_id' else 'null'::jsonb end)) as r
      from jsonb_array_elements(v_s.data -> 'pins') jp
     where not exists (select 1 from public.vtt_pins y where y.id = (jp ->> 'id')::uuid)) q;

  return v_scene;
end;
$$;

ALTER FUNCTION public.restore_scene_snapshot(p_snapshot uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.review_proposed_event(p_id uuid, p_accept boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  p   public.proposed_events%rowtype;
  seg public.transcript_segments%rowtype;
  v_axis text; v_frame text; v_target text;
  v_event uuid;
begin
  select * into p from public.proposed_events where id = p_id;
  if not found then raise exception 'proposal not found'; end if;
  if not public.is_campaign_gm(p.campaign_id) then raise exception 'not permitted'; end if;
  if p.status <> 'proposed' then return null; end if;

  if not p_accept then
    update public.proposed_events set status = 'rejected' where id = p_id;
    return null;
  end if;

  if not exists (select 1 from public.event_types where key = p.event_type) then
    raise exception 'unknown event_type %', p.event_type;
  end if;

  v_axis   := case when p.axis   in ('N','T','O','S','E','I') then p.axis end;
  v_frame  := case when p.frame  in ('ic','ooc')              then p.frame end;
  v_target := case when p.target in ('fiction','player','system') then p.target end;

  if p.segment_id is not null then
    select * into seg from public.transcript_segments where id = p.segment_id;
  end if;

  insert into public.events
    (campaign_id, session_id, character_id, event_type, axis, frame, target,
     ts_offset_ms, payload, source, confidence, transcript_span, extractor_version)
  values
    (p.campaign_id, p.session_id, p.character_id, p.event_type, v_axis, v_frame, v_target,
     seg.start_ms,
     case when p.rationale is not null then jsonb_build_object('rationale', p.rationale) end,
     'transcript', p.confidence,
     case when seg.id is not null
          then jsonb_build_object('start_ms', seg.start_ms, 'end_ms', seg.end_ms, 'text', seg.text) end,
     p.extractor_version)
  returning id into v_event;

  update public.proposed_events set status = 'accepted' where id = p_id;
  return v_event;
end; $$;

ALTER FUNCTION public.review_proposed_event(p_id uuid, p_accept boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.revoke_gm_invite(p_invite uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.campaign_gm_invites i set revoked_at = now()
   where i.id = p_invite and i.accepted_at is null and i.revoked_at is null
     and exists (select 1 from public.campaigns c where c.id = i.campaign_id and c.gm_id = auth.uid());
  if not found then raise exception 'that invite is not open, or it is not yours to cancel'; end if;
end;
$$;

ALTER FUNCTION public.revoke_gm_invite(p_invite uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.roster_for_share(code text) RETURNS TABLE(character_id uuid, name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select ch.id, ch.name
  from public.campaigns c
  join public.characters ch on ch.campaign_id = c.id
  where c.share_code = code and ch.kind = 'pc'
  order by ch.name;
$$;

ALTER FUNCTION public.roster_for_share(code text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rsvp_for_share(code text, p_session_id uuid, p_status text, p_display_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_campaign uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_status not in ('going','maybe','declined') then raise exception 'invalid status'; end if;

  select c.id into v_campaign
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code and s.id = p_session_id;
  if v_campaign is null then raise exception 'session not found for share'; end if;

  if p_display_name is not null and length(trim(p_display_name)) > 0 then
    update public.profiles set display_name = p_display_name
    where id = v_uid and (display_name is null or length(trim(display_name)) = 0);
  end if;

  if exists (select 1 from public.attendance where session_id = p_session_id and profile_id = v_uid) then
    update public.attendance set status = p_status
    where session_id = p_session_id and profile_id = v_uid;
  else
    insert into public.attendance (campaign_id, session_id, profile_id, status)
    values (v_campaign, p_session_id, v_uid, p_status);
  end if;
end;
$$;

ALTER FUNCTION public.rsvp_for_share(code text, p_session_id uuid, p_status text, p_display_name text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.rsvps_for_gm(p_session_id uuid) RETURNS TABLE(status text, display_name text, character_name text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.status, p.display_name, ch.name
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  join public.attendance a on a.session_id = s.id
  left join public.profiles p on p.id = a.profile_id
  left join public.characters ch on ch.id = a.character_id
  where s.id = p_session_id
    and public.is_campaign_gm(c.id)
  order by
    case a.status when 'going' then 0 when 'maybe' then 1 when 'declined' then 2 else 3 end,
    p.display_name nulls last;
$$;

ALTER FUNCTION public.rsvps_for_gm(p_session_id uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.scene_snapshot_take(p_scene uuid, p_label text, p_session uuid, p_by uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_sc public.vtt_scenes;
  v_id uuid;
begin
  select * into v_sc from public.vtt_scenes where id = p_scene;
  if v_sc.id is null then raise exception 'scene not found'; end if;
  insert into public.scene_snapshots (campaign_id, scene_id, session_id, label, taken_by, data)
  values (v_sc.campaign_id, v_sc.id, p_session, left(coalesce(nullif(trim(p_label), ''), 'Snapshot'), 120), p_by,
    jsonb_build_object(
      'scene', jsonb_build_object('fog_on', v_sc.fog_on, 'revealed', encode(coalesce(v_sc.revealed, '\x'::bytea), 'hex'),
                                  'door_state', coalesce(v_sc.door_state, '{}'::jsonb), 'settings', coalesce(v_sc.settings, '{}'::jsonb)),
      'tokens',    coalesce((select jsonb_agg(to_jsonb(tok)) from public.vtt_tokens tok where tok.scene_id = p_scene), '[]'::jsonb),
      'drawings',  coalesce((select jsonb_agg(to_jsonb(drw)) from public.vtt_drawings drw where drw.scene_id = p_scene), '[]'::jsonb),
      'templates', coalesce((select jsonb_agg(to_jsonb(tpl)) from public.vtt_templates tpl where tpl.scene_id = p_scene), '[]'::jsonb),
      'effects',   coalesce((select jsonb_agg(to_jsonb(eff)) from public.vtt_effects eff where eff.scene_id = p_scene), '[]'::jsonb),
      'pins',      coalesce((select jsonb_agg(to_jsonb(pin)) from public.vtt_pins pin where pin.scene_id = p_scene), '[]'::jsonb)))
  returning id into v_id;
  -- keep the newest 20 for this scene
  delete from public.scene_snapshots s
   where s.scene_id = p_scene
     and s.id not in (select id from public.scene_snapshots where scene_id = p_scene order by taken_at desc limit 20);
  return v_id;
end;
$$;

ALTER FUNCTION public.scene_snapshot_take(p_scene uuid, p_label text, p_session uuid, p_by uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.scene_snapshots_for(p_scene uuid) RETURNS TABLE(id uuid, label text, taken_at timestamp with time zone, session_number integer, tokens integer, drawings integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select s.id, s.label, s.taken_at, se.session_number,
         jsonb_array_length(s.data -> 'tokens'), jsonb_array_length(s.data -> 'drawings')
    from public.scene_snapshots s
    left join public.sessions se on se.id = s.session_id
   where s.scene_id = p_scene and public.is_campaign_gm(s.campaign_id)
   order by s.taken_at desc;
$$;

ALTER FUNCTION public.scene_snapshots_for(p_scene uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.schema_health() RETURNS TABLE(check_key text, label text, ok boolean, detail text, migration text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'storage', 'pg_catalog'
    AS $$
  select 'portrait_player'::text,
         'Players can upload portraits for their own characters'::text,
         exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                   and policyname='player writes own pc portrait'),
         'storage.objects policy "player writes own pc portrait"'::text,
         'p14-portrait-uploads.sql'::text
  union all
  select 'portrait_statblock',
         'GMs can upload portraits for their own monster stat blocks',
         exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                   and policyname='gm writes own statblock portrait'),
         'storage.objects policy "gm writes own statblock portrait"',
         'p14-portrait-uploads.sql'
  union all
  select 'portrait_helpers',
         'The portrait policies can actually see who owns what',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public'
             and p.proname in ('can_write_character_portrait','can_write_statblock_portrait')) = 2,
         'functions public.can_write_character_portrait / can_write_statblock_portrait',
         'p17-portrait-policy-definer.sql'
  union all
  select 'map_path_guard',
         'Uploads outside a campaign folder do not abort on a bad path',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='is_campaign_gm_segment'),
         'function public.is_campaign_gm_segment',
         'p18-map-policy-uuid-guard.sql'
  union all
  select 'room_capture',
         'In-person sessions can be recorded from one microphone',
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='audio_tracks' and column_name='kind')
         and exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='capture_jobs'
                    and column_name='room_consent_by'),
         'audio_tracks.kind and capture_jobs.room_consent_by',
         'p19-room-capture.sql'
  union all
  select 'pc_library',
         'Players can save reusable character builds',
         to_regclass('public.pc_library') is not null,
         'table public.pc_library',
         'p13-pc-library.sql'
  union all
  select 'character_identities',
         'Characters link across campaigns',
         to_regclass('public.character_identities') is not null,
         'table public.character_identities',
         'p15-character-identities.sql'
  union all
  select 'capture_heartbeat',
         'The voice sidecar can claim and recover recordings',
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='capture_control'
                    and column_name='heartbeat_at'),
         'column public.capture_control.heartbeat_at',
         'p7-capture-heartbeat.sql'
$$;

ALTER FUNCTION public.schema_health() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.session_consent_ok(p_session uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with s as (
    select id, campaign_id from public.sessions where id = p_session
  ),
  present as (
    select a.character_id
    from public.attendance a
    where a.session_id = p_session
      and a.status in ('present', 'late', 'partial')
      and a.character_id is not null
  ),
  blanket as (  -- characters with standing (campaign-wide) consent
    select rc.character_id
    from public.recording_consents rc, s
    where rc.campaign_id = s.campaign_id
      and rc.session_id is null
      and rc.consented
  ),
  optout as (   -- characters the GM opted out of THIS session
    select rc.character_id
    from public.recording_consents rc
    where rc.session_id = p_session
      and rc.consented = false
  ),
  room as (     -- in-person: the GM affirmed the whole room agreed, before recording started
    select 1
    from public.capture_jobs j
    where j.session_id = p_session
      and j.room_consent_at is not null
      and exists (
        select 1 from public.audio_tracks a
        where a.job_id = j.id and a.kind = 'room'
      )
  )
  select
    exists (select 1 from room)
    or (
      -- at least one recordable character: consented and not opted out
      exists (
        select 1 from present p
        where p.character_id in (select character_id from blanket)
          and p.character_id not in (select character_id from optout)
      )
      -- and nobody present is un-consented AND not excluded
      and not exists (
        select 1 from present p
        where p.character_id not in (select character_id from blanket)
          and p.character_id not in (select character_id from optout)
      )
    );
$$;

ALTER FUNCTION public.session_consent_ok(p_session uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_my_email_digest(p_on boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_email text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then raise exception 'your account has no email address'; end if;
  insert into public.email_prefs (email, digest, updated_at) values (v_email, coalesce(p_on, false), now())
  on conflict (email) do update set digest = excluded.digest, updated_at = now();
end;
$$;

ALTER FUNCTION public.set_my_email_digest(p_on boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_my_email_prefs(p_reminders boolean, p_recaps boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_email text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then raise exception 'your account has no email address'; end if;
  insert into public.email_prefs (email, reminders, recaps, updated_at)
  values (v_email, coalesce(p_reminders, true), coalesce(p_recaps, true), now())
  on conflict (email) do update
    set reminders = excluded.reminders, recaps = excluded.recaps, updated_at = now();
end;
$$;

ALTER FUNCTION public.set_my_email_prefs(p_reminders boolean, p_recaps boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_my_recording_consent(p_campaign uuid, p_consented boolean) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_ch  record;
  v_n   integer := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_consented is null then raise exception 'say yes or no'; end if;
  for v_ch in
    select ch.id from public.characters ch
     where ch.campaign_id = p_campaign and ch.profile_id = v_uid and ch.kind = 'pc'
  loop
    update public.recording_consents
       set consented = p_consented, method = 'player_web', profile_id = v_uid, recorded_by = v_uid, created_at = now()
     where campaign_id = p_campaign and character_id = v_ch.id and session_id is null;
    if not found then
      insert into public.recording_consents (campaign_id, session_id, character_id, profile_id, consented, method, recorded_by)
      values (p_campaign, null, v_ch.id, v_uid, p_consented, 'player_web', v_uid);
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'you have no character in that campaign'; end if;
  return v_n;
end;
$$;

ALTER FUNCTION public.set_my_recording_consent(p_campaign uuid, p_consented boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_public_slug(p_campaign uuid, p_slug text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
declare
  s text;
begin
  if not public.is_campaign_gm(p_campaign) then
    raise exception 'Only the GM of this campaign can change its address.';
  end if;

  s := lower(trim(coalesce(p_slug, '')));

  if s = '' then
    raise exception 'Give the address some text.';
  end if;
  if length(s) < 3 or length(s) > 40 then
    raise exception 'An address has to be between 3 and 40 characters.';
  end if;
  -- Letters, digits and single inner hyphens. No leading or trailing hyphen, because a trailing one
  -- is invisible when someone reads the link aloud and produces a 404 nobody can explain.
  if s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Use lowercase letters, numbers and hyphens only, and do not start or end with a hyphen.';
  end if;
  if public.reserved_slug(s) then
    raise exception 'That address is reserved. Pick another.';
  end if;

  -- Only for a campaign that has asked to be findable. See the note at the top: on an unlisted
  -- campaign the random address IS the privacy, and replacing it with a guessable one would quietly
  -- remove a protection the GM never agreed to give up.
  if not exists (
    select 1 from public.campaigns
    where id = p_campaign and public_listed and public_published_at is not null
  ) then
    raise exception 'Publish the campaign and turn on search indexing first. While a campaign is unlisted, its random address is what keeps it private.';
  end if;

  if exists (select 1 from public.campaigns where public_slug = s and id <> p_campaign) then
    raise exception 'Another campaign already uses that address.';
  end if;

  update public.campaigns set public_slug = s where id = p_campaign;
  return s;
end;
$_$;

ALTER FUNCTION public.set_public_slug(p_campaign uuid, p_slug text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin new.updated_at = now(); return new; end; $$;

ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.slugify(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  with cleaned as (
    select trim(both '-' from
      regexp_replace(
        regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g')) as s
  )
  select nullif(
    case
      when length(s) <= 60 then s
      -- Back up to the last hyphen inside the limit so the cut lands between words.
      else trim(both '-' from left(s, 60 - position('-' in reverse(left(s, 61)))))
    end, '')
  from cleaned;
$$;

ALTER FUNCTION public.slugify(p_text text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.snapshot_campaign_scenes_at_close(p_campaign uuid, p_session uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_scene uuid;
  v_n     integer := 0;
  v_num   integer;
begin
  select session_number into v_num from public.sessions where id = p_session;
  for v_scene in select id from public.vtt_scenes where campaign_id = p_campaign loop
    perform public.scene_snapshot_take(v_scene, 'End of ' || case when v_num is null then 'a session' else 'Session ' || v_num end, p_session, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

ALTER FUNCTION public.snapshot_campaign_scenes_at_close(p_campaign uuid, p_session uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.snapshot_scene(p_scene uuid, p_label text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_c uuid;
begin
  select campaign_id into v_c from public.vtt_scenes where id = p_scene;
  if v_c is null or not public.is_campaign_gm(v_c) then raise exception 'only the GM can snapshot a scene'; end if;
  return public.scene_snapshot_take(p_scene, coalesce(nullif(trim(p_label), ''), 'Saved by hand'), null, auth.uid());
end;
$$;

ALTER FUNCTION public.snapshot_scene(p_scene uuid, p_label text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.submit_vibe_check(code text, p_session_number integer, p_satisfaction integer, p_spotlight text, p_note text, p_player_name text, p_anonymous boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_campaign uuid;
  v_session  uuid;
  v_uid      uuid := auth.uid();
begin
  -- Still required. The caller has to be SOMEBODY for the share link to be checked at all; being
  -- anonymous is about what is STORED, not about skipping the gate.
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select c.id, s.id into v_campaign, v_session
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code and s.session_number = p_session_number
  limit 1;
  if v_session is null then
    raise exception 'invalid link or session';
  end if;

  if p_satisfaction is not null and (p_satisfaction < 1 or p_satisfaction > 5) then
    raise exception 'satisfaction out of range';
  end if;
  if p_spotlight is not null
     and p_spotlight not in ('wanted_more','about_right','wanted_less') then
    raise exception 'invalid spotlight value';
  end if;

  if coalesce(p_anonymous, false) then
    -- No profile_id, so no upsert: there is deliberately nothing to match against. The name is
    -- forced null even if one was typed, because a form that lets you tick "anonymous" and still
    -- sends your name is a trap rather than a choice.
    insert into public.vibe_checks
      (campaign_id, session_id, profile_id, satisfaction, spotlight_feeling, note, player_name, created_at)
    values
      (v_campaign, v_session, null, p_satisfaction, p_spotlight,
       nullif(trim(p_note), ''), null, date_trunc('hour', now()));
    return;
  end if;

  -- the signup trigger normally makes this; ensure it for anon players
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  insert into public.vibe_checks
    (campaign_id, session_id, profile_id, satisfaction, spotlight_feeling, note, player_name)
  values
    (v_campaign, v_session, v_uid, p_satisfaction, p_spotlight,
     nullif(trim(p_note), ''), nullif(trim(p_player_name), ''))
  on conflict (session_id, profile_id) do update
    set satisfaction      = excluded.satisfaction,
        spotlight_feeling = excluded.spotlight_feeling,
        note              = excluded.note,
        player_name       = excluded.player_name,
        created_at        = now();
end;
$$;

ALTER FUNCTION public.submit_vibe_check(code text, p_session_number integer, p_satisfaction integer, p_spotlight text, p_note text, p_player_name text, p_anonymous boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.sync_my_email() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_email text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select u.email into v_email from auth.users u where u.id = auth.uid();
  if nullif(v_email, '') is not null then
    update public.profiles set email = v_email, updated_at = now()
     where id = auth.uid() and email is distinct from v_email;
  end if;
  return v_email;
end;
$$;

ALTER FUNCTION public.sync_my_email() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_activate_scene(p_scene uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_campaign uuid;
begin
  select campaign_id into v_campaign from public.vtt_scenes where id = p_scene;
  if v_campaign is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_campaign) then raise exception 'only the GM can change the scene'; end if;
  update public.vtt_scenes set is_active = false, updated_at = now() where campaign_id = v_campaign and is_active and id <> p_scene;
  update public.vtt_scenes set is_active = true, updated_at = now() where id = p_scene;
  delete from public.vtt_scene_players where campaign_id = v_campaign;
end;
$$;

ALTER FUNCTION public.tabletop_activate_scene(p_scene uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_can_edit_token(p_token uuid, p_campaign uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

ALTER FUNCTION public.tabletop_can_edit_token(p_token uuid, p_campaign uuid) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE IF NOT EXISTS public.vtt_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deck_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    name text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    suit text,
    rank text,
    pile text DEFAULT 'draw'::text NOT NULL,
    holder uuid,
    face_up boolean DEFAULT false NOT NULL,
    played_by uuid,
    ord integer DEFAULT 0 NOT NULL,
    moved_at timestamp with time zone DEFAULT now() NOT NULL,
    image_path text,
    given_by uuid,
    CONSTRAINT vtt_cards_body_check CHECK ((char_length(body) <= 600)),
    CONSTRAINT vtt_cards_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 80))),
    CONSTRAINT vtt_cards_picture_folder CHECK (((image_path IS NULL) OR (image_path ~ (('^'::text || (campaign_id)::text) || '/cards/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'::text)))),
    CONSTRAINT vtt_cards_pile_check CHECK ((pile = ANY (ARRAY['draw'::text, 'hand'::text, 'table'::text, 'discard'::text]))),
    CONSTRAINT vtt_cards_rank_check CHECK ((rank ~ '^(A|[2-9]|10|J|Q|K|R|B)$'::text)),
    CONSTRAINT vtt_cards_suit_check CHECK ((suit = ANY (ARRAY['hearts'::text, 'diamonds'::text, 'clubs'::text, 'spades'::text, 'joker'::text])))
);

ALTER TABLE public.vtt_cards OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_card_json(c public.vtt_cards, p_show boolean) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object('id', c.id, 'deckId', c.deck_id, 'pile', c.pile, 'faceUp', c.face_up,
                            'holder', c.holder, 'playedBy', c.played_by, 'givenBy', c.given_by, 'shown', p_show)
      || case when p_show then jsonb_build_object('name', c.name, 'body', c.body, 'suit', c.suit, 'rank', c.rank,
                                                  'picture', public.tabletop_file_url(c.image_path)) else '{}'::jsonb end;
$$;

ALTER FUNCTION public.tabletop_card_json(c public.vtt_cards, p_show boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_card_move(p_card uuid, p_to text, p_face_up boolean DEFAULT true, p_holder uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_c    public.vtt_cards;
  v_d    public.vtt_decks;
  v_gm   boolean;
  v_to   uuid;
  v_ord  integer;
  v_up   boolean := coalesce(p_face_up, true);
  v_msg  text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_to not in ('table', 'discard', 'hand', 'draw') then raise exception 'cards go to the table, the discards, a hand or the deck'; end if;
  select * into v_c from public.vtt_cards where id = p_card for update;
  if v_c.id is null then raise exception 'card not found'; end if;
  select * into v_d from public.vtt_decks where id = v_c.deck_id;
  v_gm := public.is_campaign_gm(v_c.campaign_id);
  if not v_gm then
    if not public.tabletop_is_player(v_c.campaign_id) then raise exception 'not at this table'; end if;
    if not ((v_c.pile = 'hand' and v_c.holder = v_uid) or (v_c.pile = 'table' and v_c.played_by = v_uid)) then
      raise exception 'that card is not yours to move';
    end if;
    if p_to = 'draw' then raise exception 'only the GM puts cards back in the deck'; end if;
  end if;

  if p_to = 'hand' then
    v_to := coalesce(p_holder, v_uid);
    if not public.tabletop_card_seat(v_c.campaign_id, v_to) then raise exception 'that person is not at this table'; end if;
  end if;

  -- where it goes in its new pile: on top of the deck, or after what is already there
  if p_to = 'draw' then
    select coalesce(min(ord), 1) - 1 into v_ord from public.vtt_cards where deck_id = v_c.deck_id and pile = 'draw';
  elsif p_to = 'discard' then
    select coalesce(max(ord), 0) + 1 into v_ord from public.vtt_cards where deck_id = v_c.deck_id and pile = 'discard';
  elsif p_to = 'table' then
    v_ord := case when v_c.pile = 'table' then v_c.ord
                  else (select coalesce(max(ord), 0) + 1 from public.vtt_cards where campaign_id = v_c.campaign_id and pile = 'table') end;
  else
    select coalesce(max(ord), 0) + 1 into v_ord from public.vtt_cards where campaign_id = v_c.campaign_id and pile = 'hand' and holder = v_to;
  end if;

  -- what chat says: a card's name only once everyone can see it
  v_msg := case
    when p_to = 'table' and v_c.pile = 'table' and v_up and not v_c.face_up then format('reveals %s', v_c.name)
    when p_to = 'table' and v_c.pile = 'table' and not v_up and v_c.face_up then format('turns %s face down', v_c.name)
    when p_to = 'table' and v_c.pile = 'table' then null
    when p_to = 'table' and v_up then format('plays %s', v_c.name)
    when p_to = 'table' then 'plays a card face down'
    when p_to = 'discard' then format('discards %s', v_c.name)
    when p_to = 'draw' then format('puts a card back on top of %s', v_d.name)
    when v_to = v_uid and v_c.pile = 'table' then format('takes back %s', case when v_c.face_up then v_c.name else 'a card' end)
    when v_to = v_uid then null
    when v_c.pile in ('draw', 'discard') then format('gives %s a card from %s', public.tabletop_seat_name(v_c.campaign_id, v_to), v_d.name)
    else format('passes a card to %s', public.tabletop_seat_name(v_c.campaign_id, v_to)) end;

  update public.vtt_cards
     set pile = p_to,
         holder = case when p_to = 'hand' then v_to end,
         face_up = case when p_to = 'table' then v_up when p_to = 'discard' then true else false end,
         played_by = case when p_to = 'table' then coalesce(case when v_c.pile = 'table' then v_c.played_by end, v_uid) end,
         given_by = case when p_to = 'hand' and v_to <> v_uid then v_uid end,
         ord = v_ord,
         moved_at = now()
   where id = p_card;
  if v_msg is not null then perform public.tabletop_card_say(v_c.campaign_id, v_msg); end if;
end;
$$;

ALTER FUNCTION public.tabletop_card_move(p_card uuid, p_to text, p_face_up boolean, p_holder uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_card_say(p_campaign uuid, p_body text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  insert into public.vtt_messages (campaign_id, session_id, author_profile, kind, body)
  values (p_campaign, public.tabletop_open_session(p_campaign), auth.uid(), 'emote', left(p_body, 2000));
$$;

ALTER FUNCTION public.tabletop_card_say(p_campaign uuid, p_body text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_card_seat(p_campaign uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select p_uid is not null and (
    public.campaign_gm_of(p_campaign, p_uid)
    or exists (select 1 from public.characters c where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = p_uid));
$$;

ALTER FUNCTION public.tabletop_card_seat(p_campaign uuid, p_uid uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_card_use(p_card uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_c   public.vtt_cards;
  v_ord integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_c from public.vtt_cards where id = p_card for update;
  if v_c.id is null then raise exception 'card not found'; end if;
  if not ((v_c.pile = 'hand' and v_c.holder = v_uid) or (v_c.pile = 'table' and v_c.played_by = v_uid)) then
    raise exception 'that card is not yours to use';
  end if;
  if not public.is_campaign_gm(v_c.campaign_id) and not public.tabletop_is_player(v_c.campaign_id) then raise exception 'not at this table'; end if;
  select coalesce(max(ord), 0) + 1 into v_ord from public.vtt_cards where deck_id = v_c.deck_id and pile = 'discard';
  update public.vtt_cards
     set pile = 'discard', holder = null, face_up = true, played_by = null, given_by = null, ord = v_ord, moved_at = now()
   where id = p_card;
  perform public.tabletop_card_say(v_c.campaign_id,
    format('uses %s', v_c.name) || case when coalesce(trim(v_c.body), '') <> '' then ': ' || left(trim(v_c.body), 300) else '' end);
end;
$$;

ALTER FUNCTION public.tabletop_card_use(p_card uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_cards(p_campaign uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_gm  boolean;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  return jsonb_build_object(
    'decks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.name, 'kind', d.kind, 'backColor', d.back_color, 'playersDraw', d.players_draw,
               'back', public.tabletop_file_url(d.back_path),
               'total', (select count(*) from public.vtt_cards c where c.deck_id = d.id),
               'draw', (select count(*) from public.vtt_cards c where c.deck_id = d.id and c.pile = 'draw'),
               'discard', (select count(*) from public.vtt_cards c where c.deck_id = d.id and c.pile = 'discard'),
               'discardTop', (select public.tabletop_card_json(c, true) from public.vtt_cards c
                               where c.deck_id = d.id and c.pile = 'discard' order by c.ord desc limit 1))
             order by d.created_at), '[]'::jsonb)
        from public.vtt_decks d where d.campaign_id = p_campaign),
    'table', (
      select coalesce(jsonb_agg(public.tabletop_card_json(c, c.face_up or v_gm or c.played_by = v_uid) order by c.ord), '[]'::jsonb)
        from public.vtt_cards c where c.campaign_id = p_campaign and c.pile = 'table'),
    'hand', (
      select coalesce(jsonb_agg(public.tabletop_card_json(c, true) order by c.ord), '[]'::jsonb)
        from public.vtt_cards c where c.campaign_id = p_campaign and c.pile = 'hand' and c.holder = v_uid),
    'hands', (
      select coalesce(jsonb_agg(jsonb_build_object('holder', h.holder, 'name', public.tabletop_seat_name(p_campaign, h.holder), 'count', h.n)
             order by h.holder), '[]'::jsonb)
        from (select holder, count(*) as n from public.vtt_cards
               where campaign_id = p_campaign and pile = 'hand' and holder is not null group by holder) h),
    'others', case when v_gm then (
      select coalesce(jsonb_agg(public.tabletop_card_json(c, true) order by c.holder, c.ord), '[]'::jsonb)
        from public.vtt_cards c where c.campaign_id = p_campaign and c.pile = 'hand' and c.holder is distinct from v_uid) end
  );
end;
$$;

ALTER FUNCTION public.tabletop_cards(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_cards_to_hand(p_deck uuid, p_to uuid, p_count integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_d   public.vtt_decks;
  v_n   integer := greatest(1, least(coalesce(p_count, 1), 10));
  v_got integer;
begin
  -- one draw at a time per deck, so two people never take the same card
  select * into v_d from public.vtt_decks where id = p_deck for update;
  with top as (
    select id, ord from public.vtt_cards where deck_id = p_deck and pile = 'draw' order by ord limit v_n for update
  ), numbered as (
    select id, row_number() over (order by ord) as rn from top
  ), base as (
    select coalesce(max(ord), 0) as m from public.vtt_cards where campaign_id = v_d.campaign_id and pile = 'hand' and holder = p_to
  )
  update public.vtt_cards c
     set pile = 'hand', holder = p_to, face_up = false, played_by = null, ord = base.m + numbered.rn, moved_at = now(),
         given_by = case when p_to is distinct from auth.uid() then auth.uid() end
    from numbered, base
   where c.id = numbered.id;
  get diagnostics v_got = row_count;
  if v_got = 0 then raise exception '% is empty: shuffle the discards back in first', v_d.name; end if;
  return v_got;
end;
$$;

ALTER FUNCTION public.tabletop_cards_to_hand(p_deck uuid, p_to uuid, p_count integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_combat(p_campaign uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_uid uuid := auth.uid();
  v_gm  boolean;
  v_cb  public.combats;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;

  select * into v_cb from public.combats
  where campaign_id = p_campaign and status = 'active'
  order by updated_at desc limit 1;
  if v_cb.id is null then return null; end if;

  return jsonb_build_object(
    'id', v_cb.id,
    'name', v_cb.name,
    'round', v_cb.round,
    'order', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',          e.c ->> 'id',
          'name',        e.c ->> 'name',
          'kind',        e.c ->> 'kind',
          'initiative',  e.c -> 'initiative',
          'defeated',    coalesce((e.c ->> 'defeated')::boolean, false),
          'is_turn',     (e.ord - 1) = v_cb.turn,
          'tokenId',     e.c -> 'tokenId',
          'characterId', e.c -> 'characterId',
          'conditions',  coalesce(e.c -> 'conditions', '[]'::jsonb),
          'mine',        o.mine,
          'awaitingSave', jsonb_typeof(e.c -> 'pendingSaves') = 'array' and jsonb_array_length(e.c -> 'pendingSaves') > 0
        )
        || case when e.c ->> 'kind' = 'pc' then jsonb_build_object(
             'hp',     e.c -> 'hp',
             'maxHp',  e.c -> 'maxHp',
             'tempHp', e.c -> 'tempHp')
           else '{}'::jsonb end
        || case when (e.ord - 1) = v_cb.turn and not o.mine then jsonb_build_object(
             'turnUsed', jsonb_build_object(
               'action', (public.combat_econ(e.c) ->> 'action')::boolean,
               'bonus',  (public.combat_econ(e.c) ->> 'bonus')::boolean,
               'moved',  (public.combat_econ(e.c) ->> 'moved')::integer))
           else '{}'::jsonb end
        || case when o.mine then jsonb_build_object(
             'ac', e.c -> 'ac',
             'pendingSaves', coalesce(case when jsonb_typeof(e.c -> 'pendingSaves') = 'array' then e.c -> 'pendingSaves' end, '[]'::jsonb),
             'lastSave', e.c -> 'lastSave',
             'econ', public.combat_econ(e.c) - 'log'
                     || jsonb_build_object('log', coalesce((select jsonb_agg(l - 'prev' order by o2) from jsonb_array_elements(public.combat_econ(e.c) -> 'log') with ordinality as x(l, o2)), '[]'::jsonb)),
             'speed', e.c -> 'speed',
             'speedNow', public.combat_speed(e.c),
             'attacksPerAction', coalesce(e.c -> 'attacksPerAction', '1'::jsonb),
             'cantAct', public.combat_cant_act(e.c))
           else '{}'::jsonb end
        order by e.ord), '[]'::jsonb)
      from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord),
           lateral (select (e.c ->> 'kind') = 'pc'
                       and coalesce(e.c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
                       and exists (select 1 from public.characters ch
                                   where ch.id = (e.c ->> 'characterId')::uuid and ch.profile_id = v_uid) as mine) o
      where not coalesce((e.c ->> 'hidden')::boolean, false)
    )
  );
end;
$_$;

ALTER FUNCTION public.tabletop_combat(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_deck_deal(p_deck uuid, p_to uuid, p_count integer DEFAULT 1) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_d   public.vtt_decks;
  v_got integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_d from public.vtt_decks where id = p_deck;
  if v_d.id is null then raise exception 'deck not found'; end if;
  if not public.is_campaign_gm(v_d.campaign_id) then raise exception 'only the GM deals'; end if;
  if not public.tabletop_card_seat(v_d.campaign_id, p_to) then raise exception 'that person is not at this table'; end if;
  v_got := public.tabletop_cards_to_hand(p_deck, p_to, p_count);
  perform public.tabletop_card_say(v_d.campaign_id, format('deals %s from %s to %s',
    case when v_got = 1 then 'a card' else v_got || ' cards' end, v_d.name, public.tabletop_seat_name(v_d.campaign_id, p_to)));
  return v_got;
end;
$$;

ALTER FUNCTION public.tabletop_deck_deal(p_deck uuid, p_to uuid, p_count integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_deck_draw(p_deck uuid, p_count integer DEFAULT 1) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_d   public.vtt_decks;
  v_got integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_d from public.vtt_decks where id = p_deck;
  if v_d.id is null then raise exception 'deck not found'; end if;
  if not public.is_campaign_gm(v_d.campaign_id) then
    if not public.tabletop_is_player(v_d.campaign_id) then raise exception 'not at this table'; end if;
    if not v_d.players_draw then raise exception 'only the GM draws from %', v_d.name; end if;
  end if;
  v_got := public.tabletop_cards_to_hand(p_deck, v_uid, p_count);
  perform public.tabletop_card_say(v_d.campaign_id, format('draws %s from %s', case when v_got = 1 then 'a card' else v_got || ' cards' end, v_d.name));
  return v_got;
end;
$$;

ALTER FUNCTION public.tabletop_deck_draw(p_deck uuid, p_count integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_deck_shuffle(p_deck uuid, p_all boolean DEFAULT false) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_d public.vtt_decks;
  v_n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_d from public.vtt_decks where id = p_deck for update;
  if v_d.id is null then raise exception 'deck not found'; end if;
  if not public.is_campaign_gm(v_d.campaign_id) then raise exception 'only the GM shuffles'; end if;
  if coalesce(p_all, false) then
    update public.vtt_cards set pile = 'draw', holder = null, face_up = false, played_by = null, moved_at = now()
     where deck_id = p_deck and pile <> 'draw';
  else
    update public.vtt_cards set pile = 'draw', face_up = false, moved_at = now() where deck_id = p_deck and pile = 'discard';
  end if;
  update public.vtt_cards c set ord = s.rn
    from (select id, row_number() over (order by gen_random_uuid()) as rn from public.vtt_cards where deck_id = p_deck and pile = 'draw') s
   where c.id = s.id;
  select count(*) into v_n from public.vtt_cards where deck_id = p_deck and pile = 'draw';
  perform public.tabletop_card_say(v_d.campaign_id,
    case when coalesce(p_all, false) then format('gathers every card and shuffles %s', v_d.name) else format('shuffles %s', v_d.name) end);
  return v_n;
end;
$$;

ALTER FUNCTION public.tabletop_deck_shuffle(p_deck uuid, p_all boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_difficult_extra(p_cells jsonb, p_n integer, p_ax double precision, p_ay double precision, p_bx double precision, p_by double precision, p_base integer, p_fps real) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
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
$_$;

ALTER FUNCTION public.tabletop_difficult_extra(p_cells jsonb, p_n integer, p_ax double precision, p_ay double precision, p_bx double precision, p_by double precision, p_base integer, p_fps real) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_effect_kinds() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  select array['fire', 'cold', 'acid', 'lightning', 'poison', 'darkness', 'fog', 'radiant', 'necrotic']::text[];
$$;

ALTER FUNCTION public.tabletop_effect_kinds() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_feed(p_campaign uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 200) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

ALTER FUNCTION public.tabletop_feed(p_campaign uuid, p_since timestamp with time zone, p_limit integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_feed_signal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_c uuid;
begin
  for v_c in select distinct campaign_id from new_rows where campaign_id is not null loop
    begin
      perform realtime.send('{}'::jsonb, 'feed', 'tabletop:' || v_c::text, true);
      perform realtime.send('{}'::jsonb, 'feed', 'tabletop:' || v_c::text, false);
    exception when others then
      null; -- a missed announcement only means the table picks the roll up on its next poll
    end;
  end loop;
  return null;
end;
$$;

ALTER FUNCTION public.tabletop_feed_signal() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_feet(p_dx real, p_dy real, p_rule text, p_fps real) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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
$$;

ALTER FUNCTION public.tabletop_feet(p_dx real, p_dy real, p_rule text, p_fps real) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_file_in_use(p_path text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.vtt_handouts where image_path = p_path)
      or exists (select 1 from public.vtt_decks where back_path = p_path)
      or exists (select 1 from public.vtt_cards where image_path = p_path);
$$;

ALTER FUNCTION public.tabletop_file_in_use(p_path text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_file_ok(p_campaign uuid, p_path text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_path is null or p_path !~ ('^' || p_campaign::text || '/(handouts|cards|decks)/[0-9a-f-]{36}\.(png|jpg|webp|gif)$') then
    return false;
  end if;
  if public.is_campaign_gm(p_campaign) then return true; end if;
  if not public.tabletop_is_player(p_campaign) then return false; end if;
  return exists (
           select 1 from public.vtt_handouts h
            where h.campaign_id = p_campaign and h.image_path = p_path
              and (h.shown_to is null or exists (
                    select 1 from public.characters me
                     where me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = v_uid and me.id = any (h.shown_to))))
      or exists (select 1 from public.vtt_decks d where d.campaign_id = p_campaign and d.back_path = p_path)
      or exists (
           select 1 from public.vtt_cards c
            where c.campaign_id = p_campaign and c.image_path = p_path
              and ((c.pile = 'hand' and c.holder = v_uid)
                   or (c.pile = 'table' and (c.face_up or c.played_by = v_uid))
                   or c.pile = 'discard'));
end;
$_$;

ALTER FUNCTION public.tabletop_file_ok(p_campaign uuid, p_path text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_file_url(p_path text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case when p_path is null then null
              else '/api/tabletop/table-file?c=' || split_part(p_path, '/', 1) || '&p=' || p_path end;
$$;

ALTER FUNCTION public.tabletop_file_url(p_path text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_floors(p_scene uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_sc  public.vtt_scenes;
  v_gm  boolean;
  v_m   public.battle_maps;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_sc from public.vtt_scenes where id = p_scene;
  if v_sc.id is null then raise exception 'scene not found'; end if;
  v_gm := public.is_campaign_gm(v_sc.campaign_id);
  if not v_gm then
    if not public.tabletop_is_player(v_sc.campaign_id) then raise exception 'not at this table'; end if;
    if public.tabletop_scene_for(v_sc.campaign_id, v_uid) is distinct from p_scene then return '[]'::jsonb; end if;
  end if;
  select * into v_m from public.battle_maps where id = v_sc.battle_map_id;
  -- one scene per floor: the active one, else the most recently changed
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'level', f.level,
             'name', coalesce(nullif(v_m.meta -> 'levelNames' ->> f.level, ''), 'Level ' || (f.level + 1)),
             'current', f.id = p_scene)
           || case when v_gm then jsonb_build_object('sceneId', f.id, 'active', f.is_active) else '{}'::jsonb end
           order by f.level)
      from (select distinct on (s.level) s.id, s.level, s.is_active from public.vtt_scenes s
             where s.campaign_id = v_sc.campaign_id and s.battle_map_id = v_sc.battle_map_id
             order by s.level, (s.id = p_scene) desc, s.is_active desc, s.updated_at desc) f
  ), '[]'::jsonb);
end;
$$;

ALTER FUNCTION public.tabletop_floors(p_scene uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_gm_ids(p_campaign uuid) RETURNS uuid[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not (public.is_campaign_gm(p_campaign) or public.tabletop_is_player(p_campaign)) then
    raise exception 'not at this table';
  end if;
  return array(
    select c.gm_id from public.campaigns c where c.id = p_campaign and c.gm_id is not null
    union
    select m.profile_id from public.memberships m
     where m.campaign_id = p_campaign and m.role in ('gm', 'co-gm') and m.active and m.profile_id is not null);
end;
$$;

ALTER FUNCTION public.tabletop_gm_ids(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_handouts(p_campaign uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if public.is_campaign_gm(p_campaign) then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'entryId', h.entry_id, 'title', coalesce(e.title, h.title), 'type', e.type, 'summary', e.summary,
               'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at,
               'picture', public.tabletop_file_url(h.image_path), 'picturePath', h.image_path, 'note', h.note,
               'shownTo', case when h.shown_to is null then null else (
                 select coalesce(jsonb_agg(ch.name order by ch.name), '[]'::jsonb) from public.characters ch where ch.id = any (h.shown_to)) end)
             order by h.shown_at desc)
        from public.vtt_handouts h left join public.entries e on e.id = h.entry_id and e.campaign_id = h.campaign_id
       where h.campaign_id = p_campaign and (h.entry_id is null or e.id is not null)), '[]'::jsonb);
  end if;
  if not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'entryId', h.entry_id, 'title', coalesce(e.title, h.title), 'type', e.type, 'summary', e.summary,
             'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at,
             'picture', public.tabletop_file_url(h.image_path), 'note', h.note)
           order by h.shown_at desc)
      from public.vtt_handouts h left join public.entries e on e.id = h.entry_id and e.campaign_id = h.campaign_id
     where h.campaign_id = p_campaign
       and (h.entry_id is null or e.id is not null)
       and exists (
         select 1 from public.characters me
          where me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = v_uid
            and (h.shown_to is null or me.id = any (h.shown_to))
            and (h.entry_id is null
                 or e.visibility in ('common', 'player')
                 or exists (select 1 from public.entry_reveals r
                             where r.target_type = 'entry' and r.target_id = e.id and r.revealed_to_character_id = me.id)))
  ), '[]'::jsonb);
end;
$$;

ALTER FUNCTION public.tabletop_handouts(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_has_hooks(p_campaign uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (public.is_campaign_gm(p_campaign) or public.tabletop_is_player(p_campaign))
     and exists (select 1 from public.addon_hooks h where h.campaign_id = p_campaign and h.enabled);
$$;

ALTER FUNCTION public.tabletop_has_hooks(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_hide_handout(p_handout uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_h public.vtt_handouts;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_h from public.vtt_handouts where id = p_handout;
  if v_h.id is null then raise exception 'that handout is gone'; end if;
  if not public.is_campaign_gm(v_h.campaign_id) then raise exception 'only the GM hides handouts'; end if;
  delete from public.vtt_handouts where id = p_handout;
  delete from public.entry_reveals r
   where r.id = any (v_h.added_reveals)
     and not exists (select 1 from public.vtt_handouts o where o.campaign_id = v_h.campaign_id and r.id = any (o.added_reveals));
end;
$$;

ALTER FUNCTION public.tabletop_hide_handout(p_handout uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_is_player(p_campaign uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.characters ch
    where ch.campaign_id = p_campaign and ch.profile_id = auth.uid() and ch.kind = 'pc'
      and coalesce(ch.active, true)   -- p165 (audit R6): a player who left or was removed is not at the table
  ) and not exists (
    select 1 from public.campaigns c where c.id = p_campaign and c.deleted_at is not null
  );
$$;

ALTER FUNCTION public.tabletop_is_player(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_move_token(p_token uuid, p_x real, p_y real, p_rot real DEFAULT NULL::real) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

ALTER FUNCTION public.tabletop_move_token(p_token uuid, p_x real, p_y real, p_rot real) OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.battle_maps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text DEFAULT 'Untitled map'::text NOT NULL,
    kind text DEFAULT 'indoor'::text NOT NULL,
    n integer DEFAULT 25 NOT NULL,
    feet_per_square integer DEFAULT 5 NOT NULL,
    levels jsonb DEFAULT '[]'::jsonb NOT NULL,
    custom_cells jsonb DEFAULT '[]'::jsonb NOT NULL,
    doors jsonb DEFAULT '[]'::jsonb NOT NULL,
    elements jsonb DEFAULT '[]'::jsonb NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT battle_maps_feet_per_square_check CHECK (((feet_per_square >= 1) AND (feet_per_square <= 1000))),
    CONSTRAINT battle_maps_kind_check CHECK ((kind = ANY (ARRAY['indoor'::text, 'outdoor'::text]))),
    CONSTRAINT battle_maps_n_check CHECK (((n >= 5) AND (n <= 200)))
);

ALTER TABLE public.battle_maps OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_on_connector(p_map public.battle_maps, p_level integer, p_x double precision, p_y double precision) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
      from jsonb_array_elements(case when jsonb_typeof(p_map.elements -> p_level) = 'array' then p_map.elements -> p_level else '[]'::jsonb end) e,
           lateral (select case when jsonb_typeof(e.value -> 's') = 'number' then greatest((e.value ->> 's')::double precision, 0.5) else 1 end as s) z
     where e.value ->> 'k' in ('stairs', 'ladder', 'trapdoor', 'pit')
       and jsonb_typeof(e.value -> 'x') = 'number' and jsonb_typeof(e.value -> 'y') = 'number'
       and p_x between (e.value ->> 'x')::double precision - 0.25 and (e.value ->> 'x')::double precision + z.s + 0.25
       and p_y between (e.value ->> 'y')::double precision - 0.25 and (e.value ->> 'y')::double precision + z.s + 0.25);
$$;

ALTER FUNCTION public.tabletop_on_connector(p_map public.battle_maps, p_level integer, p_x double precision, p_y double precision) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_open_session(p_campaign uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select s.id from public.sessions s
  where s.campaign_id = p_campaign and s.started_at is not null and s.ended_at is null
  order by s.started_at desc
  limit 1;
$$;

ALTER FUNCTION public.tabletop_open_session(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_pin_entry(p_pin uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_p   public.vtt_pins;
  v_sc  public.vtt_scenes;
  v_n   integer;
  v_e   public.entries;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_p from public.vtt_pins where id = p_pin;
  if v_p.id is null or v_p.entry_id is null then raise exception 'nothing to read there'; end if;
  select * into v_sc from public.vtt_scenes where id = v_p.scene_id;
  if not public.is_campaign_gm(v_p.campaign_id) then
    select b.n into v_n from public.battle_maps b where b.id = v_sc.battle_map_id;
    if not (public.tabletop_is_player(v_p.campaign_id)
            and v_p.players_see
            and public.tabletop_scene_for(v_p.campaign_id, v_uid) = v_p.scene_id
            and (v_n is null or public.tabletop_revealed(v_sc.revealed, v_sc.fog_on, v_n, floor(v_p.x)::integer, floor(v_p.y)::integer))
            and public.tabletop_player_reads_entry(v_p.campaign_id, v_p.entry_id)) then
      raise exception 'nothing to read there';
    end if;
  end if;
  select * into v_e from public.entries where id = v_p.entry_id and campaign_id = v_p.campaign_id;
  if v_e.id is null then raise exception 'nothing to read there'; end if;
  return jsonb_build_object('id', v_p.id, 'entryId', v_e.id, 'title', v_e.title, 'type', v_e.type, 'summary', v_e.summary,
    'body', v_e.body, 'blocks', v_e.blocks, 'imageUrl', v_e.image_url, 'shownAt', now());
end;
$$;

ALTER FUNCTION public.tabletop_pin_entry(p_pin uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_pins(p_scene uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_sc    public.vtt_scenes;
  v_n     integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_sc from public.vtt_scenes where id = p_scene;
  if v_sc.id is null then raise exception 'scene not found'; end if;
  if public.is_campaign_gm(v_sc.campaign_id) then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'x', p.x, 'y', p.y, 'label', p.label, 'color', p.color,
               'entryId', p.entry_id, 'entryTitle', e.title, 'gmNote', p.gm_note, 'playersSee', p.players_see) order by p.created_at)
        from public.vtt_pins p left join public.entries e on e.id = p.entry_id and e.campaign_id = p.campaign_id
       where p.scene_id = p_scene), '[]'::jsonb);
  end if;
  if not public.tabletop_is_player(v_sc.campaign_id) then raise exception 'not at this table'; end if;
  if public.tabletop_scene_for(v_sc.campaign_id, v_uid) is distinct from p_scene then return '[]'::jsonb; end if;
  select b.n into v_n from public.battle_maps b where b.id = v_sc.battle_map_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'x', p.x, 'y', p.y, 'label', p.label, 'color', p.color,
             'entryId', case when ok.reads then p.entry_id end, 'entryTitle', case when ok.reads then e.title end,
             'playersSee', true) order by p.created_at)
      from public.vtt_pins p
      left join public.entries e on e.id = p.entry_id and e.campaign_id = p.campaign_id
      cross join lateral (select p.entry_id is not null and public.tabletop_player_reads_entry(v_sc.campaign_id, p.entry_id) as reads) ok
     where p.scene_id = p_scene and p.players_see
       and (v_n is null or public.tabletop_revealed(v_sc.revealed, v_sc.fog_on, v_n, floor(p.x)::integer, floor(p.y)::integer))
  ), '[]'::jsonb);
end;
$$;

ALTER FUNCTION public.tabletop_pins(p_scene uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_place(p_scene uuid, p_profiles uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_s public.vtt_scenes;
  v_n integer;
begin
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_s.campaign_id) then raise exception 'only the GM moves players between scenes'; end if;
  if coalesce(array_length(p_profiles, 1), 0) = 0 then raise exception 'pick at least one player'; end if;
  if exists (select 1 from unnest(p_profiles) p where not exists (
      select 1 from public.characters c where c.campaign_id = v_s.campaign_id and c.kind = 'pc' and c.profile_id = p)) then
    raise exception 'that player has no character in this campaign';
  end if;
  if v_s.is_active then
    delete from public.vtt_scene_players where campaign_id = v_s.campaign_id and profile_id = any (p_profiles);
  else
    insert into public.vtt_scene_players (campaign_id, profile_id, scene_id)
    select v_s.campaign_id, p, p_scene from unnest(p_profiles) p
    on conflict (campaign_id, profile_id) do update set scene_id = excluded.scene_id, updated_at = now();
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

ALTER FUNCTION public.tabletop_place(p_scene uuid, p_profiles uuid[]) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_player_reads_entry(p_campaign uuid, p_entry uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.entries e, public.characters me
     where e.id = p_entry and e.campaign_id = p_campaign
       and me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = auth.uid()
       and (e.visibility in ('common', 'player')
            or exists (select 1 from public.entry_reveals r
                        where r.target_type = 'entry' and r.target_id = e.id and r.revealed_to_character_id = me.id)));
$$;

ALTER FUNCTION public.tabletop_player_reads_entry(p_campaign uuid, p_entry uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_revealed(p_rev bytea, p_on boolean, p_n integer, p_x integer, p_y integer) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select not coalesce(p_on, false) or (
    p_x >= 0 and p_y >= 0 and p_x < p_n and p_y < p_n
    and (p_y * p_n + p_x) < length(p_rev) * 8
    and get_bit(p_rev, p_y * p_n + p_x) = 1
  );
$$;

ALTER FUNCTION public.tabletop_revealed(p_rev bytea, p_on boolean, p_n integer, p_x integer, p_y integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_say(p_campaign uuid, p_body text, p_kind text DEFAULT 'say'::text, p_as_name text DEFAULT NULL::text, p_character uuid DEFAULT NULL::uuid, p_whisper_to uuid[] DEFAULT NULL::uuid[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_gm   boolean;
  v_id   uuid;
  v_to   uuid[];
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  if p_kind not in ('say', 'emote', 'whisper') then raise exception 'unknown message kind'; end if;
  if coalesce(trim(p_body), '') = '' then return null; end if;
  if char_length(trim(p_body)) > 2000 then raise exception 'message too long (2000 characters at most)'; end if;
  -- a player speaks as their own character; the GM may speak as any character in the campaign or a name
  if p_character is not null and not exists (
    select 1 from public.characters c where c.id = p_character and c.campaign_id = p_campaign
      and (v_gm or c.profile_id = v_uid)) then
    raise exception 'you cannot speak as that character';
  end if;
  if p_kind = 'whisper' then
    -- recipients must be at this table: the GM or the owner of a pc here
    select array_agg(distinct r) into v_to
    from unnest(coalesce(p_whisper_to, '{}')) r
    where public.campaign_gm_of(p_campaign, r)
       or exists (select 1 from public.characters c where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = r);
    if v_to is null or array_length(v_to, 1) is null then raise exception 'nobody at this table by that name'; end if;
  end if;
  insert into public.vtt_messages (campaign_id, session_id, author_profile, as_name, character_id, kind, body, whisper_to)
  values (p_campaign, public.tabletop_open_session(p_campaign), v_uid,
          -- p142 (audit B16): only the GM speaks under a name; a player is themselves or their character
          case when v_gm then nullif(trim(coalesce(p_as_name, '')), '') else null end,
          p_character, p_kind, trim(p_body), case when p_kind = 'whisper' then v_to else null end)
  returning id into v_id;
  return v_id;
end;
$$;

ALTER FUNCTION public.tabletop_say(p_campaign uuid, p_body text, p_kind text, p_as_name text, p_character uuid, p_whisper_to uuid[]) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_scene_for(p_campaign uuid, p_profile uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select sp.scene_id from public.vtt_scene_players sp join public.vtt_scenes s on s.id = sp.scene_id
      where sp.campaign_id = p_campaign and sp.profile_id = p_profile and s.campaign_id = p_campaign),
    (select s.id from public.vtt_scenes s where s.campaign_id = p_campaign and s.is_active limit 1));
$$;

ALTER FUNCTION public.tabletop_scene_for(p_campaign uuid, p_profile uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_seat_name(p_campaign uuid, p_uid uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case when public.campaign_gm_of(p_campaign, p_uid) then 'GM'
              else coalesce((select c.name from public.characters c
                              where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = p_uid
                              order by c.active desc, c.name limit 1), 'someone') end;
$$;

ALTER FUNCTION public.tabletop_seat_name(p_campaign uuid, p_uid uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_server_ms() RETURNS double precision
    LANGUAGE sql
    AS $$ select extract(epoch from clock_timestamp()) * 1000 $$;

ALTER FUNCTION public.tabletop_server_ms() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_set_audio(p_campaign uuid, p_state jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_m     jsonb := p_state -> 'music';
  v_snd   public.vtt_sounds;
  v_music jsonb := null;
  v_amb   jsonb := '[]'::jsonb;
  v_a     jsonb;
  v_out   jsonb;
  v_n     integer := 0;
  v_vol   real;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only the GM controls the sound'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or length(p_state::text) > 4000 then raise exception 'that is not a sound setting'; end if;

  if jsonb_typeof(v_m) = 'object' and coalesce(v_m ->> 'soundId', '') ~ '^[0-9a-f-]{36}$' then
    select * into v_snd from public.vtt_sounds where id = (v_m ->> 'soundId')::uuid and campaign_id = p_campaign;
    if v_snd.id is null then raise exception 'that sound is not in this campaign'; end if;
    v_vol := case when jsonb_typeof(v_m -> 'volume') = 'number' then greatest(0, least(1, (v_m ->> 'volume')::real)) else 0.7 end;
    v_music := jsonb_build_object(
      'soundId', v_snd.id, 'name', v_snd.name, 'url', v_snd.url, 'duration', v_snd.duration,
      'playing', coalesce((v_m ->> 'playing')::boolean, false),
      'offset', case when jsonb_typeof(v_m -> 'offset') = 'number' then greatest(0, least(86400, (v_m ->> 'offset')::double precision)) else 0 end,
      'loop', coalesce((v_m ->> 'loop')::boolean, true),
      'volume', v_vol,
      'at', extract(epoch from clock_timestamp()) * 1000);
  end if;

  if jsonb_typeof(p_state -> 'ambient') = 'array' then
    for v_a in select a from jsonb_array_elements(p_state -> 'ambient') as x(a) loop
      exit when v_n >= 4;
      continue when jsonb_typeof(v_a) <> 'object' or coalesce(v_a ->> 'soundId', '') !~ '^[0-9a-f-]{36}$';
      select * into v_snd from public.vtt_sounds where id = (v_a ->> 'soundId')::uuid and campaign_id = p_campaign;
      continue when v_snd.id is null;
      v_vol := case when jsonb_typeof(v_a -> 'volume') = 'number' then greatest(0, least(1, (v_a ->> 'volume')::real)) else 0.5 end;
      v_amb := v_amb || jsonb_build_array(jsonb_build_object('soundId', v_snd.id, 'name', v_snd.name, 'url', v_snd.url, 'volume', v_vol));
      v_n := v_n + 1;
    end loop;
  end if;

  v_out := jsonb_build_object('music', v_music, 'ambient', v_amb);
  insert into public.vtt_audio (campaign_id, state, updated_at) values (p_campaign, v_out, now())
  on conflict (campaign_id) do update set state = excluded.state, updated_at = now();
  return v_out;
end;
$_$;

ALTER FUNCTION public.tabletop_set_audio(p_campaign uuid, p_state jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_set_doors(p_scene uuid, p_edges text[], p_open boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_uid   uuid := auth.uid();
  v_s     public.vtt_scenes;
  v_map   public.battle_maps;
  v_gm    boolean;
  v_doors jsonb;
  v_state jsonb;
  v_edge  text;
  v_kind  text;
  v_i     integer;
  v_side  text;
  v_r     integer;
  v_c     integer;
  v_mx    real;
  v_my    real;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  v_gm := public.is_campaign_gm(v_s.campaign_id);
  if not v_gm and not (public.tabletop_is_player(v_s.campaign_id) and v_s.id = public.tabletop_scene_for(v_s.campaign_id, v_uid)) then
    raise exception 'not at this table';
  end if;
  select * into v_map from public.battle_maps where id = v_s.battle_map_id;
  v_doors := coalesce(v_map.doors -> v_s.level, '{}'::jsonb);
  v_state := coalesce(v_s.door_state, '{}'::jsonb);
  if coalesce(array_length(p_edges, 1), 0) = 0 then return; end if;
  if array_length(p_edges, 1) > 500 then raise exception 'too many doors at once'; end if;

  foreach v_edge in array p_edges loop
    v_kind := v_doors ->> v_edge;
    if v_kind is null or v_edge !~ '^[0-9]+[hv]$' then raise exception 'there is no door there'; end if;
    if not v_gm then
      -- a closed secret door is a wall to players, so it answers like one
      if v_kind = 'secret' and not (v_state ? v_edge) then raise exception 'there is no door there'; end if;
      v_i := substring(v_edge from '^[0-9]+')::integer;
      v_side := right(v_edge, 1);
      v_r := v_i / v_map.n; v_c := v_i % v_map.n;
      -- the door must touch a revealed square
      if not (public.tabletop_revealed(v_s.revealed, v_s.fog_on, v_map.n, v_c, v_r)
              or (v_side = 'h' and public.tabletop_revealed(v_s.revealed, v_s.fog_on, v_map.n, v_c, v_r - 1))
              or (v_side = 'v' and public.tabletop_revealed(v_s.revealed, v_s.fog_on, v_map.n, v_c - 1, v_r))) then
        raise exception 'there is no door there';
      end if;
      if v_kind not in ('door', 'double') then raise exception 'only the GM can open that door'; end if;
      -- and a token the player controls must stand next to it
      if v_side = 'h' then v_mx := v_c + 0.5; v_my := v_r; else v_mx := v_c; v_my := v_r + 0.5; end if;
      if not exists (
        select 1 from public.vtt_tokens t
        where t.scene_id = p_scene and not t.hidden and t.layer <> 'gm'
          and (v_uid = any (t.controlled_by)
               or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid))
          and sqrt(power(t.x - v_mx, 2) + power(t.y - v_my, 2)) <= 1.5 + t.size / 2.0 - 0.5
      ) then
        raise exception 'move a token next to the door first';
      end if;
    end if;
    if p_open then v_state := v_state || jsonb_build_object(v_edge, true);
    else v_state := v_state - v_edge; end if;
  end loop;

  update public.vtt_scenes set door_state = v_state, updated_at = now() where id = p_scene;
end;
$_$;

ALTER FUNCTION public.tabletop_set_doors(p_scene uuid, p_edges text[], p_open boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_set_fog(p_scene uuid, p_on boolean DEFAULT NULL::boolean, p_revealed text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_s public.vtt_scenes;
  v_n integer;
  v_rev bytea;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_s.campaign_id) then raise exception 'only the GM can change the fog'; end if;
  select n into v_n from public.battle_maps where id = v_s.battle_map_id;
  if p_revealed is not null then
    if p_revealed !~ '^([0-9a-f]{2})*$' then raise exception 'the fog bitmap is not hex'; end if;
    v_rev := decode(p_revealed, 'hex');
    if length(v_rev) > (coalesce(v_n, 100) * coalesce(v_n, 100) + 7) / 8 then raise exception 'the fog bitmap is larger than the map'; end if;
  end if;
  update public.vtt_scenes
     set fog_on = coalesce(p_on, fog_on),
         revealed = coalesce(v_rev, revealed),
         updated_at = now()
   where id = p_scene;
end;
$_$;

ALTER FUNCTION public.tabletop_set_fog(p_scene uuid, p_on boolean, p_revealed text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_set_initiative(p_campaign uuid, p_character uuid, p_total integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cb  public.combats;
  v_new jsonb;
begin
  select * into v_cb from public.combats
   where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1
   for update;
  if v_cb.id is null then return false; end if;
  if not exists (
    select 1 from jsonb_array_elements(v_cb.combatants) c
     where c ->> 'kind' = 'pc' and c ->> 'characterId' = p_character::text and (c -> 'initiative' is null or c -> 'initiative' = 'null'::jsonb)
  ) then return false; end if;

  select jsonb_agg(case when x.c ->> 'kind' = 'pc' and x.c ->> 'characterId' = p_character::text
                        then x.c || jsonb_build_object('initiative', p_total) else x.c end order by x.n)
    into v_new
    from jsonb_array_elements(v_cb.combatants) with ordinality x(c, n);

  if v_cb.round = 1 and v_cb.turn = 0 then
    -- the turn order, as sortForTurns: rolled first (highest, then initiative bonus, then players before
    -- monsters, then name), unrolled after in the order they were added
    select jsonb_agg(y.c order by
             (y.c -> 'initiative' is null or y.c -> 'initiative' = 'null'::jsonb),
             case when y.c -> 'initiative' is null or y.c -> 'initiative' = 'null'::jsonb then y.n end,
             (y.c ->> 'initiative')::numeric desc,
             coalesce((y.c ->> 'initBonus')::numeric, 0) desc,
             (y.c ->> 'kind' = 'pc') desc,
             y.c ->> 'name',
             y.n)
      into v_new
      from jsonb_array_elements(v_new) with ordinality y(c, n);
    update public.combats set combatants = v_new, turn = 0, updated_at = now() where id = v_cb.id;
  else
    update public.combats set combatants = v_new, updated_at = now() where id = v_cb.id;
  end if;
  return true;
end;
$$;

ALTER FUNCTION public.tabletop_set_initiative(p_campaign uuid, p_character uuid, p_total integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_set_token_elevation(p_tokens uuid[], p_feet integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

ALTER FUNCTION public.tabletop_set_token_elevation(p_tokens uuid[], p_feet integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_set_token_look(p_token uuid, p_image_url text DEFAULT NULL::text, p_frame jsonb DEFAULT NULL::jsonb, p_clear_frame boolean DEFAULT false) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;

ALTER FUNCTION public.tabletop_set_token_look(p_token uuid, p_image_url text, p_frame jsonb, p_clear_frame boolean) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_set_token_markers(p_token uuid, p_markers text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;

ALTER FUNCTION public.tabletop_set_token_markers(p_token uuid, p_markers text[]) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_show_handout(p_campaign uuid, p_entry uuid, p_characters uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_chars uuid[];
  v_added uuid[];
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only the GM shows handouts'; end if;
  if not exists (select 1 from public.entries e where e.id = p_entry and e.campaign_id = p_campaign) then
    raise exception 'that entry is not in this campaign';
  end if;
  select coalesce(array_agg(ch.id), '{}') into v_chars
    from public.characters ch
   where ch.campaign_id = p_campaign and ch.kind = 'pc'
     and (p_characters is null or ch.id = any (p_characters));
  if coalesce(array_length(v_chars, 1), 0) = 0 then raise exception 'no player characters to show it to'; end if;

  with ins as (
    insert into public.entry_reveals (campaign_id, target_type, target_id, revealed_to_character_id)
    select p_campaign, 'entry', p_entry, c from unnest(v_chars) c
    on conflict (target_type, target_id, revealed_to_character_id) do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_added from ins;

  insert into public.vtt_handouts (campaign_id, entry_id, shown_to, added_reveals)
  values (p_campaign, p_entry, case when p_characters is null then null else v_chars end, v_added)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'characters', to_jsonb(v_chars));
end;
$$;

ALTER FUNCTION public.tabletop_show_handout(p_campaign uuid, p_entry uuid, p_characters uuid[]) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_show_image_handout(p_campaign uuid, p_title text, p_path text, p_note text DEFAULT NULL::text, p_characters uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_chars uuid[];
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only the GM shows handouts'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'give the picture a title'; end if;
  select coalesce(array_agg(ch.id), '{}') into v_chars
    from public.characters ch
   where ch.campaign_id = p_campaign and ch.kind = 'pc'
     and (p_characters is null or ch.id = any (p_characters));
  if coalesce(array_length(v_chars, 1), 0) = 0 then raise exception 'no player characters to show it to'; end if;
  insert into public.vtt_handouts (campaign_id, entry_id, title, image_path, note, shown_to, added_reveals)
  values (p_campaign, null, left(trim(p_title), 80), p_path, nullif(left(coalesce(p_note, ''), 600), ''),
          case when p_characters is null then null else v_chars end, '{}')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'characters', to_jsonb(v_chars));
end;
$$;

ALTER FUNCTION public.tabletop_show_image_handout(p_campaign uuid, p_title text, p_path text, p_note text, p_characters uuid[]) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_state(p_campaign uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_uid     uuid := auth.uid();
  v_gm      boolean;
  v_player  boolean;
  v_camp    public.campaigns;
  v_scene   public.vtt_scenes;
  v_map     public.battle_maps;
  v_lv      integer;
  v_n       integer;
  v_labels  boolean;
  v_fog     boolean := false;
  v_rev     bytea := '\x'::bytea;
  v_ds      jsonb := '{}'::jsonb;
  v_doors   jsonb := '{}'::jsonb;
  v_walls   jsonb := '[]'::jsonb;
  v_mapjson jsonb := null;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  v_player := public.tabletop_is_player(p_campaign);
  if not v_gm and not v_player then raise exception 'not at this table'; end if;

  select * into v_camp from public.campaigns where id = p_campaign;
  -- the scene this person is on: their own (a split party, or the GM viewing another), else the active one
  select * into v_scene from public.vtt_scenes where id = public.tabletop_scene_for(p_campaign, v_uid);
  if v_scene.id is not null then
    select * into v_map from public.battle_maps where id = v_scene.battle_map_id;
    v_fog := v_scene.fog_on;
    v_rev := v_scene.revealed;
    v_ds := coalesce(v_scene.door_state, '{}'::jsonb);
  end if;

  if v_map.id is not null then
    v_lv := v_scene.level;
    v_n := v_map.n;
    v_labels := v_gm or coalesce((v_scene.settings ->> 'show_labels')::boolean, false);

    if v_gm then
      v_doors := coalesce(v_map.doors -> v_lv, '{}'::jsonb);
    else
      -- a door reaches players when it touches a revealed square; a secret door only once it is open,
      -- and then as a plain door
      select coalesce(jsonb_object_agg(d.key, case when d.value = '"secret"'::jsonb then '"door"'::jsonb else d.value end), '{}'::jsonb)
        into v_doors
        from jsonb_each(coalesce(v_map.doors -> v_lv, '{}'::jsonb)) d,
             lateral (select substring(d.key from '^[0-9]+')::integer as i, right(d.key, 1) as side) e
       where d.key ~ '^[0-9]+[hv]$'
         and (d.value <> '"secret"'::jsonb or v_ds ? d.key)
         and (public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n)
              or (e.side = 'h' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n - 1))
              or (e.side = 'v' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n - 1, e.i / v_n)));
      select coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb) into v_ds
        from jsonb_each(v_ds) k where v_doors ? k.key;
      -- a closed secret door is plain wall to players: the edge comes as a wall to draw and to block
      -- sight, with nothing to say it is a door (two floor squares otherwise show an open gap)
      select coalesce(jsonb_agg(d.key), '[]'::jsonb)
        into v_walls
        from jsonb_each(coalesce(v_map.doors -> v_lv, '{}'::jsonb)) d,
             lateral (select substring(d.key from '^[0-9]+')::integer as i, right(d.key, 1) as side) e
       where d.key ~ '^[0-9]+[hv]$' and d.value = '"secret"'::jsonb and not (coalesce(v_scene.door_state, '{}'::jsonb) ? d.key)
         and (public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n)
              or (e.side = 'h' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n, e.i / v_n - 1))
              or (e.side = 'v' and public.tabletop_revealed(v_rev, v_fog, v_n, e.i % v_n - 1, e.i / v_n)));
    end if;

    v_mapjson := jsonb_build_object(
      'id', v_map.id,
      'kind', v_map.kind,
      'n', v_map.n,
      'feet_per_square', v_map.feet_per_square,
      'grid', case when v_gm or not v_fog then coalesce(v_map.levels -> v_lv, '[]'::jsonb)
                   else (select coalesce(jsonb_agg(case when public.tabletop_revealed(v_rev, v_fog, v_n, ((g.ord - 1) % v_n)::integer, ((g.ord - 1) / v_n)::integer)
                                                    then g.v else '0'::jsonb end order by g.ord), '[]'::jsonb)
                         from jsonb_array_elements(coalesce(v_map.levels -> v_lv, '[]'::jsonb)) with ordinality g(v, ord)) end,
      'custom', case when v_gm or not v_fog then coalesce(v_map.custom_cells -> v_lv, '{}'::jsonb)
                     else (select coalesce(jsonb_object_agg(cc.key, cc.value), '{}'::jsonb)
                           from jsonb_each(coalesce(v_map.custom_cells -> v_lv, '{}'::jsonb)) cc
                           where cc.key ~ '^[0-9]+$'
                             and public.tabletop_revealed(v_rev, v_fog, v_n, cc.key::integer % v_n, cc.key::integer / v_n)) end,
      'doors', v_doors,
      'door_state', v_ds,
      'walls', v_walls,
      'elements', (select coalesce(jsonb_agg(e.value), '[]'::jsonb)
                   from jsonb_array_elements(coalesce(v_map.elements -> v_lv, '[]'::jsonb)) e
                   where (v_labels or coalesce(e.value ->> 'k', '') <> 'label')
                     and (v_gm or public.tabletop_revealed(v_rev, v_fog, v_n,
                                    floor(coalesce((e.value ->> 'x')::real, 0))::integer,
                                    floor(coalesce((e.value ->> 'y')::real, 0))::integer))),
      'fog', jsonb_build_object('on', v_fog, 'revealed', encode(v_rev, 'hex')),
      'meta', jsonb_build_object(
        'title', v_map.meta -> 'title',
        'levelNames', v_map.meta -> 'levelNames',
        'autoNumber', v_map.meta -> 'autoNumber',
        'showGrid', v_map.meta -> 'showGrid',
        'ground', v_map.meta -> 'ground',
        'grid', v_map.meta -> 'grid',
        'topGrid', v_map.meta -> 'topGrid',
        'overlay', v_map.meta -> 'overlays' -> v_lv,
        'sightWalls', coalesce(v_map.meta -> 'sightWalls' -> v_lv, '[]'::jsonb)
      )
    );
  end if;

  return jsonb_build_object(
    'role', case when v_gm then 'gm' else 'player' end,
    'me', v_uid,
    'campaign', jsonb_build_object('id', v_camp.id, 'name', v_camp.name, 'gm_id', v_camp.gm_id),
    'session_id', public.tabletop_open_session(p_campaign),
    'scene', case when v_scene.id is null then null else jsonb_build_object(
      'id', v_scene.id, 'name', v_scene.name, 'battle_map_id', v_scene.battle_map_id,
      'level', v_scene.level, 'settings', v_scene.settings) end,
    'map', v_mapjson,
    'tokens', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'kind', t.kind, 'character_id', t.character_id, 'stat_block_id', t.stat_block_id,
        'name', t.name, 'image_url', t.image_url, 'x', t.x, 'y', t.y, 'size', t.size, 'rot', t.rot,
        'layer', t.layer, 'hidden', t.hidden, 'controlled_by', to_jsonb(t.controlled_by), 'style', t.style,
        'mine', v_gm or v_uid = any (t.controlled_by)
                or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid)
      ) order by t.created_at), '[]'::jsonb)
      from public.vtt_tokens t
      where v_scene.id is not null and t.scene_id = v_scene.id
        and (v_gm or (not t.hidden and t.layer <> 'gm'
                      and (v_uid = any (t.controlled_by)
                           or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid)
                           or public.tabletop_revealed(v_rev, v_fog, coalesce(v_n, 0), floor(t.x)::integer, floor(t.y)::integer))))
    ),
    -- who is at the table, for whispers and token owners: the GM and every claimed pc
    'party', (
      select coalesce(jsonb_agg(x.p), '[]'::jsonb) from (
        select jsonb_build_object('profile_id', v_camp.gm_id, 'name', 'GM', 'character_id', null, 'portrait_url', null) as p
        union all
        select jsonb_build_object('profile_id', c.profile_id, 'name', c.name, 'character_id', c.id, 'portrait_url', c.portrait_url)
        from public.characters c
        where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id is not null and c.active
      ) x
    ),
    -- GM only: the scenes and battle maps to pick from
    'scenes', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'battle_map_id', s.battle_map_id,
        'level', s.level, 'is_active', s.is_active) order by s.updated_at desc), '[]'::jsonb)
      from public.vtt_scenes s where s.campaign_id = p_campaign) else '[]'::jsonb end,
    -- GM only: who is on which scene. Anyone not listed is on the active scene.
    'placements', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('profile_id', sp.profile_id, 'scene_id', sp.scene_id)), '[]'::jsonb)
      from public.vtt_scene_players sp where sp.campaign_id = p_campaign) else '[]'::jsonb end,
    'battle_maps', case when v_gm then (
      select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind,
        'levelNames', b.meta -> 'levelNames') order by b.created_at), '[]'::jsonb)
      from public.battle_maps b where b.campaign_id = p_campaign) else '[]'::jsonb end
  );
end;
$_$;

ALTER FUNCTION public.tabletop_state(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_storage_host() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select 'agafmvywayisxgvrfium.supabase.co'::text $$;

ALTER FUNCTION public.tabletop_storage_host() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_system(p_campaign uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select c.system from public.campaigns c
   where c.id = p_campaign
     and (public.is_campaign_gm(p_campaign) or public.tabletop_is_player(p_campaign));
$$;

ALTER FUNCTION public.tabletop_system(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_token_floor(p_token uuid, p_level integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_t    public.vtt_tokens;
  v_sc   public.vtt_scenes;
  v_to   public.vtt_scenes;
  v_m    public.battle_maps;
  v_gm   boolean;
  v_p    uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_level is null or p_level not between 0 and 2 then raise exception 'floors are levels 1 to 3'; end if;
  select * into v_t from public.vtt_tokens where id = p_token for update;
  if v_t.id is null then raise exception 'token not found'; end if;
  select * into v_sc from public.vtt_scenes where id = v_t.scene_id;
  select * into v_m from public.battle_maps where id = v_sc.battle_map_id;
  if v_sc.level = p_level then return v_sc.id; end if;
  v_gm := public.is_campaign_gm(v_t.campaign_id);
  if not v_gm then
    if not public.tabletop_is_player(v_t.campaign_id) then raise exception 'not at this table'; end if;
    if v_t.hidden or v_t.layer = 'gm' or not (
         v_uid = any (v_t.controlled_by)
         or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)) then
      raise exception 'that token is not yours';
    end if;
    if public.tabletop_scene_for(v_t.campaign_id, v_uid) is distinct from v_t.scene_id then raise exception 'that token is not on your floor'; end if;
    if not coalesce((v_sc.settings ->> 'freeFloors')::boolean, false)
       and not public.tabletop_on_connector(v_m, v_sc.level, v_t.x, v_t.y) then
      raise exception 'stand on stairs, a ladder, a trapdoor or a pit to change floor';
    end if;
  end if;

  select * into v_to from public.vtt_scenes s
   where s.campaign_id = v_sc.campaign_id and s.battle_map_id = v_sc.battle_map_id and s.level = p_level
   order by s.is_active desc, s.updated_at desc limit 1;
  if v_to.id is null then raise exception 'that floor is not on the table yet: the GM adds it with the floor buttons'; end if;
  if not v_gm and public.tabletop_walled_at(coalesce(v_m.levels -> p_level, '[]'::jsonb), coalesce(v_m.custom_cells -> p_level, '{}'::jsonb),
                                            v_m.n, coalesce(v_m.kind, '') = 'outdoor', floor(v_t.x)::integer, floor(v_t.y)::integer) then
    raise exception 'that spot is solid rock on the other floor';
  end if;

  update public.vtt_tokens set scene_id = v_to.id where id = v_t.id;

  -- the token's players go with it (never a GM or co-GM, whose view is their own)
  for v_p in
    select distinct p from (
      select c.profile_id as p from public.characters c where c.id = v_t.character_id
      union select unnest(coalesce(v_t.controlled_by, '{}'::uuid[]))) x
     where p is not null and not public.campaign_gm_of(v_t.campaign_id, p) and public.tabletop_card_seat(v_t.campaign_id, p)
  loop
    if v_to.is_active then
      delete from public.vtt_scene_players where campaign_id = v_t.campaign_id and profile_id = v_p;
    else
      insert into public.vtt_scene_players (campaign_id, profile_id, scene_id) values (v_t.campaign_id, v_p, v_to.id)
      on conflict (campaign_id, profile_id) do update set scene_id = excluded.scene_id, updated_at = now();
    end if;
  end loop;
  return v_to.id;
end;
$$;

ALTER FUNCTION public.tabletop_token_floor(p_token uuid, p_level integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_token_seen(p_token uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.vtt_tokens t
     where t.id = p_token and not t.hidden and t.layer <> 'gm'
       and t.scene_id = public.tabletop_scene_for(t.campaign_id, auth.uid())
       and public.tabletop_token_visible(t.scene_id, t.x, t.y, t.character_id, t.controlled_by));
$$;

ALTER FUNCTION public.tabletop_token_seen(p_token uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_token_visible(p_scene uuid, p_x real, p_y real, p_character uuid, p_controlled uuid[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select auth.uid() = any (coalesce(p_controlled, '{}'))
      or exists (select 1 from public.characters c where c.id = p_character and c.profile_id = auth.uid())
      or exists (
        select 1 from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id
        where s.id = p_scene
          and public.tabletop_revealed(s.revealed, s.fog_on, b.n, floor(p_x)::integer, floor(p_y)::integer)
      );
$$;

ALTER FUNCTION public.tabletop_token_visible(p_scene uuid, p_x real, p_y real, p_character uuid, p_controlled uuid[]) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_topic_ok(p_topic text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_c uuid;
begin
  if p_topic is null or p_topic !~ '^tabletop:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_c := substring(p_topic from 10)::uuid;
  return public.is_campaign_gm(v_c) or public.tabletop_is_player(v_c);
end;
$_$;

ALTER FUNCTION public.tabletop_topic_ok(p_topic text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_view_scene(p_scene uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_s public.vtt_scenes;
begin
  select * into v_s from public.vtt_scenes where id = p_scene;
  if v_s.id is null then raise exception 'scene not found'; end if;
  if not public.is_campaign_gm(v_s.campaign_id) then raise exception 'only the GM can do that'; end if;
  if v_s.is_active then
    delete from public.vtt_scene_players where campaign_id = v_s.campaign_id and profile_id = auth.uid();
  else
    insert into public.vtt_scene_players (campaign_id, profile_id, scene_id) values (v_s.campaign_id, auth.uid(), p_scene)
    on conflict (campaign_id, profile_id) do update set scene_id = excluded.scene_id, updated_at = now();
  end if;
end;
$$;

ALTER FUNCTION public.tabletop_view_scene(p_scene uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_wall_blocks(p_map public.battle_maps, p_level integer, p_ds jsonb, p_ax double precision, p_ay double precision, p_bx double precision, p_by double precision) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
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
$$;

ALTER FUNCTION public.tabletop_wall_blocks(p_map public.battle_maps, p_level integer, p_ds jsonb, p_ax double precision, p_ay double precision, p_bx double precision, p_by double precision) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tabletop_walled_at(p_grid jsonb, p_custom jsonb, p_n integer, p_outdoor boolean, p_c integer, p_r integer) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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
$$;

ALTER FUNCTION public.tabletop_walled_at(p_grid jsonb, p_custom jsonb, p_n integer, p_outdoor boolean, p_c integer, p_r integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.threads_guard_character() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.character_id is not null then
    if not exists (
      select 1 from public.characters ch
      where ch.id = new.character_id
        and ch.profile_id = auth.uid()
    ) then
      raise exception 'you can only attach a thread to a character you own';
    end if;
  end if;
  return new;
end;
$$;

ALTER FUNCTION public.threads_guard_character() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tool_render_reserve(p_tool text, p_ip text, p_global integer, p_per_ip integer) RETURNS TABLE(reserved_id bigint, refused text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_id bigint;
begin
  -- One reservation at a time, so every request counts the ones before it.
  perform pg_advisory_xact_lock(hashtext('public.tool_render_reserve'));
  if (select count(*) from public.tool_render_log where created_at >= v_since) >= coalesce(p_global, 0) then
    return query select null::bigint, 'global'::text;
    return;
  end if;
  if coalesce(p_ip, 'unknown') <> 'unknown'
     and (select count(*) from public.tool_render_log where ip = p_ip and created_at >= v_since) >= coalesce(p_per_ip, 0) then
    return query select null::bigint, 'ip'::text;
    return;
  end if;
  insert into public.tool_render_log (tool, ip) values (coalesce(p_tool, 'map-render'), p_ip) returning id into v_id;
  return query select v_id, null::text;
end;
$$;

ALTER FUNCTION public.tool_render_reserve(p_tool text, p_ip text, p_global integer, p_per_ip integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.touch_compendium_entries() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

ALTER FUNCTION public.touch_compendium_entries() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.touch_dm_boards() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

ALTER FUNCTION public.touch_dm_boards() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.touch_player_notes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

ALTER FUNCTION public.touch_player_notes() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.touch_stat_blocks_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

ALTER FUNCTION public.touch_stat_blocks_updated_at() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;

ALTER FUNCTION public.touch_updated_at() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.tpdi_autobind() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  -- A player-scope response is ABOUT THE PERSON. It must never be bound to a
  -- character. This single guard is the whole fix.
  if NEW.scope = 'player' then
    NEW.assigned_character_id := null;
    NEW.campaign_id := null;
    return NEW;
  end if;

  if NEW.assigned_character_id is null and NEW.respondent_id is not null then
    -- Only autobind within a KNOWN campaign. Without one there is no principled way
    -- to pick among a person's characters, and picking arbitrarily is how the bug
    -- above happened. Better to leave it unbound and let claim_character_invite or
    -- the GM assign it.
    if NEW.campaign_id is not null then
      select ch.id into NEW.assigned_character_id
      from public.characters ch
      where ch.profile_id = NEW.respondent_id
        and ch.kind = 'pc'
        and ch.campaign_id = NEW.campaign_id
      order by ch.created_at
      limit 1;
    end if;
  end if;

  return NEW;
end;
$$;

ALTER FUNCTION public.tpdi_autobind() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.trash_campaign(p_campaign uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_c public.campaigns;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if v_c.id is null or v_c.gm_id is distinct from auth.uid() then
    raise exception 'only the campaign''s GM can move it to the trash';
  end if;
  if v_c.deleted_at is not null then return v_c.deleted_at + interval '30 days'; end if;
  update public.campaigns
     set deleted_at = now(),
         trash_restore = jsonb_build_object(
           'share_code', v_c.share_code,
           'discord_channel_id', v_c.discord_channel_id,
           'public_published_at', v_c.public_published_at),
         share_code = null,
         discord_channel_id = null,
         public_published_at = null
   where id = p_campaign;
  return now() + interval '30 days';
end;
$$;

ALTER FUNCTION public.trash_campaign(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.unassign_response(p_response uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_campaign uuid;
begin
  select campaign_id into v_campaign from public.tpdi_responses where id = p_response;
  if v_campaign is null then raise exception 'response not found'; end if;
  if not public.is_campaign_gm(v_campaign) then raise exception 'not permitted'; end if;
  update public.tpdi_responses set assigned_character_id = null where id = p_response;
end; $$;

ALTER FUNCTION public.unassign_response(p_response uuid) OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    avatar_url text,
    is_anonymous boolean DEFAULT true NOT NULL,
    upgraded_at timestamp with time zone,
    access_granted boolean DEFAULT false NOT NULL,
    access_role text,
    terms_accepted_at timestamp with time zone,
    terms_version text
);

ALTER TABLE public.profiles OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.upgrade_profile_from_auth() RETURNS public.profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid  uuid := auth.uid();
  v_user auth.users;
  v_meta jsonb;
  v_row  public.profiles;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select * into v_user from auth.users where id = v_uid;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);

  -- Guard: only claim the upgrade if a real identity is actually attached. This
  -- keeps a caller from flipping is_anonymous on a still-anonymous session.
  if coalesce(v_user.is_anonymous, false) then
    raise exception 'still anonymous: link an identity before upgrading';
  end if;

  update public.profiles p
     set display_name = coalesce(
           nullif(p.display_name, ''),
           nullif(coalesce(v_meta->>'full_name', v_meta->>'name', v_meta->>'user_name', ''), '')
         ),
         email        = coalesce(nullif(v_user.email, ''), p.email),
         avatar_url   = coalesce(
           nullif(coalesce(v_meta->>'avatar_url', v_meta->>'picture', ''), ''),
           p.avatar_url
         ),
         is_anonymous = false,
         upgraded_at  = coalesce(p.upgraded_at, now()),
         updated_at   = now()
   where p.id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

ALTER FUNCTION public.upgrade_profile_from_auth() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.usage_by_campaign(p_since timestamp with time zone) RETURNS TABLE(campaign_id uuid, minutes numeric, speaker_minutes numeric, room_minutes numeric, ai_calls bigint, tokens bigint, images bigint, sessions bigint, room_sessions bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.campaign_id,
         coalesce(sum(u.audio_seconds) filter (where u.kind = 'transcription'), 0) / 60.0,
         coalesce(sum(u.audio_seconds) filter (where u.kind = 'transcription' and coalesce(u.provider, 'speaker') <> 'room'), 0) / 60.0,
         coalesce(sum(u.audio_seconds) filter (where u.kind = 'transcription' and u.provider = 'room'), 0) / 60.0,
         count(*) filter (where u.kind = 'ai'),
         coalesce(sum(coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0)), 0)::bigint,
         coalesce(sum(coalesce(u.images, 1)) filter (where u.kind = 'image'), 0)::bigint,
         count(distinct u.session_id) filter (where u.kind = 'transcription'),
         count(distinct u.session_id) filter (where u.kind = 'transcription' and u.provider = 'room')
    from public.usage_events u
   where u.created_at >= p_since and u.campaign_id is not null
   group by u.campaign_id;
$$;

ALTER FUNCTION public.usage_by_campaign(p_since timestamp with time zone) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.usage_events_fill_campaign() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.campaign_id is null and new.session_id is not null then
    select s.campaign_id into new.campaign_id from public.sessions s where s.id = new.session_id;
  end if;
  return new;
end $$;

ALTER FUNCTION public.usage_events_fill_campaign() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.vibe_target(code text, p_session_number integer) RETURNS TABLE(campaign_name text, session_id uuid, session_number integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select c.name, s.id, s.session_number
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code and s.session_number = p_session_number
  limit 1;
$$;

ALTER FUNCTION public.vibe_target(code text, p_session_number integer) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.vtt_same_campaign() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  j  jsonb := to_jsonb(new);
  o  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  c  uuid  := (j ->> 'campaign_id')::uuid;
  moved boolean := tg_op = 'INSERT' or (j -> 'campaign_id') is distinct from (o -> 'campaign_id');
  k  text;
  v  uuid;
  ok boolean;
begin
  foreach k in array array['scene_id', 'entry_id', 'token_id', 'character_id', 'battle_map_id'] loop
    continue when not (j ? k) or j ->> k is null;
    continue when not moved and (j -> k) is not distinct from (o -> k);
    v := (j ->> k)::uuid;
    ok := case k
      when 'scene_id'      then exists (select 1 from public.vtt_scenes x  where x.id = v and x.campaign_id = c)
      when 'entry_id'      then exists (select 1 from public.entries x     where x.id = v and x.campaign_id = c)
      when 'token_id'      then exists (select 1 from public.vtt_tokens x  where x.id = v and x.campaign_id = c)
      when 'character_id'  then exists (select 1 from public.characters x  where x.id = v and x.campaign_id = c)
      when 'battle_map_id' then exists (select 1 from public.battle_maps x where x.id = v and x.campaign_id = c)
    end;
    if not ok then
      raise exception 'that % belongs to another campaign', replace(replace(k, '_id', ''), '_', ' ') using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

ALTER FUNCTION public.vtt_same_campaign() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_calendar_reshape(p_campaign uuid, p_calendar jsonb, p_day integer, p_moves jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_n integer;
begin
  if not public.is_campaign_gm(p_campaign) then raise exception 'not permitted'; end if;
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) > 5000 then raise exception 'bad moves'; end if;
  update public.campaigns set world_calendar = p_calendar, world_day = p_day where id = p_campaign;
  -- every row is matched by its date before this update, so a chain of moves (a to b, b to c) is safe
  update public.sessions s
     set world_day = (m ->> 1)::integer
    from jsonb_array_elements(p_moves) m
   where s.campaign_id = p_campaign
     and jsonb_typeof(m -> 0) = 'number' and jsonb_typeof(m -> 1) = 'number'
     and s.world_day = (m ->> 0)::integer;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

ALTER FUNCTION public.world_calendar_reshape(p_campaign uuid, p_calendar jsonb, p_day integer, p_moves jsonb) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_ai_image_read(p_campaign uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    when public.is_campaign_gm(p_campaign) or public.is_campaign_member(p_campaign) then
      (select wm.ai_image_url from public.world_maps wm where wm.campaign_id = p_campaign limit 1)
    else null
  end;
$$;

ALTER FUNCTION public.world_map_ai_image_read(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_ai_image_read_for_player(p_share text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select wm.ai_image_url
  from public.world_maps wm
  join public.campaigns c on c.id = wm.campaign_id
  where c.share_code = p_share
  limit 1;
$$;

ALTER FUNCTION public.world_map_ai_image_read_for_player(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_features_read(p_campaign uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select case
    when public.is_campaign_gm(p_campaign) or public.is_campaign_member(p_campaign) then
      coalesce((
        select jsonb_agg(jsonb_build_object('kind', mf.kind, 'class', mf.class, 'path', mf.path, 'name', mf.name))
        from public.map_features mf
        join public.world_maps wm on wm.id = mf.world_map_id
        where wm.campaign_id = p_campaign
      ), '[]'::jsonb)
    else null
  end;
$$;

ALTER FUNCTION public.world_map_features_read(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_features_read_for_player(p_share text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select jsonb_agg(jsonb_build_object('kind', mf.kind, 'class', mf.class, 'path', mf.path, 'name', mf.name))
    from public.map_features mf
    join public.world_maps wm on wm.id = mf.world_map_id
    join public.campaigns c on c.id = wm.campaign_id
    where c.share_code = p_share
  ), '[]'::jsonb);
$$;

ALTER FUNCTION public.world_map_features_read_for_player(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_labels_read(p_campaign uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  select case
    when public.is_campaign_gm(p_campaign) or public.is_campaign_member(p_campaign) then
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.id, 'x', l.x, 'y', l.y, 'text', l.text, 'size', l.size, 'color', l.color
        ))
        from public.map_labels l
        join public.world_maps wm on wm.id = l.world_map_id
        where wm.campaign_id = p_campaign
          and (public.is_campaign_gm(p_campaign) or l.visibility in ('common', 'player'))
      ), '[]'::jsonb)
    else null
  end
$$;

ALTER FUNCTION public.world_map_labels_read(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_labels_read_for_player(p_share text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'x', l.x, 'y', l.y, 'text', l.text, 'size', l.size, 'color', l.color
    ))
    from public.map_labels l
    join public.world_maps wm on wm.id = l.world_map_id
    join public.campaigns c on c.id = wm.campaign_id
    where c.share_code = p_share
      and l.visibility in ('common','player')
  ), '[]'::jsonb);
$$;

ALTER FUNCTION public.world_map_labels_read_for_player(p_share text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_paint(p_campaign uuid, p_terrain text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not exists (
    select 1 from world_maps wm
    where wm.campaign_id = p_campaign
      and (is_campaign_gm(p_campaign) or (wm.editable_by = 'party' and is_campaign_member(p_campaign)))
  ) then
    raise exception 'not permitted to edit this map';
  end if;
  update world_maps set terrain = p_terrain, updated_at = now() where campaign_id = p_campaign;
end;
$$;

ALTER FUNCTION public.world_map_paint(p_campaign uuid, p_terrain text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_poi_detail_for_player(p_share text, p_poi uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;

ALTER FUNCTION public.world_map_poi_detail_for_player(p_share text, p_poi uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_read(p_campaign uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with allowed as (
    select
      is_campaign_gm(p_campaign) as is_gm,
      (is_campaign_gm(p_campaign) or is_campaign_member(p_campaign)) as can_read
  ),
  wm as (
    select * from world_maps where campaign_id = p_campaign
  )
  select case
    when not (select can_read from allowed) then null::jsonb
    else jsonb_build_object(
      'map',    (select to_jsonb(w) - 'campaign_id' from wm w),
      'biomes', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from biomes b),
      'images', (select coalesce(jsonb_agg(to_jsonb(i) order by i.z), '[]'::jsonb)
                 from map_images i where i.world_map_id = (select id from wm)),
      'icons',  (select coalesce(jsonb_agg(jsonb_build_object('id', mi.id, 'url', mi.url)), '[]'::jsonb)
                 from map_icons mi where mi.campaign_id = p_campaign),
      'layers', (select coalesce(jsonb_agg(to_jsonb(l) order by l.ord), '[]'::jsonb)
                 from map_layers l where l.world_map_id = (select id from wm)),
      'regions', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
                  from regions r
                  where r.world_map_id = (select id from wm)
                    and ((select is_gm from allowed) or r.visibility in ('common','player'))),
      'hexes', (select coalesce(jsonb_agg(jsonb_build_object('col', h.col, 'row', h.row, 'region_id', h.region_id)), '[]'::jsonb)
                from world_hexes h
                join regions r on r.id = h.region_id
                where h.world_map_id = (select id from wm)
                  and ((select is_gm from allowed) or r.visibility in ('common','player'))),
      'pois', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
               from map_pois p
               where p.world_map_id = (select id from wm)
                 and ((select is_gm from allowed) or p.visibility in ('common','player')))
    )
  end;
$$;

ALTER FUNCTION public.world_map_read(p_campaign uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.world_map_read_for_player(p_share text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with camp as (
    select id from public.campaigns where share_code = p_share limit 1
  ),
  wm as (
    select * from public.world_maps where campaign_id = (select id from camp)
  )
  select case
    when (select id from camp) is null then null::jsonb
    else jsonb_build_object(
      'map',    (select to_jsonb(w) - 'campaign_id' from wm w),
      'biomes', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from public.biomes b),
      'images', (select coalesce(jsonb_agg(to_jsonb(i) order by i.z), '[]'::jsonb)
                 from public.map_images i where i.world_map_id = (select id from wm)),
      'icons',  (select coalesce(jsonb_agg(jsonb_build_object('id', mi.id, 'url', mi.url)), '[]'::jsonb)
                 from public.map_icons mi where mi.campaign_id = (select id from camp)),
      'layers', (select coalesce(jsonb_agg(to_jsonb(l) order by l.ord), '[]'::jsonb)
                 from public.map_layers l where l.world_map_id = (select id from wm)),
      'regions', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
                  from public.regions r
                  where r.world_map_id = (select id from wm)
                    and r.visibility in ('common','player')),
      'hexes', (select coalesce(jsonb_agg(jsonb_build_object('col', h.col, 'row', h.row, 'region_id', h.region_id)), '[]'::jsonb)
                from public.world_hexes h
                join public.regions r on r.id = h.region_id
                where h.world_map_id = (select id from wm)
                  and r.visibility in ('common','player')),
      'pois', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
               from public.map_pois p
               where p.world_map_id = (select id from wm)
                 and p.visibility in ('common','player'))
    )
  end;
$$;

ALTER FUNCTION public.world_map_read_for_player(p_share text) OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public._migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    note text
);

ALTER TABLE public._migrations OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.addon_hooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    secret text NOT NULL,
    events text[] DEFAULT '{roll}'::text[] NOT NULL,
    include_secret boolean DEFAULT false NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    fail_count integer DEFAULT 0 NOT NULL,
    last_status integer,
    last_error text,
    last_attempt_at timestamp with time zone,
    last_ok_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT addon_hooks_events_check CHECK (((cardinality(events) >= 1) AND (events <@ ARRAY['roll'::text, 'chat'::text, 'turn'::text, 'combat'::text]))),
    CONSTRAINT addon_hooks_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 40))),
    CONSTRAINT addon_hooks_secret_check CHECK ((char_length(secret) >= 32)),
    CONSTRAINT addon_hooks_url_check CHECK (((char_length(url) <= 500) AND (url ~ '^https://[^[:space:]]+$'::text)))
);

ALTER TABLE public.addon_hooks OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.addon_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text NOT NULL,
    prefix text NOT NULL,
    key_hash text NOT NULL,
    scopes text[] DEFAULT '{read}'::text[] NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    window_start timestamp with time zone DEFAULT now() NOT NULL,
    window_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT addon_keys_key_hash_check CHECK ((key_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT addon_keys_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 40))),
    CONSTRAINT addon_keys_prefix_check CHECK (((char_length(prefix) >= 4) AND (char_length(prefix) <= 16))),
    CONSTRAINT addon_keys_scopes_check CHECK (((cardinality(scopes) >= 1) AND (scopes <@ ARRAY['read'::text, 'chat'::text, 'roll'::text])))
);

ALTER TABLE public.addon_keys OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.addon_outbox (
    id bigint NOT NULL,
    hook_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    event text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_until timestamp with time zone,
    delivered_at timestamp with time zone,
    dropped_at timestamp with time zone
);

ALTER TABLE public.addon_outbox OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.ai_map_renders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'world'::text NOT NULL,
    CONSTRAINT ai_map_renders_kind_check CHECK ((kind = ANY (ARRAY['world'::text, 'battle'::text, 'trace'::text, 'ask'::text, 'recap'::text, 'journal'::text, 'import'::text])))
);

ALTER TABLE public.ai_map_renders OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.arc_touches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    arc_id uuid NOT NULL,
    session_id uuid,
    event_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.arc_touches OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.arcs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    character_id uuid,
    profile_id uuid,
    title text NOT NULL,
    description text,
    status text DEFAULT 'open'::text NOT NULL,
    opened_session_id uuid,
    last_touched_session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT arcs_status_check CHECK ((status = ANY (ARRAY['open'::text, 'progressing'::text, 'resolved'::text, 'dormant'::text])))
);

ALTER TABLE public.arcs OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid NOT NULL,
    profile_id uuid,
    status text DEFAULT 'present'::text NOT NULL,
    character_id uuid,
    CONSTRAINT attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'partial'::text, 'going'::text, 'maybe'::text, 'declined'::text])))
);

ALTER TABLE public.attendance OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.audio_tracks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    character_id uuid,
    storage_path text,
    duration_seconds numeric,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    gm_identity_id uuid,
    purged_at timestamp with time zone,
    kind text DEFAULT 'speaker'::text NOT NULL,
    speaker_map jsonb,
    timeline_map jsonb,
    CONSTRAINT audio_tracks_kind_check CHECK ((kind = ANY (ARRAY['speaker'::text, 'room'::text]))),
    CONSTRAINT audio_tracks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'transcribing'::text, 'done'::text, 'error'::text])))
);

ALTER TABLE public.audio_tracks OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.bastion_maps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.bastion_maps OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.biomes (
    id smallint NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    category text NOT NULL,
    color text NOT NULL,
    sort smallint DEFAULT 0 NOT NULL
);

ALTER TABLE public.biomes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.building_maps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.building_maps OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.calendar_feeds (
    profile_id uuid NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.calendar_feeds OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.campaign_gm_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    accepted_by uuid,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone
);

ALTER TABLE public.campaign_gm_invites OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.campaign_journals (
    campaign_id uuid NOT NULL,
    content jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.campaign_journals OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.campaign_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    from_id uuid NOT NULL,
    to_email text NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    cancelled_at timestamp with time zone,
    CONSTRAINT campaign_transfers_to_email_check CHECK (((to_email = lower(to_email)) AND (char_length(to_email) <= 320)))
);

ALTER TABLE public.campaign_transfers OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    system text DEFAULT '5e'::text NOT NULL,
    gm_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    share_code text DEFAULT substr(md5((gen_random_uuid())::text), 1, 10),
    discord_guild_id text,
    discord_channel_id text,
    recur_rule jsonb,
    public_slug text,
    public_published_at timestamp with time zone,
    public_blurb text,
    public_listed boolean DEFAULT false NOT NULL,
    codex_cover_url text,
    time_zone text,
    deleted_at timestamp with time zone,
    trash_restore jsonb,
    audio_language text,
    world_calendar jsonb,
    world_day integer,
    codex_theme text,
    activity_watchers boolean DEFAULT false NOT NULL,
    CONSTRAINT campaigns_audio_language_shape CHECK (((audio_language IS NULL) OR (audio_language ~ '^[a-z]{2}$'::text))),
    CONSTRAINT campaigns_codex_theme_check CHECK (((codex_theme IS NULL) OR (codex_theme = ANY (ARRAY['forge'::text, 'frost'::text, 'verdant'::text, 'crimson'::text, 'arcane'::text])))),
    CONSTRAINT campaigns_time_zone_shape CHECK (((time_zone IS NULL) OR ((char_length(time_zone) <= 64) AND (time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'::text)))),
    CONSTRAINT campaigns_world_calendar_shape CHECK (((world_calendar IS NULL) OR ((jsonb_typeof(world_calendar) = 'object'::text) AND (jsonb_typeof((world_calendar -> 'months'::text)) = 'array'::text) AND ((jsonb_array_length((world_calendar -> 'months'::text)) >= 1) AND (jsonb_array_length((world_calendar -> 'months'::text)) <= 24)) AND (pg_column_size(world_calendar) <= 8192)))),
    CONSTRAINT campaigns_world_day_range CHECK (((world_day IS NULL) OR ((world_day >= '-100000000'::integer) AND (world_day <= 100000000))))
);

ALTER TABLE public.campaigns OWNER TO postgres;

COMMENT ON COLUMN public.campaigns.audio_language IS 'ISO 639-1 code of the language the table plays in (transcription, recaps, journal). Null means English. Push 26.';

CREATE TABLE IF NOT EXISTS public.capture_control (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid,
    guild_id text NOT NULL,
    requested_by_discord_id text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    capture_job_id uuid,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    channel_id text,
    heartbeat_at timestamp with time zone,
    owner text
);

ALTER TABLE public.capture_control OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.capture_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid NOT NULL,
    source text DEFAULT 'online'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    extractor_version text,
    error text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    extract_cursor integer DEFAULT 0 NOT NULL,
    recode_cursor integer DEFAULT 0 NOT NULL,
    gm_extract_cursor integer DEFAULT 0 NOT NULL,
    room_consent_by uuid,
    room_consent_at timestamp with time zone,
    CONSTRAINT capture_jobs_source_check CHECK ((source = ANY (ARRAY['online'::text, 'in_person'::text]))),
    CONSTRAINT capture_jobs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'blocked_consent'::text, 'uploading'::text, 'transcribing'::text, 'extracting'::text, 'review'::text, 'done'::text, 'error'::text])))
);

ALTER TABLE public.capture_jobs OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.character_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    source_library_id uuid,
    name text NOT NULL,
    species text,
    class text,
    subclass text,
    species_variant text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.character_identities OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.character_wiki_gm_edit (
    character_id uuid NOT NULL,
    campaign_id uuid,
    granted_by uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.character_wiki_gm_edit OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.character_wiki_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    campaign_id uuid,
    owner_id uuid,
    title text DEFAULT ''::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT character_wiki_sections_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'shared'::text])))
);

ALTER TABLE public.character_wiki_sections OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.characters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    profile_id uuid,
    kind text DEFAULT 'pc'::text NOT NULL,
    name text NOT NULL,
    species text,
    class text,
    subclass text,
    level smallint,
    alignment text,
    build jsonb,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    visibility text DEFAULT 'player'::text NOT NULL,
    invite_code text DEFAULT substr(md5((gen_random_uuid())::text), 1, 10),
    discord_user_id text,
    ddb_character_id text,
    species_variant text,
    portrait_url text,
    identity_id uuid,
    is_public boolean DEFAULT false NOT NULL,
    alter_ego_of uuid,
    system text DEFAULT 'dnd5e'::text NOT NULL,
    blocks jsonb,
    summary text,
    CONSTRAINT characters_kind_check CHECK ((kind = ANY (ARRAY['pc'::text, 'npc'::text]))),
    CONSTRAINT characters_visibility_check CHECK ((visibility = ANY (ARRAY['common'::text, 'player'::text, 'gm'::text, 'private'::text])))
);

ALTER TABLE public.characters OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.chat_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    player_profile uuid NOT NULL,
    from_ts timestamp with time zone NOT NULL,
    to_ts timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.chat_grants OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    author_profile uuid NOT NULL,
    display_name text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.chat_messages OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.class_capabilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system text DEFAULT '5e'::text NOT NULL,
    class text NOT NULL,
    subclass text,
    capabilities text[] DEFAULT '{}'::text[] NOT NULL,
    partnered boolean DEFAULT false NOT NULL,
    partner text
);

ALTER TABLE public.class_capabilities OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system text DEFAULT '5e'::text NOT NULL,
    name text NOT NULL,
    source text DEFAULT 'core'::text NOT NULL,
    partnered boolean DEFAULT false NOT NULL,
    partner text,
    edition text DEFAULT 'both'::text NOT NULL,
    sort integer DEFAULT 100 NOT NULL,
    CONSTRAINT classes_edition_check CHECK ((edition = ANY (ARRAY['2014'::text, '2024'::text, 'both'::text])))
);

ALTER TABLE public.classes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.combats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    encounter_id uuid,
    session_id uuid,
    name text DEFAULT 'Combat'::text NOT NULL,
    rules text DEFAULT '2024'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    round integer DEFAULT 1 NOT NULL,
    turn integer DEFAULT 0 NOT NULL,
    combatants jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    calibration jsonb DEFAULT '{}'::jsonb NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT combats_status_ck CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text])))
);

ALTER TABLE public.combats OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.compendium_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gm_id uuid NOT NULL,
    campaign_id uuid,
    system text DEFAULT 'dnd5e'::text NOT NULL,
    ruleset text DEFAULT 'both'::text NOT NULL,
    category text DEFAULT 'custom'::text NOT NULL,
    overrides_id text,
    name text DEFAULT 'Untitled'::text NOT NULL,
    source text DEFAULT 'kc'::text NOT NULL,
    tag text,
    meta_lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    body text,
    spoken jsonb DEFAULT '[]'::jsonb NOT NULL,
    aliases jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    display jsonb,
    CONSTRAINT compendium_entries_ruleset_check CHECK ((ruleset = ANY (ARRAY['2014'::text, '2024'::text, 'both'::text])))
);

ALTER TABLE public.compendium_entries OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.discord_setup_codes (
    code text NOT NULL,
    campaign_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '1 day'::interval) NOT NULL,
    used_at timestamp with time zone,
    used_by text
);

ALTER TABLE public.discord_setup_codes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.disposition_reveals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    revealed_by uuid NOT NULL,
    campaign_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.disposition_reveals OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.disposition_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    status text DEFAULT 'fitting'::text NOT NULL,
    execution text,
    error text,
    triggered_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT disposition_runs_status_check CHECK ((status = ANY (ARRAY['fitting'::text, 'done'::text, 'error'::text])))
);

ALTER TABLE public.disposition_runs OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.dispositions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    campaign_id uuid,
    source text NOT NULL,
    axis_scores jsonb NOT NULL,
    weights jsonb,
    model_version text NOT NULL,
    session_id uuid,
    as_of timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    character_id uuid,
    scope text DEFAULT 'character'::text NOT NULL,
    CONSTRAINT dispositions_scope_check CHECK ((scope = ANY (ARRAY['player'::text, 'character'::text]))),
    CONSTRAINT dispositions_scope_shape_check CHECK ((((scope = 'player'::text) AND (character_id IS NULL) AND (campaign_id IS NULL)) OR ((scope = 'character'::text) AND (character_id IS NOT NULL)))),
    CONSTRAINT dispositions_source_check CHECK ((source = ANY (ARRAY['prior'::text, 'posterior'::text])))
);

ALTER TABLE public.dispositions OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.dm_boards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gm_id uuid NOT NULL,
    campaign_id uuid,
    name text DEFAULT 'New board'::text NOT NULL,
    cards jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.dm_boards OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.dungeon_maps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    levels jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.dungeon_maps OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.email_prefs (
    email text NOT NULL,
    reminders boolean DEFAULT true NOT NULL,
    recaps boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    digest boolean DEFAULT false NOT NULL,
    CONSTRAINT email_prefs_email_check CHECK (((email = lower(email)) AND (char_length(email) <= 320)))
);

ALTER TABLE public.email_prefs OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.encounters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text NOT NULL,
    rules text DEFAULT '2024'::text NOT NULL,
    foes jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    maps jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT encounters_maps_shape CHECK (((jsonb_typeof(maps) = 'array'::text) AND (jsonb_array_length(maps) <= 12)))
);

ALTER TABLE public.encounters OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.entity_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    relation text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_links_source_type_check CHECK ((source_type = ANY (ARRAY['entry'::text, 'character'::text, 'arc'::text, 'session'::text, 'event'::text]))),
    CONSTRAINT entity_links_target_type_check CHECK ((target_type = ANY (ARRAY['entry'::text, 'character'::text, 'arc'::text, 'session'::text, 'event'::text])))
);

ALTER TABLE public.entity_links OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    visibility text DEFAULT 'gm'::text NOT NULL,
    created_by uuid DEFAULT auth.uid() NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    slug text,
    image_url text,
    summary text,
    blocks jsonb,
    CONSTRAINT entries_type_check CHECK ((type = ANY (ARRAY['note'::text, 'location'::text, 'lore'::text]))),
    CONSTRAINT entries_visibility_check CHECK ((visibility = ANY (ARRAY['common'::text, 'player'::text, 'gm'::text, 'private'::text])))
);

ALTER TABLE public.entries OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.entry_reveals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    revealed_to_character_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.entry_reveals OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.event_types (
    key text NOT NULL,
    label text NOT NULL,
    category text NOT NULL,
    default_axis text,
    default_frame text,
    default_target text,
    CONSTRAINT event_types_category_check CHECK ((category = ANY (ARRAY['opportunity'::text, 'response'::text, 'reward'::text, 'meta'::text]))),
    CONSTRAINT event_types_default_axis_check CHECK ((default_axis = ANY (ARRAY['N'::text, 'T'::text, 'O'::text, 'S'::text, 'E'::text, 'I'::text]))),
    CONSTRAINT event_types_default_frame_check CHECK ((default_frame = ANY (ARRAY['ic'::text, 'ooc'::text]))),
    CONSTRAINT event_types_default_target_check CHECK ((default_target = ANY (ARRAY['fiction'::text, 'player'::text, 'system'::text])))
);

ALTER TABLE public.event_types OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid NOT NULL,
    character_id uuid,
    actor_profile_id uuid,
    event_type text NOT NULL,
    axis text,
    frame text,
    target text,
    ts_offset_ms bigint,
    payload jsonb,
    source text DEFAULT 'manual'::text NOT NULL,
    confidence numeric(4,3),
    transcript_span jsonb,
    extractor_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT events_axis_check CHECK ((axis = ANY (ARRAY['N'::text, 'T'::text, 'O'::text, 'S'::text, 'E'::text, 'I'::text]))),
    CONSTRAINT events_frame_check CHECK ((frame = ANY (ARRAY['ic'::text, 'ooc'::text]))),
    CONSTRAINT events_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'vtt'::text, 'transcript'::text]))),
    CONSTRAINT events_target_check CHECK ((target = ANY (ARRAY['fiction'::text, 'player'::text, 'system'::text])))
);

ALTER TABLE public.events OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.gm_card_decks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'custom'::text NOT NULL,
    back_color text DEFAULT '#7a2e2e'::text NOT NULL,
    back_path text,
    players_draw boolean DEFAULT true NOT NULL,
    cards jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gm_card_decks_back_color_check CHECK ((back_color ~ '^#[0-9a-fA-F]{6}$'::text)),
    CONSTRAINT gm_card_decks_back_folder CHECK (((back_path IS NULL) OR (back_path ~ (('^library/'::text || (owner)::text) || '/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'::text)))),
    CONSTRAINT gm_card_decks_cards_check CHECK (((jsonb_typeof(cards) = 'array'::text) AND ((jsonb_array_length(cards) >= 1) AND (jsonb_array_length(cards) <= 200)))),
    CONSTRAINT gm_card_decks_kind_check CHECK ((kind = ANY (ARRAY['standard'::text, 'custom'::text]))),
    CONSTRAINT gm_card_decks_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 60)))
);

ALTER TABLE public.gm_card_decks OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.gm_event_kinds (
    kind text NOT NULL,
    category text NOT NULL,
    label text NOT NULL,
    feeds text[] DEFAULT '{}'::text[] NOT NULL,
    sort integer DEFAULT 0 NOT NULL
);

ALTER TABLE public.gm_event_kinds OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.gm_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid NOT NULL,
    kind text NOT NULL,
    summary text NOT NULL,
    detail text,
    quote text,
    npc_id uuid,
    npc_name text,
    location_name text,
    target_character_id uuid,
    thread_status text DEFAULT 'n/a'::text,
    resolved_by_event_id uuid,
    resolved_session_id uuid,
    audio_track_id uuid,
    t_start_seconds numeric,
    proposed_from uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    faction_name text,
    location_id uuid,
    faction_id uuid,
    lore_disposition text,
    CONSTRAINT gm_events_lore_disposition_check CHECK ((lore_disposition = ANY (ARRAY['legacy'::text, 'kept'::text, 'dismissed'::text]))),
    CONSTRAINT gm_events_thread_status_check CHECK ((thread_status = ANY (ARRAY['n/a'::text, 'open'::text, 'resolved'::text, 'dropped'::text])))
);

ALTER TABLE public.gm_events OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.gm_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    profile_id uuid,
    discord_user_id text,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.gm_identities OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.gm_proposed_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid NOT NULL,
    job_id uuid,
    kind text NOT NULL,
    summary text NOT NULL,
    detail text,
    quote text,
    npc_name text,
    npc_id uuid,
    location_name text,
    target_character_id uuid,
    audio_track_id uuid,
    t_start_seconds numeric,
    t_end_seconds numeric,
    confidence numeric,
    status text DEFAULT 'proposed'::text NOT NULL,
    extractor_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    faction_name text,
    location_id uuid,
    faction_id uuid,
    CONSTRAINT gm_proposed_events_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'merged'::text])))
);

ALTER TABLE public.gm_proposed_events OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.import_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    body text,
    links jsonb DEFAULT '[]'::jsonb NOT NULL,
    confidence numeric,
    origin text,
    source_note text,
    dedupe_kind text,
    dedupe_id uuid,
    decision text DEFAULT 'pending'::text NOT NULL,
    created_kind text,
    created_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_candidates_decision_check CHECK ((decision = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'merged'::text]))),
    CONSTRAINT import_candidates_kind_check CHECK ((kind = ANY (ARRAY['npc'::text, 'location'::text, 'faction'::text, 'item'::text, 'lore'::text, 'pc'::text])))
);

ALTER TABLE public.import_candidates OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.import_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    created_by uuid DEFAULT auth.uid() NOT NULL,
    status text DEFAULT 'parsing'::text NOT NULL,
    source_format text,
    session_mode text,
    file_count integer DEFAULT 0 NOT NULL,
    note_count integer DEFAULT 0 NOT NULL,
    candidate_count integer DEFAULT 0 NOT NULL,
    session_count integer DEFAULT 0 NOT NULL,
    stats jsonb,
    warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_jobs_status_check CHECK ((status = ANY (ARRAY['parsing'::text, 'extracting'::text, 'review'::text, 'committing'::text, 'committed'::text, 'error'::text])))
);

ALTER TABLE public.import_jobs OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.import_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    idx integer NOT NULL,
    label text,
    occurred_on date,
    recap text,
    entity_names jsonb DEFAULT '[]'::jsonb NOT NULL,
    decision text DEFAULT 'pending'::text NOT NULL,
    created_session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_sessions_decision_check CHECK ((decision = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

ALTER TABLE public.import_sessions OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.loot_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid,
    character_id uuid,
    event_id uuid,
    item_name text NOT NULL,
    rarity text,
    est_value numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.loot_grants OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.lore_backup (
    backup_id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_id uuid NOT NULL,
    campaign_id uuid,
    type text,
    title text,
    body text,
    visibility text,
    created_by uuid,
    tags text[],
    is_public boolean,
    slug text,
    image_url text,
    backed_up_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text
);

ALTER TABLE public.lore_backup OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.map_features (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_map_id uuid NOT NULL,
    kind text NOT NULL,
    class integer DEFAULT 1 NOT NULL,
    path jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text,
    CONSTRAINT map_features_kind_check CHECK ((kind = ANY (ARRAY['river'::text, 'road'::text])))
);

ALTER TABLE public.map_features OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.map_fog (
    map_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    cols integer DEFAULT 64 NOT NULL,
    rows integer DEFAULT 48 NOT NULL,
    cells text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.map_fog OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.map_icons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    url text NOT NULL,
    bytes integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.map_icons OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.map_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_map_id uuid NOT NULL,
    url text NOT NULL,
    x double precision DEFAULT 0 NOT NULL,
    y double precision DEFAULT 0 NOT NULL,
    scale double precision DEFAULT 1 NOT NULL,
    z integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.map_images OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.map_labels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_map_id uuid NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    text text DEFAULT 'Label'::text NOT NULL,
    size integer DEFAULT 18 NOT NULL,
    color text,
    visibility text DEFAULT 'common'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    locked boolean DEFAULT false NOT NULL
);

ALTER TABLE public.map_labels OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.map_layers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_map_id uuid NOT NULL,
    name text NOT NULL,
    ord integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.map_layers OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.map_pins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    map_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    label text,
    linked_type text,
    linked_id uuid,
    visibility text DEFAULT 'player'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.map_pins OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.map_pois (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_map_id uuid NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    col smallint,
    "row" smallint,
    icon_key text,
    icon_id uuid,
    name text DEFAULT 'New marker'::text NOT NULL,
    note text,
    entry_id uuid,
    character_id uuid,
    visibility text DEFAULT 'common'::text NOT NULL,
    size real DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    color text,
    locked boolean DEFAULT false NOT NULL,
    CONSTRAINT map_pois_visibility_ck CHECK ((visibility = ANY (ARRAY['common'::text, 'player'::text, 'gm'::text, 'private'::text])))
);

ALTER TABLE public.map_pois OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.maps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text DEFAULT 'Map'::text NOT NULL,
    image_path text NOT NULL,
    visibility text DEFAULT 'player'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_entry_id uuid
);

ALTER TABLE public.maps OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role text DEFAULT 'player'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT memberships_role_check CHECK ((role = ANY (ARRAY['player'::text, 'gm'::text, 'co-gm'::text])))
);

ALTER TABLE public.memberships OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.notifications (
    id bigint NOT NULL,
    profile_id uuid NOT NULL,
    campaign_id uuid,
    kind text NOT NULL,
    title text NOT NULL,
    link text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    emailed_at timestamp with time zone,
    CONSTRAINT notifications_dedupe_key_check CHECK ((char_length(dedupe_key) <= 200)),
    CONSTRAINT notifications_kind_check CHECK ((kind = ANY (ARRAY['session_scheduled'::text, 'session_moved'::text, 'session_cancelled'::text, 'recap_sent'::text, 'rsvp'::text, 'player_joined'::text, 'review_ready'::text, 'processing_failed'::text, 'cogm_joined'::text, 'cogm_left'::text, 'cogm_removed'::text]))),
    CONSTRAINT notifications_link_check CHECK (((link IS NULL) OR ((char_length(link) <= 500) AND (link ~~ '/%'::text)))),
    CONSTRAINT notifications_title_check CHECK ((char_length(title) <= 300))
);

ALTER TABLE public.notifications OWNER TO postgres;

do $guard$ begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.notifications'::regclass and attname = 'id' and attidentity <> '') then
    execute 'ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
)';
  end if;
end $guard$;

CREATE TABLE IF NOT EXISTS public.npc_text_fix_backup (
    entry_id uuid NOT NULL,
    character_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    old_entry_body text,
    old_char_description text,
    fixed_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.npc_text_fix_backup OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.party_funds (
    campaign_id uuid NOT NULL,
    pp integer DEFAULT 0 NOT NULL,
    gp integer DEFAULT 0 NOT NULL,
    ep integer DEFAULT 0 NOT NULL,
    sp integer DEFAULT 0 NOT NULL,
    cp integer DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT party_funds_cp_check CHECK ((cp >= 0)),
    CONSTRAINT party_funds_ep_check CHECK ((ep >= 0)),
    CONSTRAINT party_funds_gp_check CHECK ((gp >= 0)),
    CONSTRAINT party_funds_pp_check CHECK ((pp >= 0)),
    CONSTRAINT party_funds_sp_check CHECK ((sp >= 0))
);

ALTER TABLE public.party_funds OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.party_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text NOT NULL,
    qty integer DEFAULT 1 NOT NULL,
    weight real,
    note text,
    custom boolean DEFAULT false NOT NULL,
    mod smallint,
    variant text,
    added_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT party_items_mod_check CHECK (((mod IS NULL) OR ((mod >= 0) AND (mod <= 3)))),
    CONSTRAINT party_items_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 80))),
    CONSTRAINT party_items_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
    CONSTRAINT party_items_qty_check CHECK (((qty >= 1) AND (qty <= 9999))),
    CONSTRAINT party_items_variant_check CHECK (((variant IS NULL) OR (char_length(variant) <= 80))),
    CONSTRAINT party_items_weight_check CHECK (((weight IS NULL) OR ((weight >= (0)::double precision) AND (weight <= (10000)::double precision))))
);

ALTER TABLE public.party_items OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.pc_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    name text NOT NULL,
    build jsonb DEFAULT '{}'::jsonb NOT NULL,
    species text,
    class text,
    subclass text,
    species_variant text,
    level smallint,
    portrait_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    alter_ego_of uuid,
    system text DEFAULT 'dnd5e'::text NOT NULL
);

ALTER TABLE public.pc_library OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.player_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    entry_id uuid,
    body text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.player_notes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.poll_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    poll_id uuid NOT NULL,
    discord_user_id text,
    character_id uuid,
    available jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.poll_responses OWNER TO postgres;

CREATE OR REPLACE VIEW public.profiles_public AS
 SELECT id,
    display_name,
    avatar_url,
    is_anonymous
   FROM public.profiles;

ALTER VIEW public.profiles_public OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.proposed_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid NOT NULL,
    character_id uuid,
    event_type text,
    axis text,
    frame text,
    target text,
    confidence numeric,
    segment_id uuid,
    extractor_version text,
    rationale text,
    status text DEFAULT 'proposed'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT proposed_events_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'accepted'::text, 'rejected'::text])))
);

ALTER TABLE public.proposed_events OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.rate_hits (
    id bigint NOT NULL,
    bucket text NOT NULL,
    key text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.rate_hits OWNER TO postgres;

CREATE SEQUENCE IF NOT EXISTS public.rate_hits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.rate_hits_id_seq OWNER TO postgres;

ALTER SEQUENCE public.rate_hits_id_seq OWNED BY public.rate_hits.id;

CREATE TABLE IF NOT EXISTS public.recap_sends (
    id bigint NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid NOT NULL,
    sent_by uuid NOT NULL,
    recipients integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recap_sends_recipients_check CHECK (((recipients >= 0) AND (recipients <= 100)))
);

ALTER TABLE public.recap_sends OWNER TO postgres;

do $guard$ begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.recap_sends'::regclass and attname = 'id' and attidentity <> '') then
    execute 'ALTER TABLE public.recap_sends ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.recap_sends_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
)';
  end if;
end $guard$;

CREATE TABLE IF NOT EXISTS public.recodings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    segment_id uuid,
    coder_version text,
    event_type text,
    axis text,
    confidence numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.recodings OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.recording_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid,
    character_id uuid,
    profile_id uuid,
    consented boolean DEFAULT false NOT NULL,
    method text,
    recorded_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.recording_consents OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.regions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_map_id uuid NOT NULL,
    layer_id uuid NOT NULL,
    name text NOT NULL,
    parent_region_id uuid,
    entry_id uuid,
    visibility text DEFAULT 'common'::text NOT NULL,
    tint text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT regions_visibility_ck CHECK ((visibility = ANY (ARRAY['common'::text, 'player'::text, 'gm'::text, 'private'::text])))
);

ALTER TABLE public.regions OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.roll_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    players_can_roll boolean DEFAULT false NOT NULL,
    results_gm_only boolean DEFAULT false NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roll_tables_body_check CHECK ((char_length(body) <= 20000)),
    CONSTRAINT roll_tables_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 80)))
);

ALTER TABLE public.roll_tables OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.scene_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    scene_id uuid NOT NULL,
    session_id uuid,
    label text NOT NULL,
    taken_by uuid,
    taken_at timestamp with time zone DEFAULT now() NOT NULL,
    data jsonb NOT NULL,
    CONSTRAINT scene_snapshots_label_check CHECK ((char_length(label) <= 120))
);

ALTER TABLE public.scene_snapshots OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.session_plan_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    title text NOT NULL,
    note text,
    kind text DEFAULT 'scene'::text NOT NULL,
    difficulty text,
    linked_event_id uuid,
    linked_character_id uuid,
    "position" integer DEFAULT 0 NOT NULL,
    done boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'gm'::text NOT NULL
);

ALTER TABLE public.session_plan_items OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.session_polls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    created_by uuid,
    status text DEFAULT 'open'::text NOT NULL,
    slots jsonb DEFAULT '[]'::jsonb NOT NULL,
    recurring boolean DEFAULT false NOT NULL,
    channel_id text,
    message_id text,
    chosen_slot text,
    session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.session_polls OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_number integer,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    status text DEFAULT 'scheduled'::text NOT NULL,
    consent_recorded boolean DEFAULT false NOT NULL,
    capture_modality text DEFAULT 'none'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    recap text,
    reminder_sent_at timestamp with time zone,
    discord_recap_post jsonb,
    world_day integer,
    CONSTRAINT sessions_capture_modality_check CHECK ((capture_modality = ANY (ARRAY['none'::text, 'manual'::text, 'online'::text, 'in_person'::text, 'mixed'::text]))),
    CONSTRAINT sessions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'live'::text, 'completed'::text, 'processed'::text, 'cancelled'::text]))),
    CONSTRAINT sessions_world_day_range CHECK (((world_day IS NULL) OR ((world_day >= '-100000000'::integer) AND (world_day <= 100000000))))
);

ALTER TABLE public.sessions OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.species (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system text DEFAULT '5e'::text NOT NULL,
    name text NOT NULL,
    source text DEFAULT 'core'::text NOT NULL,
    partnered boolean DEFAULT false NOT NULL,
    partner text,
    edition text DEFAULT 'both'::text NOT NULL,
    sort integer DEFAULT 100 NOT NULL,
    CONSTRAINT species_edition_check CHECK ((edition = ANY (ARRAY['2014'::text, '2024'::text, 'both'::text])))
);

ALTER TABLE public.species OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.species_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    species_id uuid NOT NULL,
    name text NOT NULL,
    variant_kind text DEFAULT 'subrace'::text NOT NULL,
    source text DEFAULT 'core'::text NOT NULL,
    partnered boolean DEFAULT false NOT NULL,
    partner text,
    edition text DEFAULT 'both'::text NOT NULL,
    sort integer DEFAULT 100 NOT NULL,
    CONSTRAINT species_variants_edition_check CHECK ((edition = ANY (ARRAY['2014'::text, '2024'::text, 'both'::text]))),
    CONSTRAINT species_variants_kind_check CHECK ((variant_kind = ANY (ARRAY['subrace'::text, 'lineage'::text])))
);

ALTER TABLE public.species_variants OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.stat_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gm_id uuid NOT NULL,
    campaign_id uuid,
    name text NOT NULL,
    block jsonb,
    cr text,
    xp integer,
    ac integer,
    hp integer,
    size text,
    type text,
    portrait_path text,
    source_edition text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    system text DEFAULT 'dnd5e'::text NOT NULL,
    level integer
);

ALTER TABLE public.stat_blocks OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.storage_purge_queue (
    id bigint NOT NULL,
    bucket text NOT NULL,
    path text NOT NULL,
    reason text NOT NULL,
    not_before timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT storage_purge_queue_reason_check CHECK ((reason = ANY (ARRAY['upload'::text, 'account_deletion'::text])))
);

ALTER TABLE public.storage_purge_queue OWNER TO postgres;

do $guard$ begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.storage_purge_queue'::regclass and attname = 'id' and attidentity <> '') then
    execute 'ALTER TABLE public.storage_purge_queue ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.storage_purge_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
)';
  end if;
end $guard$;

CREATE TABLE IF NOT EXISTS public.threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid DEFAULT auth.uid() NOT NULL,
    campaign_id uuid,
    character_id uuid,
    title text NOT NULL,
    detail text,
    kind text DEFAULT 'thread'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.threads OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.tool_render_log (
    id bigint NOT NULL,
    tool text DEFAULT 'map-render'::text NOT NULL,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.tool_render_log OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.tpdi_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    respondent_id uuid,
    instrument_version text NOT NULL,
    answers jsonb NOT NULL,
    scores jsonb,
    item_order jsonb,
    player_name text,
    campaign_id uuid,
    assigned_character_id uuid,
    safety jsonb,
    scope text DEFAULT 'character'::text NOT NULL,
    CONSTRAINT tpdi_responses_scope_check CHECK ((scope = ANY (ARRAY['player'::text, 'character'::text]))),
    CONSTRAINT tpdi_responses_scope_shape_check CHECK ((((scope = 'player'::text) AND (assigned_character_id IS NULL)) OR (scope = 'character'::text)))
);

ALTER TABLE public.tpdi_responses OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.transcript_segments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    track_id uuid,
    campaign_id uuid NOT NULL,
    character_id uuid,
    start_ms integer,
    end_ms integer,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    speaker smallint,
    gm_identity_id uuid
);

ALTER TABLE public.transcript_segments OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.usage_events (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    campaign_id uuid,
    session_id uuid,
    kind text NOT NULL,
    provider text,
    model text,
    route text,
    input_tokens integer,
    output_tokens integer,
    images integer,
    audio_seconds numeric,
    CONSTRAINT usage_events_kind_check CHECK ((kind = ANY (ARRAY['ai'::text, 'image'::text, 'transcription'::text])))
);

ALTER TABLE public.usage_events OWNER TO postgres;

do $guard$ begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.usage_events'::regclass and attname = 'id' and attidentity <> '') then
    execute 'ALTER TABLE public.usage_events ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.usage_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
)';
  end if;
end $guard$;

CREATE OR REPLACE VIEW public.v_arc_freshness AS
 WITH cur AS (
         SELECT sessions.campaign_id,
            max(sessions.session_number) AS current_session
           FROM public.sessions
          GROUP BY sessions.campaign_id
        ), lt AS (
         SELECT a_1.id AS arc_id,
            s.session_number AS last_touched_num
           FROM (public.arcs a_1
             LEFT JOIN public.sessions s ON ((s.id = a_1.last_touched_session_id)))
        )
 SELECT a.id AS arc_id,
    a.campaign_id,
    a.title,
    a.status,
    a.character_id,
    ch.name AS character_name,
    lt.last_touched_num,
    cur.current_session,
        CASE
            WHEN (lt.last_touched_num IS NULL) THEN cur.current_session
            ELSE (cur.current_session - lt.last_touched_num)
        END AS sessions_since_touched,
    ((a.status = ANY (ARRAY['open'::text, 'progressing'::text])) AND ((lt.last_touched_num IS NULL) OR ((cur.current_session - lt.last_touched_num) >= 3))) AS stale
   FROM (((public.arcs a
     JOIN cur ON ((cur.campaign_id = a.campaign_id)))
     LEFT JOIN lt ON ((lt.arc_id = a.id)))
     LEFT JOIN public.characters ch ON ((ch.id = a.character_id)));

ALTER VIEW public.v_arc_freshness OWNER TO postgres;

CREATE OR REPLACE VIEW public.v_audio_due_for_purge WITH (security_invoker='true') AS
 SELECT id AS track_id,
    campaign_id,
    job_id,
    storage_path,
    created_at,
    (now() - created_at) AS age
   FROM public.audio_tracks t
  WHERE ((purged_at IS NULL) AND (storage_path IS NOT NULL) AND (created_at < (now() - '60 days'::interval)));

ALTER VIEW public.v_audio_due_for_purge OWNER TO postgres;

CREATE OR REPLACE VIEW public.v_campaign_audio_retention WITH (security_invoker='true') AS
 SELECT campaign_id,
    count(*) FILTER (WHERE ((purged_at IS NULL) AND (storage_path IS NOT NULL))) AS audio_present,
    count(*) FILTER (WHERE (purged_at IS NOT NULL)) AS audio_purged,
    min(created_at) FILTER (WHERE (purged_at IS NULL)) AS oldest_retained_at
   FROM public.audio_tracks t
  GROUP BY campaign_id;

ALTER VIEW public.v_campaign_audio_retention OWNER TO postgres;

CREATE OR REPLACE VIEW public.v_character_catalog_audit AS
 SELECT id AS character_id,
    campaign_id,
    name,
    species,
    species_variant,
    class,
    subclass,
    ((species IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.species s
          WHERE (s.name = ch.species))))) AS species_unknown,
    ((class IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.classes c
          WHERE (c.name = ch.class))))) AS class_unknown,
    ((subclass IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.class_capabilities cc
          WHERE (cc.subclass = ch.subclass))))) AS subclass_unknown,
    ((subclass IS NULL) OR (NOT (EXISTS ( SELECT 1
           FROM public.class_capabilities cc
          WHERE (cc.subclass = ch.subclass))))) AS no_capabilities
   FROM public.characters ch
  WHERE (kind = 'pc'::text);

ALTER VIEW public.v_character_catalog_audit OWNER TO postgres;

CREATE OR REPLACE VIEW public.v_loot_fairness AS
 WITH per_char AS (
         SELECT loot_grants.campaign_id,
            loot_grants.character_id,
            sum(COALESCE(loot_grants.est_value, (0)::numeric)) AS total_value,
            count(*) AS items
           FROM public.loot_grants
          WHERE (loot_grants.character_id IS NOT NULL)
          GROUP BY loot_grants.campaign_id, loot_grants.character_id
        ), camp AS (
         SELECT per_char.campaign_id,
            sum(per_char.total_value) AS camp_total,
            count(*) AS n_recipients
           FROM per_char
          GROUP BY per_char.campaign_id
        )
 SELECT p.campaign_id,
    p.character_id,
    ch.name AS character_name,
    p.items,
    p.total_value,
        CASE
            WHEN (c.camp_total > (0)::numeric) THEN round((p.total_value / c.camp_total), 3)
            ELSE NULL::numeric
        END AS share,
        CASE
            WHEN (c.n_recipients > 0) THEN round((1.0 / (c.n_recipients)::numeric), 3)
            ELSE NULL::numeric
        END AS equal_share,
        CASE
            WHEN (c.camp_total > (0)::numeric) THEN round(((p.total_value / c.camp_total) - (1.0 / (c.n_recipients)::numeric)), 3)
            ELSE NULL::numeric
        END AS deviation
   FROM ((per_char p
     JOIN camp c ON ((c.campaign_id = p.campaign_id)))
     LEFT JOIN public.characters ch ON ((ch.id = p.character_id)));

ALTER VIEW public.v_loot_fairness OWNER TO postgres;

CREATE OR REPLACE VIEW public.v_session_axis_engagement AS
 WITH opps AS (
         SELECT e.session_id,
            e.axis,
            count(*) AS opportunities
           FROM (public.events e
             JOIN public.event_types t ON ((t.key = e.event_type)))
          WHERE ((t.category = 'opportunity'::text) AND (e.axis IS NOT NULL))
          GROUP BY e.session_id, e.axis
        ), resp AS (
         SELECT e.campaign_id,
            e.session_id,
            e.character_id,
            e.axis,
            count(*) AS responses
           FROM (public.events e
             JOIN public.event_types t ON ((t.key = e.event_type)))
          WHERE ((t.category = 'response'::text) AND (e.axis IS NOT NULL) AND (e.character_id IS NOT NULL))
          GROUP BY e.campaign_id, e.session_id, e.character_id, e.axis
        )
 SELECT r.campaign_id,
    r.session_id,
    r.character_id,
    r.axis,
    r.responses,
    COALESCE(o.opportunities, (0)::bigint) AS opportunities,
        CASE
            WHEN (COALESCE(o.opportunities, (0)::bigint) > 0) THEN round(((r.responses)::numeric / (o.opportunities)::numeric), 3)
            ELSE NULL::numeric
        END AS per_opportunity_rate
   FROM (resp r
     LEFT JOIN opps o ON (((o.session_id = r.session_id) AND (o.axis = r.axis))));

ALTER VIEW public.v_session_axis_engagement OWNER TO postgres;

CREATE OR REPLACE VIEW public.v_session_spotlight WITH (security_invoker='true') AS
 WITH resp AS (
         SELECT e.campaign_id,
            e.session_id,
            e.character_id,
            sum(
                CASE
                    WHEN (e.event_type = ANY (ARRAY['decision'::text, 'character_choice'::text])) THEN 2.0
                    ELSE 1.0
                END) AS weighted,
            count(*) AS raw_events
           FROM (public.events e
             JOIN public.event_types t ON ((t.key = e.event_type)))
          WHERE ((t.category = 'response'::text) AND (e.character_id IS NOT NULL))
          GROUP BY e.campaign_id, e.session_id, e.character_id
        )
 SELECT r.campaign_id,
    r.session_id,
    r.character_id,
    c.name AS character_name,
    r.raw_events,
    r.weighted,
    round((r.weighted / NULLIF(sum(r.weighted) OVER (PARTITION BY r.session_id), (0)::numeric)), 3) AS share
   FROM (resp r
     LEFT JOIN public.characters c ON ((c.id = r.character_id)));

ALTER VIEW public.v_session_spotlight OWNER TO postgres;

CREATE OR REPLACE VIEW public.v_session_equity WITH (security_invoker='true') AS
 SELECT campaign_id,
    session_id,
    count(*) AS n_active,
    round(sum(weighted), 2) AS total_weighted,
    round(avg(weighted), 2) AS mean_weighted,
    round(stddev_pop(weighted), 2) AS sd_weighted,
        CASE
            WHEN (avg(weighted) > (0)::numeric) THEN round((stddev_pop(weighted) / avg(weighted)), 3)
            ELSE (0)::numeric
        END AS cv
   FROM public.v_session_spotlight
  GROUP BY campaign_id, session_id;

ALTER VIEW public.v_session_equity OWNER TO postgres;

CREATE OR REPLACE VIEW public.v_session_gini AS
 WITH ranked AS (
         SELECT v_session_spotlight.campaign_id,
            v_session_spotlight.session_id,
            v_session_spotlight.weighted,
            row_number() OVER (PARTITION BY v_session_spotlight.session_id ORDER BY v_session_spotlight.weighted) AS i,
            count(*) OVER (PARTITION BY v_session_spotlight.session_id) AS n,
            sum(v_session_spotlight.weighted) OVER (PARTITION BY v_session_spotlight.session_id) AS tot
           FROM public.v_session_spotlight
        )
 SELECT campaign_id,
    session_id,
    max(n) AS n_active,
        CASE
            WHEN ((max(tot) > (0)::numeric) AND (max(n) > 1)) THEN round((((2.0 * sum(((i)::numeric * weighted))) / ((max(n))::numeric * max(tot))) - (((max(n))::numeric + 1.0) / (max(n))::numeric)), 3)
            ELSE (0)::numeric
        END AS gini
   FROM ranked
  GROUP BY campaign_id, session_id;

ALTER VIEW public.v_session_gini OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vibe_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid NOT NULL,
    profile_id uuid,
    satisfaction smallint,
    spotlight_feeling text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    player_name text,
    CONSTRAINT vibe_checks_satisfaction_check CHECK (((satisfaction >= 1) AND (satisfaction <= 5))),
    CONSTRAINT vibe_checks_spotlight_feeling_check CHECK ((spotlight_feeling = ANY (ARRAY['wanted_more'::text, 'about_right'::text, 'wanted_less'::text])))
);

ALTER TABLE public.vibe_checks OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_audio (
    campaign_id uuid NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.vtt_audio OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_decks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'custom'::text NOT NULL,
    back_color text DEFAULT '#7a2e2e'::text NOT NULL,
    players_draw boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    back_path text,
    CONSTRAINT vtt_decks_back_color_check CHECK ((back_color ~ '^#[0-9a-fA-F]{6}$'::text)),
    CONSTRAINT vtt_decks_back_folder CHECK (((back_path IS NULL) OR (back_path ~ (('^'::text || (campaign_id)::text) || '/decks/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'::text)))),
    CONSTRAINT vtt_decks_kind_check CHECK ((kind = ANY (ARRAY['standard'::text, 'custom'::text]))),
    CONSTRAINT vtt_decks_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 60)))
);

ALTER TABLE public.vtt_decks OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_drawings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    scene_id uuid NOT NULL,
    owner uuid DEFAULT auth.uid() NOT NULL,
    layer text DEFAULT 'table'::text NOT NULL,
    kind text NOT NULL,
    points jsonb NOT NULL,
    color text DEFAULT '#e0703a'::text NOT NULL,
    width real DEFAULT 0.08 NOT NULL,
    fill boolean DEFAULT false NOT NULL,
    text text,
    size real DEFAULT 0.6 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vtt_drawings_check CHECK (((kind <> 'text'::text) OR ((text IS NOT NULL) AND (char_length(TRIM(BOTH FROM text)) > 0)))),
    CONSTRAINT vtt_drawings_color_check CHECK ((color ~ '^#[0-9a-fA-F]{6}$'::text)),
    CONSTRAINT vtt_drawings_kind_check CHECK ((kind = ANY (ARRAY['pen'::text, 'line'::text, 'rect'::text, 'ellipse'::text, 'text'::text]))),
    CONSTRAINT vtt_drawings_layer_check CHECK ((layer = ANY (ARRAY['table'::text, 'gm'::text]))),
    CONSTRAINT vtt_drawings_points_check CHECK (((jsonb_typeof(points) = 'array'::text) AND ((jsonb_array_length(points) >= 1) AND (jsonb_array_length(points) <= 4000)))),
    CONSTRAINT vtt_drawings_size_check CHECK (((size >= (0.2)::double precision) AND (size <= (6)::double precision))),
    CONSTRAINT vtt_drawings_text_check CHECK (((text IS NULL) OR (char_length(text) <= 200))),
    CONSTRAINT vtt_drawings_width_check CHECK (((width >= (0.02)::double precision) AND (width <= (1)::double precision)))
);

ALTER TABLE public.vtt_drawings OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_effects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    scene_id uuid NOT NULL,
    token_id uuid NOT NULL,
    owner uuid DEFAULT auth.uid() NOT NULL,
    kind text NOT NULL,
    radius_ft real DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vtt_effects_kind_check CHECK ((kind = ANY (ARRAY['fire'::text, 'cold'::text, 'acid'::text, 'lightning'::text, 'poison'::text, 'darkness'::text, 'fog'::text, 'radiant'::text, 'necrotic'::text]))),
    CONSTRAINT vtt_effects_radius_ft_check CHECK (((radius_ft >= (0)::double precision) AND (radius_ft <= (120)::double precision)))
);

ALTER TABLE public.vtt_effects OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid NOT NULL,
    character_id uuid,
    source text DEFAULT 'beyond20'::text NOT NULL,
    ddb_character_id text,
    actor_name text,
    event_type text NOT NULL,
    name text,
    rolls jsonb,
    state jsonb,
    fidelity text DEFAULT 'unverified'::text NOT NULL,
    rolled_at timestamp with time zone,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_at timestamp with time zone,
    applied_to text,
    external_id text,
    CONSTRAINT vtt_events_external_id_len CHECK (((external_id IS NULL) OR ((char_length(external_id) >= 1) AND (char_length(external_id) <= 100)))),
    CONSTRAINT vtt_events_fidelity_check CHECK ((fidelity = ANY (ARRAY['canonical'::text, 'unverified'::text, 'heard'::text])))
);

ALTER TABLE public.vtt_events OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_handouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    entry_id uuid,
    shown_to uuid[],
    added_reveals uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    shown_by uuid DEFAULT auth.uid(),
    shown_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    image_path text,
    note text,
    CONSTRAINT vtt_handouts_entry_or_picture CHECK (((entry_id IS NOT NULL) OR ((image_path IS NOT NULL) AND ((char_length(TRIM(BOTH FROM COALESCE(title, ''::text))) >= 1) AND (char_length(TRIM(BOTH FROM COALESCE(title, ''::text))) <= 80)) AND (char_length(COALESCE(note, ''::text)) <= 600)))),
    CONSTRAINT vtt_handouts_picture_folder CHECK (((image_path IS NULL) OR (image_path ~ (('^'::text || (campaign_id)::text) || '/handouts/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'::text))))
);

ALTER TABLE public.vtt_handouts OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_ingest_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key_hash text NOT NULL,
    profile_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT vtt_ingest_keys_kind_check CHECK ((kind = ANY (ARRAY['player'::text, 'gm'::text])))
);

ALTER TABLE public.vtt_ingest_keys OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    session_id uuid,
    author_profile uuid NOT NULL,
    as_name text,
    character_id uuid,
    kind text DEFAULT 'say'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    roll jsonb,
    vtt_event_id uuid,
    whisper_to uuid[],
    gm_only boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vtt_messages_body_check CHECK ((char_length(body) <= 2000)),
    CONSTRAINT vtt_messages_kind_check CHECK ((kind = ANY (ARRAY['say'::text, 'emote'::text, 'whisper'::text, 'roll'::text, 'system'::text])))
);

ALTER TABLE public.vtt_messages OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_name_links (
    campaign_id uuid NOT NULL,
    source text NOT NULL,
    name_norm text NOT NULL,
    character_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vtt_name_links_name_len CHECK (((char_length(name_norm) >= 1) AND (char_length(name_norm) <= 200))),
    CONSTRAINT vtt_name_links_source_chk CHECK ((source = ANY (ARRAY['roll20'::text, 'beyond20'::text, 'foundry'::text, 'owlbear'::text])))
);

ALTER TABLE public.vtt_name_links OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_pins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    scene_id uuid NOT NULL,
    x real NOT NULL,
    y real NOT NULL,
    label text NOT NULL,
    color text DEFAULT '#d9a43a'::text NOT NULL,
    entry_id uuid,
    gm_note text DEFAULT ''::text NOT NULL,
    players_see boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vtt_pins_color_check CHECK ((color ~ '^#[0-9a-fA-F]{6}$'::text)),
    CONSTRAINT vtt_pins_gm_note_check CHECK ((char_length(gm_note) <= 2000)),
    CONSTRAINT vtt_pins_label_check CHECK (((char_length(TRIM(BOTH FROM label)) >= 1) AND (char_length(TRIM(BOTH FROM label)) <= 80))),
    CONSTRAINT vtt_pins_x_check CHECK (((x >= ('-1000'::integer)::double precision) AND (x <= (1000)::double precision))),
    CONSTRAINT vtt_pins_y_check CHECK (((y >= ('-1000'::integer)::double precision) AND (y <= (1000)::double precision)))
);

ALTER TABLE public.vtt_pins OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_scene_players (
    campaign_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    scene_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.vtt_scene_players OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_scenes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    battle_map_id uuid NOT NULL,
    level integer DEFAULT 0 NOT NULL,
    name text DEFAULT 'Scene'::text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fog_on boolean DEFAULT false NOT NULL,
    revealed bytea DEFAULT '\x'::bytea NOT NULL,
    door_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT vtt_scenes_level_check CHECK (((level >= 0) AND (level <= 2)))
);

ALTER TABLE public.vtt_scenes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_sounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'music'::text NOT NULL,
    url text NOT NULL,
    duration real,
    bytes integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vtt_sounds_bytes_check CHECK (((bytes IS NULL) OR (bytes >= 0))),
    CONSTRAINT vtt_sounds_duration_check CHECK (((duration IS NULL) OR ((duration > (0)::double precision) AND (duration < (86400)::double precision)))),
    CONSTRAINT vtt_sounds_kind_check CHECK ((kind = ANY (ARRAY['music'::text, 'ambient'::text]))),
    CONSTRAINT vtt_sounds_name_check CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 80))),
    CONSTRAINT vtt_sounds_url_ours CHECK ((url ~ (((('^https://'::text || replace(public.tabletop_storage_host(), '.'::text, '\.'::text)) || '/storage/v1/object/public/campaign-maps/'::text) || (campaign_id)::text) || '/audio/[A-Za-z0-9._-]+$'::text)))
);

ALTER TABLE public.vtt_sounds OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    scene_id uuid NOT NULL,
    owner uuid DEFAULT auth.uid() NOT NULL,
    shape text NOT NULL,
    x real NOT NULL,
    y real NOT NULL,
    size_ft real NOT NULL,
    width_ft real DEFAULT 5 NOT NULL,
    rot real DEFAULT 0 NOT NULL,
    color text DEFAULT '#e0703a'::text NOT NULL,
    label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    effect text,
    CONSTRAINT vtt_templates_color_check CHECK ((color ~ '^#[0-9a-fA-F]{6}$'::text)),
    CONSTRAINT vtt_templates_effect_check CHECK (((effect IS NULL) OR (effect = ANY (ARRAY['fire'::text, 'cold'::text, 'acid'::text, 'lightning'::text, 'poison'::text, 'darkness'::text, 'fog'::text, 'radiant'::text, 'necrotic'::text])))),
    CONSTRAINT vtt_templates_label_check CHECK (((label IS NULL) OR (char_length(label) <= 60))),
    CONSTRAINT vtt_templates_shape_check CHECK ((shape = ANY (ARRAY['circle'::text, 'cone'::text, 'square'::text, 'line'::text]))),
    CONSTRAINT vtt_templates_size_ft_check CHECK (((size_ft > (0)::double precision) AND (size_ft <= (1000)::double precision))),
    CONSTRAINT vtt_templates_width_ft_check CHECK (((width_ft > (0)::double precision) AND (width_ft <= (200)::double precision)))
);

ALTER TABLE public.vtt_templates OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_token_notes (
    token_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vtt_token_notes_body_check CHECK ((char_length(body) <= 4000))
);

ALTER TABLE public.vtt_token_notes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.vtt_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    scene_id uuid NOT NULL,
    kind text DEFAULT 'monster'::text NOT NULL,
    character_id uuid,
    stat_block_id uuid,
    name text DEFAULT 'Token'::text NOT NULL,
    image_url text,
    x real DEFAULT 0.5 NOT NULL,
    y real DEFAULT 0.5 NOT NULL,
    size real DEFAULT 1 NOT NULL,
    rot real DEFAULT 0 NOT NULL,
    layer text DEFAULT 'token'::text NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    controlled_by uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    style jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vtt_tokens_kind_check CHECK ((kind = ANY (ARRAY['pc'::text, 'npc'::text, 'monster'::text, 'object'::text]))),
    CONSTRAINT vtt_tokens_layer_check CHECK ((layer = ANY (ARRAY['map'::text, 'token'::text, 'gm'::text]))),
    CONSTRAINT vtt_tokens_size_check CHECK (((size > (0)::double precision) AND (size <= (12)::double precision)))
);

ALTER TABLE public.vtt_tokens OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.world_hexes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    world_map_id uuid NOT NULL,
    col smallint NOT NULL,
    "row" smallint NOT NULL,
    region_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.world_hexes OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.world_maps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    name text DEFAULT 'World map'::text NOT NULL,
    width smallint DEFAULT 100 NOT NULL,
    height smallint DEFAULT 100 NOT NULL,
    origin_col smallint DEFAULT '-50'::integer NOT NULL,
    origin_row smallint DEFAULT '-50'::integer NOT NULL,
    format_version smallint DEFAULT 1 NOT NULL,
    terrain text,
    editable_by text DEFAULT 'gm'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    image_url text,
    snapshot_url text,
    published boolean DEFAULT false NOT NULL,
    gen_config jsonb,
    gen_seed text,
    ai_image_url text,
    ai_image_at timestamp with time zone,
    style text DEFAULT 'fantasy'::text,
    miles_per_hex integer,
    custom_hexes jsonb,
    CONSTRAINT world_maps_editable_ck CHECK ((editable_by = ANY (ARRAY['gm'::text, 'players'::text]))),
    CONSTRAINT world_maps_size_ck CHECK (((width >= 1) AND (width <= 250) AND ((height >= 1) AND (height <= 250))))
);

ALTER TABLE public.world_maps OWNER TO postgres;

ALTER TABLE ONLY public.rate_hits ALTER COLUMN id SET DEFAULT nextval('public.rate_hits_id_seq'::regclass);

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = '_migrations_pkey' and conrelid = 'public._migrations'::regclass) then
    execute 'ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (name)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_hooks_pkey' and conrelid = 'public.addon_hooks'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_hooks
    ADD CONSTRAINT addon_hooks_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_keys_key_hash_key' and conrelid = 'public.addon_keys'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_keys
    ADD CONSTRAINT addon_keys_key_hash_key UNIQUE (key_hash)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_keys_pkey' and conrelid = 'public.addon_keys'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_keys
    ADD CONSTRAINT addon_keys_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_outbox_pkey' and conrelid = 'public.addon_outbox'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_outbox
    ADD CONSTRAINT addon_outbox_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_map_renders_pkey' and conrelid = 'public.ai_map_renders'::regclass) then
    execute 'ALTER TABLE ONLY public.ai_map_renders
    ADD CONSTRAINT ai_map_renders_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arc_touches_pkey' and conrelid = 'public.arc_touches'::regclass) then
    execute 'ALTER TABLE ONLY public.arc_touches
    ADD CONSTRAINT arc_touches_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arcs_pkey' and conrelid = 'public.arcs'::regclass) then
    execute 'ALTER TABLE ONLY public.arcs
    ADD CONSTRAINT arcs_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_pkey' and conrelid = 'public.attendance'::regclass) then
    execute 'ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_session_id_profile_id_key' and conrelid = 'public.attendance'::regclass) then
    execute 'ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_session_id_profile_id_key UNIQUE (session_id, profile_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'audio_tracks_pkey' and conrelid = 'public.audio_tracks'::regclass) then
    execute 'ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'bastion_maps_campaign_id_key' and conrelid = 'public.bastion_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.bastion_maps
    ADD CONSTRAINT bastion_maps_campaign_id_key UNIQUE (campaign_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'bastion_maps_pkey' and conrelid = 'public.bastion_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.bastion_maps
    ADD CONSTRAINT bastion_maps_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'battle_maps_pkey' and conrelid = 'public.battle_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.battle_maps
    ADD CONSTRAINT battle_maps_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'biomes_key_key' and conrelid = 'public.biomes'::regclass) then
    execute 'ALTER TABLE ONLY public.biomes
    ADD CONSTRAINT biomes_key_key UNIQUE (key)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'biomes_pkey' and conrelid = 'public.biomes'::regclass) then
    execute 'ALTER TABLE ONLY public.biomes
    ADD CONSTRAINT biomes_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'building_maps_campaign_id_key' and conrelid = 'public.building_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.building_maps
    ADD CONSTRAINT building_maps_campaign_id_key UNIQUE (campaign_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'building_maps_pkey' and conrelid = 'public.building_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.building_maps
    ADD CONSTRAINT building_maps_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'calendar_feeds_pkey' and conrelid = 'public.calendar_feeds'::regclass) then
    execute 'ALTER TABLE ONLY public.calendar_feeds
    ADD CONSTRAINT calendar_feeds_pkey PRIMARY KEY (profile_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'calendar_feeds_token_key' and conrelid = 'public.calendar_feeds'::regclass) then
    execute 'ALTER TABLE ONLY public.calendar_feeds
    ADD CONSTRAINT calendar_feeds_token_key UNIQUE (token)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_gm_invites_pkey' and conrelid = 'public.campaign_gm_invites'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_gm_invites
    ADD CONSTRAINT campaign_gm_invites_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_gm_invites_token_key' and conrelid = 'public.campaign_gm_invites'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_gm_invites
    ADD CONSTRAINT campaign_gm_invites_token_key UNIQUE (token)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_journals_pkey' and conrelid = 'public.campaign_journals'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_journals
    ADD CONSTRAINT campaign_journals_pkey PRIMARY KEY (campaign_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_transfers_pkey' and conrelid = 'public.campaign_transfers'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_transfers
    ADD CONSTRAINT campaign_transfers_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_transfers_token_key' and conrelid = 'public.campaign_transfers'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_transfers
    ADD CONSTRAINT campaign_transfers_token_key UNIQUE (token)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_pkey' and conrelid = 'public.campaigns'::regclass) then
    execute 'ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_control_pkey' and conrelid = 'public.capture_control'::regclass) then
    execute 'ALTER TABLE ONLY public.capture_control
    ADD CONSTRAINT capture_control_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_jobs_pkey' and conrelid = 'public.capture_jobs'::regclass) then
    execute 'ALTER TABLE ONLY public.capture_jobs
    ADD CONSTRAINT capture_jobs_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'character_identities_pkey' and conrelid = 'public.character_identities'::regclass) then
    execute 'ALTER TABLE ONLY public.character_identities
    ADD CONSTRAINT character_identities_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'character_wiki_gm_edit_pkey' and conrelid = 'public.character_wiki_gm_edit'::regclass) then
    execute 'ALTER TABLE ONLY public.character_wiki_gm_edit
    ADD CONSTRAINT character_wiki_gm_edit_pkey PRIMARY KEY (character_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'character_wiki_sections_pkey' and conrelid = 'public.character_wiki_sections'::regclass) then
    execute 'ALTER TABLE ONLY public.character_wiki_sections
    ADD CONSTRAINT character_wiki_sections_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'characters_pkey' and conrelid = 'public.characters'::regclass) then
    execute 'ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'chat_grants_pkey' and conrelid = 'public.chat_grants'::regclass) then
    execute 'ALTER TABLE ONLY public.chat_grants
    ADD CONSTRAINT chat_grants_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_pkey' and conrelid = 'public.chat_messages'::regclass) then
    execute 'ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_capabilities_pkey' and conrelid = 'public.class_capabilities'::regclass) then
    execute 'ALTER TABLE ONLY public.class_capabilities
    ADD CONSTRAINT class_capabilities_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'classes_pkey' and conrelid = 'public.classes'::regclass) then
    execute 'ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'classes_system_name_key' and conrelid = 'public.classes'::regclass) then
    execute 'ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_system_name_key UNIQUE (system, name)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'combats_pkey' and conrelid = 'public.combats'::regclass) then
    execute 'ALTER TABLE ONLY public.combats
    ADD CONSTRAINT combats_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'compendium_entries_pkey' and conrelid = 'public.compendium_entries'::regclass) then
    execute 'ALTER TABLE ONLY public.compendium_entries
    ADD CONSTRAINT compendium_entries_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'discord_setup_codes_pkey' and conrelid = 'public.discord_setup_codes'::regclass) then
    execute 'ALTER TABLE ONLY public.discord_setup_codes
    ADD CONSTRAINT discord_setup_codes_pkey PRIMARY KEY (code)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'disposition_reveals_pkey' and conrelid = 'public.disposition_reveals'::regclass) then
    execute 'ALTER TABLE ONLY public.disposition_reveals
    ADD CONSTRAINT disposition_reveals_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'disposition_reveals_profile_key' and conrelid = 'public.disposition_reveals'::regclass) then
    execute 'ALTER TABLE ONLY public.disposition_reveals
    ADD CONSTRAINT disposition_reveals_profile_key UNIQUE (profile_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'disposition_runs_pkey' and conrelid = 'public.disposition_runs'::regclass) then
    execute 'ALTER TABLE ONLY public.disposition_runs
    ADD CONSTRAINT disposition_runs_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dispositions_pkey' and conrelid = 'public.dispositions'::regclass) then
    execute 'ALTER TABLE ONLY public.dispositions
    ADD CONSTRAINT dispositions_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dm_boards_pkey' and conrelid = 'public.dm_boards'::regclass) then
    execute 'ALTER TABLE ONLY public.dm_boards
    ADD CONSTRAINT dm_boards_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dungeon_maps_campaign_id_key' and conrelid = 'public.dungeon_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.dungeon_maps
    ADD CONSTRAINT dungeon_maps_campaign_id_key UNIQUE (campaign_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dungeon_maps_pkey' and conrelid = 'public.dungeon_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.dungeon_maps
    ADD CONSTRAINT dungeon_maps_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_prefs_pkey' and conrelid = 'public.email_prefs'::regclass) then
    execute 'ALTER TABLE ONLY public.email_prefs
    ADD CONSTRAINT email_prefs_pkey PRIMARY KEY (email)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'encounters_pkey' and conrelid = 'public.encounters'::regclass) then
    execute 'ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entity_links_campaign_id_source_type_source_id_target_type__key' and conrelid = 'public.entity_links'::regclass) then
    execute 'ALTER TABLE ONLY public.entity_links
    ADD CONSTRAINT entity_links_campaign_id_source_type_source_id_target_type__key UNIQUE (campaign_id, source_type, source_id, target_type, target_id, relation)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entity_links_pkey' and conrelid = 'public.entity_links'::regclass) then
    execute 'ALTER TABLE ONLY public.entity_links
    ADD CONSTRAINT entity_links_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entries_pkey' and conrelid = 'public.entries'::regclass) then
    execute 'ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entry_reveals_pkey' and conrelid = 'public.entry_reveals'::regclass) then
    execute 'ALTER TABLE ONLY public.entry_reveals
    ADD CONSTRAINT entry_reveals_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entry_reveals_target_type_target_id_revealed_to_character_i_key' and conrelid = 'public.entry_reveals'::regclass) then
    execute 'ALTER TABLE ONLY public.entry_reveals
    ADD CONSTRAINT entry_reveals_target_type_target_id_revealed_to_character_i_key UNIQUE (target_type, target_id, revealed_to_character_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'event_types_pkey' and conrelid = 'public.event_types'::regclass) then
    execute 'ALTER TABLE ONLY public.event_types
    ADD CONSTRAINT event_types_pkey PRIMARY KEY (key)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_pkey' and conrelid = 'public.events'::regclass) then
    execute 'ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_card_decks_pkey' and conrelid = 'public.gm_card_decks'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_card_decks
    ADD CONSTRAINT gm_card_decks_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_event_kinds_pkey' and conrelid = 'public.gm_event_kinds'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_event_kinds
    ADD CONSTRAINT gm_event_kinds_pkey PRIMARY KEY (kind)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_pkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_identities_campaign_id_discord_user_id_key' and conrelid = 'public.gm_identities'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_identities
    ADD CONSTRAINT gm_identities_campaign_id_discord_user_id_key UNIQUE (campaign_id, discord_user_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_identities_pkey' and conrelid = 'public.gm_identities'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_identities
    ADD CONSTRAINT gm_identities_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_pkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_candidates_pkey' and conrelid = 'public.import_candidates'::regclass) then
    execute 'ALTER TABLE ONLY public.import_candidates
    ADD CONSTRAINT import_candidates_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_jobs_pkey' and conrelid = 'public.import_jobs'::regclass) then
    execute 'ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_sessions_pkey' and conrelid = 'public.import_sessions'::regclass) then
    execute 'ALTER TABLE ONLY public.import_sessions
    ADD CONSTRAINT import_sessions_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'loot_grants_pkey' and conrelid = 'public.loot_grants'::regclass) then
    execute 'ALTER TABLE ONLY public.loot_grants
    ADD CONSTRAINT loot_grants_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'lore_backup_pkey' and conrelid = 'public.lore_backup'::regclass) then
    execute 'ALTER TABLE ONLY public.lore_backup
    ADD CONSTRAINT lore_backup_pkey PRIMARY KEY (backup_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_features_pkey' and conrelid = 'public.map_features'::regclass) then
    execute 'ALTER TABLE ONLY public.map_features
    ADD CONSTRAINT map_features_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_fog_pkey' and conrelid = 'public.map_fog'::regclass) then
    execute 'ALTER TABLE ONLY public.map_fog
    ADD CONSTRAINT map_fog_pkey PRIMARY KEY (map_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_icons_pkey' and conrelid = 'public.map_icons'::regclass) then
    execute 'ALTER TABLE ONLY public.map_icons
    ADD CONSTRAINT map_icons_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_images_pkey' and conrelid = 'public.map_images'::regclass) then
    execute 'ALTER TABLE ONLY public.map_images
    ADD CONSTRAINT map_images_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_labels_pkey' and conrelid = 'public.map_labels'::regclass) then
    execute 'ALTER TABLE ONLY public.map_labels
    ADD CONSTRAINT map_labels_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_layers_pkey' and conrelid = 'public.map_layers'::regclass) then
    execute 'ALTER TABLE ONLY public.map_layers
    ADD CONSTRAINT map_layers_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_pins_pkey' and conrelid = 'public.map_pins'::regclass) then
    execute 'ALTER TABLE ONLY public.map_pins
    ADD CONSTRAINT map_pins_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_pois_pkey' and conrelid = 'public.map_pois'::regclass) then
    execute 'ALTER TABLE ONLY public.map_pois
    ADD CONSTRAINT map_pois_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'maps_pkey' and conrelid = 'public.maps'::regclass) then
    execute 'ALTER TABLE ONLY public.maps
    ADD CONSTRAINT maps_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_campaign_id_profile_id_key' and conrelid = 'public.memberships'::regclass) then
    execute 'ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_campaign_id_profile_id_key UNIQUE (campaign_id, profile_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_pkey' and conrelid = 'public.memberships'::regclass) then
    execute 'ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_pkey' and conrelid = 'public.notifications'::regclass) then
    execute 'ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_profile_id_dedupe_key_key' and conrelid = 'public.notifications'::regclass) then
    execute 'ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_profile_id_dedupe_key_key UNIQUE (profile_id, dedupe_key)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'npc_text_fix_backup_pkey' and conrelid = 'public.npc_text_fix_backup'::regclass) then
    execute 'ALTER TABLE ONLY public.npc_text_fix_backup
    ADD CONSTRAINT npc_text_fix_backup_pkey PRIMARY KEY (entry_id, character_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'party_funds_pkey' and conrelid = 'public.party_funds'::regclass) then
    execute 'ALTER TABLE ONLY public.party_funds
    ADD CONSTRAINT party_funds_pkey PRIMARY KEY (campaign_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'party_items_pkey' and conrelid = 'public.party_items'::regclass) then
    execute 'ALTER TABLE ONLY public.party_items
    ADD CONSTRAINT party_items_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'pc_library_pkey' and conrelid = 'public.pc_library'::regclass) then
    execute 'ALTER TABLE ONLY public.pc_library
    ADD CONSTRAINT pc_library_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'player_notes_pkey' and conrelid = 'public.player_notes'::regclass) then
    execute 'ALTER TABLE ONLY public.player_notes
    ADD CONSTRAINT player_notes_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'poll_responses_pkey' and conrelid = 'public.poll_responses'::regclass) then
    execute 'ALTER TABLE ONLY public.poll_responses
    ADD CONSTRAINT poll_responses_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'poll_responses_poll_id_discord_user_id_key' and conrelid = 'public.poll_responses'::regclass) then
    execute 'ALTER TABLE ONLY public.poll_responses
    ADD CONSTRAINT poll_responses_poll_id_discord_user_id_key UNIQUE (poll_id, discord_user_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pkey' and conrelid = 'public.profiles'::regclass) then
    execute 'ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'proposed_events_pkey' and conrelid = 'public.proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.proposed_events
    ADD CONSTRAINT proposed_events_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'rate_hits_pkey' and conrelid = 'public.rate_hits'::regclass) then
    execute 'ALTER TABLE ONLY public.rate_hits
    ADD CONSTRAINT rate_hits_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recap_sends_pkey' and conrelid = 'public.recap_sends'::regclass) then
    execute 'ALTER TABLE ONLY public.recap_sends
    ADD CONSTRAINT recap_sends_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recodings_pkey' and conrelid = 'public.recodings'::regclass) then
    execute 'ALTER TABLE ONLY public.recodings
    ADD CONSTRAINT recodings_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recording_consents_pkey' and conrelid = 'public.recording_consents'::regclass) then
    execute 'ALTER TABLE ONLY public.recording_consents
    ADD CONSTRAINT recording_consents_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recording_consents_session_id_character_id_key' and conrelid = 'public.recording_consents'::regclass) then
    execute 'ALTER TABLE ONLY public.recording_consents
    ADD CONSTRAINT recording_consents_session_id_character_id_key UNIQUE (session_id, character_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'regions_pkey' and conrelid = 'public.regions'::regclass) then
    execute 'ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'roll_tables_pkey' and conrelid = 'public.roll_tables'::regclass) then
    execute 'ALTER TABLE ONLY public.roll_tables
    ADD CONSTRAINT roll_tables_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'scene_snapshots_pkey' and conrelid = 'public.scene_snapshots'::regclass) then
    execute 'ALTER TABLE ONLY public.scene_snapshots
    ADD CONSTRAINT scene_snapshots_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_plan_items_pkey' and conrelid = 'public.session_plan_items'::regclass) then
    execute 'ALTER TABLE ONLY public.session_plan_items
    ADD CONSTRAINT session_plan_items_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_polls_pkey' and conrelid = 'public.session_polls'::regclass) then
    execute 'ALTER TABLE ONLY public.session_polls
    ADD CONSTRAINT session_polls_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_pkey' and conrelid = 'public.sessions'::regclass) then
    execute 'ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'species_pkey' and conrelid = 'public.species'::regclass) then
    execute 'ALTER TABLE ONLY public.species
    ADD CONSTRAINT species_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'species_system_name_key' and conrelid = 'public.species'::regclass) then
    execute 'ALTER TABLE ONLY public.species
    ADD CONSTRAINT species_system_name_key UNIQUE (system, name)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'species_variants_pkey' and conrelid = 'public.species_variants'::regclass) then
    execute 'ALTER TABLE ONLY public.species_variants
    ADD CONSTRAINT species_variants_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'species_variants_species_name_kind_key' and conrelid = 'public.species_variants'::regclass) then
    execute 'ALTER TABLE ONLY public.species_variants
    ADD CONSTRAINT species_variants_species_name_kind_key UNIQUE (species_id, name, variant_kind)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'stat_blocks_pkey' and conrelid = 'public.stat_blocks'::regclass) then
    execute 'ALTER TABLE ONLY public.stat_blocks
    ADD CONSTRAINT stat_blocks_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'storage_purge_queue_pkey' and conrelid = 'public.storage_purge_queue'::regclass) then
    execute 'ALTER TABLE ONLY public.storage_purge_queue
    ADD CONSTRAINT storage_purge_queue_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'threads_pkey' and conrelid = 'public.threads'::regclass) then
    execute 'ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'tool_render_log_pkey' and conrelid = 'public.tool_render_log'::regclass) then
    execute 'ALTER TABLE ONLY public.tool_render_log
    ADD CONSTRAINT tool_render_log_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'tpdi_responses_pkey' and conrelid = 'public.tpdi_responses'::regclass) then
    execute 'ALTER TABLE ONLY public.tpdi_responses
    ADD CONSTRAINT tpdi_responses_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'transcript_segments_pkey' and conrelid = 'public.transcript_segments'::regclass) then
    execute 'ALTER TABLE ONLY public.transcript_segments
    ADD CONSTRAINT transcript_segments_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'usage_events_pkey' and conrelid = 'public.usage_events'::regclass) then
    execute 'ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vibe_checks_pkey' and conrelid = 'public.vibe_checks'::regclass) then
    execute 'ALTER TABLE ONLY public.vibe_checks
    ADD CONSTRAINT vibe_checks_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vibe_checks_session_id_profile_id_key' and conrelid = 'public.vibe_checks'::regclass) then
    execute 'ALTER TABLE ONLY public.vibe_checks
    ADD CONSTRAINT vibe_checks_session_id_profile_id_key UNIQUE (session_id, profile_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_audio_pkey' and conrelid = 'public.vtt_audio'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_audio
    ADD CONSTRAINT vtt_audio_pkey PRIMARY KEY (campaign_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_cards_pkey' and conrelid = 'public.vtt_cards'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_cards
    ADD CONSTRAINT vtt_cards_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_decks_pkey' and conrelid = 'public.vtt_decks'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_decks
    ADD CONSTRAINT vtt_decks_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_drawings_pkey' and conrelid = 'public.vtt_drawings'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_drawings
    ADD CONSTRAINT vtt_drawings_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_effects_pkey' and conrelid = 'public.vtt_effects'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_effects
    ADD CONSTRAINT vtt_effects_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_events_pkey' and conrelid = 'public.vtt_events'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_events
    ADD CONSTRAINT vtt_events_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_handouts_pkey' and conrelid = 'public.vtt_handouts'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_handouts
    ADD CONSTRAINT vtt_handouts_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_ingest_keys_key_hash_key' and conrelid = 'public.vtt_ingest_keys'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_ingest_keys
    ADD CONSTRAINT vtt_ingest_keys_key_hash_key UNIQUE (key_hash)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_ingest_keys_pkey' and conrelid = 'public.vtt_ingest_keys'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_ingest_keys
    ADD CONSTRAINT vtt_ingest_keys_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_messages_pkey' and conrelid = 'public.vtt_messages'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_messages
    ADD CONSTRAINT vtt_messages_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_name_links_pkey' and conrelid = 'public.vtt_name_links'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_name_links
    ADD CONSTRAINT vtt_name_links_pkey PRIMARY KEY (campaign_id, source, name_norm)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_pins_pkey' and conrelid = 'public.vtt_pins'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_pins
    ADD CONSTRAINT vtt_pins_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_scene_players_pkey' and conrelid = 'public.vtt_scene_players'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_scene_players
    ADD CONSTRAINT vtt_scene_players_pkey PRIMARY KEY (campaign_id, profile_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_scenes_pkey' and conrelid = 'public.vtt_scenes'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_scenes
    ADD CONSTRAINT vtt_scenes_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_sounds_pkey' and conrelid = 'public.vtt_sounds'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_sounds
    ADD CONSTRAINT vtt_sounds_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_templates_pkey' and conrelid = 'public.vtt_templates'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_templates
    ADD CONSTRAINT vtt_templates_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_token_notes_pkey' and conrelid = 'public.vtt_token_notes'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_token_notes
    ADD CONSTRAINT vtt_token_notes_pkey PRIMARY KEY (token_id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_tokens_pkey' and conrelid = 'public.vtt_tokens'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_tokens
    ADD CONSTRAINT vtt_tokens_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'world_hexes_cell_uq' and conrelid = 'public.world_hexes'::regclass) then
    execute 'ALTER TABLE ONLY public.world_hexes
    ADD CONSTRAINT world_hexes_cell_uq UNIQUE (world_map_id, col, "row")';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'world_hexes_pkey' and conrelid = 'public.world_hexes'::regclass) then
    execute 'ALTER TABLE ONLY public.world_hexes
    ADD CONSTRAINT world_hexes_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'world_maps_pkey' and conrelid = 'public.world_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.world_maps
    ADD CONSTRAINT world_maps_pkey PRIMARY KEY (id)';
  end if;
end $guard$;

CREATE INDEX IF NOT EXISTS addon_hooks_campaign_idx ON public.addon_hooks USING btree (campaign_id) WHERE enabled;

CREATE INDEX IF NOT EXISTS addon_keys_campaign_idx ON public.addon_keys USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS addon_outbox_campaign_idx ON public.addon_outbox USING btree (campaign_id) WHERE ((delivered_at IS NULL) AND (dropped_at IS NULL));

CREATE INDEX IF NOT EXISTS addon_outbox_due_idx ON public.addon_outbox USING btree (next_at) WHERE ((delivered_at IS NULL) AND (dropped_at IS NULL));

CREATE INDEX IF NOT EXISTS ai_map_renders_profile_kind_time_idx ON public.ai_map_renders USING btree (profile_id, kind, created_at);

CREATE INDEX IF NOT EXISTS ai_map_renders_profile_time_idx ON public.ai_map_renders USING btree (profile_id, created_at);

CREATE INDEX IF NOT EXISTS arcs_campaign_id_idx ON public.arcs USING btree (campaign_id);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_session_character_key ON public.attendance USING btree (session_id, character_id);

CREATE INDEX IF NOT EXISTS attendance_session_id_idx ON public.attendance USING btree (session_id);

CREATE INDEX IF NOT EXISTS audio_tracks_gm_identity_idx ON public.audio_tracks USING btree (gm_identity_id) WHERE (gm_identity_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS audio_tracks_job_idx ON public.audio_tracks USING btree (job_id);

CREATE INDEX IF NOT EXISTS audio_tracks_retention_idx ON public.audio_tracks USING btree (created_at) WHERE (purged_at IS NULL);

CREATE INDEX IF NOT EXISTS battle_maps_campaign_idx ON public.battle_maps USING btree (campaign_id, created_at);

CREATE INDEX IF NOT EXISTS campaign_gm_invites_campaign_idx ON public.campaign_gm_invites USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS campaign_transfers_campaign_idx ON public.campaign_transfers USING btree (campaign_id) WHERE ((accepted_at IS NULL) AND (cancelled_at IS NULL));

CREATE INDEX IF NOT EXISTS campaigns_deleted_at_idx ON public.campaigns USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_public_slug_key ON public.campaigns USING btree (public_slug) WHERE (public_slug IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_share_code_key ON public.campaigns USING btree (share_code);

CREATE INDEX IF NOT EXISTS capture_control_campaign_idx ON public.capture_control USING btree (campaign_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS capture_control_one_open_per_guild ON public.capture_control USING btree (guild_id) WHERE (status = ANY (ARRAY['requested'::text, 'active'::text, 'stopping'::text]));

CREATE INDEX IF NOT EXISTS capture_control_open_heartbeat_idx ON public.capture_control USING btree (heartbeat_at) WHERE (status = ANY (ARRAY['requested'::text, 'active'::text, 'stopping'::text]));

CREATE INDEX IF NOT EXISTS capture_control_status_idx ON public.capture_control USING btree (status);

CREATE INDEX IF NOT EXISTS capture_jobs_session_idx ON public.capture_jobs USING btree (session_id);

CREATE UNIQUE INDEX IF NOT EXISTS character_identities_owner_build_uidx ON public.character_identities USING btree (profile_id, source_library_id) WHERE (source_library_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS character_identities_profile_idx ON public.character_identities USING btree (profile_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS character_wiki_sections_char_idx ON public.character_wiki_sections USING btree (character_id, "position");

CREATE INDEX IF NOT EXISTS characters_alter_ego_of_idx ON public.characters USING btree (alter_ego_of) WHERE (alter_ego_of IS NOT NULL);

CREATE INDEX IF NOT EXISTS characters_campaign_discord_idx ON public.characters USING btree (campaign_id, discord_user_id);

CREATE INDEX IF NOT EXISTS characters_campaign_id_idx ON public.characters USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS characters_ddb_idx ON public.characters USING btree (campaign_id, ddb_character_id);

CREATE INDEX IF NOT EXISTS characters_fts_idx ON public.characters USING gin (to_tsvector('simple'::regconfig, ((((COALESCE(name, ''::text) || ' '::text) || COALESCE(summary, ''::text)) || ' '::text) || COALESCE(description, ''::text))));

CREATE INDEX IF NOT EXISTS characters_identity_idx ON public.characters USING btree (identity_id) WHERE (identity_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS characters_invite_code_key ON public.characters USING btree (invite_code);

CREATE INDEX IF NOT EXISTS characters_public_idx ON public.characters USING btree (campaign_id) WHERE is_public;

CREATE INDEX IF NOT EXISTS characters_system_idx ON public.characters USING btree (system);

CREATE INDEX IF NOT EXISTS chat_grants_lookup_idx ON public.chat_grants USING btree (campaign_id, player_profile);

CREATE INDEX IF NOT EXISTS chat_messages_campaign_idx ON public.chat_messages USING btree (campaign_id, created_at);

CREATE INDEX IF NOT EXISTS combats_campaign_status_idx ON public.combats USING btree (campaign_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS compendium_entries_one_account_override ON public.compendium_entries USING btree (gm_id, system, overrides_id) WHERE ((overrides_id IS NOT NULL) AND (campaign_id IS NULL));

CREATE INDEX IF NOT EXISTS compendium_entries_owner_idx ON public.compendium_entries USING btree (gm_id, system);

CREATE INDEX IF NOT EXISTS discord_setup_codes_campaign_idx ON public.discord_setup_codes USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS disposition_runs_campaign_idx ON public.disposition_runs USING btree (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dispositions_profile_id_source_idx ON public.dispositions USING btree (profile_id, source);

CREATE INDEX IF NOT EXISTS dispositions_scope_idx ON public.dispositions USING btree (profile_id, scope, source, as_of DESC);

CREATE INDEX IF NOT EXISTS dm_boards_owner_idx ON public.dm_boards USING btree (gm_id);

CREATE INDEX IF NOT EXISTS encounters_campaign_idx ON public.encounters USING btree (campaign_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS entity_links_src_idx ON public.entity_links USING btree (campaign_id, source_type, source_id);

CREATE INDEX IF NOT EXISTS entity_links_tgt_idx ON public.entity_links USING btree (campaign_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS entries_campaign_idx ON public.entries USING btree (campaign_id, type);

CREATE UNIQUE INDEX IF NOT EXISTS entries_campaign_slug_uniq ON public.entries USING btree (campaign_id, slug) WHERE (slug IS NOT NULL);

CREATE INDEX IF NOT EXISTS entries_fts_idx ON public.entries USING gin (to_tsvector('simple'::regconfig, ((((COALESCE(title, ''::text) || ' '::text) || COALESCE(summary, ''::text)) || ' '::text) || COALESCE(body, ''::text))));

CREATE INDEX IF NOT EXISTS entries_public_idx ON public.entries USING btree (campaign_id) WHERE is_public;

CREATE INDEX IF NOT EXISTS entries_tags_idx ON public.entries USING gin (tags);

CREATE INDEX IF NOT EXISTS entry_reveals_campaign_idx ON public.entry_reveals USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS entry_reveals_target_idx ON public.entry_reveals USING btree (target_type, target_id);

CREATE INDEX IF NOT EXISTS events_actor_profile_id_idx ON public.events USING btree (actor_profile_id);

CREATE INDEX IF NOT EXISTS events_campaign_id_session_id_idx ON public.events USING btree (campaign_id, session_id);

CREATE INDEX IF NOT EXISTS events_session_id_axis_idx ON public.events USING btree (session_id, axis);

CREATE INDEX IF NOT EXISTS gm_card_decks_owner_idx ON public.gm_card_decks USING btree (owner, created_at DESC);

CREATE INDEX IF NOT EXISTS gm_events_faction_idx ON public.gm_events USING btree (faction_id);

CREATE INDEX IF NOT EXISTS gm_events_fts_idx ON public.gm_events USING gin (to_tsvector('simple'::regconfig, ((((((((((COALESCE(summary, ''::text) || ' '::text) || COALESCE(detail, ''::text)) || ' '::text) || COALESCE(quote, ''::text)) || ' '::text) || COALESCE(npc_name, ''::text)) || ' '::text) || COALESCE(location_name, ''::text)) || ' '::text) || COALESCE(faction_name, ''::text))));

CREATE INDEX IF NOT EXISTS gm_events_location_idx ON public.gm_events USING btree (location_id);

CREATE INDEX IF NOT EXISTS gm_events_npc_idx ON public.gm_events USING btree (campaign_id, npc_id);

CREATE INDEX IF NOT EXISTS gm_events_session_idx ON public.gm_events USING btree (session_id, kind);

CREATE INDEX IF NOT EXISTS gm_events_thread_idx ON public.gm_events USING btree (campaign_id, thread_status) WHERE (thread_status = 'open'::text);

CREATE INDEX IF NOT EXISTS gm_proposed_session_idx ON public.gm_proposed_events USING btree (session_id, status);

CREATE INDEX IF NOT EXISTS import_candidates_job_idx ON public.import_candidates USING btree (job_id, kind, decision);

CREATE INDEX IF NOT EXISTS import_jobs_campaign_idx ON public.import_jobs USING btree (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS import_sessions_job_idx ON public.import_sessions USING btree (job_id, idx);

CREATE INDEX IF NOT EXISTS loot_grants_campaign_id_character_id_idx ON public.loot_grants USING btree (campaign_id, character_id);

CREATE INDEX IF NOT EXISTS map_features_world_map_id_idx ON public.map_features USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS map_fog_campaign_idx ON public.map_fog USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS map_icons_campaign_idx ON public.map_icons USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS map_images_world_map_id_idx ON public.map_images USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS map_labels_world_map_id_idx ON public.map_labels USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS map_layers_world_map_id_idx ON public.map_layers USING btree (world_map_id, ord);

CREATE INDEX IF NOT EXISTS map_pins_map_idx ON public.map_pins USING btree (map_id);

CREATE INDEX IF NOT EXISTS map_pois_world_map_id_idx ON public.map_pois USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS maps_campaign_idx ON public.maps USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS maps_linked_entry_idx ON public.maps USING btree (linked_entry_id);

CREATE INDEX IF NOT EXISTS memberships_profile_id_idx ON public.memberships USING btree (profile_id);

CREATE INDEX IF NOT EXISTS notifications_digest_idx ON public.notifications USING btree (created_at) WHERE ((read_at IS NULL) AND (emailed_at IS NULL));

CREATE INDEX IF NOT EXISTS notifications_profile_idx ON public.notifications USING btree (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS party_items_campaign_idx ON public.party_items USING btree (campaign_id, name);

CREATE INDEX IF NOT EXISTS pc_library_alter_ego_of_idx ON public.pc_library USING btree (alter_ego_of) WHERE (alter_ego_of IS NOT NULL);

CREATE INDEX IF NOT EXISTS pc_library_profile_idx ON public.pc_library USING btree (profile_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS pc_library_system_idx ON public.pc_library USING btree (system);

CREATE UNIQUE INDEX IF NOT EXISTS player_notes_one_per_entry ON public.player_notes USING btree (profile_id, entry_id) WHERE (entry_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS player_notes_owner_campaign_idx ON public.player_notes USING btree (profile_id, campaign_id);

CREATE INDEX IF NOT EXISTS poll_responses_poll_idx ON public.poll_responses USING btree (poll_id);

CREATE INDEX IF NOT EXISTS proposed_events_job_idx ON public.proposed_events USING btree (job_id, status);

CREATE INDEX IF NOT EXISTS rate_hits_bucket_key_at_idx ON public.rate_hits USING btree (bucket, key, at);

CREATE INDEX IF NOT EXISTS recap_sends_sender_idx ON public.recap_sends USING btree (sent_by, created_at DESC);

CREATE INDEX IF NOT EXISTS recodings_job_idx ON public.recodings USING btree (job_id);

CREATE UNIQUE INDEX IF NOT EXISTS recording_consents_blanket_uniq ON public.recording_consents USING btree (character_id, campaign_id) WHERE (session_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS recording_consents_blanket_unq ON public.recording_consents USING btree (campaign_id, character_id) WHERE (session_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS recording_consents_session_uniq ON public.recording_consents USING btree (character_id, session_id) WHERE (session_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS regions_layer_id_idx ON public.regions USING btree (layer_id);

CREATE INDEX IF NOT EXISTS regions_parent_idx ON public.regions USING btree (parent_region_id);

CREATE INDEX IF NOT EXISTS regions_world_map_id_idx ON public.regions USING btree (world_map_id);

CREATE INDEX IF NOT EXISTS roll_tables_campaign_idx ON public.roll_tables USING btree (campaign_id, name);

CREATE INDEX IF NOT EXISTS scene_snapshots_scene_idx ON public.scene_snapshots USING btree (scene_id, taken_at DESC);

CREATE INDEX IF NOT EXISTS session_plan_items_campaign_idx ON public.session_plan_items USING btree (campaign_id, "position");

CREATE INDEX IF NOT EXISTS session_polls_campaign_idx ON public.session_polls USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS sessions_campaign_id_idx ON public.sessions USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS sessions_fts_idx ON public.sessions USING gin (to_tsvector('simple'::regconfig, ((COALESCE(recap, ''::text) || ' '::text) || COALESCE(notes, ''::text))));

CREATE INDEX IF NOT EXISTS species_partner_idx ON public.species USING btree (partnered, partner);

CREATE INDEX IF NOT EXISTS species_variants_partner_idx ON public.species_variants USING btree (partnered, partner);

CREATE INDEX IF NOT EXISTS species_variants_species_idx ON public.species_variants USING btree (species_id);

CREATE INDEX IF NOT EXISTS stat_blocks_campaign_idx ON public.stat_blocks USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS stat_blocks_gm_idx ON public.stat_blocks USING btree (gm_id);

CREATE INDEX IF NOT EXISTS stat_blocks_system_idx ON public.stat_blocks USING btree (system);

CREATE INDEX IF NOT EXISTS storage_purge_queue_due_idx ON public.storage_purge_queue USING btree (not_before);

CREATE INDEX IF NOT EXISTS storage_purge_queue_path_idx ON public.storage_purge_queue USING btree (bucket, path);

CREATE INDEX IF NOT EXISTS threads_campaign_idx ON public.threads USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS threads_profile_idx ON public.threads USING btree (profile_id);

CREATE INDEX IF NOT EXISTS tool_render_log_created_idx ON public.tool_render_log USING btree (created_at);

CREATE INDEX IF NOT EXISTS tool_render_log_ip_created_idx ON public.tool_render_log USING btree (ip, created_at);

CREATE INDEX IF NOT EXISTS tpdi_responses_scope_idx ON public.tpdi_responses USING btree (respondent_id, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS transcript_segments_fts_idx ON public.transcript_segments USING gin (to_tsvector('simple'::regconfig, COALESCE(text, ''::text)));

CREATE INDEX IF NOT EXISTS transcript_segments_gm_identity_idx ON public.transcript_segments USING btree (gm_identity_id) WHERE (gm_identity_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS transcript_segments_job_idx ON public.transcript_segments USING btree (job_id, start_ms);

CREATE INDEX IF NOT EXISTS transcript_segments_track_speaker_idx ON public.transcript_segments USING btree (track_id, speaker) WHERE (speaker IS NOT NULL);

CREATE INDEX IF NOT EXISTS usage_events_campaign_idx ON public.usage_events USING btree (campaign_id, created_at);

CREATE INDEX IF NOT EXISTS usage_events_created_idx ON public.usage_events USING btree (created_at);

CREATE INDEX IF NOT EXISTS vibe_checks_campaign_id_session_id_idx ON public.vibe_checks USING btree (campaign_id, session_id);

CREATE INDEX IF NOT EXISTS vtt_cards_campaign_idx ON public.vtt_cards USING btree (campaign_id, pile, holder);

CREATE INDEX IF NOT EXISTS vtt_cards_deck_idx ON public.vtt_cards USING btree (deck_id, pile, ord);

CREATE INDEX IF NOT EXISTS vtt_decks_campaign_idx ON public.vtt_decks USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS vtt_drawings_scene_idx ON public.vtt_drawings USING btree (scene_id);

CREATE INDEX IF NOT EXISTS vtt_effects_scene_idx ON public.vtt_effects USING btree (scene_id);

CREATE INDEX IF NOT EXISTS vtt_events_campaign_idx ON public.vtt_events USING btree (campaign_id, received_at);

CREATE UNIQUE INDEX IF NOT EXISTS vtt_events_external_uniq ON public.vtt_events USING btree (campaign_id, source, external_id);

CREATE INDEX IF NOT EXISTS vtt_events_session_idx ON public.vtt_events USING btree (session_id, rolled_at);

CREATE INDEX IF NOT EXISTS vtt_handouts_campaign_idx ON public.vtt_handouts USING btree (campaign_id, shown_at DESC);

CREATE INDEX IF NOT EXISTS vtt_ingest_keys_owner_idx ON public.vtt_ingest_keys USING btree (profile_id, campaign_id) WHERE (revoked_at IS NULL);

CREATE INDEX IF NOT EXISTS vtt_messages_author_idx ON public.vtt_messages USING btree (author_profile);

CREATE INDEX IF NOT EXISTS vtt_messages_campaign_idx ON public.vtt_messages USING btree (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vtt_pins_scene_idx ON public.vtt_pins USING btree (scene_id);

CREATE INDEX IF NOT EXISTS vtt_scenes_campaign_idx ON public.vtt_scenes USING btree (campaign_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS vtt_scenes_one_active ON public.vtt_scenes USING btree (campaign_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS vtt_sounds_campaign_idx ON public.vtt_sounds USING btree (campaign_id, kind, name);

CREATE INDEX IF NOT EXISTS vtt_templates_scene_idx ON public.vtt_templates USING btree (scene_id);

CREATE INDEX IF NOT EXISTS vtt_token_notes_campaign_idx ON public.vtt_token_notes USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS vtt_tokens_campaign_idx ON public.vtt_tokens USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS vtt_tokens_scene_idx ON public.vtt_tokens USING btree (scene_id);

CREATE INDEX IF NOT EXISTS world_hexes_region_idx ON public.world_hexes USING btree (region_id);

CREATE UNIQUE INDEX IF NOT EXISTS world_maps_one_per_campaign ON public.world_maps USING btree (campaign_id);

CREATE OR REPLACE TRIGGER addon_hooks_follow_gms AFTER DELETE OR UPDATE OF role, active ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.addon_hooks_follow_gms();

CREATE OR REPLACE TRIGGER addon_hooks_follow_owner AFTER UPDATE OF gm_id ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.addon_hooks_follow_owner();

CREATE OR REPLACE TRIGGER addon_on_combat AFTER INSERT OR UPDATE ON public.combats FOR EACH ROW EXECUTE FUNCTION public.addon_on_combat();

CREATE OR REPLACE TRIGGER addon_on_message AFTER INSERT ON public.vtt_messages FOR EACH ROW EXECUTE FUNCTION public.addon_on_message();

CREATE OR REPLACE TRIGGER arc_touch_bumps_arc AFTER INSERT ON public.arc_touches FOR EACH ROW EXECUTE FUNCTION public.bump_arc_on_touch();

CREATE OR REPLACE TRIGGER arcs_updated BEFORE UPDATE ON public.arcs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER audio_tracks_usage AFTER UPDATE OF status ON public.audio_tracks FOR EACH ROW EXECUTE FUNCTION public.audio_tracks_usage();

CREATE OR REPLACE TRIGGER campaigns_owner_guard BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.campaigns_owner_guard();

CREATE OR REPLACE TRIGGER campaigns_updated BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER capture_jobs_updated BEFORE UPDATE ON public.capture_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER character_identities_set_updated_at BEFORE UPDATE ON public.character_identities FOR EACH ROW EXECUTE FUNCTION public.character_identities_touch_updated_at();

CREATE OR REPLACE TRIGGER character_wiki_fill_t BEFORE INSERT OR UPDATE ON public.character_wiki_sections FOR EACH ROW EXECUTE FUNCTION public.character_wiki_fill();

CREATE OR REPLACE TRIGGER character_wiki_grant_fill_t BEFORE INSERT ON public.character_wiki_gm_edit FOR EACH ROW EXECUTE FUNCTION public.character_wiki_grant_fill();

CREATE OR REPLACE TRIGGER characters_alter_ego_flat BEFORE INSERT OR UPDATE OF alter_ego_of ON public.characters FOR EACH ROW EXECUTE FUNCTION public.alter_ego_is_flat();

CREATE OR REPLACE TRIGGER characters_updated BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER combat_turn_econ BEFORE UPDATE OF turn, round ON public.combats FOR EACH ROW EXECUTE FUNCTION public.combat_turn_econ();

CREATE OR REPLACE TRIGGER combats_calibration BEFORE INSERT OR UPDATE ON public.combats FOR EACH ROW EXECUTE FUNCTION public.combat_calibration();

CREATE OR REPLACE TRIGGER combats_version BEFORE UPDATE ON public.combats FOR EACH ROW EXECUTE FUNCTION public.combat_bump_version();

CREATE OR REPLACE TRIGGER compendium_entries_touch BEFORE UPDATE ON public.compendium_entries FOR EACH ROW EXECUTE FUNCTION public.touch_compendium_entries();

CREATE OR REPLACE TRIGGER disposition_runs_touch BEFORE UPDATE ON public.disposition_runs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE TRIGGER dm_boards_touch BEFORE UPDATE ON public.dm_boards FOR EACH ROW EXECUTE FUNCTION public.touch_dm_boards();

CREATE OR REPLACE TRIGGER entries_slug BEFORE INSERT ON public.entries FOR EACH ROW EXECUTE FUNCTION public.entries_set_slug();

CREATE OR REPLACE TRIGGER entries_updated BEFORE UPDATE ON public.entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER memberships_gm_guard BEFORE INSERT OR DELETE OR UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.memberships_gm_guard();

CREATE OR REPLACE TRIGGER notify_on_cogm AFTER INSERT OR DELETE OR UPDATE OF role, active ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.notify_on_cogm();

CREATE OR REPLACE TRIGGER notify_on_job AFTER UPDATE OF status ON public.capture_jobs FOR EACH ROW EXECUTE FUNCTION public.notify_on_job();

CREATE OR REPLACE TRIGGER notify_on_join AFTER INSERT OR UPDATE OF profile_id ON public.characters FOR EACH ROW EXECUTE FUNCTION public.notify_on_join();

CREATE OR REPLACE TRIGGER notify_on_recap_send AFTER INSERT ON public.recap_sends FOR EACH ROW EXECUTE FUNCTION public.notify_on_recap_send();

CREATE OR REPLACE TRIGGER notify_on_rsvp AFTER INSERT OR UPDATE OF status ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.notify_on_rsvp();

CREATE OR REPLACE TRIGGER notify_on_session AFTER INSERT OR UPDATE OF scheduled_at, status ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.notify_on_session();

CREATE OR REPLACE TRIGGER pc_library_alter_ego_flat BEFORE INSERT OR UPDATE OF alter_ego_of ON public.pc_library FOR EACH ROW EXECUTE FUNCTION public.library_alter_ego_is_flat();

CREATE OR REPLACE TRIGGER pc_library_set_updated_at BEFORE UPDATE ON public.pc_library FOR EACH ROW EXECUTE FUNCTION public.pc_library_touch_updated_at();

CREATE OR REPLACE TRIGGER player_notes_same_campaign BEFORE INSERT OR UPDATE ON public.player_notes FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

CREATE OR REPLACE TRIGGER player_notes_touch BEFORE UPDATE ON public.player_notes FOR EACH ROW EXECUTE FUNCTION public.touch_player_notes();

CREATE OR REPLACE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER sessions_updated BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER stat_blocks_touch BEFORE UPDATE ON public.stat_blocks FOR EACH ROW EXECUTE FUNCTION public.touch_stat_blocks_updated_at();

CREATE OR REPLACE TRIGGER threads_guard_character_trg BEFORE INSERT OR UPDATE ON public.threads FOR EACH ROW EXECUTE FUNCTION public.threads_guard_character();

CREATE OR REPLACE TRIGGER tpdi_autobind_trg BEFORE INSERT ON public.tpdi_responses FOR EACH ROW EXECUTE FUNCTION public.tpdi_autobind();

CREATE OR REPLACE TRIGGER usage_events_fill_campaign BEFORE INSERT ON public.usage_events FOR EACH ROW EXECUTE FUNCTION public.usage_events_fill_campaign();

CREATE OR REPLACE TRIGGER vtt_drawings_same_campaign BEFORE INSERT OR UPDATE ON public.vtt_drawings FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

CREATE OR REPLACE TRIGGER vtt_effects_same_campaign BEFORE INSERT OR UPDATE ON public.vtt_effects FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

CREATE OR REPLACE TRIGGER vtt_events_feed_signal AFTER INSERT ON public.vtt_events REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.tabletop_feed_signal();

CREATE OR REPLACE TRIGGER vtt_handouts_same_campaign BEFORE INSERT OR UPDATE ON public.vtt_handouts FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

CREATE OR REPLACE TRIGGER vtt_pins_same_campaign BEFORE INSERT OR UPDATE ON public.vtt_pins FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

CREATE OR REPLACE TRIGGER vtt_scene_players_same_campaign BEFORE INSERT OR UPDATE ON public.vtt_scene_players FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

CREATE OR REPLACE TRIGGER vtt_scenes_same_campaign BEFORE INSERT OR UPDATE ON public.vtt_scenes FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

CREATE OR REPLACE TRIGGER vtt_templates_same_campaign BEFORE INSERT OR UPDATE ON public.vtt_templates FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

CREATE OR REPLACE TRIGGER vtt_token_notes_same_campaign BEFORE INSERT OR UPDATE ON public.vtt_token_notes FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

CREATE OR REPLACE TRIGGER vtt_tokens_same_campaign BEFORE INSERT OR UPDATE ON public.vtt_tokens FOR EACH ROW EXECUTE FUNCTION public.vtt_same_campaign();

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_hooks_campaign_id_fkey' and conrelid = 'public.addon_hooks'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_hooks
    ADD CONSTRAINT addon_hooks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_hooks_created_by_fkey' and conrelid = 'public.addon_hooks'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_hooks
    ADD CONSTRAINT addon_hooks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_keys_campaign_id_fkey' and conrelid = 'public.addon_keys'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_keys
    ADD CONSTRAINT addon_keys_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_keys_created_by_fkey' and conrelid = 'public.addon_keys'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_keys
    ADD CONSTRAINT addon_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_outbox_campaign_id_fkey' and conrelid = 'public.addon_outbox'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_outbox
    ADD CONSTRAINT addon_outbox_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'addon_outbox_hook_id_fkey' and conrelid = 'public.addon_outbox'::regclass) then
    execute 'ALTER TABLE ONLY public.addon_outbox
    ADD CONSTRAINT addon_outbox_hook_id_fkey FOREIGN KEY (hook_id) REFERENCES public.addon_hooks(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_map_renders_campaign_id_fkey' and conrelid = 'public.ai_map_renders'::regclass) then
    execute 'ALTER TABLE ONLY public.ai_map_renders
    ADD CONSTRAINT ai_map_renders_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arc_touches_arc_id_fkey' and conrelid = 'public.arc_touches'::regclass) then
    execute 'ALTER TABLE ONLY public.arc_touches
    ADD CONSTRAINT arc_touches_arc_id_fkey FOREIGN KEY (arc_id) REFERENCES public.arcs(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arc_touches_campaign_id_fkey' and conrelid = 'public.arc_touches'::regclass) then
    execute 'ALTER TABLE ONLY public.arc_touches
    ADD CONSTRAINT arc_touches_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arc_touches_event_id_fkey' and conrelid = 'public.arc_touches'::regclass) then
    execute 'ALTER TABLE ONLY public.arc_touches
    ADD CONSTRAINT arc_touches_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arc_touches_session_id_fkey' and conrelid = 'public.arc_touches'::regclass) then
    execute 'ALTER TABLE ONLY public.arc_touches
    ADD CONSTRAINT arc_touches_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arcs_campaign_id_fkey' and conrelid = 'public.arcs'::regclass) then
    execute 'ALTER TABLE ONLY public.arcs
    ADD CONSTRAINT arcs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arcs_character_id_fkey' and conrelid = 'public.arcs'::regclass) then
    execute 'ALTER TABLE ONLY public.arcs
    ADD CONSTRAINT arcs_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arcs_last_touched_session_id_fkey' and conrelid = 'public.arcs'::regclass) then
    execute 'ALTER TABLE ONLY public.arcs
    ADD CONSTRAINT arcs_last_touched_session_id_fkey FOREIGN KEY (last_touched_session_id) REFERENCES public.sessions(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arcs_opened_session_id_fkey' and conrelid = 'public.arcs'::regclass) then
    execute 'ALTER TABLE ONLY public.arcs
    ADD CONSTRAINT arcs_opened_session_id_fkey FOREIGN KEY (opened_session_id) REFERENCES public.sessions(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'arcs_profile_id_fkey' and conrelid = 'public.arcs'::regclass) then
    execute 'ALTER TABLE ONLY public.arcs
    ADD CONSTRAINT arcs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_campaign_id_fkey' and conrelid = 'public.attendance'::regclass) then
    execute 'ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_character_id_fkey' and conrelid = 'public.attendance'::regclass) then
    execute 'ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_profile_id_fkey' and conrelid = 'public.attendance'::regclass) then
    execute 'ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_session_id_fkey' and conrelid = 'public.attendance'::regclass) then
    execute 'ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'audio_tracks_campaign_id_fkey' and conrelid = 'public.audio_tracks'::regclass) then
    execute 'ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'audio_tracks_character_id_fkey' and conrelid = 'public.audio_tracks'::regclass) then
    execute 'ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'audio_tracks_gm_identity_id_fkey' and conrelid = 'public.audio_tracks'::regclass) then
    execute 'ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_gm_identity_id_fkey FOREIGN KEY (gm_identity_id) REFERENCES public.gm_identities(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'audio_tracks_job_id_fkey' and conrelid = 'public.audio_tracks'::regclass) then
    execute 'ALTER TABLE ONLY public.audio_tracks
    ADD CONSTRAINT audio_tracks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.capture_jobs(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'bastion_maps_campaign_id_fkey' and conrelid = 'public.bastion_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.bastion_maps
    ADD CONSTRAINT bastion_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'battle_maps_campaign_id_fkey' and conrelid = 'public.battle_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.battle_maps
    ADD CONSTRAINT battle_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'building_maps_campaign_id_fkey' and conrelid = 'public.building_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.building_maps
    ADD CONSTRAINT building_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'calendar_feeds_profile_id_fkey' and conrelid = 'public.calendar_feeds'::regclass) then
    execute 'ALTER TABLE ONLY public.calendar_feeds
    ADD CONSTRAINT calendar_feeds_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_gm_invites_accepted_by_fkey' and conrelid = 'public.campaign_gm_invites'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_gm_invites
    ADD CONSTRAINT campaign_gm_invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_gm_invites_campaign_id_fkey' and conrelid = 'public.campaign_gm_invites'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_gm_invites
    ADD CONSTRAINT campaign_gm_invites_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_gm_invites_created_by_fkey' and conrelid = 'public.campaign_gm_invites'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_gm_invites
    ADD CONSTRAINT campaign_gm_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_journals_campaign_id_fkey' and conrelid = 'public.campaign_journals'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_journals
    ADD CONSTRAINT campaign_journals_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_transfers_accepted_by_fkey' and conrelid = 'public.campaign_transfers'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_transfers
    ADD CONSTRAINT campaign_transfers_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_transfers_campaign_id_fkey' and conrelid = 'public.campaign_transfers'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_transfers
    ADD CONSTRAINT campaign_transfers_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_transfers_from_id_fkey' and conrelid = 'public.campaign_transfers'::regclass) then
    execute 'ALTER TABLE ONLY public.campaign_transfers
    ADD CONSTRAINT campaign_transfers_from_id_fkey FOREIGN KEY (from_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_gm_id_fkey' and conrelid = 'public.campaigns'::regclass) then
    execute 'ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_control_campaign_id_fkey' and conrelid = 'public.capture_control'::regclass) then
    execute 'ALTER TABLE ONLY public.capture_control
    ADD CONSTRAINT capture_control_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_control_capture_job_id_fkey' and conrelid = 'public.capture_control'::regclass) then
    execute 'ALTER TABLE ONLY public.capture_control
    ADD CONSTRAINT capture_control_capture_job_id_fkey FOREIGN KEY (capture_job_id) REFERENCES public.capture_jobs(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_control_session_id_fkey' and conrelid = 'public.capture_control'::regclass) then
    execute 'ALTER TABLE ONLY public.capture_control
    ADD CONSTRAINT capture_control_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_jobs_campaign_id_fkey' and conrelid = 'public.capture_jobs'::regclass) then
    execute 'ALTER TABLE ONLY public.capture_jobs
    ADD CONSTRAINT capture_jobs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_jobs_created_by_fkey' and conrelid = 'public.capture_jobs'::regclass) then
    execute 'ALTER TABLE ONLY public.capture_jobs
    ADD CONSTRAINT capture_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_jobs_room_consent_by_fkey' and conrelid = 'public.capture_jobs'::regclass) then
    execute 'ALTER TABLE ONLY public.capture_jobs
    ADD CONSTRAINT capture_jobs_room_consent_by_fkey FOREIGN KEY (room_consent_by) REFERENCES auth.users(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_jobs_session_id_fkey' and conrelid = 'public.capture_jobs'::regclass) then
    execute 'ALTER TABLE ONLY public.capture_jobs
    ADD CONSTRAINT capture_jobs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'character_identities_profile_id_fkey' and conrelid = 'public.character_identities'::regclass) then
    execute 'ALTER TABLE ONLY public.character_identities
    ADD CONSTRAINT character_identities_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'character_identities_source_library_id_fkey' and conrelid = 'public.character_identities'::regclass) then
    execute 'ALTER TABLE ONLY public.character_identities
    ADD CONSTRAINT character_identities_source_library_id_fkey FOREIGN KEY (source_library_id) REFERENCES public.pc_library(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'character_wiki_gm_edit_campaign_id_fkey' and conrelid = 'public.character_wiki_gm_edit'::regclass) then
    execute 'ALTER TABLE ONLY public.character_wiki_gm_edit
    ADD CONSTRAINT character_wiki_gm_edit_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'character_wiki_gm_edit_character_id_fkey' and conrelid = 'public.character_wiki_gm_edit'::regclass) then
    execute 'ALTER TABLE ONLY public.character_wiki_gm_edit
    ADD CONSTRAINT character_wiki_gm_edit_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'character_wiki_sections_campaign_id_fkey' and conrelid = 'public.character_wiki_sections'::regclass) then
    execute 'ALTER TABLE ONLY public.character_wiki_sections
    ADD CONSTRAINT character_wiki_sections_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'character_wiki_sections_character_id_fkey' and conrelid = 'public.character_wiki_sections'::regclass) then
    execute 'ALTER TABLE ONLY public.character_wiki_sections
    ADD CONSTRAINT character_wiki_sections_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'characters_alter_ego_of_fkey' and conrelid = 'public.characters'::regclass) then
    execute 'ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_alter_ego_of_fkey FOREIGN KEY (alter_ego_of) REFERENCES public.characters(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'characters_campaign_id_fkey' and conrelid = 'public.characters'::regclass) then
    execute 'ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'characters_identity_id_fkey' and conrelid = 'public.characters'::regclass) then
    execute 'ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES public.character_identities(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'characters_profile_id_fkey' and conrelid = 'public.characters'::regclass) then
    execute 'ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'chat_grants_campaign_id_fkey' and conrelid = 'public.chat_grants'::regclass) then
    execute 'ALTER TABLE ONLY public.chat_grants
    ADD CONSTRAINT chat_grants_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_campaign_id_fkey' and conrelid = 'public.chat_messages'::regclass) then
    execute 'ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'combats_campaign_id_fkey' and conrelid = 'public.combats'::regclass) then
    execute 'ALTER TABLE ONLY public.combats
    ADD CONSTRAINT combats_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'combats_encounter_id_fkey' and conrelid = 'public.combats'::regclass) then
    execute 'ALTER TABLE ONLY public.combats
    ADD CONSTRAINT combats_encounter_id_fkey FOREIGN KEY (encounter_id) REFERENCES public.encounters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'combats_session_id_fkey' and conrelid = 'public.combats'::regclass) then
    execute 'ALTER TABLE ONLY public.combats
    ADD CONSTRAINT combats_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'compendium_entries_campaign_id_fkey' and conrelid = 'public.compendium_entries'::regclass) then
    execute 'ALTER TABLE ONLY public.compendium_entries
    ADD CONSTRAINT compendium_entries_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'compendium_entries_gm_id_fkey' and conrelid = 'public.compendium_entries'::regclass) then
    execute 'ALTER TABLE ONLY public.compendium_entries
    ADD CONSTRAINT compendium_entries_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'discord_setup_codes_campaign_id_fkey' and conrelid = 'public.discord_setup_codes'::regclass) then
    execute 'ALTER TABLE ONLY public.discord_setup_codes
    ADD CONSTRAINT discord_setup_codes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'discord_setup_codes_created_by_fkey' and conrelid = 'public.discord_setup_codes'::regclass) then
    execute 'ALTER TABLE ONLY public.discord_setup_codes
    ADD CONSTRAINT discord_setup_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'disposition_reveals_campaign_id_fkey' and conrelid = 'public.disposition_reveals'::regclass) then
    execute 'ALTER TABLE ONLY public.disposition_reveals
    ADD CONSTRAINT disposition_reveals_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'disposition_reveals_profile_id_fkey' and conrelid = 'public.disposition_reveals'::regclass) then
    execute 'ALTER TABLE ONLY public.disposition_reveals
    ADD CONSTRAINT disposition_reveals_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'disposition_reveals_revealed_by_fkey' and conrelid = 'public.disposition_reveals'::regclass) then
    execute 'ALTER TABLE ONLY public.disposition_reveals
    ADD CONSTRAINT disposition_reveals_revealed_by_fkey FOREIGN KEY (revealed_by) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'disposition_runs_campaign_id_fkey' and conrelid = 'public.disposition_runs'::regclass) then
    execute 'ALTER TABLE ONLY public.disposition_runs
    ADD CONSTRAINT disposition_runs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dispositions_campaign_id_fkey' and conrelid = 'public.dispositions'::regclass) then
    execute 'ALTER TABLE ONLY public.dispositions
    ADD CONSTRAINT dispositions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dispositions_character_id_fkey' and conrelid = 'public.dispositions'::regclass) then
    execute 'ALTER TABLE ONLY public.dispositions
    ADD CONSTRAINT dispositions_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dispositions_profile_id_fkey' and conrelid = 'public.dispositions'::regclass) then
    execute 'ALTER TABLE ONLY public.dispositions
    ADD CONSTRAINT dispositions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dispositions_session_id_fkey' and conrelid = 'public.dispositions'::regclass) then
    execute 'ALTER TABLE ONLY public.dispositions
    ADD CONSTRAINT dispositions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dm_boards_campaign_id_fkey' and conrelid = 'public.dm_boards'::regclass) then
    execute 'ALTER TABLE ONLY public.dm_boards
    ADD CONSTRAINT dm_boards_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dm_boards_gm_id_fkey' and conrelid = 'public.dm_boards'::regclass) then
    execute 'ALTER TABLE ONLY public.dm_boards
    ADD CONSTRAINT dm_boards_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'dungeon_maps_campaign_id_fkey' and conrelid = 'public.dungeon_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.dungeon_maps
    ADD CONSTRAINT dungeon_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'encounters_campaign_id_fkey' and conrelid = 'public.encounters'::regclass) then
    execute 'ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entity_links_campaign_id_fkey' and conrelid = 'public.entity_links'::regclass) then
    execute 'ALTER TABLE ONLY public.entity_links
    ADD CONSTRAINT entity_links_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entries_campaign_id_fkey' and conrelid = 'public.entries'::regclass) then
    execute 'ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entries_created_by_fkey' and conrelid = 'public.entries'::regclass) then
    execute 'ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entry_reveals_campaign_id_fkey' and conrelid = 'public.entry_reveals'::regclass) then
    execute 'ALTER TABLE ONLY public.entry_reveals
    ADD CONSTRAINT entry_reveals_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'entry_reveals_revealed_to_character_id_fkey' and conrelid = 'public.entry_reveals'::regclass) then
    execute 'ALTER TABLE ONLY public.entry_reveals
    ADD CONSTRAINT entry_reveals_revealed_to_character_id_fkey FOREIGN KEY (revealed_to_character_id) REFERENCES public.characters(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_actor_profile_id_fkey' and conrelid = 'public.events'::regclass) then
    execute 'ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_actor_profile_id_fkey FOREIGN KEY (actor_profile_id) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_campaign_id_fkey' and conrelid = 'public.events'::regclass) then
    execute 'ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_character_id_fkey' and conrelid = 'public.events'::regclass) then
    execute 'ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_event_type_fkey' and conrelid = 'public.events'::regclass) then
    execute 'ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_event_type_fkey FOREIGN KEY (event_type) REFERENCES public.event_types(key)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_session_id_fkey' and conrelid = 'public.events'::regclass) then
    execute 'ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_card_decks_owner_fkey' and conrelid = 'public.gm_card_decks'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_card_decks
    ADD CONSTRAINT gm_card_decks_owner_fkey FOREIGN KEY (owner) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_audio_track_id_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_audio_track_id_fkey FOREIGN KEY (audio_track_id) REFERENCES public.audio_tracks(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_campaign_id_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_faction_id_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_faction_id_fkey FOREIGN KEY (faction_id) REFERENCES public.entries(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_kind_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_kind_fkey FOREIGN KEY (kind) REFERENCES public.gm_event_kinds(kind)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_location_id_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.entries(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_npc_id_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_npc_id_fkey FOREIGN KEY (npc_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_proposed_from_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_proposed_from_fkey FOREIGN KEY (proposed_from) REFERENCES public.gm_proposed_events(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_resolved_by_event_id_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_resolved_by_event_id_fkey FOREIGN KEY (resolved_by_event_id) REFERENCES public.gm_events(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_resolved_session_id_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_resolved_session_id_fkey FOREIGN KEY (resolved_session_id) REFERENCES public.sessions(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_session_id_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_events_target_character_id_fkey' and conrelid = 'public.gm_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_events
    ADD CONSTRAINT gm_events_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_identities_campaign_id_fkey' and conrelid = 'public.gm_identities'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_identities
    ADD CONSTRAINT gm_identities_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_identities_profile_id_fkey' and conrelid = 'public.gm_identities'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_identities
    ADD CONSTRAINT gm_identities_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_audio_track_id_fkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_audio_track_id_fkey FOREIGN KEY (audio_track_id) REFERENCES public.audio_tracks(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_campaign_id_fkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_faction_id_fkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_faction_id_fkey FOREIGN KEY (faction_id) REFERENCES public.entries(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_job_id_fkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.capture_jobs(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_kind_fkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_kind_fkey FOREIGN KEY (kind) REFERENCES public.gm_event_kinds(kind)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_location_id_fkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.entries(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_npc_id_fkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_npc_id_fkey FOREIGN KEY (npc_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_session_id_fkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_proposed_events_target_character_id_fkey' and conrelid = 'public.gm_proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.gm_proposed_events
    ADD CONSTRAINT gm_proposed_events_target_character_id_fkey FOREIGN KEY (target_character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_candidates_campaign_id_fkey' and conrelid = 'public.import_candidates'::regclass) then
    execute 'ALTER TABLE ONLY public.import_candidates
    ADD CONSTRAINT import_candidates_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_candidates_job_id_fkey' and conrelid = 'public.import_candidates'::regclass) then
    execute 'ALTER TABLE ONLY public.import_candidates
    ADD CONSTRAINT import_candidates_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.import_jobs(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_jobs_campaign_id_fkey' and conrelid = 'public.import_jobs'::regclass) then
    execute 'ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_jobs_created_by_fkey' and conrelid = 'public.import_jobs'::regclass) then
    execute 'ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_sessions_campaign_id_fkey' and conrelid = 'public.import_sessions'::regclass) then
    execute 'ALTER TABLE ONLY public.import_sessions
    ADD CONSTRAINT import_sessions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'import_sessions_job_id_fkey' and conrelid = 'public.import_sessions'::regclass) then
    execute 'ALTER TABLE ONLY public.import_sessions
    ADD CONSTRAINT import_sessions_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.import_jobs(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'loot_grants_campaign_id_fkey' and conrelid = 'public.loot_grants'::regclass) then
    execute 'ALTER TABLE ONLY public.loot_grants
    ADD CONSTRAINT loot_grants_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'loot_grants_character_id_fkey' and conrelid = 'public.loot_grants'::regclass) then
    execute 'ALTER TABLE ONLY public.loot_grants
    ADD CONSTRAINT loot_grants_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'loot_grants_event_id_fkey' and conrelid = 'public.loot_grants'::regclass) then
    execute 'ALTER TABLE ONLY public.loot_grants
    ADD CONSTRAINT loot_grants_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'loot_grants_session_id_fkey' and conrelid = 'public.loot_grants'::regclass) then
    execute 'ALTER TABLE ONLY public.loot_grants
    ADD CONSTRAINT loot_grants_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_features_world_map_id_fkey' and conrelid = 'public.map_features'::regclass) then
    execute 'ALTER TABLE ONLY public.map_features
    ADD CONSTRAINT map_features_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES public.world_maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_fog_campaign_id_fkey' and conrelid = 'public.map_fog'::regclass) then
    execute 'ALTER TABLE ONLY public.map_fog
    ADD CONSTRAINT map_fog_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_fog_map_id_fkey' and conrelid = 'public.map_fog'::regclass) then
    execute 'ALTER TABLE ONLY public.map_fog
    ADD CONSTRAINT map_fog_map_id_fkey FOREIGN KEY (map_id) REFERENCES public.maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_icons_campaign_id_fkey' and conrelid = 'public.map_icons'::regclass) then
    execute 'ALTER TABLE ONLY public.map_icons
    ADD CONSTRAINT map_icons_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_images_world_map_id_fkey' and conrelid = 'public.map_images'::regclass) then
    execute 'ALTER TABLE ONLY public.map_images
    ADD CONSTRAINT map_images_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES public.world_maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_labels_world_map_id_fkey' and conrelid = 'public.map_labels'::regclass) then
    execute 'ALTER TABLE ONLY public.map_labels
    ADD CONSTRAINT map_labels_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES public.world_maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_layers_world_map_id_fkey' and conrelid = 'public.map_layers'::regclass) then
    execute 'ALTER TABLE ONLY public.map_layers
    ADD CONSTRAINT map_layers_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES public.world_maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_pins_campaign_id_fkey' and conrelid = 'public.map_pins'::regclass) then
    execute 'ALTER TABLE ONLY public.map_pins
    ADD CONSTRAINT map_pins_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_pins_map_id_fkey' and conrelid = 'public.map_pins'::regclass) then
    execute 'ALTER TABLE ONLY public.map_pins
    ADD CONSTRAINT map_pins_map_id_fkey FOREIGN KEY (map_id) REFERENCES public.maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_pois_character_id_fkey' and conrelid = 'public.map_pois'::regclass) then
    execute 'ALTER TABLE ONLY public.map_pois
    ADD CONSTRAINT map_pois_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_pois_entry_id_fkey' and conrelid = 'public.map_pois'::regclass) then
    execute 'ALTER TABLE ONLY public.map_pois
    ADD CONSTRAINT map_pois_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entries(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_pois_icon_id_fkey' and conrelid = 'public.map_pois'::regclass) then
    execute 'ALTER TABLE ONLY public.map_pois
    ADD CONSTRAINT map_pois_icon_id_fkey FOREIGN KEY (icon_id) REFERENCES public.map_icons(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'map_pois_world_map_id_fkey' and conrelid = 'public.map_pois'::regclass) then
    execute 'ALTER TABLE ONLY public.map_pois
    ADD CONSTRAINT map_pois_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES public.world_maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'maps_campaign_id_fkey' and conrelid = 'public.maps'::regclass) then
    execute 'ALTER TABLE ONLY public.maps
    ADD CONSTRAINT maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'maps_linked_entry_id_fkey' and conrelid = 'public.maps'::regclass) then
    execute 'ALTER TABLE ONLY public.maps
    ADD CONSTRAINT maps_linked_entry_id_fkey FOREIGN KEY (linked_entry_id) REFERENCES public.entries(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_campaign_id_fkey' and conrelid = 'public.memberships'::regclass) then
    execute 'ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_profile_id_fkey' and conrelid = 'public.memberships'::regclass) then
    execute 'ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_actor_id_fkey' and conrelid = 'public.notifications'::regclass) then
    execute 'ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_campaign_id_fkey' and conrelid = 'public.notifications'::regclass) then
    execute 'ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_profile_id_fkey' and conrelid = 'public.notifications'::regclass) then
    execute 'ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'party_funds_campaign_id_fkey' and conrelid = 'public.party_funds'::regclass) then
    execute 'ALTER TABLE ONLY public.party_funds
    ADD CONSTRAINT party_funds_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'party_funds_updated_by_fkey' and conrelid = 'public.party_funds'::regclass) then
    execute 'ALTER TABLE ONLY public.party_funds
    ADD CONSTRAINT party_funds_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'party_items_added_by_fkey' and conrelid = 'public.party_items'::regclass) then
    execute 'ALTER TABLE ONLY public.party_items
    ADD CONSTRAINT party_items_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'party_items_campaign_id_fkey' and conrelid = 'public.party_items'::regclass) then
    execute 'ALTER TABLE ONLY public.party_items
    ADD CONSTRAINT party_items_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'pc_library_alter_ego_of_fkey' and conrelid = 'public.pc_library'::regclass) then
    execute 'ALTER TABLE ONLY public.pc_library
    ADD CONSTRAINT pc_library_alter_ego_of_fkey FOREIGN KEY (alter_ego_of) REFERENCES public.pc_library(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'pc_library_profile_id_fkey' and conrelid = 'public.pc_library'::regclass) then
    execute 'ALTER TABLE ONLY public.pc_library
    ADD CONSTRAINT pc_library_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'player_notes_campaign_id_fkey' and conrelid = 'public.player_notes'::regclass) then
    execute 'ALTER TABLE ONLY public.player_notes
    ADD CONSTRAINT player_notes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'player_notes_entry_id_fkey' and conrelid = 'public.player_notes'::regclass) then
    execute 'ALTER TABLE ONLY public.player_notes
    ADD CONSTRAINT player_notes_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entries(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'player_notes_profile_id_fkey' and conrelid = 'public.player_notes'::regclass) then
    execute 'ALTER TABLE ONLY public.player_notes
    ADD CONSTRAINT player_notes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'poll_responses_character_id_fkey' and conrelid = 'public.poll_responses'::regclass) then
    execute 'ALTER TABLE ONLY public.poll_responses
    ADD CONSTRAINT poll_responses_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'poll_responses_poll_id_fkey' and conrelid = 'public.poll_responses'::regclass) then
    execute 'ALTER TABLE ONLY public.poll_responses
    ADD CONSTRAINT poll_responses_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.session_polls(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_id_fkey' and conrelid = 'public.profiles'::regclass) then
    execute 'ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'proposed_events_campaign_id_fkey' and conrelid = 'public.proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.proposed_events
    ADD CONSTRAINT proposed_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'proposed_events_character_id_fkey' and conrelid = 'public.proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.proposed_events
    ADD CONSTRAINT proposed_events_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'proposed_events_event_type_fkey' and conrelid = 'public.proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.proposed_events
    ADD CONSTRAINT proposed_events_event_type_fkey FOREIGN KEY (event_type) REFERENCES public.event_types(key)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'proposed_events_job_id_fkey' and conrelid = 'public.proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.proposed_events
    ADD CONSTRAINT proposed_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.capture_jobs(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'proposed_events_segment_id_fkey' and conrelid = 'public.proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.proposed_events
    ADD CONSTRAINT proposed_events_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.transcript_segments(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'proposed_events_session_id_fkey' and conrelid = 'public.proposed_events'::regclass) then
    execute 'ALTER TABLE ONLY public.proposed_events
    ADD CONSTRAINT proposed_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recap_sends_campaign_id_fkey' and conrelid = 'public.recap_sends'::regclass) then
    execute 'ALTER TABLE ONLY public.recap_sends
    ADD CONSTRAINT recap_sends_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recap_sends_sent_by_fkey' and conrelid = 'public.recap_sends'::regclass) then
    execute 'ALTER TABLE ONLY public.recap_sends
    ADD CONSTRAINT recap_sends_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recap_sends_session_id_fkey' and conrelid = 'public.recap_sends'::regclass) then
    execute 'ALTER TABLE ONLY public.recap_sends
    ADD CONSTRAINT recap_sends_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recodings_campaign_id_fkey' and conrelid = 'public.recodings'::regclass) then
    execute 'ALTER TABLE ONLY public.recodings
    ADD CONSTRAINT recodings_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recodings_event_type_fkey' and conrelid = 'public.recodings'::regclass) then
    execute 'ALTER TABLE ONLY public.recodings
    ADD CONSTRAINT recodings_event_type_fkey FOREIGN KEY (event_type) REFERENCES public.event_types(key)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recodings_job_id_fkey' and conrelid = 'public.recodings'::regclass) then
    execute 'ALTER TABLE ONLY public.recodings
    ADD CONSTRAINT recodings_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.capture_jobs(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recodings_segment_id_fkey' and conrelid = 'public.recodings'::regclass) then
    execute 'ALTER TABLE ONLY public.recodings
    ADD CONSTRAINT recodings_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.transcript_segments(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recording_consents_campaign_id_fkey' and conrelid = 'public.recording_consents'::regclass) then
    execute 'ALTER TABLE ONLY public.recording_consents
    ADD CONSTRAINT recording_consents_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recording_consents_character_id_fkey' and conrelid = 'public.recording_consents'::regclass) then
    execute 'ALTER TABLE ONLY public.recording_consents
    ADD CONSTRAINT recording_consents_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recording_consents_profile_id_fkey' and conrelid = 'public.recording_consents'::regclass) then
    execute 'ALTER TABLE ONLY public.recording_consents
    ADD CONSTRAINT recording_consents_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recording_consents_recorded_by_fkey' and conrelid = 'public.recording_consents'::regclass) then
    execute 'ALTER TABLE ONLY public.recording_consents
    ADD CONSTRAINT recording_consents_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'recording_consents_session_id_fkey' and conrelid = 'public.recording_consents'::regclass) then
    execute 'ALTER TABLE ONLY public.recording_consents
    ADD CONSTRAINT recording_consents_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'regions_entry_id_fkey' and conrelid = 'public.regions'::regclass) then
    execute 'ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entries(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'regions_layer_id_fkey' and conrelid = 'public.regions'::regclass) then
    execute 'ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_layer_id_fkey FOREIGN KEY (layer_id) REFERENCES public.map_layers(id) ON DELETE RESTRICT';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'regions_parent_region_id_fkey' and conrelid = 'public.regions'::regclass) then
    execute 'ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_parent_region_id_fkey FOREIGN KEY (parent_region_id) REFERENCES public.regions(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'regions_world_map_id_fkey' and conrelid = 'public.regions'::regclass) then
    execute 'ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES public.world_maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'roll_tables_campaign_id_fkey' and conrelid = 'public.roll_tables'::regclass) then
    execute 'ALTER TABLE ONLY public.roll_tables
    ADD CONSTRAINT roll_tables_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'scene_snapshots_campaign_id_fkey' and conrelid = 'public.scene_snapshots'::regclass) then
    execute 'ALTER TABLE ONLY public.scene_snapshots
    ADD CONSTRAINT scene_snapshots_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'scene_snapshots_scene_id_fkey' and conrelid = 'public.scene_snapshots'::regclass) then
    execute 'ALTER TABLE ONLY public.scene_snapshots
    ADD CONSTRAINT scene_snapshots_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES public.vtt_scenes(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'scene_snapshots_session_id_fkey' and conrelid = 'public.scene_snapshots'::regclass) then
    execute 'ALTER TABLE ONLY public.scene_snapshots
    ADD CONSTRAINT scene_snapshots_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'scene_snapshots_taken_by_fkey' and conrelid = 'public.scene_snapshots'::regclass) then
    execute 'ALTER TABLE ONLY public.scene_snapshots
    ADD CONSTRAINT scene_snapshots_taken_by_fkey FOREIGN KEY (taken_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_plan_items_campaign_id_fkey' and conrelid = 'public.session_plan_items'::regclass) then
    execute 'ALTER TABLE ONLY public.session_plan_items
    ADD CONSTRAINT session_plan_items_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_plan_items_linked_character_id_fkey' and conrelid = 'public.session_plan_items'::regclass) then
    execute 'ALTER TABLE ONLY public.session_plan_items
    ADD CONSTRAINT session_plan_items_linked_character_id_fkey FOREIGN KEY (linked_character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_plan_items_linked_event_id_fkey' and conrelid = 'public.session_plan_items'::regclass) then
    execute 'ALTER TABLE ONLY public.session_plan_items
    ADD CONSTRAINT session_plan_items_linked_event_id_fkey FOREIGN KEY (linked_event_id) REFERENCES public.gm_events(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_polls_campaign_id_fkey' and conrelid = 'public.session_polls'::regclass) then
    execute 'ALTER TABLE ONLY public.session_polls
    ADD CONSTRAINT session_polls_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_polls_session_id_fkey' and conrelid = 'public.session_polls'::regclass) then
    execute 'ALTER TABLE ONLY public.session_polls
    ADD CONSTRAINT session_polls_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_campaign_id_fkey' and conrelid = 'public.sessions'::regclass) then
    execute 'ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'species_variants_species_id_fkey' and conrelid = 'public.species_variants'::regclass) then
    execute 'ALTER TABLE ONLY public.species_variants
    ADD CONSTRAINT species_variants_species_id_fkey FOREIGN KEY (species_id) REFERENCES public.species(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'stat_blocks_campaign_id_fkey' and conrelid = 'public.stat_blocks'::regclass) then
    execute 'ALTER TABLE ONLY public.stat_blocks
    ADD CONSTRAINT stat_blocks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'stat_blocks_gm_id_fkey' and conrelid = 'public.stat_blocks'::regclass) then
    execute 'ALTER TABLE ONLY public.stat_blocks
    ADD CONSTRAINT stat_blocks_gm_id_fkey FOREIGN KEY (gm_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'threads_campaign_id_fkey' and conrelid = 'public.threads'::regclass) then
    execute 'ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'threads_character_id_fkey' and conrelid = 'public.threads'::regclass) then
    execute 'ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'threads_profile_id_fkey' and conrelid = 'public.threads'::regclass) then
    execute 'ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'tpdi_responses_assigned_character_id_fkey' and conrelid = 'public.tpdi_responses'::regclass) then
    execute 'ALTER TABLE ONLY public.tpdi_responses
    ADD CONSTRAINT tpdi_responses_assigned_character_id_fkey FOREIGN KEY (assigned_character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'tpdi_responses_campaign_id_fkey' and conrelid = 'public.tpdi_responses'::regclass) then
    execute 'ALTER TABLE ONLY public.tpdi_responses
    ADD CONSTRAINT tpdi_responses_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'transcript_segments_campaign_id_fkey' and conrelid = 'public.transcript_segments'::regclass) then
    execute 'ALTER TABLE ONLY public.transcript_segments
    ADD CONSTRAINT transcript_segments_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'transcript_segments_character_id_fkey' and conrelid = 'public.transcript_segments'::regclass) then
    execute 'ALTER TABLE ONLY public.transcript_segments
    ADD CONSTRAINT transcript_segments_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'transcript_segments_gm_identity_id_fkey' and conrelid = 'public.transcript_segments'::regclass) then
    execute 'ALTER TABLE ONLY public.transcript_segments
    ADD CONSTRAINT transcript_segments_gm_identity_id_fkey FOREIGN KEY (gm_identity_id) REFERENCES public.gm_identities(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'transcript_segments_job_id_fkey' and conrelid = 'public.transcript_segments'::regclass) then
    execute 'ALTER TABLE ONLY public.transcript_segments
    ADD CONSTRAINT transcript_segments_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.capture_jobs(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'transcript_segments_track_id_fkey' and conrelid = 'public.transcript_segments'::regclass) then
    execute 'ALTER TABLE ONLY public.transcript_segments
    ADD CONSTRAINT transcript_segments_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.audio_tracks(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'usage_events_campaign_id_fkey' and conrelid = 'public.usage_events'::regclass) then
    execute 'ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'usage_events_session_id_fkey' and conrelid = 'public.usage_events'::regclass) then
    execute 'ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vibe_checks_campaign_id_fkey' and conrelid = 'public.vibe_checks'::regclass) then
    execute 'ALTER TABLE ONLY public.vibe_checks
    ADD CONSTRAINT vibe_checks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vibe_checks_profile_id_fkey' and conrelid = 'public.vibe_checks'::regclass) then
    execute 'ALTER TABLE ONLY public.vibe_checks
    ADD CONSTRAINT vibe_checks_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vibe_checks_session_id_fkey' and conrelid = 'public.vibe_checks'::regclass) then
    execute 'ALTER TABLE ONLY public.vibe_checks
    ADD CONSTRAINT vibe_checks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_audio_campaign_id_fkey' and conrelid = 'public.vtt_audio'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_audio
    ADD CONSTRAINT vtt_audio_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_cards_campaign_id_fkey' and conrelid = 'public.vtt_cards'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_cards
    ADD CONSTRAINT vtt_cards_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_cards_deck_id_fkey' and conrelid = 'public.vtt_cards'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_cards
    ADD CONSTRAINT vtt_cards_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.vtt_decks(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_cards_given_by_fkey' and conrelid = 'public.vtt_cards'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_cards
    ADD CONSTRAINT vtt_cards_given_by_fkey FOREIGN KEY (given_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_cards_holder_fkey' and conrelid = 'public.vtt_cards'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_cards
    ADD CONSTRAINT vtt_cards_holder_fkey FOREIGN KEY (holder) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_cards_played_by_fkey' and conrelid = 'public.vtt_cards'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_cards
    ADD CONSTRAINT vtt_cards_played_by_fkey FOREIGN KEY (played_by) REFERENCES public.profiles(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_decks_campaign_id_fkey' and conrelid = 'public.vtt_decks'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_decks
    ADD CONSTRAINT vtt_decks_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_drawings_campaign_id_fkey' and conrelid = 'public.vtt_drawings'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_drawings
    ADD CONSTRAINT vtt_drawings_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_drawings_owner_fkey' and conrelid = 'public.vtt_drawings'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_drawings
    ADD CONSTRAINT vtt_drawings_owner_fkey FOREIGN KEY (owner) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_drawings_scene_id_fkey' and conrelid = 'public.vtt_drawings'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_drawings
    ADD CONSTRAINT vtt_drawings_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES public.vtt_scenes(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_effects_campaign_id_fkey' and conrelid = 'public.vtt_effects'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_effects
    ADD CONSTRAINT vtt_effects_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_effects_owner_fkey' and conrelid = 'public.vtt_effects'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_effects
    ADD CONSTRAINT vtt_effects_owner_fkey FOREIGN KEY (owner) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_effects_scene_id_fkey' and conrelid = 'public.vtt_effects'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_effects
    ADD CONSTRAINT vtt_effects_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES public.vtt_scenes(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_effects_token_id_fkey' and conrelid = 'public.vtt_effects'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_effects
    ADD CONSTRAINT vtt_effects_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.vtt_tokens(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_events_campaign_id_fkey' and conrelid = 'public.vtt_events'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_events
    ADD CONSTRAINT vtt_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_events_character_id_fkey' and conrelid = 'public.vtt_events'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_events
    ADD CONSTRAINT vtt_events_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_events_session_id_fkey' and conrelid = 'public.vtt_events'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_events
    ADD CONSTRAINT vtt_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_handouts_campaign_id_fkey' and conrelid = 'public.vtt_handouts'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_handouts
    ADD CONSTRAINT vtt_handouts_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_handouts_entry_id_fkey' and conrelid = 'public.vtt_handouts'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_handouts
    ADD CONSTRAINT vtt_handouts_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entries(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_ingest_keys_campaign_id_fkey' and conrelid = 'public.vtt_ingest_keys'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_ingest_keys
    ADD CONSTRAINT vtt_ingest_keys_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_ingest_keys_profile_id_fkey' and conrelid = 'public.vtt_ingest_keys'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_ingest_keys
    ADD CONSTRAINT vtt_ingest_keys_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_messages_author_profile_fkey' and conrelid = 'public.vtt_messages'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_messages
    ADD CONSTRAINT vtt_messages_author_profile_fkey FOREIGN KEY (author_profile) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_messages_campaign_id_fkey' and conrelid = 'public.vtt_messages'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_messages
    ADD CONSTRAINT vtt_messages_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_messages_character_id_fkey' and conrelid = 'public.vtt_messages'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_messages
    ADD CONSTRAINT vtt_messages_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_messages_session_id_fkey' and conrelid = 'public.vtt_messages'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_messages
    ADD CONSTRAINT vtt_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_messages_vtt_event_id_fkey' and conrelid = 'public.vtt_messages'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_messages
    ADD CONSTRAINT vtt_messages_vtt_event_id_fkey FOREIGN KEY (vtt_event_id) REFERENCES public.vtt_events(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_name_links_campaign_id_fkey' and conrelid = 'public.vtt_name_links'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_name_links
    ADD CONSTRAINT vtt_name_links_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_name_links_character_id_fkey' and conrelid = 'public.vtt_name_links'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_name_links
    ADD CONSTRAINT vtt_name_links_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_pins_campaign_id_fkey' and conrelid = 'public.vtt_pins'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_pins
    ADD CONSTRAINT vtt_pins_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_pins_entry_id_fkey' and conrelid = 'public.vtt_pins'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_pins
    ADD CONSTRAINT vtt_pins_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entries(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_pins_scene_id_fkey' and conrelid = 'public.vtt_pins'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_pins
    ADD CONSTRAINT vtt_pins_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES public.vtt_scenes(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_scene_players_campaign_id_fkey' and conrelid = 'public.vtt_scene_players'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_scene_players
    ADD CONSTRAINT vtt_scene_players_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_scene_players_profile_id_fkey' and conrelid = 'public.vtt_scene_players'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_scene_players
    ADD CONSTRAINT vtt_scene_players_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_scene_players_scene_id_fkey' and conrelid = 'public.vtt_scene_players'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_scene_players
    ADD CONSTRAINT vtt_scene_players_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES public.vtt_scenes(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_scenes_battle_map_id_fkey' and conrelid = 'public.vtt_scenes'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_scenes
    ADD CONSTRAINT vtt_scenes_battle_map_id_fkey FOREIGN KEY (battle_map_id) REFERENCES public.battle_maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_scenes_campaign_id_fkey' and conrelid = 'public.vtt_scenes'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_scenes
    ADD CONSTRAINT vtt_scenes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_sounds_campaign_id_fkey' and conrelid = 'public.vtt_sounds'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_sounds
    ADD CONSTRAINT vtt_sounds_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_templates_campaign_id_fkey' and conrelid = 'public.vtt_templates'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_templates
    ADD CONSTRAINT vtt_templates_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_templates_owner_fkey' and conrelid = 'public.vtt_templates'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_templates
    ADD CONSTRAINT vtt_templates_owner_fkey FOREIGN KEY (owner) REFERENCES public.profiles(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_templates_scene_id_fkey' and conrelid = 'public.vtt_templates'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_templates
    ADD CONSTRAINT vtt_templates_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES public.vtt_scenes(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_token_notes_campaign_id_fkey' and conrelid = 'public.vtt_token_notes'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_token_notes
    ADD CONSTRAINT vtt_token_notes_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_token_notes_token_id_fkey' and conrelid = 'public.vtt_token_notes'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_token_notes
    ADD CONSTRAINT vtt_token_notes_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.vtt_tokens(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_tokens_campaign_id_fkey' and conrelid = 'public.vtt_tokens'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_tokens
    ADD CONSTRAINT vtt_tokens_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_tokens_character_id_fkey' and conrelid = 'public.vtt_tokens'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_tokens
    ADD CONSTRAINT vtt_tokens_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_tokens_scene_id_fkey' and conrelid = 'public.vtt_tokens'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_tokens
    ADD CONSTRAINT vtt_tokens_scene_id_fkey FOREIGN KEY (scene_id) REFERENCES public.vtt_scenes(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_tokens_stat_block_id_fkey' and conrelid = 'public.vtt_tokens'::regclass) then
    execute 'ALTER TABLE ONLY public.vtt_tokens
    ADD CONSTRAINT vtt_tokens_stat_block_id_fkey FOREIGN KEY (stat_block_id) REFERENCES public.stat_blocks(id) ON DELETE SET NULL';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'world_hexes_region_id_fkey' and conrelid = 'public.world_hexes'::regclass) then
    execute 'ALTER TABLE ONLY public.world_hexes
    ADD CONSTRAINT world_hexes_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'world_hexes_world_map_id_fkey' and conrelid = 'public.world_hexes'::regclass) then
    execute 'ALTER TABLE ONLY public.world_hexes
    ADD CONSTRAINT world_hexes_world_map_id_fkey FOREIGN KEY (world_map_id) REFERENCES public.world_maps(id) ON DELETE CASCADE';
  end if;
end $guard$;

do $guard$ begin
  if not exists (select 1 from pg_constraint where conname = 'world_maps_campaign_id_fkey' and conrelid = 'public.world_maps'::regclass) then
    execute 'ALTER TABLE ONLY public.world_maps
    ADD CONSTRAINT world_maps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE';
  end if;
end $guard$;

ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.addon_hooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addon_hooks_gm ON public.addon_hooks;
CREATE POLICY addon_hooks_gm ON public.addon_hooks USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.addon_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addon_keys_gm ON public.addon_keys;
CREATE POLICY addon_keys_gm ON public.addon_keys USING (public.is_campaign_gm(campaign_id)) WITH CHECK ((public.is_campaign_gm(campaign_id) AND (created_by = auth.uid())));

ALTER TABLE public.addon_outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_map_renders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_map_renders owner read" ON public.ai_map_renders;
CREATE POLICY "ai_map_renders owner read" ON public.ai_map_renders FOR SELECT USING ((profile_id = auth.uid()));

ALTER TABLE public.arc_touches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.arcs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audio_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "author writes own entries" ON public.entries;
CREATE POLICY "author writes own entries" ON public.entries TO authenticated USING (((created_by = auth.uid()) AND public.is_campaign_member(campaign_id))) WITH CHECK (((created_by = auth.uid()) AND public.is_campaign_member(campaign_id)));

ALTER TABLE public.bastion_maps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bastion_maps_gm ON public.bastion_maps;
CREATE POLICY bastion_maps_gm ON public.bastion_maps USING ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = bastion_maps.campaign_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = bastion_maps.campaign_id) AND public.is_campaign_gm(c.id)))));

ALTER TABLE public.battle_maps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS battle_maps_gm ON public.battle_maps;
CREATE POLICY battle_maps_gm ON public.battle_maps USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.biomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "biomes readable by all" ON public.biomes;
CREATE POLICY "biomes readable by all" ON public.biomes FOR SELECT USING (true);

ALTER TABLE public.building_maps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS building_maps_gm ON public.building_maps;
CREATE POLICY building_maps_gm ON public.building_maps USING ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = building_maps.campaign_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = building_maps.campaign_id) AND public.is_campaign_gm(c.id)))));

ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_gm_invites ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_journals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_transfers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.capture_control ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.capture_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.character_identities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.character_wiki_gm_edit ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.character_wiki_sections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_grants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.class_capabilities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.combats ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.compendium_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "create own campaign" ON public.campaigns;
CREATE POLICY "create own campaign" ON public.campaigns FOR INSERT TO authenticated WITH CHECK ((gm_id = auth.uid()));

DROP POLICY IF EXISTS "cw grant: owner grants" ON public.character_wiki_gm_edit;
CREATE POLICY "cw grant: owner grants" ON public.character_wiki_gm_edit FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.characters ch
  WHERE ((ch.id = character_wiki_gm_edit.character_id) AND (ch.profile_id = auth.uid())))));

DROP POLICY IF EXISTS "cw grant: owner revokes" ON public.character_wiki_gm_edit;
CREATE POLICY "cw grant: owner revokes" ON public.character_wiki_gm_edit FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.characters ch
  WHERE ((ch.id = character_wiki_gm_edit.character_id) AND (ch.profile_id = auth.uid())))));

DROP POLICY IF EXISTS "cw grant: read" ON public.character_wiki_gm_edit;
CREATE POLICY "cw grant: read" ON public.character_wiki_gm_edit FOR SELECT TO authenticated USING ((public.is_campaign_gm(campaign_id) OR (EXISTS ( SELECT 1
   FROM public.characters ch
  WHERE ((ch.id = character_wiki_gm_edit.character_id) AND (ch.profile_id = auth.uid()))))));

DROP POLICY IF EXISTS "cw sections: delete" ON public.character_wiki_sections;
CREATE POLICY "cw sections: delete" ON public.character_wiki_sections FOR DELETE TO authenticated USING (((owner_id = auth.uid()) OR (public.is_campaign_gm(campaign_id) AND (EXISTS ( SELECT 1
   FROM public.character_wiki_gm_edit g
  WHERE (g.character_id = character_wiki_sections.character_id))))));

DROP POLICY IF EXISTS "cw sections: insert" ON public.character_wiki_sections;
CREATE POLICY "cw sections: insert" ON public.character_wiki_sections FOR INSERT TO authenticated WITH CHECK (((owner_id = auth.uid()) OR (public.is_campaign_gm(campaign_id) AND (EXISTS ( SELECT 1
   FROM public.character_wiki_gm_edit g
  WHERE (g.character_id = character_wiki_sections.character_id))))));

DROP POLICY IF EXISTS "cw sections: read" ON public.character_wiki_sections;
CREATE POLICY "cw sections: read" ON public.character_wiki_sections FOR SELECT TO authenticated USING (((owner_id = auth.uid()) OR ((visibility = 'shared'::text) AND public.is_campaign_gm(campaign_id))));

DROP POLICY IF EXISTS "cw sections: update" ON public.character_wiki_sections;
CREATE POLICY "cw sections: update" ON public.character_wiki_sections FOR UPDATE TO authenticated USING (((owner_id = auth.uid()) OR (public.is_campaign_gm(campaign_id) AND (EXISTS ( SELECT 1
   FROM public.character_wiki_gm_edit g
  WHERE (g.character_id = character_wiki_sections.character_id))))));

ALTER TABLE public.discord_setup_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.disposition_reveals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.disposition_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS disposition_runs_gm_read ON public.disposition_runs;
CREATE POLICY disposition_runs_gm_read ON public.disposition_runs FOR SELECT USING (public.is_campaign_gm(campaign_id));

ALTER TABLE public.dispositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dispositions: character scope" ON public.dispositions;
CREATE POLICY "dispositions: character scope" ON public.dispositions FOR SELECT TO authenticated USING (((scope = 'character'::text) AND ((profile_id = auth.uid()) OR ((campaign_id IS NOT NULL) AND public.is_campaign_gm(campaign_id)))));

DROP POLICY IF EXISTS "dispositions: player scope" ON public.dispositions;
CREATE POLICY "dispositions: player scope" ON public.dispositions FOR SELECT TO authenticated USING (((scope = 'player'::text) AND ((EXISTS ( SELECT 1
   FROM (public.characters ch
     JOIN public.campaigns c ON ((c.id = ch.campaign_id)))
  WHERE ((ch.profile_id = dispositions.profile_id) AND public.is_campaign_gm(c.id)))) OR ((profile_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.disposition_reveals r
  WHERE (r.profile_id = auth.uid())))))));

ALTER TABLE public.dm_boards ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dungeon_maps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dungeon_maps_gm ON public.dungeon_maps;
CREATE POLICY dungeon_maps_gm ON public.dungeon_maps USING ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = dungeon_maps.campaign_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = dungeon_maps.campaign_id) AND public.is_campaign_gm(c.id)))));

ALTER TABLE public.email_prefs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.entity_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.entry_reveals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gm adds members" ON public.memberships;
CREATE POLICY "gm adds members" ON public.memberships FOR INSERT TO authenticated WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all audio_tracks" ON public.audio_tracks;
CREATE POLICY "gm all audio_tracks" ON public.audio_tracks TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all capture_jobs" ON public.capture_jobs;
CREATE POLICY "gm all capture_jobs" ON public.capture_jobs TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all combats" ON public.combats;
CREATE POLICY "gm all combats" ON public.combats USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all encounters" ON public.encounters;
CREATE POLICY "gm all encounters" ON public.encounters USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all map fog" ON public.map_fog;
CREATE POLICY "gm all map fog" ON public.map_fog TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all maps" ON public.maps;
CREATE POLICY "gm all maps" ON public.maps USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all pins" ON public.map_pins;
CREATE POLICY "gm all pins" ON public.map_pins USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all plan items" ON public.session_plan_items;
CREATE POLICY "gm all plan items" ON public.session_plan_items USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all proposed_events" ON public.proposed_events;
CREATE POLICY "gm all proposed_events" ON public.proposed_events TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all recodings" ON public.recodings;
CREATE POLICY "gm all recodings" ON public.recodings TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all reveals" ON public.entry_reveals;
CREATE POLICY "gm all reveals" ON public.entry_reveals USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm all transcript_segments" ON public.transcript_segments;
CREATE POLICY "gm all transcript_segments" ON public.transcript_segments TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm deletes campaign" ON public.campaigns;
CREATE POLICY "gm deletes campaign" ON public.campaigns FOR DELETE TO authenticated USING ((gm_id = auth.uid()));

DROP POLICY IF EXISTS "gm manages campaign" ON public.campaigns;
CREATE POLICY "gm manages campaign" ON public.campaigns FOR UPDATE TO authenticated USING (public.is_campaign_gm(id));

DROP POLICY IF EXISTS "gm manages own stat blocks" ON public.stat_blocks;
CREATE POLICY "gm manages own stat blocks" ON public.stat_blocks USING (((gm_id = auth.uid()) OR ((campaign_id IS NOT NULL) AND public.is_campaign_gm(campaign_id)))) WITH CHECK ((((gm_id = auth.uid()) AND ((campaign_id IS NULL) OR public.is_campaign_gm(campaign_id))) OR ((campaign_id IS NOT NULL) AND public.is_campaign_gm(campaign_id))));

DROP POLICY IF EXISTS "gm or self removes membership" ON public.memberships;
CREATE POLICY "gm or self removes membership" ON public.memberships FOR DELETE TO authenticated USING ((public.is_campaign_gm(campaign_id) OR (profile_id = auth.uid())));

DROP POLICY IF EXISTS "gm or self updates membership" ON public.memberships;
CREATE POLICY "gm or self updates membership" ON public.memberships FOR UPDATE TO authenticated USING ((public.is_campaign_gm(campaign_id) OR (profile_id = auth.uid())));

DROP POLICY IF EXISTS "gm reads campaign responses" ON public.tpdi_responses;
CREATE POLICY "gm reads campaign responses" ON public.tpdi_responses FOR SELECT TO authenticated USING (((campaign_id IS NOT NULL) AND public.is_campaign_gm(campaign_id)));

DROP POLICY IF EXISTS "gm reads campaign usage" ON public.usage_events;
CREATE POLICY "gm reads campaign usage" ON public.usage_events FOR SELECT TO authenticated USING (((campaign_id IS NOT NULL) AND public.is_campaign_gm(campaign_id)));

DROP POLICY IF EXISTS "gm reads journal" ON public.campaign_journals;
CREATE POLICY "gm reads journal" ON public.campaign_journals FOR SELECT USING (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm reads links" ON public.entity_links;
CREATE POLICY "gm reads links" ON public.entity_links FOR SELECT TO authenticated USING (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm reads name links" ON public.vtt_name_links;
CREATE POLICY "gm reads name links" ON public.vtt_name_links FOR SELECT TO authenticated USING (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm reads poll responses" ON public.poll_responses;
CREATE POLICY "gm reads poll responses" ON public.poll_responses FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.session_polls p
  WHERE ((p.id = poll_responses.poll_id) AND public.is_campaign_gm(p.campaign_id)))));

DROP POLICY IF EXISTS "gm reads polls" ON public.session_polls;
CREATE POLICY "gm reads polls" ON public.session_polls FOR SELECT USING (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm reads scene snapshots" ON public.scene_snapshots;
CREATE POLICY "gm reads scene snapshots" ON public.scene_snapshots FOR SELECT TO authenticated USING (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm reads vtt events" ON public.vtt_events;
CREATE POLICY "gm reads vtt events" ON public.vtt_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = vtt_events.campaign_id) AND public.is_campaign_gm(c.id)))));

DROP POLICY IF EXISTS "gm writes arc_touches" ON public.arc_touches;
CREATE POLICY "gm writes arc_touches" ON public.arc_touches TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm writes arcs" ON public.arcs;
CREATE POLICY "gm writes arcs" ON public.arcs TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm writes attendance" ON public.attendance;
CREATE POLICY "gm writes attendance" ON public.attendance TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm writes consents" ON public.recording_consents;
CREATE POLICY "gm writes consents" ON public.recording_consents TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm writes entries" ON public.entries;
CREATE POLICY "gm writes entries" ON public.entries TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm writes events" ON public.events;
CREATE POLICY "gm writes events" ON public.events TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm writes links" ON public.entity_links;
CREATE POLICY "gm writes links" ON public.entity_links TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm writes loot" ON public.loot_grants;
CREATE POLICY "gm writes loot" ON public.loot_grants TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "gm writes sessions" ON public.sessions;
CREATE POLICY "gm writes sessions" ON public.sessions TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.gm_card_decks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gm_card_decks_owner ON public.gm_card_decks;
CREATE POLICY gm_card_decks_owner ON public.gm_card_decks USING ((owner = auth.uid())) WITH CHECK ((owner = auth.uid()));

ALTER TABLE public.gm_event_kinds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gm_event_kinds_read ON public.gm_event_kinds;
CREATE POLICY gm_event_kinds_read ON public.gm_event_kinds FOR SELECT TO authenticated USING (true);

ALTER TABLE public.gm_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gm_events_select_own ON public.gm_events;
CREATE POLICY gm_events_select_own ON public.gm_events FOR SELECT USING ((campaign_id IN ( SELECT campaigns.id
   FROM public.campaigns
  WHERE public.is_campaign_gm(campaigns.id))));

ALTER TABLE public.gm_identities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.gm_proposed_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gm_proposed_events_select_own ON public.gm_proposed_events;
CREATE POLICY gm_proposed_events_select_own ON public.gm_proposed_events FOR SELECT USING ((campaign_id IN ( SELECT campaigns.id
   FROM public.campaigns
  WHERE public.is_campaign_gm(campaigns.id))));

ALTER TABLE public.import_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_candidates: gm all" ON public.import_candidates;
CREATE POLICY "import_candidates: gm all" ON public.import_candidates TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_jobs: gm all" ON public.import_jobs;
CREATE POLICY "import_jobs: gm all" ON public.import_jobs TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.import_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_sessions: gm all" ON public.import_sessions;
CREATE POLICY "import_sessions: gm all" ON public.import_sessions TO authenticated USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS "insert own responses" ON public.tpdi_responses;
CREATE POLICY "insert own responses" ON public.tpdi_responses FOR INSERT TO anon, authenticated WITH CHECK ((respondent_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.loot_grants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lore_backup ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.map_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "map_features gm all" ON public.map_features;
CREATE POLICY "map_features gm all" ON public.map_features USING ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_features.world_map_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_features.world_map_id) AND public.is_campaign_gm(c.id)))));

ALTER TABLE public.map_fog ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.map_icons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "map_icons gm all" ON public.map_icons;
CREATE POLICY "map_icons gm all" ON public.map_icons USING ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = map_icons.campaign_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = map_icons.campaign_id) AND public.is_campaign_gm(c.id)))));

ALTER TABLE public.map_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "map_images gm all" ON public.map_images;
CREATE POLICY "map_images gm all" ON public.map_images USING ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_images.world_map_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_images.world_map_id) AND public.is_campaign_gm(c.id)))));

ALTER TABLE public.map_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS map_labels_gm_all ON public.map_labels;
CREATE POLICY map_labels_gm_all ON public.map_labels USING ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_labels.world_map_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_labels.world_map_id) AND public.is_campaign_gm(c.id)))));

ALTER TABLE public.map_layers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "map_layers gm all" ON public.map_layers;
CREATE POLICY "map_layers gm all" ON public.map_layers USING ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_layers.world_map_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_layers.world_map_id) AND public.is_campaign_gm(c.id)))));

ALTER TABLE public.map_pins ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.map_pois ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "map_pois gm all" ON public.map_pois;
CREATE POLICY "map_pois gm all" ON public.map_pois USING ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_pois.world_map_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = map_pois.world_map_id) AND public.is_campaign_gm(c.id)))));

DROP POLICY IF EXISTS "map_pois member delete when open" ON public.map_pois;
CREATE POLICY "map_pois member delete when open" ON public.map_pois FOR DELETE USING (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM public.world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND (wm.editable_by = 'party'::text) AND public.is_campaign_member(wm.campaign_id))))));

DROP POLICY IF EXISTS "map_pois member insert when open" ON public.map_pois;
CREATE POLICY "map_pois member insert when open" ON public.map_pois FOR INSERT WITH CHECK (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM public.world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND (wm.editable_by = 'party'::text) AND public.is_campaign_member(wm.campaign_id))))));

DROP POLICY IF EXISTS "map_pois member read visible" ON public.map_pois;
CREATE POLICY "map_pois member read visible" ON public.map_pois FOR SELECT USING (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM public.world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND public.is_campaign_member(wm.campaign_id))))));

DROP POLICY IF EXISTS "map_pois member update when open" ON public.map_pois;
CREATE POLICY "map_pois member update when open" ON public.map_pois FOR UPDATE USING (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM public.world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND (wm.editable_by = 'party'::text) AND public.is_campaign_member(wm.campaign_id)))))) WITH CHECK (((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND (EXISTS ( SELECT 1
   FROM public.world_maps wm
  WHERE ((wm.id = map_pois.world_map_id) AND (wm.editable_by = 'party'::text) AND public.is_campaign_member(wm.campaign_id))))));

ALTER TABLE public.maps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read arc_touches" ON public.arc_touches;
CREATE POLICY "members read arc_touches" ON public.arc_touches FOR SELECT TO authenticated USING (public.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "members read arcs" ON public.arcs;
CREATE POLICY "members read arcs" ON public.arcs FOR SELECT TO authenticated USING (public.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "members read attendance" ON public.attendance;
CREATE POLICY "members read attendance" ON public.attendance FOR SELECT TO authenticated USING (public.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "members read campaigns" ON public.campaigns;
CREATE POLICY "members read campaigns" ON public.campaigns FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND (public.is_campaign_member(id) OR (gm_id = auth.uid()))));

DROP POLICY IF EXISTS "members read characters" ON public.characters;
CREATE POLICY "members read characters" ON public.characters FOR SELECT USING ((public.is_campaign_member(campaign_id) OR (profile_id = auth.uid())));

DROP POLICY IF EXISTS "members read consents" ON public.recording_consents;
CREATE POLICY "members read consents" ON public.recording_consents FOR SELECT TO authenticated USING (public.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "members read events" ON public.events;
CREATE POLICY "members read events" ON public.events FOR SELECT TO authenticated USING (public.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "members read loot" ON public.loot_grants;
CREATE POLICY "members read loot" ON public.loot_grants FOR SELECT TO authenticated USING (public.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "members read map fog" ON public.map_fog;
CREATE POLICY "members read map fog" ON public.map_fog FOR SELECT TO authenticated USING (public.is_campaign_member(campaign_id));

DROP POLICY IF EXISTS "members read sessions" ON public.sessions;
CREATE POLICY "members read sessions" ON public.sessions FOR SELECT TO authenticated USING (public.is_campaign_member(campaign_id));

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.npc_text_fix_backup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own compendium entries only" ON public.compendium_entries;
CREATE POLICY "own compendium entries only" ON public.compendium_entries USING ((gm_id = auth.uid())) WITH CHECK ((gm_id = auth.uid()));

DROP POLICY IF EXISTS "own dm boards only" ON public.dm_boards;
CREATE POLICY "own dm boards only" ON public.dm_boards USING ((gm_id = auth.uid())) WITH CHECK ((gm_id = auth.uid()));

DROP POLICY IF EXISTS "own notes only" ON public.player_notes;
CREATE POLICY "own notes only" ON public.player_notes USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "own notifications delete" ON public.notifications;
CREATE POLICY "own notifications delete" ON public.notifications FOR DELETE TO authenticated USING ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "own notifications mark" ON public.notifications;
CREATE POLICY "own notifications mark" ON public.notifications FOR UPDATE TO authenticated USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "own notifications read" ON public.notifications;
CREATE POLICY "own notifications read" ON public.notifications FOR SELECT TO authenticated USING ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "owner deletes own identities" ON public.character_identities;
CREATE POLICY "owner deletes own identities" ON public.character_identities FOR DELETE USING ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "owner deletes own library" ON public.pc_library;
CREATE POLICY "owner deletes own library" ON public.pc_library FOR DELETE USING ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "owner inserts own identities" ON public.character_identities;
CREATE POLICY "owner inserts own identities" ON public.character_identities FOR INSERT WITH CHECK ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "owner inserts own library" ON public.pc_library;
CREATE POLICY "owner inserts own library" ON public.pc_library FOR INSERT WITH CHECK ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "owner or gm adds character" ON public.characters;
CREATE POLICY "owner or gm adds character" ON public.characters FOR INSERT TO authenticated WITH CHECK ((public.is_campaign_gm(campaign_id) OR ((profile_id = auth.uid()) AND public.is_campaign_member(campaign_id))));

DROP POLICY IF EXISTS "owner or gm edits character" ON public.characters;
CREATE POLICY "owner or gm edits character" ON public.characters FOR UPDATE TO authenticated USING ((public.is_campaign_gm(campaign_id) OR (profile_id = auth.uid())));

DROP POLICY IF EXISTS "owner reads own identities" ON public.character_identities;
CREATE POLICY "owner reads own identities" ON public.character_identities FOR SELECT USING ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "owner reads own library" ON public.pc_library;
CREATE POLICY "owner reads own library" ON public.pc_library FOR SELECT USING ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "owner updates own identities" ON public.character_identities;
CREATE POLICY "owner updates own identities" ON public.character_identities FOR UPDATE USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "owner updates own library" ON public.pc_library;
CREATE POLICY "owner updates own library" ON public.pc_library FOR UPDATE USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));

ALTER TABLE public.party_funds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_funds_read ON public.party_funds;
CREATE POLICY party_funds_read ON public.party_funds FOR SELECT USING ((public.is_campaign_gm(campaign_id) OR public.tabletop_is_player(campaign_id)));

ALTER TABLE public.party_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_items_table ON public.party_items;
CREATE POLICY party_items_table ON public.party_items USING ((public.is_campaign_gm(campaign_id) OR public.tabletop_is_player(campaign_id))) WITH CHECK ((public.is_campaign_gm(campaign_id) OR public.tabletop_is_player(campaign_id)));

ALTER TABLE public.pc_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "player links from own character" ON public.entity_links;
CREATE POLICY "player links from own character" ON public.entity_links FOR INSERT TO authenticated WITH CHECK (((source_type = 'character'::text) AND public.can_write_character_portrait((source_id)::text)));

DROP POLICY IF EXISTS "player reads own character links" ON public.entity_links;
CREATE POLICY "player reads own character links" ON public.entity_links FOR SELECT TO authenticated USING ((public.can_write_character_portrait((source_id)::text) OR public.can_write_character_portrait((target_id)::text)));

DROP POLICY IF EXISTS "player unlinks from own character" ON public.entity_links;
CREATE POLICY "player unlinks from own character" ON public.entity_links FOR DELETE TO authenticated USING (((source_type = 'character'::text) AND public.can_write_character_portrait((source_id)::text)));

ALTER TABLE public.player_notes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.poll_responses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.proposed_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rate_hits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read class_capabilities" ON public.class_capabilities;
CREATE POLICY "read class_capabilities" ON public.class_capabilities FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "read classes" ON public.classes;
CREATE POLICY "read classes" ON public.classes FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "read entries" ON public.entries;
CREATE POLICY "read entries" ON public.entries FOR SELECT TO authenticated USING ((((visibility = ANY (ARRAY['common'::text, 'player'::text])) AND public.is_campaign_member(campaign_id)) OR ((visibility = 'gm'::text) AND public.is_campaign_gm(campaign_id)) OR ((visibility = 'private'::text) AND (created_by = auth.uid()))));

DROP POLICY IF EXISTS "read event_types" ON public.event_types;
CREATE POLICY "read event_types" ON public.event_types FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "read own profile" ON public.profiles;
CREATE POLICY "read own profile" ON public.profiles FOR SELECT TO authenticated USING ((id = auth.uid()));

DROP POLICY IF EXISTS "read own responses" ON public.tpdi_responses;
CREATE POLICY "read own responses" ON public.tpdi_responses FOR SELECT TO anon, authenticated USING ((respondent_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "read species" ON public.species;
CREATE POLICY "read species" ON public.species FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "read species_variants" ON public.species_variants;
CREATE POLICY "read species_variants" ON public.species_variants FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.recap_sends ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.recodings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.recording_consents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regions gm all" ON public.regions;
CREATE POLICY "regions gm all" ON public.regions USING ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = regions.world_map_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = regions.world_map_id) AND public.is_campaign_gm(c.id)))));

DROP POLICY IF EXISTS "reveal: gm grants" ON public.disposition_reveals;
CREATE POLICY "reveal: gm grants" ON public.disposition_reveals FOR INSERT TO authenticated WITH CHECK (((revealed_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (public.characters ch
     JOIN public.campaigns c ON ((c.id = ch.campaign_id)))
  WHERE ((ch.profile_id = disposition_reveals.profile_id) AND public.is_campaign_gm(c.id))))));

DROP POLICY IF EXISTS "reveal: gm reads" ON public.disposition_reveals;
CREATE POLICY "reveal: gm reads" ON public.disposition_reveals FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.characters ch
     JOIN public.campaigns c ON ((c.id = ch.campaign_id)))
  WHERE ((ch.profile_id = disposition_reveals.profile_id) AND public.is_campaign_gm(c.id)))));

DROP POLICY IF EXISTS "reveal: gm revokes" ON public.disposition_reveals;
CREATE POLICY "reveal: gm revokes" ON public.disposition_reveals FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.characters ch
     JOIN public.campaigns c ON ((c.id = ch.campaign_id)))
  WHERE ((ch.profile_id = disposition_reveals.profile_id) AND public.is_campaign_gm(c.id)))));

DROP POLICY IF EXISTS "reveal: player reads own" ON public.disposition_reveals;
CREATE POLICY "reveal: player reads own" ON public.disposition_reveals FOR SELECT TO authenticated USING ((profile_id = auth.uid()));

ALTER TABLE public.roll_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roll_tables_gm ON public.roll_tables;
CREATE POLICY roll_tables_gm ON public.roll_tables USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS roll_tables_player_read ON public.roll_tables;
CREATE POLICY roll_tables_player_read ON public.roll_tables FOR SELECT USING ((players_can_roll AND public.tabletop_is_player(campaign_id)));

ALTER TABLE public.scene_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "see relevant memberships" ON public.memberships;
CREATE POLICY "see relevant memberships" ON public.memberships FOR SELECT TO authenticated USING (((profile_id = auth.uid()) OR public.is_campaign_member(campaign_id)));

DROP POLICY IF EXISTS "self or gm reads vibe" ON public.vibe_checks;
CREATE POLICY "self or gm reads vibe" ON public.vibe_checks FOR SELECT TO authenticated USING (((profile_id = auth.uid()) OR public.is_campaign_gm(campaign_id)));

DROP POLICY IF EXISTS "self updates vibe" ON public.vibe_checks;
CREATE POLICY "self updates vibe" ON public.vibe_checks FOR UPDATE TO authenticated USING ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "self writes own disposition" ON public.dispositions;
CREATE POLICY "self writes own disposition" ON public.dispositions FOR INSERT TO authenticated WITH CHECK ((profile_id = auth.uid()));

DROP POLICY IF EXISTS "self writes vibe" ON public.vibe_checks;
CREATE POLICY "self writes vibe" ON public.vibe_checks FOR INSERT TO authenticated WITH CHECK (((profile_id = auth.uid()) AND public.is_campaign_member(campaign_id)));

ALTER TABLE public.session_plan_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.session_polls ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.species ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.species_variants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stat_blocks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.storage_purge_queue ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS threads_delete_own ON public.threads;
CREATE POLICY threads_delete_own ON public.threads FOR DELETE USING ((profile_id = auth.uid()));

DROP POLICY IF EXISTS threads_insert_own ON public.threads;
CREATE POLICY threads_insert_own ON public.threads FOR INSERT WITH CHECK ((profile_id = auth.uid()));

DROP POLICY IF EXISTS threads_select_own ON public.threads;
CREATE POLICY threads_select_own ON public.threads FOR SELECT USING ((profile_id = auth.uid()));

DROP POLICY IF EXISTS threads_update_own ON public.threads;
CREATE POLICY threads_update_own ON public.threads FOR UPDATE USING ((profile_id = auth.uid())) WITH CHECK ((profile_id = auth.uid()));

ALTER TABLE public.tool_render_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tpdi_responses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid()));

DROP POLICY IF EXISTS "update own responses" ON public.tpdi_responses;
CREATE POLICY "update own responses" ON public.tpdi_responses FOR UPDATE TO anon, authenticated USING ((respondent_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((respondent_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vibe_checks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vtt_audio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_audio_gm_read ON public.vtt_audio;
CREATE POLICY vtt_audio_gm_read ON public.vtt_audio FOR SELECT USING (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS vtt_audio_player_read ON public.vtt_audio;
CREATE POLICY vtt_audio_player_read ON public.vtt_audio FOR SELECT USING (public.tabletop_is_player(campaign_id));

ALTER TABLE public.vtt_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_cards_gm ON public.vtt_cards;
CREATE POLICY vtt_cards_gm ON public.vtt_cards USING (public.is_campaign_gm(campaign_id)) WITH CHECK ((public.is_campaign_gm(campaign_id) AND (EXISTS ( SELECT 1
   FROM public.vtt_decks d
  WHERE ((d.id = vtt_cards.deck_id) AND (d.campaign_id = vtt_cards.campaign_id))))));

ALTER TABLE public.vtt_decks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_decks_gm ON public.vtt_decks;
CREATE POLICY vtt_decks_gm ON public.vtt_decks USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.vtt_drawings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_drawings_gm ON public.vtt_drawings;
CREATE POLICY vtt_drawings_gm ON public.vtt_drawings USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS vtt_drawings_player_delete ON public.vtt_drawings;
CREATE POLICY vtt_drawings_player_delete ON public.vtt_drawings FOR DELETE USING (((owner = auth.uid()) AND public.tabletop_is_player(campaign_id)));

DROP POLICY IF EXISTS vtt_drawings_player_insert ON public.vtt_drawings;
CREATE POLICY vtt_drawings_player_insert ON public.vtt_drawings FOR INSERT WITH CHECK (((owner = auth.uid()) AND (layer = 'table'::text) AND public.tabletop_is_player(campaign_id) AND (scene_id = public.tabletop_scene_for(campaign_id, auth.uid()))));

DROP POLICY IF EXISTS vtt_drawings_player_read ON public.vtt_drawings;
CREATE POLICY vtt_drawings_player_read ON public.vtt_drawings FOR SELECT USING (((layer = 'table'::text) AND public.tabletop_is_player(campaign_id) AND (scene_id = public.tabletop_scene_for(campaign_id, auth.uid()))));

DROP POLICY IF EXISTS vtt_drawings_player_update ON public.vtt_drawings;
CREATE POLICY vtt_drawings_player_update ON public.vtt_drawings FOR UPDATE USING (((owner = auth.uid()) AND (layer = 'table'::text) AND public.tabletop_is_player(campaign_id))) WITH CHECK (((owner = auth.uid()) AND (layer = 'table'::text) AND public.tabletop_is_player(campaign_id)));

ALTER TABLE public.vtt_effects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_effects_gm ON public.vtt_effects;
CREATE POLICY vtt_effects_gm ON public.vtt_effects USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS vtt_effects_player_delete ON public.vtt_effects;
CREATE POLICY vtt_effects_player_delete ON public.vtt_effects FOR DELETE USING (((owner = auth.uid()) AND public.tabletop_is_player(campaign_id)));

DROP POLICY IF EXISTS vtt_effects_player_insert ON public.vtt_effects;
CREATE POLICY vtt_effects_player_insert ON public.vtt_effects FOR INSERT WITH CHECK (((owner = auth.uid()) AND public.tabletop_is_player(campaign_id) AND public.tabletop_token_seen(token_id) AND (scene_id = ( SELECT t.scene_id
   FROM public.vtt_tokens t
  WHERE (t.id = vtt_effects.token_id)))));

DROP POLICY IF EXISTS vtt_effects_player_read ON public.vtt_effects;
CREATE POLICY vtt_effects_player_read ON public.vtt_effects FOR SELECT USING ((public.tabletop_is_player(campaign_id) AND public.tabletop_token_seen(token_id)));

ALTER TABLE public.vtt_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vtt_handouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_handouts_gm ON public.vtt_handouts;
CREATE POLICY vtt_handouts_gm ON public.vtt_handouts USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.vtt_ingest_keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vtt_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_messages_gm_delete ON public.vtt_messages;
CREATE POLICY vtt_messages_gm_delete ON public.vtt_messages FOR DELETE USING (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS vtt_messages_read ON public.vtt_messages;
CREATE POLICY vtt_messages_read ON public.vtt_messages FOR SELECT USING (((author_profile = auth.uid()) OR ((whisper_to IS NOT NULL) AND (auth.uid() = ANY (whisper_to))) OR ((whisper_to IS NULL) AND public.is_campaign_gm(campaign_id)) OR ((whisper_to IS NULL) AND (NOT gm_only) AND public.tabletop_is_player(campaign_id))));

ALTER TABLE public.vtt_name_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vtt_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_pins_gm ON public.vtt_pins;
CREATE POLICY vtt_pins_gm ON public.vtt_pins USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.vtt_scene_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_scene_players_gm ON public.vtt_scene_players;
CREATE POLICY vtt_scene_players_gm ON public.vtt_scene_players USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS vtt_scene_players_own ON public.vtt_scene_players;
CREATE POLICY vtt_scene_players_own ON public.vtt_scene_players FOR SELECT USING ((profile_id = auth.uid()));

ALTER TABLE public.vtt_scenes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_scenes_gm ON public.vtt_scenes;
CREATE POLICY vtt_scenes_gm ON public.vtt_scenes USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS vtt_scenes_player_read ON public.vtt_scenes;
CREATE POLICY vtt_scenes_player_read ON public.vtt_scenes FOR SELECT USING ((public.tabletop_is_player(campaign_id) AND (id = public.tabletop_scene_for(campaign_id, auth.uid()))));

ALTER TABLE public.vtt_sounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_sounds_gm ON public.vtt_sounds;
CREATE POLICY vtt_sounds_gm ON public.vtt_sounds USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.vtt_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_templates_gm ON public.vtt_templates;
CREATE POLICY vtt_templates_gm ON public.vtt_templates USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS vtt_templates_player_delete ON public.vtt_templates;
CREATE POLICY vtt_templates_player_delete ON public.vtt_templates FOR DELETE USING (((owner = auth.uid()) AND public.tabletop_is_player(campaign_id)));

DROP POLICY IF EXISTS vtt_templates_player_insert ON public.vtt_templates;
CREATE POLICY vtt_templates_player_insert ON public.vtt_templates FOR INSERT WITH CHECK (((owner = auth.uid()) AND public.tabletop_is_player(campaign_id) AND (scene_id = public.tabletop_scene_for(campaign_id, auth.uid()))));

DROP POLICY IF EXISTS vtt_templates_player_read ON public.vtt_templates;
CREATE POLICY vtt_templates_player_read ON public.vtt_templates FOR SELECT USING ((public.tabletop_is_player(campaign_id) AND (scene_id = public.tabletop_scene_for(campaign_id, auth.uid()))));

DROP POLICY IF EXISTS vtt_templates_player_update ON public.vtt_templates;
CREATE POLICY vtt_templates_player_update ON public.vtt_templates FOR UPDATE USING (((owner = auth.uid()) AND public.tabletop_is_player(campaign_id))) WITH CHECK (((owner = auth.uid()) AND public.tabletop_is_player(campaign_id) AND (scene_id = public.tabletop_scene_for(campaign_id, auth.uid()))));

ALTER TABLE public.vtt_token_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_token_notes_gm ON public.vtt_token_notes;
CREATE POLICY vtt_token_notes_gm ON public.vtt_token_notes USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

ALTER TABLE public.vtt_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vtt_tokens_gm ON public.vtt_tokens;
CREATE POLICY vtt_tokens_gm ON public.vtt_tokens USING (public.is_campaign_gm(campaign_id)) WITH CHECK (public.is_campaign_gm(campaign_id));

DROP POLICY IF EXISTS vtt_tokens_player_read ON public.vtt_tokens;
CREATE POLICY vtt_tokens_player_read ON public.vtt_tokens FOR SELECT USING ((public.tabletop_is_player(campaign_id) AND (NOT hidden) AND (layer <> 'gm'::text) AND (scene_id = public.tabletop_scene_for(campaign_id, auth.uid())) AND public.tabletop_token_visible(scene_id, x, y, character_id, controlled_by)));

ALTER TABLE public.world_hexes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "world_hexes gm all" ON public.world_hexes;
CREATE POLICY "world_hexes gm all" ON public.world_hexes USING ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = world_hexes.world_map_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.world_maps wm
     JOIN public.campaigns c ON ((c.id = wm.campaign_id)))
  WHERE ((wm.id = world_hexes.world_map_id) AND public.is_campaign_gm(c.id)))));

ALTER TABLE public.world_maps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "world_maps gm all" ON public.world_maps;
CREATE POLICY "world_maps gm all" ON public.world_maps USING ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = world_maps.campaign_id) AND public.is_campaign_gm(c.id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.campaigns c
  WHERE ((c.id = world_maps.campaign_id) AND public.is_campaign_gm(c.id)))));

REVOKE ALL ON FUNCTION public.accept_campaign_transfer(p_token text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.accept_campaign_transfer(p_token text) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_gm_invite(p_token uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.accept_gm_invite(p_token uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_terms(p_version text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.accept_terms(p_version text) TO authenticated;

REVOKE ALL ON FUNCTION public.activity_call(p_profile uuid, p_fn text, p_args jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.activity_call(p_profile uuid, p_fn text, p_args jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.activity_identity(p_discord text, p_guild text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.activity_identity(p_discord text, p_guild text) TO service_role;

REVOKE ALL ON FUNCTION public.activity_watch_profile(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.activity_watch_profile(p_campaign uuid) TO service_role;

REVOKE ALL ON FUNCTION public.addon_hooks_follow_gms() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.addon_hooks_follow_owner() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.addon_hooks_prune(p_campaign uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.ask_campaign_search(p_campaign uuid, p_terms text[], p_limit integer, p_recent integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.ask_campaign_search(p_campaign uuid, p_terms text[], p_limit integer, p_recent integer) TO authenticated;

GRANT ALL ON FUNCTION public.ask_campaign_search(p_campaign uuid, p_terms text[], p_limit integer, p_recent integer) TO service_role;

REVOKE ALL ON FUNCTION public.calendar_feed(p_token uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.calendar_feed(p_token uuid) TO anon;

GRANT ALL ON FUNCTION public.calendar_feed(p_token uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.campaign_event_counts(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.campaign_event_counts(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.campaign_gm_ids(p_campaign uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.campaign_gm_of(p_campaign uuid, p_uid uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.campaign_gms(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.campaign_gms(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.campaign_player_ids(p_campaign uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.campaign_transfer_info(p_token text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.campaign_transfer_info(p_token text) TO authenticated;

REVOKE ALL ON FUNCTION public.campaign_usage_summary(p_campaign uuid, p_since timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION public.campaign_usage_summary(p_campaign uuid, p_since timestamp with time zone) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_campaign_transfer(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.cancel_campaign_transfer(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.character_campaign_public(p_character uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.character_campaign_public(p_character uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_by_discord() FROM PUBLIC;

GRANT ALL ON FUNCTION public.claim_by_discord() TO authenticated;

REVOKE ALL ON FUNCTION public.combat_apply_outside_roll(p_combat uuid, p_target text, p_events uuid[], p_half boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.combat_apply_outside_roll(p_combat uuid, p_target text, p_events uuid[], p_half boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.combat_bump_version() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.combat_calibration() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_discord_setup_code(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_discord_setup_code(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_gm_invite(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.create_gm_invite(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;

GRANT ALL ON FUNCTION public.delete_my_account() TO authenticated;

REVOKE ALL ON FUNCTION public.digest_batch(p_limit integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.digest_batch(p_limit integer) TO service_role;

REVOKE ALL ON FUNCTION public.discord_claim_allowed(p_owner uuid, p_campaign uuid, p_discord text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.discord_claim_allowed(p_owner uuid, p_campaign uuid, p_discord text) TO service_role;

REVOKE ALL ON FUNCTION public.discord_setup_resolve(p_code text, p_discord text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.discord_setup_resolve(p_code text, p_discord text) TO service_role;

REVOKE ALL ON FUNCTION public.export_my_data() FROM PUBLIC;

GRANT ALL ON FUNCTION public.export_my_data() TO authenticated;

REVOKE ALL ON FUNCTION public.forge_access(p_kind text, p_id uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.forge_access(p_kind text, p_id uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.gm_invite_preview(p_token uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.gm_invite_preview(p_token uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.gm_invites_open(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.gm_invites_open(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.initiative_my_characters(p_share text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.initiative_my_characters(p_share text) TO authenticated;

REVOKE ALL ON FUNCTION public.my_calendar_token() FROM PUBLIC;

GRANT ALL ON FUNCTION public.my_calendar_token() TO authenticated;

REVOKE ALL ON FUNCTION public.my_campaign_transfer(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.my_campaign_transfer(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.my_email_prefs() FROM PUBLIC;

GRANT ALL ON FUNCTION public.my_email_prefs() TO authenticated;

REVOKE ALL ON FUNCTION public.my_next_sessions() FROM PUBLIC;

GRANT ALL ON FUNCTION public.my_next_sessions() TO authenticated;

REVOKE ALL ON FUNCTION public.my_recording_consents() FROM PUBLIC;

GRANT ALL ON FUNCTION public.my_recording_consents() TO authenticated;

REVOKE ALL ON FUNCTION public.my_terms() FROM PUBLIC;

GRANT ALL ON FUNCTION public.my_terms() TO authenticated;

REVOKE ALL ON FUNCTION public.my_trashed_campaigns() FROM PUBLIC;

GRANT ALL ON FUNCTION public.my_trashed_campaigns() TO authenticated;

REVOKE ALL ON FUNCTION public.notify(p_to uuid[], p_campaign uuid, p_kind text, p_title text, p_link text, p_data jsonb, p_key text, p_actor uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.notify_on_cogm() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.notify_on_job() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.notify_on_join() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.notify_on_recap_send() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.notify_on_rsvp() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.notify_on_session() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.notify_session_label(p_number integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.offer_campaign_transfer(p_campaign uuid, p_email text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.offer_campaign_transfer(p_campaign uuid, p_email text) TO authenticated;

REVOKE ALL ON FUNCTION public.prune_growing_tables() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.public_campaign_theme(p_slug text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.public_campaign_theme(p_slug text) TO anon;

GRANT ALL ON FUNCTION public.public_campaign_theme(p_slug text) TO authenticated;

REVOKE ALL ON FUNCTION public.rate_hit(p_bucket text, p_key text, p_max integer, p_window_seconds integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.rate_hit(p_bucket text, p_key text, p_max integer, p_window_seconds integer) TO service_role;

REVOKE ALL ON FUNCTION public.remove_campaign_gm(p_campaign uuid, p_profile uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.remove_campaign_gm(p_campaign uuid, p_profile uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.reset_my_calendar_token() FROM PUBLIC;

GRANT ALL ON FUNCTION public.reset_my_calendar_token() TO authenticated;

REVOKE ALL ON FUNCTION public.restore_campaign(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.restore_campaign(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.restore_scene_snapshot(p_snapshot uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.restore_scene_snapshot(p_snapshot uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_gm_invite(p_invite uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.revoke_gm_invite(p_invite uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.scene_snapshot_take(p_scene uuid, p_label text, p_session uuid, p_by uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.scene_snapshots_for(p_scene uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.scene_snapshots_for(p_scene uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.set_my_email_digest(p_on boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_my_email_digest(p_on boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.set_my_email_prefs(p_reminders boolean, p_recaps boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_my_email_prefs(p_reminders boolean, p_recaps boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.set_my_recording_consent(p_campaign uuid, p_consented boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION public.set_my_recording_consent(p_campaign uuid, p_consented boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.snapshot_campaign_scenes_at_close(p_campaign uuid, p_session uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.snapshot_campaign_scenes_at_close(p_campaign uuid, p_session uuid) TO service_role;

REVOKE ALL ON FUNCTION public.snapshot_scene(p_scene uuid, p_label text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.snapshot_scene(p_scene uuid, p_label text) TO authenticated;

REVOKE ALL ON FUNCTION public.sync_my_email() FROM PUBLIC;

GRANT ALL ON FUNCTION public.sync_my_email() TO authenticated;

GRANT ALL ON TABLE public.vtt_cards TO service_role;

GRANT ALL ON TABLE public.vtt_cards TO authenticated;

REVOKE ALL ON FUNCTION public.tabletop_card_json(c public.vtt_cards, p_show boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.tabletop_card_move(p_card uuid, p_to text, p_face_up boolean, p_holder uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.tabletop_card_move(p_card uuid, p_to text, p_face_up boolean, p_holder uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.tabletop_card_use(p_card uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.tabletop_card_use(p_card uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.tabletop_cards_to_hand(p_deck uuid, p_to uuid, p_count integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.tabletop_feed(p_campaign uuid, p_since timestamp with time zone, p_limit integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.tabletop_feed(p_campaign uuid, p_since timestamp with time zone, p_limit integer) TO authenticated;

REVOKE ALL ON FUNCTION public.tabletop_feed_signal() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.tabletop_gm_ids(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.tabletop_gm_ids(p_campaign uuid) TO authenticated;

GRANT ALL ON TABLE public.battle_maps TO service_role;

GRANT ALL ON TABLE public.battle_maps TO anon;

GRANT ALL ON TABLE public.battle_maps TO authenticated;

REVOKE ALL ON FUNCTION public.tabletop_open_session(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.tabletop_open_session(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.tabletop_set_initiative(p_campaign uuid, p_character uuid, p_total integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.tabletop_set_initiative(p_campaign uuid, p_character uuid, p_total integer) TO service_role;

REVOKE ALL ON FUNCTION public.tabletop_system(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.tabletop_system(p_campaign uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.tabletop_topic_ok(p_topic text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.tabletop_topic_ok(p_topic text) TO authenticated;

REVOKE ALL ON FUNCTION public.tool_render_reserve(p_tool text, p_ip text, p_global integer, p_per_ip integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.tool_render_reserve(p_tool text, p_ip text, p_global integer, p_per_ip integer) TO service_role;

REVOKE ALL ON FUNCTION public.trash_campaign(p_campaign uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.trash_campaign(p_campaign uuid) TO authenticated;

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE ON TABLE public.profiles TO anon;

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE ON TABLE public.profiles TO authenticated;

GRANT ALL ON TABLE public.profiles TO service_role;

GRANT UPDATE(display_name) ON TABLE public.profiles TO authenticated;

GRANT SELECT(access_granted) ON TABLE public.profiles TO authenticated;

GRANT SELECT(access_role) ON TABLE public.profiles TO authenticated;

REVOKE ALL ON FUNCTION public.usage_by_campaign(p_since timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.vtt_same_campaign() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.world_calendar_reshape(p_campaign uuid, p_calendar jsonb, p_day integer, p_moves jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.world_calendar_reshape(p_campaign uuid, p_calendar jsonb, p_day integer, p_moves jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.world_map_poi_detail_for_player(p_share text, p_poi uuid) FROM PUBLIC;

GRANT ALL ON FUNCTION public.world_map_poi_detail_for_player(p_share text, p_poi uuid) TO anon;

GRANT ALL ON FUNCTION public.world_map_poi_detail_for_player(p_share text, p_poi uuid) TO authenticated;

GRANT SELECT,INSERT ON TABLE public._migrations TO service_role;

GRANT ALL ON TABLE public.addon_hooks TO authenticated;

GRANT ALL ON TABLE public.addon_hooks TO service_role;

GRANT ALL ON TABLE public.addon_keys TO authenticated;

GRANT ALL ON TABLE public.addon_keys TO service_role;

GRANT ALL ON TABLE public.addon_outbox TO service_role;

GRANT ALL ON TABLE public.ai_map_renders TO anon;

GRANT ALL ON TABLE public.ai_map_renders TO authenticated;

GRANT ALL ON TABLE public.ai_map_renders TO service_role;

GRANT ALL ON TABLE public.arc_touches TO anon;

GRANT ALL ON TABLE public.arc_touches TO authenticated;

GRANT ALL ON TABLE public.arc_touches TO service_role;

GRANT ALL ON TABLE public.arcs TO service_role;

GRANT ALL ON TABLE public.arcs TO anon;

GRANT ALL ON TABLE public.arcs TO authenticated;

GRANT ALL ON TABLE public.attendance TO service_role;

GRANT ALL ON TABLE public.attendance TO anon;

GRANT ALL ON TABLE public.attendance TO authenticated;

GRANT ALL ON TABLE public.audio_tracks TO authenticated;

GRANT ALL ON TABLE public.audio_tracks TO service_role;

GRANT ALL ON TABLE public.audio_tracks TO anon;

GRANT ALL ON TABLE public.bastion_maps TO service_role;

GRANT ALL ON TABLE public.bastion_maps TO authenticated;

GRANT ALL ON TABLE public.bastion_maps TO anon;

GRANT ALL ON TABLE public.biomes TO anon;

GRANT ALL ON TABLE public.biomes TO service_role;

GRANT ALL ON TABLE public.biomes TO authenticated;

GRANT ALL ON TABLE public.building_maps TO authenticated;

GRANT ALL ON TABLE public.building_maps TO anon;

GRANT ALL ON TABLE public.building_maps TO service_role;

GRANT ALL ON TABLE public.campaign_journals TO authenticated;

GRANT ALL ON TABLE public.campaign_journals TO anon;

GRANT ALL ON TABLE public.campaign_journals TO service_role;

GRANT ALL ON TABLE public.campaigns TO anon;

GRANT ALL ON TABLE public.campaigns TO service_role;

GRANT ALL ON TABLE public.campaigns TO authenticated;

GRANT ALL ON TABLE public.capture_control TO anon;

GRANT ALL ON TABLE public.capture_control TO authenticated;

GRANT ALL ON TABLE public.capture_control TO service_role;

GRANT ALL ON TABLE public.capture_jobs TO service_role;

GRANT ALL ON TABLE public.capture_jobs TO authenticated;

GRANT ALL ON TABLE public.capture_jobs TO anon;

GRANT ALL ON TABLE public.character_identities TO anon;

GRANT ALL ON TABLE public.character_identities TO authenticated;

GRANT ALL ON TABLE public.character_identities TO service_role;

GRANT ALL ON TABLE public.character_wiki_gm_edit TO service_role;

GRANT ALL ON TABLE public.character_wiki_gm_edit TO authenticated;

GRANT ALL ON TABLE public.character_wiki_gm_edit TO anon;

GRANT ALL ON TABLE public.character_wiki_sections TO service_role;

GRANT ALL ON TABLE public.character_wiki_sections TO authenticated;

GRANT ALL ON TABLE public.character_wiki_sections TO anon;

GRANT ALL ON TABLE public.characters TO authenticated;

GRANT ALL ON TABLE public.characters TO anon;

GRANT ALL ON TABLE public.characters TO service_role;

GRANT ALL ON TABLE public.chat_grants TO service_role;

GRANT ALL ON TABLE public.chat_grants TO anon;

GRANT ALL ON TABLE public.chat_grants TO authenticated;

GRANT ALL ON TABLE public.chat_messages TO service_role;

GRANT ALL ON TABLE public.chat_messages TO anon;

GRANT ALL ON TABLE public.chat_messages TO authenticated;

GRANT ALL ON TABLE public.class_capabilities TO anon;

GRANT ALL ON TABLE public.class_capabilities TO authenticated;

GRANT ALL ON TABLE public.class_capabilities TO service_role;

GRANT SELECT ON TABLE public.classes TO authenticated;

GRANT SELECT ON TABLE public.classes TO anon;

GRANT ALL ON TABLE public.classes TO service_role;

GRANT ALL ON TABLE public.combats TO service_role;

GRANT ALL ON TABLE public.combats TO authenticated;

GRANT ALL ON TABLE public.combats TO anon;

GRANT ALL ON TABLE public.compendium_entries TO anon;

GRANT ALL ON TABLE public.compendium_entries TO service_role;

GRANT ALL ON TABLE public.compendium_entries TO authenticated;

GRANT ALL ON TABLE public.disposition_reveals TO service_role;

GRANT ALL ON TABLE public.disposition_reveals TO anon;

GRANT ALL ON TABLE public.disposition_reveals TO authenticated;

GRANT ALL ON TABLE public.disposition_runs TO authenticated;

GRANT ALL ON TABLE public.disposition_runs TO service_role;

GRANT ALL ON TABLE public.disposition_runs TO anon;

GRANT ALL ON TABLE public.dispositions TO authenticated;

GRANT ALL ON TABLE public.dispositions TO service_role;

GRANT ALL ON TABLE public.dispositions TO anon;

GRANT ALL ON TABLE public.dm_boards TO anon;

GRANT ALL ON TABLE public.dm_boards TO service_role;

GRANT ALL ON TABLE public.dm_boards TO authenticated;

GRANT ALL ON TABLE public.dungeon_maps TO anon;

GRANT ALL ON TABLE public.dungeon_maps TO service_role;

GRANT ALL ON TABLE public.dungeon_maps TO authenticated;

GRANT SELECT,INSERT,UPDATE ON TABLE public.email_prefs TO service_role;

GRANT ALL ON TABLE public.encounters TO authenticated;

GRANT ALL ON TABLE public.encounters TO service_role;

GRANT ALL ON TABLE public.encounters TO anon;

GRANT ALL ON TABLE public.entity_links TO anon;

GRANT ALL ON TABLE public.entity_links TO service_role;

GRANT ALL ON TABLE public.entity_links TO authenticated;

GRANT ALL ON TABLE public.entries TO service_role;

GRANT ALL ON TABLE public.entries TO anon;

GRANT ALL ON TABLE public.entries TO authenticated;

GRANT ALL ON TABLE public.entry_reveals TO anon;

GRANT ALL ON TABLE public.entry_reveals TO service_role;

GRANT ALL ON TABLE public.entry_reveals TO authenticated;

GRANT ALL ON TABLE public.event_types TO service_role;

GRANT ALL ON TABLE public.event_types TO authenticated;

GRANT ALL ON TABLE public.event_types TO anon;

GRANT ALL ON TABLE public.events TO service_role;

GRANT ALL ON TABLE public.events TO authenticated;

GRANT ALL ON TABLE public.events TO anon;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.gm_card_decks TO authenticated;

GRANT ALL ON TABLE public.gm_event_kinds TO service_role;

GRANT ALL ON TABLE public.gm_event_kinds TO anon;

GRANT ALL ON TABLE public.gm_event_kinds TO authenticated;

GRANT ALL ON TABLE public.gm_events TO anon;

GRANT ALL ON TABLE public.gm_events TO service_role;

GRANT ALL ON TABLE public.gm_events TO authenticated;

GRANT ALL ON TABLE public.gm_identities TO authenticated;

GRANT ALL ON TABLE public.gm_identities TO service_role;

GRANT ALL ON TABLE public.gm_identities TO anon;

GRANT ALL ON TABLE public.gm_proposed_events TO service_role;

GRANT ALL ON TABLE public.gm_proposed_events TO authenticated;

GRANT ALL ON TABLE public.gm_proposed_events TO anon;

GRANT ALL ON TABLE public.import_candidates TO anon;

GRANT ALL ON TABLE public.import_candidates TO service_role;

GRANT ALL ON TABLE public.import_candidates TO authenticated;

GRANT ALL ON TABLE public.import_jobs TO anon;

GRANT ALL ON TABLE public.import_jobs TO authenticated;

GRANT ALL ON TABLE public.import_jobs TO service_role;

GRANT ALL ON TABLE public.import_sessions TO authenticated;

GRANT ALL ON TABLE public.import_sessions TO anon;

GRANT ALL ON TABLE public.import_sessions TO service_role;

GRANT ALL ON TABLE public.loot_grants TO authenticated;

GRANT ALL ON TABLE public.loot_grants TO anon;

GRANT ALL ON TABLE public.loot_grants TO service_role;

GRANT ALL ON TABLE public.lore_backup TO service_role;

GRANT ALL ON TABLE public.lore_backup TO authenticated;

GRANT ALL ON TABLE public.lore_backup TO anon;

GRANT ALL ON TABLE public.map_features TO service_role;

GRANT ALL ON TABLE public.map_features TO authenticated;

GRANT ALL ON TABLE public.map_features TO anon;

GRANT ALL ON TABLE public.map_fog TO service_role;

GRANT ALL ON TABLE public.map_fog TO authenticated;

GRANT ALL ON TABLE public.map_fog TO anon;

GRANT ALL ON TABLE public.map_icons TO service_role;

GRANT ALL ON TABLE public.map_icons TO anon;

GRANT ALL ON TABLE public.map_icons TO authenticated;

GRANT ALL ON TABLE public.map_images TO service_role;

GRANT ALL ON TABLE public.map_images TO anon;

GRANT ALL ON TABLE public.map_images TO authenticated;

GRANT ALL ON TABLE public.map_labels TO service_role;

GRANT ALL ON TABLE public.map_labels TO authenticated;

GRANT ALL ON TABLE public.map_labels TO anon;

GRANT ALL ON TABLE public.map_layers TO anon;

GRANT ALL ON TABLE public.map_layers TO service_role;

GRANT ALL ON TABLE public.map_layers TO authenticated;

GRANT ALL ON TABLE public.map_pins TO service_role;

GRANT ALL ON TABLE public.map_pins TO authenticated;

GRANT ALL ON TABLE public.map_pins TO anon;

GRANT ALL ON TABLE public.map_pois TO service_role;

GRANT ALL ON TABLE public.map_pois TO authenticated;

GRANT ALL ON TABLE public.map_pois TO anon;

GRANT ALL ON TABLE public.maps TO anon;

GRANT ALL ON TABLE public.maps TO authenticated;

GRANT ALL ON TABLE public.maps TO service_role;

GRANT ALL ON TABLE public.memberships TO anon;

GRANT ALL ON TABLE public.memberships TO service_role;

GRANT ALL ON TABLE public.memberships TO authenticated;

GRANT SELECT,DELETE ON TABLE public.notifications TO authenticated;

GRANT SELECT,DELETE,UPDATE ON TABLE public.notifications TO service_role;

GRANT UPDATE(read_at) ON TABLE public.notifications TO authenticated;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE ON TABLE public.party_funds TO authenticated;

GRANT ALL ON TABLE public.party_funds TO anon;

GRANT ALL ON TABLE public.party_funds TO service_role;

GRANT ALL ON TABLE public.party_items TO authenticated;

GRANT ALL ON TABLE public.party_items TO service_role;

GRANT ALL ON TABLE public.party_items TO anon;

GRANT ALL ON TABLE public.pc_library TO anon;

GRANT ALL ON TABLE public.pc_library TO service_role;

GRANT ALL ON TABLE public.pc_library TO authenticated;

GRANT ALL ON TABLE public.player_notes TO authenticated;

GRANT ALL ON TABLE public.player_notes TO service_role;

GRANT ALL ON TABLE public.player_notes TO anon;

GRANT ALL ON TABLE public.poll_responses TO anon;

GRANT ALL ON TABLE public.poll_responses TO authenticated;

GRANT ALL ON TABLE public.poll_responses TO service_role;

GRANT ALL ON TABLE public.profiles_public TO service_role;

GRANT SELECT ON TABLE public.profiles_public TO authenticated;

GRANT ALL ON TABLE public.proposed_events TO anon;

GRANT ALL ON TABLE public.proposed_events TO authenticated;

GRANT ALL ON TABLE public.proposed_events TO service_role;

GRANT SELECT,INSERT ON TABLE public.recap_sends TO service_role;

GRANT ALL ON TABLE public.recodings TO authenticated;

GRANT ALL ON TABLE public.recodings TO service_role;

GRANT ALL ON TABLE public.recodings TO anon;

GRANT ALL ON TABLE public.recording_consents TO anon;

GRANT ALL ON TABLE public.recording_consents TO service_role;

GRANT ALL ON TABLE public.recording_consents TO authenticated;

GRANT ALL ON TABLE public.regions TO service_role;

GRANT ALL ON TABLE public.regions TO anon;

GRANT ALL ON TABLE public.regions TO authenticated;

GRANT ALL ON TABLE public.roll_tables TO authenticated;

GRANT ALL ON TABLE public.roll_tables TO service_role;

GRANT SELECT ON TABLE public.scene_snapshots TO authenticated;

GRANT ALL ON TABLE public.session_plan_items TO service_role;

GRANT ALL ON TABLE public.session_plan_items TO anon;

GRANT ALL ON TABLE public.session_plan_items TO authenticated;

GRANT ALL ON TABLE public.session_polls TO authenticated;

GRANT ALL ON TABLE public.session_polls TO anon;

GRANT ALL ON TABLE public.session_polls TO service_role;

GRANT ALL ON TABLE public.sessions TO anon;

GRANT ALL ON TABLE public.sessions TO authenticated;

GRANT ALL ON TABLE public.sessions TO service_role;

GRANT ALL ON TABLE public.species TO service_role;

GRANT SELECT ON TABLE public.species TO authenticated;

GRANT SELECT ON TABLE public.species TO anon;

GRANT SELECT ON TABLE public.species_variants TO anon;

GRANT ALL ON TABLE public.species_variants TO service_role;

GRANT SELECT ON TABLE public.species_variants TO authenticated;

GRANT ALL ON TABLE public.stat_blocks TO anon;

GRANT ALL ON TABLE public.stat_blocks TO service_role;

GRANT ALL ON TABLE public.stat_blocks TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.storage_purge_queue TO service_role;

GRANT ALL ON TABLE public.threads TO authenticated;

GRANT ALL ON TABLE public.threads TO service_role;

GRANT ALL ON TABLE public.threads TO anon;

GRANT ALL ON TABLE public.tool_render_log TO authenticated;

GRANT ALL ON TABLE public.tool_render_log TO service_role;

GRANT ALL ON TABLE public.tool_render_log TO anon;

GRANT ALL ON TABLE public.tpdi_responses TO anon;

GRANT ALL ON TABLE public.tpdi_responses TO service_role;

GRANT ALL ON TABLE public.tpdi_responses TO authenticated;

GRANT ALL ON TABLE public.transcript_segments TO anon;

GRANT ALL ON TABLE public.transcript_segments TO service_role;

GRANT ALL ON TABLE public.transcript_segments TO authenticated;

GRANT SELECT ON TABLE public.usage_events TO authenticated;

GRANT SELECT ON TABLE public.v_arc_freshness TO authenticated;

GRANT ALL ON TABLE public.v_arc_freshness TO service_role;

GRANT ALL ON TABLE public.v_audio_due_for_purge TO service_role;

GRANT ALL ON TABLE public.v_campaign_audio_retention TO authenticated;

GRANT ALL ON TABLE public.v_campaign_audio_retention TO service_role;

GRANT ALL ON TABLE public.v_character_catalog_audit TO authenticated;

GRANT ALL ON TABLE public.v_character_catalog_audit TO anon;

GRANT ALL ON TABLE public.v_character_catalog_audit TO service_role;

GRANT ALL ON TABLE public.v_loot_fairness TO service_role;

GRANT SELECT ON TABLE public.v_loot_fairness TO authenticated;

GRANT ALL ON TABLE public.v_session_axis_engagement TO service_role;

GRANT SELECT ON TABLE public.v_session_axis_engagement TO authenticated;

GRANT ALL ON TABLE public.v_session_spotlight TO service_role;

GRANT SELECT ON TABLE public.v_session_spotlight TO authenticated;

GRANT ALL ON TABLE public.v_session_equity TO service_role;

GRANT SELECT ON TABLE public.v_session_equity TO authenticated;

GRANT SELECT ON TABLE public.v_session_gini TO authenticated;

GRANT ALL ON TABLE public.v_session_gini TO service_role;

GRANT ALL ON TABLE public.vibe_checks TO authenticated;

GRANT ALL ON TABLE public.vibe_checks TO anon;

GRANT ALL ON TABLE public.vibe_checks TO service_role;

GRANT ALL ON TABLE public.vtt_audio TO service_role;

GRANT ALL ON TABLE public.vtt_audio TO authenticated;

GRANT ALL ON TABLE public.vtt_decks TO authenticated;

GRANT ALL ON TABLE public.vtt_decks TO service_role;

GRANT ALL ON TABLE public.vtt_drawings TO service_role;

GRANT ALL ON TABLE public.vtt_drawings TO authenticated;

GRANT ALL ON TABLE public.vtt_drawings TO anon;

GRANT ALL ON TABLE public.vtt_effects TO anon;

GRANT ALL ON TABLE public.vtt_effects TO service_role;

GRANT ALL ON TABLE public.vtt_effects TO authenticated;

GRANT ALL ON TABLE public.vtt_events TO anon;

GRANT ALL ON TABLE public.vtt_events TO service_role;

GRANT ALL ON TABLE public.vtt_events TO authenticated;

GRANT ALL ON TABLE public.vtt_handouts TO anon;

GRANT ALL ON TABLE public.vtt_handouts TO service_role;

GRANT ALL ON TABLE public.vtt_handouts TO authenticated;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.vtt_ingest_keys TO service_role;

GRANT ALL ON TABLE public.vtt_messages TO service_role;

GRANT ALL ON TABLE public.vtt_messages TO authenticated;

GRANT ALL ON TABLE public.vtt_messages TO anon;

GRANT SELECT ON TABLE public.vtt_name_links TO authenticated;

GRANT ALL ON TABLE public.vtt_pins TO authenticated;

GRANT ALL ON TABLE public.vtt_pins TO service_role;

GRANT ALL ON TABLE public.vtt_scene_players TO service_role;

GRANT ALL ON TABLE public.vtt_scene_players TO authenticated;

GRANT ALL ON TABLE public.vtt_scene_players TO anon;

GRANT ALL ON TABLE public.vtt_scenes TO service_role;

GRANT ALL ON TABLE public.vtt_scenes TO anon;

GRANT ALL ON TABLE public.vtt_scenes TO authenticated;

GRANT ALL ON TABLE public.vtt_sounds TO service_role;

GRANT ALL ON TABLE public.vtt_sounds TO authenticated;

GRANT ALL ON TABLE public.vtt_templates TO authenticated;

GRANT ALL ON TABLE public.vtt_templates TO anon;

GRANT ALL ON TABLE public.vtt_templates TO service_role;

GRANT ALL ON TABLE public.vtt_token_notes TO service_role;

GRANT ALL ON TABLE public.vtt_token_notes TO authenticated;

GRANT ALL ON TABLE public.vtt_tokens TO service_role;

GRANT ALL ON TABLE public.vtt_tokens TO anon;

GRANT ALL ON TABLE public.vtt_tokens TO authenticated;

GRANT ALL ON TABLE public.world_hexes TO anon;

GRANT ALL ON TABLE public.world_hexes TO authenticated;

GRANT ALL ON TABLE public.world_hexes TO service_role;

GRANT ALL ON TABLE public.world_maps TO authenticated;

GRANT ALL ON TABLE public.world_maps TO anon;

GRANT ALL ON TABLE public.world_maps TO service_role;

-- ================================================================================================
-- 3 realtime: the tables the app listens to (postgres_changes in TabletopClient, map-fog, party
--   stash and the combat page). p105 to p107 added the first ones; the rest were added on the
--   dashboard. Skipped where there is no supabase_realtime publication (a plain PostgreSQL).
-- ================================================================================================

do $pub$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['combats', 'map_fog', 'party_funds', 'party_items', 'vtt_audio', 'vtt_drawings', 'vtt_effects', 'vtt_messages', 'vtt_scene_players', 'vtt_scenes', 'vtt_templates', 'vtt_tokens']
  loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $pub$;

reset check_function_bodies;
reset search_path;
