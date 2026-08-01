-- ============================================================================
-- p17-portrait-policy-definer.sql
-- Supersedes the two policies created by p14-portrait-uploads.sql. Run this after p14.
--
-- WHY p14 WAS NOT ENOUGH
--   p14's policies each ended in a subquery over an application table:
--
--     exists (select 1 from public.characters c
--             where c.id::text = split_part(storage.filename(name), '.', 1)
--               and c.profile_id = auth.uid())
--
--   A policy predicate executes AS THE CALLING USER, so that subquery is itself filtered by RLS on
--   public.characters. That table has exactly one SELECT policy, is_campaign_member(campaign_id).
--   The upload therefore only succeeded if the uploader could already see the character row through
--   a DIFFERENT policy, and when they could not the exists() returned no rows and the storage policy
--   evaluated false. Nothing errors in that situation: the policy is simply not satisfied, the
--   insert is refused, and the client sees an opaque permission failure. The same trap applies to
--   the stat_blocks subquery.
--
--   This is the standard reason Supabase recommends SECURITY DEFINER helpers for ownership checks
--   inside policies. The helper runs as its owner, sees the row regardless of RLS, and answers one
--   narrow question: may THIS caller write THIS portrait. It returns a boolean and nothing else, so
--   it leaks no data even though it bypasses RLS to compute the answer.
--
-- WHAT ELSE CHANGES
--   The character check now also allows the campaign's GM, not just the owning player. p14 covered
--   only the player, on the assumption that the pre-existing "gm upload maps" policy already
--   covered a GM writing under <campaign_id>/. Since both the GM and the player side were failing,
--   that assumption is not carrying the weight it was given, and a GM setting a portrait for a
--   character at their own table is plainly legitimate.
--
--   The id is validated as a uuid before casting. split_part on an unexpected filename would
--   otherwise raise on the cast and fail the whole request rather than simply denying it.
--
-- Idempotent (create or replace, drop-then-create). Run by hand in the Supabase editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Ownership helpers. SECURITY DEFINER so they can see the row that RLS would hide from the caller.
-- Both take text and validate, so a malformed path denies instead of erroring.
-- ----------------------------------------------------------------------------

create or replace function public.can_write_character_portrait(p_id text)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select case
    when p_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then false
    else exists (
      select 1
      from public.characters c
      left join public.campaigns g on g.id = c.campaign_id
      where c.id = p_id::uuid
        and (c.profile_id = auth.uid() or g.gm_id = auth.uid())
    )
  end;
$$;

create or replace function public.can_write_statblock_portrait(p_id text)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select case
    when p_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then false
    else exists (
      select 1 from public.stat_blocks s
      where s.id = p_id::uuid and s.gm_id = auth.uid()
    )
  end;
$$;

revoke all on function public.can_write_character_portrait(text) from public;
revoke all on function public.can_write_statblock_portrait(text) from public;
grant execute on function public.can_write_character_portrait(text) to authenticated;
grant execute on function public.can_write_statblock_portrait(text) to authenticated;

-- ----------------------------------------------------------------------------
-- The policies. Same names as p14 so the health check and any operator notes still match.
-- Path shapes, confirmed against storage.foldername/filename on this database:
--   PC portrait              <campaign_id>/portraits/<character_id>.<ext>   folders = 2
--   campaign stat block      <campaign_id>/statblocks/<stat_block_id>.<ext>
--   library-wide stat block  statblocks/<stat_block_id>.<ext>               folders = 1
-- ----------------------------------------------------------------------------

drop policy if exists "player writes own pc portrait" on storage.objects;
create policy "player writes own pc portrait"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'campaign-maps'
    and (storage.foldername(name))[2] = 'portraits'
    and public.can_write_character_portrait(split_part(storage.filename(name), '.', 1))
  )
  with check (
    bucket_id = 'campaign-maps'
    and (storage.foldername(name))[2] = 'portraits'
    and public.can_write_character_portrait(split_part(storage.filename(name), '.', 1))
  );

drop policy if exists "gm writes own statblock portrait" on storage.objects;
create policy "gm writes own statblock portrait"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'campaign-maps'
    and 'statblocks' = any (storage.foldername(name))
    and public.can_write_statblock_portrait(split_part(storage.filename(name), '.', 1))
  )
  with check (
    bucket_id = 'campaign-maps'
    and 'statblocks' = any (storage.foldername(name))
    and public.can_write_statblock_portrait(split_part(storage.filename(name), '.', 1))
  );

-- ----------------------------------------------------------------------------
-- Verify without uploading anything. Signed in as the account under test, in the app, this is what
-- the policy will decide. From the SQL editor it runs as service role and auth.uid() is null, so
-- expect false there; that is correct and not a failure.
--
--   select public.can_write_character_portrait('<character_id>');
--   select public.can_write_statblock_portrait('<stat_block_id>');
-- ----------------------------------------------------------------------------
