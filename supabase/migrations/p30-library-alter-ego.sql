-- ============================================================================
-- p30-library-alter-ego.sql
-- Alter egos in the LIBRARY, not just at a table.
--
-- WHY p29 WAS NOT ENOUGH
--   p29 put alter_ego_of on `characters`, so a second persona could only exist once the character
--   was already playing in a campaign. But a library build is a TEMPLATE - the thing a player makes
--   before they have a table - and for a changeling or a Jekyll build the second face is part of
--   what the character IS. Building both and being able to launch only one is the wrong shape: the
--   player would rebuild the alter by hand in every campaign they took the character to.
--
-- THE SAME LINK, ONE LEVEL UP
--   pc_library gets the same self-reference with the same flatness rule. Launching a primary then
--   launches its alters alongside it and links the resulting characters with p29's column, so the
--   pair arrives at the table already joined.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

alter table public.pc_library
  add column if not exists alter_ego_of uuid references public.pc_library (id) on delete cascade;

comment on column public.pc_library.alter_ego_of is
  'The library build this one is an alternate persona of. Launching the primary launches its alters '
  'too and links the resulting characters via characters.alter_ego_of.';

create index if not exists pc_library_alter_ego_of_idx
  on public.pc_library (alter_ego_of)
  where alter_ego_of is not null;

-- One level deep, same as characters. A trigger rather than a check because the rule is about
-- ANOTHER row, which a check constraint cannot see.
create or replace function public.library_alter_ego_is_flat()
returns trigger
language plpgsql
as $$
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
  return new;
end;
$$;

drop trigger if exists pc_library_alter_ego_flat on public.pc_library;
create trigger pc_library_alter_ego_flat
  before insert or update of alter_ego_of on public.pc_library
  for each row execute function public.library_alter_ego_is_flat();

-- ----------------------------------------------------------------------------
-- Verify:
--   select a.name as alter, p.name as primary_build
--   from public.pc_library a join public.pc_library p on p.id = a.alter_ego_of;
-- ----------------------------------------------------------------------------
