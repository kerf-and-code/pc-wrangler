-- ============================================================================
-- p29-alter-ego.sql
-- Two characters, one player, one seat at the table.
--
-- WHAT THIS IS FOR
--   Changelings, Jekyll-and-Hyde builds, a rage form, a curse that takes over: one PLAYER who
--   switches between two fully built characters under some in-fiction trigger. Not a subclass and
--   not a form - two sheets, two names, two sets of numbers, and only one of them present at a time.
--
-- WHY A LINK RATHER THAN A SECOND BUILD INSIDE ONE CHARACTER
--   An alter ego needs everything a character has: its own class, level, gear, spells, portrait,
--   disposition read. Nesting a second build inside characters.build would mean every query that
--   reads a character learning about a shape that is usually absent, and every derivation asking
--   which of the two it meant. Two rows with a link keeps all of that working unchanged.
--
-- IT IS NOT character_identities
--   That table links the same character across DIFFERENT campaigns, and its whole purpose is to
--   POOL their dispositions - the model reads one person underneath. An alter ego is the opposite
--   case: the same player in the SAME campaign, and the reads should stay apart, because whether
--   they diverge is the interesting question. Reusing that link would answer it by assumption.
--
-- ATTRIBUTION STAYS WITH THE PRIMARY, for now. Discord maps one voice track to one character, so a
-- mid-session switch would otherwise scatter events across two sheets with nothing marking where.
-- Everything lands on the primary until a session shows what the switch actually looks like.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

alter table public.characters
  add column if not exists alter_ego_of uuid references public.characters (id) on delete cascade;

comment on column public.characters.alter_ego_of is
  'The primary character this one is an alternate persona of. Null for a normal character and for '
  'the primary itself. Voice capture and event attribution stay on the primary.';

create index if not exists characters_alter_ego_of_idx
  on public.characters (alter_ego_of)
  where alter_ego_of is not null;

-- ONE LEVEL DEEP. An alter ego cannot itself have an alter ego: the chain would have no natural end
-- and every consumer would need to walk it. A trigger rather than a check constraint because the
-- rule is about ANOTHER row, which a check cannot see.
create or replace function public.alter_ego_is_flat()
returns trigger
language plpgsql
as $$
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
  return new;
end;
$$;

drop trigger if exists characters_alter_ego_flat on public.characters;
create trigger characters_alter_ego_flat
  before insert or update of alter_ego_of on public.characters
  for each row execute function public.alter_ego_is_flat();

-- ----------------------------------------------------------------------------
-- WHAT STILL READS THESE AS TWO SEPARATE CHARACTERS, deliberately:
--   the Roster, the encounter balancer's party list, and the disposition model.
--
-- The balancer one is worth knowing before a GM meets it: a party of four whose rogue has an alter
-- ego will count five. Whether that should be filtered is a product decision, not a schema one, and
-- filtering it here would hide the character from the GM entirely.
--
-- Verify:
--   select c.name as alter, p.name as primary_character
--   from public.characters c join public.characters p on p.id = c.alter_ego_of;
-- ----------------------------------------------------------------------------
