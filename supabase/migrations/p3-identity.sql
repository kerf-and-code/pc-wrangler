-- Phase 3: durable player identity.
--
-- Durable accounts become the primary path; anonymous stays as the fallback.
--
-- THE KEY FACT THAT MAKES THIS CHEAP: everything already keys on auth.uid().
-- profiles.id, characters.profile_id, tpdi_responses.respondent_id, and
-- dispositions.profile_id all resolve to the same auth user id. Supabase's
-- linkIdentity() attaches a Google or Discord identity to an EXISTING anonymous
-- user while preserving that id. So upgrading a guest to a real account changes
-- nothing downstream: their characters, TPDI responses, and dispositions all still
-- resolve. There is no data migration here, and no backfill.
--
-- Idempotent. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. profiles: carry enough identity to render a player hub.
-- ---------------------------------------------------------------------------
-- Today profiles holds only (id, display_name, created_at, updated_at), and
-- handle_new_user inserts nothing but the id. That is fine for an anonymous
-- player who has no name, but a durable account arrives from Google or Discord
-- carrying a name, an email, and an avatar, and the /me hub needs them.
--
-- is_anonymous is denormalized from auth.users so that RLS-safe app code can ask
-- "is this a guest?" without reaching into the auth schema.

alter table public.profiles
  add column if not exists email        text,
  add column if not exists avatar_url   text,
  add column if not exists is_anonymous boolean not null default true,
  add column if not exists upgraded_at  timestamptz;

comment on column public.profiles.is_anonymous is
  'True while this player is a guest. Flips to false when they link a durable identity (Google, Discord, email).';
comment on column public.profiles.upgraded_at is
  'When the guest linked a durable identity. Null for players who have never upgraded.';

-- ---------------------------------------------------------------------------
-- 2. handle_new_user: populate the profile from whatever the provider gave us.
-- ---------------------------------------------------------------------------
-- Runs on INSERT for every auth user, anonymous included. An anonymous signup has
-- no metadata, so it lands with nulls and is_anonymous = true, exactly as before.
-- An OAuth signup lands with a name, an email, and an avatar.
--
-- NOTE ON THE PILOT BUG: the handoff blamed the /join consent failure on anonymous
-- claimers having no profiles row. This function has always created one for every
-- auth user, so that diagnosis only holds if the TRIGGER was never attached.
-- Section 3 attaches it unconditionally, which either fixes the bug or is a no-op.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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

-- ---------------------------------------------------------------------------
-- 3. The trigger. Attach it unconditionally.
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. The upgrade: guest becomes a durable account.
-- ---------------------------------------------------------------------------
-- Called by the app AFTER supabase.auth.linkIdentity() succeeds. The auth user id
-- is unchanged, so this only refreshes the profile row and records the upgrade.
-- Nothing is reassigned, because nothing needs to be.

create or replace function public.upgrade_profile_from_auth()
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $$
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

grant execute on function public.upgrade_profile_from_auth() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. SECURITY FIX: claim_character_invite could steal a claimed character.
-- ---------------------------------------------------------------------------
-- The old body ran `update characters set profile_id = auth.uid()` with NO check
-- that the character was unclaimed. Invite codes are permanent and get pasted into
-- Discord, so anyone holding one could seize a character that already belonged to
-- another player, silently inheriting their history, dispositions, and journal.
--
-- Now: claimable only if unclaimed, or if it is already yours (idempotent re-claim,
-- which is what happens when a player re-opens their invite link).
--
-- BEHAVIOR CHANGE: a GM who wants to reassign a character to a different player now
-- has to clear characters.profile_id first. That is the correct shape for a
-- destructive action, and it is a GM action, not an invite-code action.

create or replace function public.claim_character_invite(p_code text)
returns table(campaign_share_code text, character_id uuid, character_name text)
language plpgsql
security definer
set search_path to 'public'
as $$
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

-- ---------------------------------------------------------------------------
-- 6. The player dossier: every character this person owns, across campaigns.
-- ---------------------------------------------------------------------------
-- This is the payoff of durable identity, and the thing that makes the
-- one-player-many-characters stable possible. Harvested from the hub (h1).

create or replace function public.my_characters()
returns table (
  character_id  uuid,
  name          text,
  campaign_id   uuid,
  campaign_name text,
  species       text,
  class         text,
  subclass      text,
  level         smallint,
  alignment     text,
  kind          text,
  active        boolean
)
language sql
security definer
set search_path to 'public'
as $$
  select ch.id, ch.name, c.id, c.name,
         ch.species, ch.class, ch.subclass, ch.level, ch.alignment, ch.kind, ch.active
  from public.characters ch
  join public.campaigns c on c.id = ch.campaign_id
  where ch.profile_id = auth.uid()
  order by c.name, ch.name;
$$;

grant execute on function public.my_characters() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 7. Personal threads (hub h1): a player's own plot threads, favors, grudges.
-- ---------------------------------------------------------------------------
create table if not exists public.threads (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  campaign_id  uuid references public.campaigns(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  title        text not null,
  detail       text,
  kind         text not null default 'thread',
  status       text not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists threads_profile_idx  on public.threads (profile_id);
create index if not exists threads_campaign_idx on public.threads (campaign_id);

alter table public.threads enable row level security;

drop policy if exists "threads_select_own" on public.threads;
create policy "threads_select_own" on public.threads
  for select using (profile_id = auth.uid());

drop policy if exists "threads_insert_own" on public.threads;
create policy "threads_insert_own" on public.threads
  for insert with check (profile_id = auth.uid());

drop policy if exists "threads_update_own" on public.threads;
create policy "threads_update_own" on public.threads
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "threads_delete_own" on public.threads;
create policy "threads_delete_own" on public.threads
  for delete using (profile_id = auth.uid());

grant select, insert, update, delete on public.threads to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Backfill is_anonymous for profiles that predate this migration.
-- ---------------------------------------------------------------------------
-- Everyone who exists right now is either a guest or a GM who signed in with
-- OAuth. Read the truth from auth.users rather than guessing.

update public.profiles p
   set is_anonymous = coalesce(u.is_anonymous, false),
       email        = coalesce(nullif(u.email, ''), p.email),
       upgraded_at  = case
                        when coalesce(u.is_anonymous, false) then p.upgraded_at
                        else coalesce(p.upgraded_at, u.created_at)
                      end
  from auth.users u
 where u.id = p.id
   and (p.is_anonymous is distinct from coalesce(u.is_anonymous, false)
        or p.email is null);
