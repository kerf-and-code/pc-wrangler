-- ============================================================================
-- p90-compendium-entries.sql
-- Homebrew and non-destructive overrides for the voice compendium (/gm/compendium).
--
-- THE MODEL
--   The compendium ships a static, prebuilt index (public/compendium/index-<ed>.json). This table
--   layers a GM's OWN cards on top of it at load time, client-side. A row is either:
--     * a brand-new homebrew card  -> overrides_id is null
--     * an override that shadows a shipped card -> overrides_id holds that base card's id
--       (e.g. 'spell:fireball'); the shipped JSON is never touched, so an override is fully
--       reversible by deleting the row.
--
--   SCOPE is account-wide with an optional campaign pin (Terry's call): a row with campaign_id null
--   follows the GM across every campaign; a row with campaign_id set shows only when that campaign is
--   the active one. Keyed on gm_id, owner-only - a GM sees only their own cards, and nobody else's.
--
--   The card itself is stored flattened (tag / meta_lines / body / spoken / aliases) rather than as a
--   category-specific display blob, because every custom card renders through ONE generic 'custom' card
--   in the tool. category is kept for the chip/filtering and mirrors the base card's category on an
--   override.
--
-- ONE POLICY, ALL COMMANDS, OWNER ONLY - same shape as p35-player-notes, deliberately: a single
--   `for all` so select and the write commands can never disagree.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

create table if not exists public.compendium_entries (
  id           uuid primary key default gen_random_uuid(),
  gm_id        uuid not null references auth.users (id) on delete cascade,
  -- Null = account-wide (all the GM's campaigns); set = pinned to one campaign.
  campaign_id  uuid references public.campaigns (id) on delete cascade,
  system       text not null default 'dnd5e',
  -- Which edition toggle the card shows under: matches the tool's ruleset control.
  ruleset      text not null default 'both' check (ruleset in ('2014', '2024', 'both')),
  -- The card's category (mirrors the base card on an override; 'custom' for a freeform new card).
  category     text not null default 'custom',
  -- The base entry id this override shadows (e.g. 'spell:fireball'), or null for a new card.
  overrides_id text,
  name         text not null default 'Untitled',
  source       text not null default 'kc',
  -- The flattened custom-card payload.
  tag          text,                                   -- chip label (e.g. 'house rule', 'spell')
  meta_lines   jsonb not null default '[]'::jsonb,     -- string[]: the small meta lines above the body
  body         text,
  spoken       jsonb not null default '[]'::jsonb,     -- string[]: extra spoken/typed match phrases
  aliases      jsonb not null default '[]'::jsonb,     -- string[]: shorthand, merged into spoken at load
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Query path: a GM's cards for a system, newest first, then filtered by ruleset + active campaign
-- client-side.
create index if not exists compendium_entries_owner_idx
  on public.compendium_entries (gm_id, system);

-- At most one ACCOUNT-WIDE override of a given base card per GM per system, so editing an SRD card
-- twice updates the same row rather than stacking silent duplicates. Campaign-pinned overrides are
-- intentionally allowed to coexist with the account-wide one.
create unique index if not exists compendium_entries_one_account_override
  on public.compendium_entries (gm_id, system, overrides_id)
  where overrides_id is not null and campaign_id is null;

alter table public.compendium_entries enable row level security;

drop policy if exists "own compendium entries only" on public.compendium_entries;
create policy "own compendium entries only"
  on public.compendium_entries
  for all
  using (gm_id = auth.uid())
  with check (gm_id = auth.uid());

create or replace function public.touch_compendium_entries()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists compendium_entries_touch on public.compendium_entries;
create trigger compendium_entries_touch
  before update on public.compendium_entries
  for each row execute function public.touch_compendium_entries();

-- ----------------------------------------------------------------------------
-- Verify (expect ONE policy row, ALL, (gm_id = auth.uid())):
--   select policyname, cmd, qual from pg_policies
--   where schemaname = 'public' and tablename = 'compendium_entries';
--
-- As a signed-in GM, this returns only your own rows; as another user, zero:
--   select count(*) from public.compendium_entries;
-- ----------------------------------------------------------------------------
