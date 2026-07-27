-- p12-builders-persistence.sql
--
-- Phase 2 persistence for the builders. Two surfaces:
--
-- PC CHARACTER SHEETS need NO new table. The sheet is a living JSONB document that lives in
-- the EXISTING characters.build column, keyed to the character it belongs to. The existing
-- policy "owner or gm edits character" (is_campaign_gm(campaign_id) OR profile_id = auth.uid())
-- already governs who may write it: a player edits their own build, their GM edits any build
-- in the campaign. The denormalized columns (level, class, subclass, species, species_variant)
-- are updated alongside build so the roster and encounter builder can query them without
-- parsing JSON. Nothing to migrate here; the sheet creator just writes those columns + build.
--
-- GM MONSTER STAT BLOCKS need one new table, because they are not characters. A stat block is
-- GM-owned and reusable: campaign_id is NULLABLE so a GM can build a monster once for their
-- whole library (null) or pin it to a single campaign (set). RLS mirrors the characters
-- pattern using the same helper functions.

create table if not exists public.stat_blocks (
  id           uuid primary key default gen_random_uuid(),
  gm_id        uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid references public.campaigns(id) on delete set null,  -- null = GM library-wide
  name         text not null,
  -- The full stat block as a living JSONB document, same spirit as characters.build.
  -- Denormalized columns below are for the encounter builder to read without parsing JSON.
  block        jsonb,
  cr           text,          -- challenge rating, kept as text to allow "1/4" etc.
  xp           integer,
  ac           integer,
  hp           integer,
  size         text,
  type         text,          -- creature type
  portrait_path text,         -- object path in the campaign-maps bucket, mirrors character portraits
  source_edition text,        -- '2024' | '2014' | 'custom', which ruleset the GM built against
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists stat_blocks_gm_idx on public.stat_blocks (gm_id);
create index if not exists stat_blocks_campaign_idx on public.stat_blocks (campaign_id);

alter table public.stat_blocks enable row level security;

-- The GM who owns a stat block can do anything with it. A stat block pinned to a campaign is
-- also readable by that campaign's GM (which is normally the same person, but this keeps it
-- correct if ownership and GM ever diverge). Players have no access: monster stat blocks are
-- GM prep, not player-facing.
drop policy if exists "gm manages own stat blocks" on public.stat_blocks;
create policy "gm manages own stat blocks"
  on public.stat_blocks for all
  using (
    gm_id = auth.uid()
    or (campaign_id is not null and is_campaign_gm(campaign_id))
  )
  with check (
    gm_id = auth.uid()
    or (campaign_id is not null and is_campaign_gm(campaign_id))
  );

-- keep updated_at honest
create or replace function public.touch_stat_blocks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stat_blocks_touch on public.stat_blocks;
create trigger stat_blocks_touch
  before update on public.stat_blocks
  for each row execute function public.touch_stat_blocks_updated_at();

-- PORTRAITS reuse the existing public campaign-maps bucket rather than a new bucket. Path
-- convention: <campaign_id>/portraits/<character_id>.<ext> for PC portraits and
-- <campaign_id>/statblocks/<stat_block_id>.<ext> for monster art. Because campaign-maps is
-- already public and already has upload policies for campaign members/GMs, no new storage
-- policy is required if the existing campaign-maps policies key on the campaign_id path prefix.
-- Confirm the existing campaign-maps storage policy before relying on this; if it restricts
-- to a maps/ prefix, add an analogous policy for the portraits/ and statblocks/ prefixes.
