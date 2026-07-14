-- Phase 4: the character catalog.
--
-- THE BUG THIS FIXES, AND WHY IT IS ONE BUG AND NOT THREE.
--
-- Today app/gm/page.tsx holds species and classes as HARDCODED ARRAYS, rendered as
-- <input list=...> + <datalist>, which is a free-text field with suggestions, not a
-- constrained picker. Only subclass reads a real table (class_capabilities).
--
-- Three symptoms were reported. They are the same defect:
--
--   1. "High Elf is not selectable."   High Elf is a SUBRACE. There is no subrace
--                                      column anywhere in characters. The option is
--                                      not missing; the DIMENSION is missing.
--   2. "Vulpin is missing."            Vulpin is a Humblefolk subrace (Humblewood).
--                                      Same missing dimension, plus no partner
--                                      support on species at all.
--   3. PARTNERED_SPECIES holds         Lotusden Halfling and Pallid Elf are SUBRACES
--      two entries, both wrong.        (of Halfling and Elf). They were filed as
--                                      species because there was nowhere else to put
--                                      them.
--
-- So: one missing dimension, three symptoms.
--
-- THE QUIETER PROBLEM. Because these are free-text fields, `species` and `subclass`
-- accept anything typed. `subclass` joins class_capabilities to produce party
-- coverage, which feeds the TACTICS AXIS. A typo silently drops a character's
-- capability profile and nothing errors. The disposition model is currently being
-- fit on unnormalized strings.
--
-- EDITION HANDLING (decision 6: standardize on 2024, keep 2014 available).
-- 2014 and 2024 model variants differently: 2014 has SUBRACES chosen at creation;
-- 2024 collapsed them, so Elf is one species and High Elf becomes an ELVEN LINEAGE
-- picked at level 1. Rather than pick a winner, species_variants carries a
-- variant_kind discriminator ('subrace' | 'lineage') and an edition tag, so both
-- shapes coexist and the UI can default to 2024 while still offering 2014.
--
-- SCOPE FENCE (the Part E NOT-list: "not a character-sheet manager").
-- This catalog exists ONLY because subclass feeds a measure. The rule: if a field
-- does not feed a measure, it does not get built. Species, variant, class,
-- subclass, level. No stat blocks, no spells, no equipment, no hit points.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. species
-- ---------------------------------------------------------------------------
create table if not exists public.species (
  id        uuid primary key default gen_random_uuid(),
  system    text not null default '5e',
  name      text not null,
  -- Where it comes from. 'core' means a PHB/base species; anything else names the book.
  source    text not null default 'core',
  -- Third-party or partnered content (Humblewood, Critical Role, Kobold Press...).
  partnered boolean not null default false,
  partner   text,
  -- '2024' | '2014' | 'both'. Most species exist in both; a few are edition-specific.
  edition   text not null default 'both',
  sort      integer not null default 100,
  constraint species_system_name_key unique (system, name),
  constraint species_edition_check check (edition in ('2014', '2024', 'both'))
);

create index if not exists species_partner_idx on public.species (partnered, partner);

-- ---------------------------------------------------------------------------
-- 2. species_variants  <- THE MISSING DIMENSION
-- ---------------------------------------------------------------------------
-- A subrace (2014) or a lineage (2024). This is where High Elf, Vulpin, Lotusden
-- Halfling, and Pallid Elf actually belong.
create table if not exists public.species_variants (
  id           uuid primary key default gen_random_uuid(),
  species_id   uuid not null references public.species(id) on delete cascade,
  name         text not null,
  -- The discriminator that lets 2014 and 2024 coexist rather than fighting.
  variant_kind text not null default 'subrace',
  source       text not null default 'core',
  partnered    boolean not null default false,
  partner      text,
  edition      text not null default 'both',
  sort         integer not null default 100,
  -- Uniqueness MUST include variant_kind. Elf carries "High Elf" twice on purpose:
  -- once as a 2024 lineage and once as a 2014 subrace. They are the same word for
  -- genuinely different mechanics. A (species_id, name) key would silently collapse
  -- them into one and drop the 2014 row on an ON CONFLICT DO NOTHING seed.
  constraint species_variants_species_name_kind_key unique (species_id, name, variant_kind),
  constraint species_variants_kind_check check (variant_kind in ('subrace', 'lineage')),
  constraint species_variants_edition_check check (edition in ('2014', '2024', 'both'))
);

create index if not exists species_variants_species_idx on public.species_variants (species_id);
create index if not exists species_variants_partner_idx on public.species_variants (partnered, partner);

-- ---------------------------------------------------------------------------
-- 3. classes
-- ---------------------------------------------------------------------------
-- class_capabilities already carries (class, subclass, capabilities, partner) and
-- IS the subclass catalog. It does not carry a clean list of CLASSES, though, which
-- the picker needs. Rather than duplicate, this table holds classes only, and
-- subclasses continue to come from class_capabilities.
create table if not exists public.classes (
  id        uuid primary key default gen_random_uuid(),
  system    text not null default '5e',
  name      text not null,
  source    text not null default 'core',
  partnered boolean not null default false,
  partner   text,
  edition   text not null default 'both',
  sort      integer not null default 100,
  constraint classes_system_name_key unique (system, name),
  constraint classes_edition_check check (edition in ('2014', '2024', 'both'))
);

-- ---------------------------------------------------------------------------
-- 4. characters gains the missing column
-- ---------------------------------------------------------------------------
-- Deliberately NOT replacing characters.species / class / subclass with foreign
-- keys yet. Those columns hold years of free-text data that will not all match a
-- catalog, and a NOT VALID FK on dirty data would break character creation on day
-- one. Staged instead:
--
--   this migration : add species_variant, populate the catalogs, ship the audit view
--   next           : constrained selects in the UI, so all NEW data is clean
--   then           : backfill the existing rows using the audit
--   finally        : add the FK constraints, once they can actually hold
--
-- species_variant is text (not a FK) for the same reason and gets promoted later.
alter table public.characters
  add column if not exists species_variant text;

comment on column public.characters.species_variant is
  'Subrace (2014) or lineage (2024). The dimension that made High Elf unselectable by its absence.';

-- ---------------------------------------------------------------------------
-- 5. RLS: catalogs are reference data. Everyone signed in can read; nobody writes.
-- ---------------------------------------------------------------------------
alter table public.species          enable row level security;
alter table public.species_variants enable row level security;
alter table public.classes          enable row level security;

drop policy if exists "read species" on public.species;
create policy "read species" on public.species
  for select to anon, authenticated using (true);

drop policy if exists "read species_variants" on public.species_variants;
create policy "read species_variants" on public.species_variants
  for select to anon, authenticated using (true);

drop policy if exists "read classes" on public.classes;
create policy "read classes" on public.classes
  for select to anon, authenticated using (true);

revoke all on public.species          from anon, authenticated;
revoke all on public.species_variants from anon, authenticated;
revoke all on public.classes          from anon, authenticated;

grant select on public.species          to anon, authenticated;
grant select on public.species_variants to anon, authenticated;
grant select on public.classes          to anon, authenticated;

grant select, insert, update, delete on public.species          to service_role;
grant select, insert, update, delete on public.species_variants to service_role;
grant select, insert, update, delete on public.classes          to service_role;

-- ---------------------------------------------------------------------------
-- 6. THE AUDIT: how dirty is the existing data?
-- ---------------------------------------------------------------------------
-- Every character whose species, class, or subclass does not match the catalog.
-- These are the rows whose capability profile is silently dropped from coverage,
-- and therefore from the Tactics axis. Run this before trusting any fit.
create or replace view public.v_character_catalog_audit
with (security_invoker = true) as
select
  ch.id            as character_id,
  ch.campaign_id,
  ch.name,
  ch.species,
  ch.species_variant,
  ch.class,
  ch.subclass,
  (ch.species is not null
     and not exists (select 1 from public.species s where s.name = ch.species))  as species_unknown,
  (ch.class is not null
     and not exists (select 1 from public.classes c where c.name = ch.class))    as class_unknown,
  (ch.subclass is not null
     and not exists (select 1 from public.class_capabilities cc
                      where cc.subclass = ch.subclass))                          as subclass_unknown,
  -- The one that actually costs you: an unrecognized subclass means no capability
  -- rows, which means this character contributes nothing to party coverage.
  (ch.subclass is null
     or not exists (select 1 from public.class_capabilities cc
                     where cc.subclass = ch.subclass))                           as no_capabilities
from public.characters ch
where ch.kind = 'pc';

comment on view public.v_character_catalog_audit is
  'Characters whose species/class/subclass do not match the catalog. no_capabilities = true means this character is invisible to coverage, and therefore to the Tactics axis.';

grant select on public.v_character_catalog_audit to authenticated, service_role;
