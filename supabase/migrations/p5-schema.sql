-- Phase 5: the two-level disposition model. Schema layer.
--
-- THE MODEL, IN ONE PARAGRAPH.
--
-- Today: theta[c,a], one latent per character per axis, with the TPDI self-report
-- entering as a covariate whose loading beta[a] is ESTIMATED, not assumed. That is
-- already good design and it survives.
--
-- After: a player latent phi[p,a] sits above it, anchored on that person's OWN
-- elicited self-report, and each character is partially pooled toward the player
-- they belong to. A veteran's new character therefore starts shrunk toward how that
-- person tends to play rather than at the population mean, and earns its way off
-- that prior as sessions accumulate. Cold-start solved. The gap between what someone
-- SAYS about themselves and how they actually play becomes signal, not error.
--
-- WHY SELF-REPORT AS A PRIOR AND NOT AS TRUTH. Self-report is reliable (people are
-- consistent about their self-perception); it is not thereby valid (they may be
-- wrong). Holding it as a prior that behavior can overrule is the honest posture,
-- and it is exactly what beta[a] already encodes.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. tpdi_responses: scope, and a series rather than a point.
-- ---------------------------------------------------------------------------
-- The table is already most of the way there: respondent_id is the PERSON,
-- campaign_id is nullable, and instrument_version exists. What is missing is an
-- explicit scope, so a player-level elicitation ("fill this in as YOURSELF") can be
-- told apart from a character-level one ("fill this in as Bobert").
alter table public.tpdi_responses
  add column if not exists scope text not null default 'character';

alter table public.tpdi_responses
  drop constraint if exists tpdi_responses_scope_check;
alter table public.tpdi_responses
  add constraint tpdi_responses_scope_check check (scope in ('player', 'character'));

comment on column public.tpdi_responses.scope is
  'player = filled in as yourself, the anchor for the player latent. character = filled in as a specific PC.';

-- A player-scope response has no character and no campaign, by definition.
alter table public.tpdi_responses
  drop constraint if exists tpdi_responses_scope_shape_check;
alter table public.tpdi_responses
  add constraint tpdi_responses_scope_shape_check check (
    (scope = 'player'    and assigned_character_id is null)
    or scope = 'character'
  );

create index if not exists tpdi_responses_scope_idx
  on public.tpdi_responses (respondent_id, scope, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. THE LANDMINE: tpdi_autobind would silently corrupt every player prior.
-- ---------------------------------------------------------------------------
-- The existing trigger reads:
--
--   if NEW.assigned_character_id is null and NEW.respondent_id is not null then
--     select ch.id into NEW.assigned_character_id
--     from public.characters ch
--     where ch.profile_id = NEW.respondent_id and ch.kind = 'pc'
--       and (NEW.campaign_id is null or ch.campaign_id = NEW.campaign_id)
--     limit 1;
--
-- A player-scope response is precisely `campaign_id IS NULL, assigned_character_id
-- IS NULL`. This trigger sees that shape, matches ANY PC the person owns, with
-- `limit 1` and NO ORDER BY, and binds the response to whichever character the query
-- planner happened to return first.
--
-- The anchor of the entire two-level model would be attached to a randomly chosen
-- character. Silently. And it would look fine.
--
-- Fixed: never autobind a player-scope response. Character-scope behavior is
-- otherwise unchanged, except that it now requires a campaign to disambiguate,
-- rather than grabbing an arbitrary PC when there is none.
create or replace function public.tpdi_autobind()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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

-- ---------------------------------------------------------------------------
-- 3. dispositions: scope.
-- ---------------------------------------------------------------------------
-- The table already carries profile_id (not null) AND a nullable character_id, so a
-- player-scope row is representable today as character_id IS NULL. Making it
-- explicit stops that from being an implicit convention nobody remembers.
alter table public.dispositions
  add column if not exists scope text not null default 'character';

alter table public.dispositions
  drop constraint if exists dispositions_scope_check;
alter table public.dispositions
  add constraint dispositions_scope_check check (scope in ('player', 'character'));

-- A player-scope disposition is about the PERSON: no character, and no campaign
-- (it spans them).
alter table public.dispositions
  drop constraint if exists dispositions_scope_shape_check;
alter table public.dispositions
  add constraint dispositions_scope_shape_check check (
    (scope = 'player'    and character_id is null and campaign_id is null)
    or (scope = 'character' and character_id is not null)
  );

create index if not exists dispositions_scope_idx
  on public.dispositions (profile_id, scope, source, as_of desc);

-- Backfill: every existing row is character-scoped.
update public.dispositions set scope = 'character' where scope is null;

-- ---------------------------------------------------------------------------
-- 4. THE REVEAL, ENFORCED IN RLS AND NOT MERELY IN THE UI.
-- ---------------------------------------------------------------------------
-- Two facts drove this:
--
--   a) The CHARACTER posterior is ALREADY visible to players. /me has rendered it,
--      ungated, under "How you actually play", since before the pilot. Adding a gate
--      now would be taking something away. Leave it open.
--
--   b) The PLAYER posterior is new, and it is the exposing one: it is a claim about
--      the PERSON, not about a character they are wearing. Gating something at birth
--      is honest; retracting it later is not.
--
-- And a trap: dispositions already has `"players read own dispositions" using
-- (profile_id = auth.uid())`. So a player can read ANY row of their own straight from
-- the API. A gate that lives only in the UI is a display preference wearing a
-- permission's clothes. It has to be RLS.

create table if not exists public.disposition_reveals (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  -- Who opened the door. A GM, in a campaign this player is in.
  revealed_by uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint disposition_reveals_profile_key unique (profile_id)
);

comment on table public.disposition_reveals is
  'A GM has revealed the PLAYER-level disposition to this player. Character-level dispositions are not gated and never were.';

alter table public.disposition_reveals enable row level security;

-- The player can see whether they have been revealed to.
drop policy if exists "reveal: player reads own" on public.disposition_reveals;
create policy "reveal: player reads own" on public.disposition_reveals
  for select to authenticated using (profile_id = auth.uid());

-- A GM can grant it, but only for a player who actually has a character in a
-- campaign that GM runs. No reaching across tables.
drop policy if exists "reveal: gm grants" on public.disposition_reveals;
create policy "reveal: gm grants" on public.disposition_reveals
  for insert to authenticated with check (
    revealed_by = auth.uid()
    and exists (
      select 1
      from public.characters ch
      join public.campaigns c on c.id = ch.campaign_id
      where ch.profile_id = public.disposition_reveals.profile_id
        and c.gm_id = auth.uid()
    )
  );

drop policy if exists "reveal: gm revokes" on public.disposition_reveals;
create policy "reveal: gm revokes" on public.disposition_reveals
  for delete to authenticated using (
    exists (
      select 1
      from public.characters ch
      join public.campaigns c on c.id = ch.campaign_id
      where ch.profile_id = public.disposition_reveals.profile_id
        and c.gm_id = auth.uid()
    )
  );

drop policy if exists "reveal: gm reads" on public.disposition_reveals;
create policy "reveal: gm reads" on public.disposition_reveals
  for select to authenticated using (
    exists (
      select 1
      from public.characters ch
      join public.campaigns c on c.id = ch.campaign_id
      where ch.profile_id = public.disposition_reveals.profile_id
        and c.gm_id = auth.uid()
    )
  );

grant select, insert, delete on public.disposition_reveals to authenticated;

-- Now rewrite the dispositions read policies to be scope-aware.
--
-- There were FOUR overlapping select policies on this table, which is how the
-- player-level row would have slipped straight through: policies OR together, so the
-- most permissive one wins. They are replaced with two that say what they mean.
drop policy if exists "players read own dispositions"  on public.dispositions;
drop policy if exists "self or gm reads dispositions"  on public.dispositions;
drop policy if exists "gm reads campaign dispositions" on public.dispositions;

-- CHARACTER scope: unchanged behavior. The player reads their own; the GM reads
-- their campaign's. This is what /me already shows and we are not taking it away.
drop policy if exists "dispositions: character scope" on public.dispositions;
create policy "dispositions: character scope" on public.dispositions
  for select to authenticated using (
    scope = 'character'
    and (
      profile_id = auth.uid()
      or (campaign_id is not null and public.is_campaign_gm(campaign_id))
    )
  );

-- PLAYER scope: the GM of a campaign this person plays in can always see it (they
-- are the one who decides whether to reveal it). The PLAYER sees it only once a
-- reveal row exists. Nobody else, ever.
drop policy if exists "dispositions: player scope" on public.dispositions;
create policy "dispositions: player scope" on public.dispositions
  for select to authenticated using (
    scope = 'player'
    and (
      exists (
        select 1
        from public.characters ch
        join public.campaigns c on c.id = ch.campaign_id
        where ch.profile_id = public.dispositions.profile_id
          and c.gm_id = auth.uid()
      )
      or (
        profile_id = auth.uid()
        and exists (
          select 1 from public.disposition_reveals r
          where r.profile_id = auth.uid()
        )
      )
    )
  );

-- Writes are unchanged: the fit worker connects directly and bypasses RLS.
-- "self writes own disposition" stays as it is for the prior rows the app writes.
