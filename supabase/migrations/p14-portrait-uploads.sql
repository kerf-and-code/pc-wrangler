-- ============================================================================
-- p14-portrait-uploads.sql
-- Storage policies so PC portraits and monster stat-block portraits can be uploaded.
--
-- WHY THIS IS NEEDED (the honest reason):
--   The campaign-maps bucket's existing write policies gate on is_campaign_gm(first path segment).
--   That covers a GM uploading a portrait for a campaign character, but NOT:
--     (a) a PLAYER uploading their own PC's portrait  (a player is not the campaign GM), and
--     (b) a LIBRARY-WIDE stat block, whose portrait path has no campaign segment to gate on
--         (campaign_id is null; path is  statblocks/<id>.<ext>  with no <campaign_id>/ prefix).
--   Without these policies the upload UI would fail silently on RLS. This adds precisely the two
--   owner-scoped policies those cases need, nothing broader.
--
-- Idempotent (drop-then-create). Run by hand in the Supabase editor.
--
-- CORRECTED 2026-08-01. The first version of this file addressed the object's filename through
-- storage.foldername(), which does NOT contain it: foldername() splits the path on '/' and returns
-- every segment EXCEPT the last. So for  <campaign_id>/portraits/<character_id>.png  it returns
-- {campaign_id, portraits} - only two elements - and the old policy's [3] lookup was always NULL.
-- Both policies therefore evaluated to false and granted nothing. They would have been created
-- without error and portrait uploads would have kept failing on RLS, which is the worst kind of
-- migration: it looks applied and does nothing. The filename comes from storage.filename().
-- Bucket 'campaign-maps' is already public-read, so no read policy is added here.
-- ============================================================================

-- Path conventions this file assumes (kept identical to the app):
--   PC portrait:              <campaign_id>/portraits/<character_id>.<ext>
--   campaign stat block:      <campaign_id>/statblocks/<stat_block_id>.<ext>
--   library-wide stat block:  statblocks/<stat_block_id>.<ext>     (no campaign segment)

-- ----------------------------------------------------------------------------
-- 1. A player may write (insert/update/delete) the portrait of a character they OWN.
--    Path shape: <campaign_id>/portraits/<character_id>.<ext>
--    We authorize on the character_id in the third path segment being a character whose
--    profile_id is the caller. The GM path is already covered by the existing map policies,
--    so this only ADDS the player-owned case; it does not replace anything.
-- ----------------------------------------------------------------------------
drop policy if exists "player writes own pc portrait" on storage.objects;
create policy "player writes own pc portrait"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'campaign-maps'
    and (storage.foldername(name))[2] = 'portraits'
    and exists (
      select 1 from public.characters c
      where c.id::text = split_part(storage.filename(name), '.', 1)
        and c.profile_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'campaign-maps'
    and (storage.foldername(name))[2] = 'portraits'
    and exists (
      select 1 from public.characters c
      where c.id::text = split_part(storage.filename(name), '.', 1)
        and c.profile_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 2. A GM may write the portrait of a stat block they OWN, at either path shape:
--      <campaign_id>/statblocks/<id>.<ext>   (campaign-pinned)
--      statblocks/<id>.<ext>                 (library-wide, no campaign segment)
--    We authorize on the stat_block_id (in the 'statblocks'-adjacent segment) being a block
--    whose gm_id is the caller. This covers the library-wide case the existing policy can't,
--    because it keys on the owning GM rather than on a campaign in the path.
-- ----------------------------------------------------------------------------
drop policy if exists "gm writes own statblock portrait" on storage.objects;
create policy "gm writes own statblock portrait"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'campaign-maps'
    and 'statblocks' = any (storage.foldername(name))
    and exists (
      select 1 from public.stat_blocks s
      where s.id::text = split_part(storage.filename(name), '.', 1)
        and s.gm_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'campaign-maps'
    and 'statblocks' = any (storage.foldername(name))
    and exists (
      select 1 from public.stat_blocks s
      where s.id::text = split_part(storage.filename(name), '.', 1)
        and s.gm_id = auth.uid()
    )
  );

-- NOTE on library-wide stat block portraits: the file lands at  statblocks/<id>.<ext>  with no
-- campaign folder. That means it is readable by anyone (the bucket is public-read) and writable
-- only by the owning GM (policy above). If a stat block is later pinned to a campaign, its portrait
-- does NOT move automatically; re-upload (or a path migration) would be needed. Acceptable for now
-- since a monster portrait is not sensitive.
