-- p149-co-gm.sql (2026-11-10, push 18)
--
-- Co-GMs. A campaign's owner (campaigns.gm_id) can invite other accounts to run the campaign with them.
-- A co-GM can do everything the owner can EXCEPT the owner's actions: delete or trash the campaign,
-- hand it over, and add or remove GMs. Terry's call (2026-11-10): co-GM access is campaign-only; it
-- opens /gm for the campaigns they co-GM but does not grant the account-wide GM pilot flag.
--
-- What this does:
--   1. campaign_gm_of(campaign, uid): the per-user form of is_campaign_gm, for definer functions.
--   2. campaign_gm_invites: single-use invite links, 7 days, owner-made. RLS on, no grants: the RPCs
--      below are the only way in.
--   3. RPCs: create_gm_invite, revoke_gm_invite, gm_invites_open, gm_invite_preview, accept_gm_invite,
--      campaign_gms, remove_campaign_gm.
--   4. Guards (CLOSES A HOLE): the memberships update policy lets a member update their OWN row, and
--      nothing stopped a player setting role = 'co-gm' on it, which made them a GM of that campaign
--      through is_campaign_gm. A trigger now lets only the owner add, promote, demote or remove a GM;
--      a GM may still remove themselves. A second trigger stops a co-GM (the campaigns update policy
--      is is_campaign_gm) from changing campaigns.gm_id or deleted_at. Definer functions (handover,
--      trash, restore, these RPCs) run as their owner and pass.
--   5. Policies that said "c.gm_id = auth.uid()" (maps, map layers, dispositions, reveals, gm events,
--      vtt events, storage map images) now say is_campaign_gm(c.id). Done by rewriting the stored
--      policy text with ALTER POLICY, so each keeps its command and roles. Left owner-only on purpose:
--      campaigns (create, delete, read), and the per-account libraries compendium_entries and
--      dm_boards. stat_blocks already allowed is_campaign_gm.
--   6. Functions that compared gm_id to the caller now use the GM check: rsvps_for_gm,
--      can_write_character_portrait, the tabletop seat, name, whisper and floor functions, addon_auth,
--      my_next_sessions, calendar_feed. delete_campaign checked is_campaign_gm, which would have let a
--      co-GM delete the campaign; it is now owner-only.
--
-- Idempotent: create if not exists, create or replace, drop-then-create triggers, and the policy
-- rewrite only touches text that still has the old form. Run supabase\checks\p149-co-gm-check.sql
-- before (to see the hole and any existing GM memberships) and after.

-- 1. -------------------------------------------------------------------------------------------------
create or replace function public.campaign_gm_of(p_campaign uuid, p_uid uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select p_uid is not null and (
    exists (select 1 from public.campaigns c where c.id = p_campaign and c.gm_id = p_uid)
    or exists (select 1 from public.memberships m
                where m.campaign_id = p_campaign and m.profile_id = p_uid
                  and m.role in ('gm', 'co-gm') and m.active));
$$;
revoke all on function public.campaign_gm_of(uuid, uuid) from public, anon, authenticated;

-- 2. -------------------------------------------------------------------------------------------------
create table if not exists public.campaign_gm_invites (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  token       uuid not null unique default gen_random_uuid(),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_at  timestamptz
);
create index if not exists campaign_gm_invites_campaign_idx on public.campaign_gm_invites (campaign_id);
alter table public.campaign_gm_invites enable row level security;
revoke all on public.campaign_gm_invites from anon, authenticated;

-- 3. -------------------------------------------------------------------------------------------------
create or replace function public.create_gm_invite(p_campaign uuid)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
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

create or replace function public.revoke_gm_invite(p_invite uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  update public.campaign_gm_invites i set revoked_at = now()
   where i.id = p_invite and i.accepted_at is null and i.revoked_at is null
     and exists (select 1 from public.campaigns c where c.id = i.campaign_id and c.gm_id = auth.uid());
  if not found then raise exception 'that invite is not open, or it is not yours to cancel'; end if;
end;
$$;

create or replace function public.gm_invites_open(p_campaign uuid)
returns table (id uuid, token uuid, created_at timestamptz, expires_at timestamptz)
language sql stable security definer
set search_path to 'public'
as $$
  select i.id, i.token, i.created_at, i.expires_at
    from public.campaign_gm_invites i
    join public.campaigns c on c.id = i.campaign_id and c.gm_id = auth.uid()
   where i.campaign_id = p_campaign and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
   order by i.created_at desc;
$$;

-- What the invite page shows before the person accepts. state: open, used, cancelled, expired, owner
-- (the caller owns this campaign) or already (the caller is already a GM here).
create or replace function public.gm_invite_preview(p_token uuid)
returns table (campaign_id uuid, campaign_name text, owner_name text, state text)
language sql stable security definer
set search_path to 'public'
as $$
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

create or replace function public.accept_gm_invite(p_token uuid)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
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

-- The campaign's GMs, for anyone in the campaign: the owner first, then co-GMs.
create or replace function public.campaign_gms(p_campaign uuid)
returns table (profile_id uuid, display_name text, role text, since timestamptz)
language sql stable security definer
set search_path to 'public'
as $$
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

-- The owner removes a co-GM, or a co-GM steps down. Someone with a character here stays as a player;
-- otherwise their membership goes.
create or replace function public.remove_campaign_gm(p_campaign uuid, p_profile uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
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

revoke all on function public.create_gm_invite(uuid)          from public, anon;
revoke all on function public.revoke_gm_invite(uuid)          from public, anon;
revoke all on function public.gm_invites_open(uuid)           from public, anon;
revoke all on function public.gm_invite_preview(uuid)         from public, anon;
revoke all on function public.accept_gm_invite(uuid)          from public, anon;
revoke all on function public.campaign_gms(uuid)              from public, anon;
revoke all on function public.remove_campaign_gm(uuid, uuid)  from public, anon;
grant execute on function public.create_gm_invite(uuid)         to authenticated;
grant execute on function public.revoke_gm_invite(uuid)         to authenticated;
grant execute on function public.gm_invites_open(uuid)          to authenticated;
grant execute on function public.gm_invite_preview(uuid)        to authenticated;
grant execute on function public.accept_gm_invite(uuid)         to authenticated;
grant execute on function public.campaign_gms(uuid)             to authenticated;
grant execute on function public.remove_campaign_gm(uuid, uuid) to authenticated;

-- 4. -------------------------------------------------------------------------------------------------
-- Only client calls are checked (current_user is anon or authenticated). Definer functions run as
-- their owner, and the service role is neither, so both pass.
create or replace function public.memberships_gm_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
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
drop trigger if exists memberships_gm_guard on public.memberships;
create trigger memberships_gm_guard before insert or update or delete on public.memberships
  for each row execute function public.memberships_gm_guard();

create or replace function public.campaigns_owner_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('anon', 'authenticated') and old.gm_id is distinct from auth.uid()
     and (new.gm_id is distinct from old.gm_id or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'only the campaign''s owner can do that';
  end if;
  return new;
end;
$$;
drop trigger if exists campaigns_owner_guard on public.campaigns;
create trigger campaigns_owner_guard before update on public.campaigns
  for each row execute function public.campaigns_owner_guard();

-- 5. -------------------------------------------------------------------------------------------------
do $$
declare
  r      record;
  v_pat  text := '(\m[a-z_]+)\.gm_id = (auth\.uid\(\)|\( SELECT auth\.uid\(\) AS uid\))';
  v_q    text;
  v_c    text;
  v_sql  text;
  v_n    int := 0;
begin
  for r in
    select p.schemaname, p.tablename, p.policyname, p.qual, p.with_check
      from pg_policies p
     where p.schemaname in ('public', 'storage')
       and not (p.schemaname = 'public' and p.tablename in ('campaigns', 'compendium_entries', 'dm_boards', 'stat_blocks'))
       and (coalesce(p.qual, '') ~ v_pat or coalesce(p.with_check, '') ~ v_pat)
  loop
    -- The alias must be the campaigns table. A table with its own gm_id column could make
    -- "x.gm_id" mean something else, so stop and leave it for a person.
    if exists (select 1 from information_schema.columns
                where table_schema = r.schemaname and table_name = r.tablename and column_name = 'gm_id') then
      raise exception 'p149: %.% policy "%" compares its own gm_id: restate it by hand', r.schemaname, r.tablename, r.policyname;
    end if;
    v_q := regexp_replace(r.qual, v_pat, 'public.is_campaign_gm(\1.id)', 'g');
    v_c := regexp_replace(r.with_check, v_pat, 'public.is_campaign_gm(\1.id)', 'g');
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_q is not null then v_sql := v_sql || ' using (' || v_q || ')'; end if;
    if v_c is not null then v_sql := v_sql || ' with check (' || v_c || ')'; end if;
    begin
      execute v_sql;
      v_n := v_n + 1;
      raise notice 'p149: % . % policy "%" now uses is_campaign_gm', r.schemaname, r.tablename, r.policyname;
    exception when insufficient_privilege then
      raise notice 'p149: could not alter %.% policy "%" (not the owner here); the check lists it', r.schemaname, r.tablename, r.policyname;
    end;
  end loop;
  raise notice 'p149: % policies rewritten', v_n;
end $$;

-- 6. -------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_campaign(p_campaign uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- p149: deleting is an owner action; a co-GM is a GM but not the owner.
  if not exists (select 1 from public.campaigns where id = p_campaign and gm_id = auth.uid()) then
    raise exception 'only the campaign''s owner can delete it';
  end if;
  delete from public.campaigns where id = p_campaign;
end; $function$;

CREATE OR REPLACE FUNCTION public.rsvps_for_gm(p_session_id uuid)
 RETURNS TABLE(status text, display_name text, character_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.can_write_character_portrait(p_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_card_seat(p_campaign uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_uid is not null and (
    public.campaign_gm_of(p_campaign, p_uid)
    or exists (select 1 from public.characters c where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = p_uid));
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_seat_name(p_campaign uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when public.campaign_gm_of(p_campaign, p_uid) then 'GM'
              else coalesce((select c.name from public.characters c
                              where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = p_uid
                              order by c.active desc, c.name limit 1), 'someone') end;
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_say(p_campaign uuid, p_body text, p_kind text DEFAULT 'say'::text, p_as_name text DEFAULT NULL::text, p_character uuid DEFAULT NULL::uuid, p_whisper_to uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_token_floor(p_token uuid, p_level integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.addon_auth(p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.my_next_sessions()
 RETURNS TABLE(campaign_id uuid, session_id uuid, session_number integer, scheduled_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.calendar_feed(p_token uuid)
 RETURNS TABLE(session_id uuid, campaign_id uuid, campaign_name text, session_number integer, scheduled_at timestamp with time zone, status text, is_gm boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

insert into public._migrations (name) values ('p149-co-gm') on conflict do nothing;
