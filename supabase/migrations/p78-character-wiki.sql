-- ============================================================================
-- p78-character-wiki.sql
-- Player-owned character pages: the narrative wiki a player writes for their own PC.
--
-- The character's STATS live on public.characters (the Forge), where the GM can already edit any
-- character. This is the opposite ownership on purpose: the STORY, backstory, goals, bonds, and the
-- secrets a player chooses to share, is the PLAYER's to write, and the GM only gets a hand in it when
-- the player grants it. So it is a separate model rather than more columns on characters, and it does
-- not touch the existing character policies.
--
-- Two tables:
--   character_wiki_sections   titled sections, each private (owner only) or shared (the GM can read).
--   character_wiki_gm_edit     a grant row; while it exists, the GM may edit this character's sections.
--
-- owner_id / campaign_id on a section are stamped from the character by a trigger, never trusted from
-- the client, so the RLS below is reliable. Ownership is characters.profile_id, the same signal p32
-- used to let a player read their own character.
--
-- Party-wide visibility (other players reading each other's pages) is deliberately NOT here: p32 called
-- cross-party reads a separate, deliberate widening, and this keeps that decision separate.
--
-- Idempotent. Run by hand in the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- sections
-- ---------------------------------------------------------------------------
create table if not exists public.character_wiki_sections (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  campaign_id  uuid references public.campaigns(id) on delete cascade,  -- stamped by trigger
  owner_id     uuid,                                                     -- stamped by trigger (characters.profile_id)
  title        text not null default '',
  body         text not null default '',
  visibility   text not null default 'private',   -- private = owner only; shared = owner + GM
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.character_wiki_sections
  drop constraint if exists character_wiki_sections_visibility_check;
alter table public.character_wiki_sections
  add constraint character_wiki_sections_visibility_check
  check (visibility in ('private', 'shared'));

create index if not exists character_wiki_sections_char_idx
  on public.character_wiki_sections (character_id, position);

-- Stamp campaign_id + owner_id from the character (so a client cannot spoof them), and keep updated_at
-- fresh. SECURITY DEFINER so it can read characters regardless of the caller's row visibility. Runs on
-- insert AND update: the two stamped columns never change, and a GM editing must not be able to
-- reassign ownership.
create or replace function public.character_wiki_fill()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  select ch.campaign_id, ch.profile_id
    into new.campaign_id, new.owner_id
  from public.characters ch
  where ch.id = new.character_id;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists character_wiki_fill_t on public.character_wiki_sections;
create trigger character_wiki_fill_t
  before insert or update on public.character_wiki_sections
  for each row execute function public.character_wiki_fill();

-- ---------------------------------------------------------------------------
-- gm-edit grant
-- ---------------------------------------------------------------------------
create table if not exists public.character_wiki_gm_edit (
  character_id uuid primary key references public.characters(id) on delete cascade,
  campaign_id  uuid references public.campaigns(id) on delete cascade,  -- stamped by trigger
  granted_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now()
);

create or replace function public.character_wiki_grant_fill()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  select ch.campaign_id into new.campaign_id from public.characters ch where ch.id = new.character_id;
  return new;
end;
$$;

drop trigger if exists character_wiki_grant_fill_t on public.character_wiki_gm_edit;
create trigger character_wiki_grant_fill_t
  before insert on public.character_wiki_gm_edit
  for each row execute function public.character_wiki_grant_fill();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.character_wiki_sections enable row level security;
alter table public.character_wiki_gm_edit  enable row level security;

-- Read a section: the owner always; the GM only when it is shared.
drop policy if exists "cw sections: read" on public.character_wiki_sections;
create policy "cw sections: read" on public.character_wiki_sections
  for select to authenticated using (
    owner_id = auth.uid()
    or (visibility = 'shared' and public.is_campaign_gm(campaign_id))
  );

-- Write a section (insert/update/delete): the owner always; the GM only while a grant exists. owner_id
-- and campaign_id are trigger-stamped, so these checks hold against the real character.
drop policy if exists "cw sections: insert" on public.character_wiki_sections;
create policy "cw sections: insert" on public.character_wiki_sections
  for insert to authenticated with check (
    owner_id = auth.uid()
    or (public.is_campaign_gm(campaign_id)
        and exists (select 1 from public.character_wiki_gm_edit g where g.character_id = character_wiki_sections.character_id))
  );

drop policy if exists "cw sections: update" on public.character_wiki_sections;
create policy "cw sections: update" on public.character_wiki_sections
  for update to authenticated using (
    owner_id = auth.uid()
    or (public.is_campaign_gm(campaign_id)
        and exists (select 1 from public.character_wiki_gm_edit g where g.character_id = character_wiki_sections.character_id))
  );

drop policy if exists "cw sections: delete" on public.character_wiki_sections;
create policy "cw sections: delete" on public.character_wiki_sections
  for delete to authenticated using (
    owner_id = auth.uid()
    or (public.is_campaign_gm(campaign_id)
        and exists (select 1 from public.character_wiki_gm_edit g where g.character_id = character_wiki_sections.character_id))
  );

-- The grant: the OWNER of the character grants and revokes; the GM (and owner) can read whether it is on.
drop policy if exists "cw grant: read" on public.character_wiki_gm_edit;
create policy "cw grant: read" on public.character_wiki_gm_edit
  for select to authenticated using (
    public.is_campaign_gm(campaign_id)
    or exists (select 1 from public.characters ch where ch.id = character_wiki_gm_edit.character_id and ch.profile_id = auth.uid())
  );

drop policy if exists "cw grant: owner grants" on public.character_wiki_gm_edit;
create policy "cw grant: owner grants" on public.character_wiki_gm_edit
  for insert to authenticated with check (
    exists (select 1 from public.characters ch where ch.id = character_wiki_gm_edit.character_id and ch.profile_id = auth.uid())
  );

drop policy if exists "cw grant: owner revokes" on public.character_wiki_gm_edit;
create policy "cw grant: owner revokes" on public.character_wiki_gm_edit
  for delete to authenticated using (
    exists (select 1 from public.characters ch where ch.id = character_wiki_gm_edit.character_id and ch.profile_id = auth.uid())
  );

grant select, insert, update, delete on public.character_wiki_sections to authenticated;
grant select, insert, delete on public.character_wiki_gm_edit to authenticated;

-- ----------------------------------------------------------------------------
-- Verify:
--   as a player on their own character: insert a section, read it back.
--   as their GM: a 'shared' section is visible, a 'private' one is not; editing is refused until the
--   player inserts a character_wiki_gm_edit row, then allowed.
-- ----------------------------------------------------------------------------
