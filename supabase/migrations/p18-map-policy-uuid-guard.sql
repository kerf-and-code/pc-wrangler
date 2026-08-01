-- ============================================================================
-- p18-map-policy-uuid-guard.sql
-- Stops the three legacy campaign-maps policies from raising on a non-uuid first path segment.
--
-- THE BUG
--   All three read:
--     is_campaign_gm(((storage.foldername(name))[1])::uuid)
--   with nothing checking that segment is a uuid first. Any object stored in campaign-maps whose
--   first path segment is not a campaign id raises
--     invalid input syntax for type uuid: "statblocks"
--
--   And a policy that RAISES aborts the whole statement. It does not evaluate to false and let
--   another permissive policy grant instead, so no amount of correctness in the portrait policies
--   could rescue the path. That is why library-wide stat-block portraits at
--   statblocks/<id>.<ext> failed while PC portraits at <campaign_id>/portraits/<id>.<ext>
--   succeeded: the latter happen to have a real uuid in segment one.
--
--   Latent beyond portraits. Anything ever written to this bucket outside a campaign folder hits it.
--
-- THE FIX
--   The permission rule is UNCHANGED. Each policy keeps exactly the predicate it had; the cast is
--   simply guarded so a non-uuid segment answers false instead of throwing. The guard lives in a
--   helper using CASE rather than an AND chain, because AND does not guarantee evaluation order
--   (the planner may reorder), whereas CASE does, and an unguarded cast that runs first is the
--   whole problem.
--
--   The helper is deliberately NOT security definer: is_campaign_gm already decides what a caller
--   may see, and wrapping it in a definer would silently widen it.
--
-- Idempotent (create or replace, drop-then-create). Run by hand in the Supabase editor.
-- ============================================================================

create or replace function public.is_campaign_gm_segment(p_segment text)
returns boolean
language sql
stable
as $$
  select case
    when p_segment is null then false
    when p_segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then false
    else public.is_campaign_gm(p_segment::uuid)
  end;
$$;

revoke all on function public.is_campaign_gm_segment(text) from public;
grant execute on function public.is_campaign_gm_segment(text) to authenticated;

-- ----------------------------------------------------------------------------
-- The three policies, recreated with their original predicates and the guarded cast.
-- Original definitions, for the record:
--   gm upload maps  INSERT  with check ((bucket_id = 'campaign-maps') AND is_campaign_gm(((storage.foldername(name))[1])::uuid))
--   gm update maps  UPDATE  using      ((bucket_id = 'campaign-maps') AND is_campaign_gm(((storage.foldername(name))[1])::uuid))
--   gm delete maps  DELETE  using      ((bucket_id = 'campaign-maps') AND is_campaign_gm(((storage.foldername(name))[1])::uuid))
-- ----------------------------------------------------------------------------

drop policy if exists "gm upload maps" on storage.objects;
create policy "gm upload maps"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'campaign-maps'
    and public.is_campaign_gm_segment((storage.foldername(name))[1])
  );

drop policy if exists "gm update maps" on storage.objects;
create policy "gm update maps"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'campaign-maps'
    and public.is_campaign_gm_segment((storage.foldername(name))[1])
  );

drop policy if exists "gm delete maps" on storage.objects;
create policy "gm delete maps"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'campaign-maps'
    and public.is_campaign_gm_segment((storage.foldername(name))[1])
  );

-- ----------------------------------------------------------------------------
-- Verify the guard without uploading. Both should return a boolean, and critically NEITHER should
-- raise. From the SQL editor auth.uid() is null so the first returns false; that is correct.
--
--   select public.is_campaign_gm_segment('statblocks');                              -- false, no error
--   select public.is_campaign_gm_segment('cdf62161-e789-4e4c-9933-b910f50d0580');    -- false as service role
--
-- Before this migration the first of those raised. That raise is what was failing the uploads.
-- ----------------------------------------------------------------------------
