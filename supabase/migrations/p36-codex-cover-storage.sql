-- ============================================================================
-- p36-codex-cover-storage.sql
-- Let a GM upload the cover image for their own campaign's published codex.
--
-- THE FAILURE
--   "new row violates row-level security policy (400)" on uploading to
--   <campaign_id>/codex/cover.<ext>. The existing portrait policies are narrower than the bucket:
--   they require path segment 2 to be exactly 'portraits' AND the filename to be a character id or
--   a stat block id. A cover is neither, so no policy granted and the insert was refused.
--
--   Nothing was broken by adding the cover feature - the bucket simply has no rule for this shape
--   of object, and storage denies by default. Which is the right default.
--
-- THE RULE
--   Segment 1 is the campaign id, segment 2 is 'codex'. Only that campaign's GM may write, and the
--   uuid cast is guarded exactly as p18 established: an unguarded cast on a non-uuid segment RAISES
--   and aborts the whole statement rather than evaluating false, which would break every other
--   policy on the bucket at the same time.
--
-- READ IS ALREADY PUBLIC for this bucket, and the codex page is anonymous, so no select policy is
-- added here. If bucket reads were ever restricted, the cover would need one.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

drop policy if exists "gm writes own codex cover" on storage.objects;
create policy "gm writes own codex cover"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'campaign-maps'
    and (storage.foldername(name))[2] = 'codex'
    and public.is_campaign_gm_segment((storage.foldername(name))[1])
  )
  with check (
    bucket_id = 'campaign-maps'
    and (storage.foldername(name))[2] = 'codex'
    and public.is_campaign_gm_segment((storage.foldername(name))[1])
  );

-- ----------------------------------------------------------------------------
-- The guarded helper is p18's is_campaign_gm_segment, reused rather than reimplemented: a second
-- copy of the uuid guard is a second place for it to be wrong.
--
-- Verify after running, as the GM, by uploading a cover on /gm/codex. And confirm the policy exists:
--   select policyname from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and policyname = 'gm writes own codex cover';
-- ----------------------------------------------------------------------------
