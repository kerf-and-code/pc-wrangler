-- ============================================================================
-- p83-entity-links-player.sql
-- Let a player manage connections FROM their own character, so the character wiki page (p80) can link
-- to the people, places, and lore it touches.
--
-- entity_links was GM-only for both read and write. This ADDS player policies without touching the GM's
-- (RLS policies are OR'd, so the GM keeps full access):
--   read   - a player may read any link that touches a character they own (either endpoint).
--   insert - a player may create a link whose SOURCE is a character they own.
--   delete - a player may remove a link whose SOURCE is a character they own.
-- No player UPDATE: a connection is added or removed, not edited in place.
--
-- can_write_character_portrait(id text) is the generic owner-or-GM character check (uuid-guarded,
-- SECURITY DEFINER), reused here. For a non-character endpoint (e.g. an entry id) it finds no character
-- and returns false, so the character-endpoint checks are self-limiting.
--
-- A connection only becomes PUBLIC when both endpoints are public: public_codex_links already filters to
-- published entries and is_public characters, so a link a player makes to a not-yet-public item simply
-- does not appear on the wiki until that item is public too.
--
-- Idempotent. Run by hand in the Supabase SQL editor.
-- ============================================================================

grant select, insert, delete on public.entity_links to authenticated;

drop policy if exists "player reads own character links" on public.entity_links;
create policy "player reads own character links" on public.entity_links
  for select to authenticated using (
    public.can_write_character_portrait(source_id::text)
    or public.can_write_character_portrait(target_id::text)
  );

drop policy if exists "player links from own character" on public.entity_links;
create policy "player links from own character" on public.entity_links
  for insert to authenticated with check (
    source_type = 'character'
    and public.can_write_character_portrait(source_id::text)
  );

drop policy if exists "player unlinks from own character" on public.entity_links;
create policy "player unlinks from own character" on public.entity_links
  for delete to authenticated using (
    source_type = 'character'
    and public.can_write_character_portrait(source_id::text)
  );

-- ----------------------------------------------------------------------------
-- Verify (as a player who owns character X):
--   insert into public.entity_links (campaign_id, source_type, source_id, target_type, target_id)
--     values ('<campaign>', 'character', '<X>', 'entry', '<a revealed entry>');   -- allowed
--   the same insert with source_id = a character you do NOT own -> denied.
-- ----------------------------------------------------------------------------
