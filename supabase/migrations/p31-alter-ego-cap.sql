-- ============================================================================
-- p31-alter-ego-cap.sql
-- At most 10 alter egos per character, enforced where it cannot be bypassed.
--
-- WHY THE DATABASE AND NOT JUST THE BUTTON
--   The Forge already stops offering the button at ten, which is the right thing for a player who
--   is simply building a character. It is not a limit: the insert goes through PostgREST with the
--   player's own token, so anything speaking to the API directly ignores the UI entirely. A cap
--   that exists to bound abuse has to live where the row is written.
--
-- WHY TEN
--   Six is the largest real case anyone has pointed at. Ten is generous enough that a legitimate
--   character never meets it and small enough that a runaway loop stops early. It is a guardrail,
--   not a rule from the game.
--
-- COUNTED PER PRIMARY, not per player: one character with eleven faces is the thing being
-- prevented; a player with eleven characters is just a player.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

create or replace function public.alter_ego_is_flat()
returns trigger
language plpgsql
as $$
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

create or replace function public.library_alter_ego_is_flat()
returns trigger
language plpgsql
as $$
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

-- The triggers themselves are unchanged from p29 and p30; only the functions they call are
-- replaced, so there is nothing to drop or recreate.

-- ----------------------------------------------------------------------------
-- Verify:
--   select alter_ego_of, count(*) from public.characters
--   where alter_ego_of is not null group by alter_ego_of having count(*) > 10;
--   -- expect zero rows, now and after
-- ----------------------------------------------------------------------------
