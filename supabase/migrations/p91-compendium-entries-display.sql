-- ============================================================================
-- p91-compendium-entries-display.sql
-- Typed homebrew for the voice compendium: add a full per-category display to compendium_entries.
--
-- WHY
--   p90 stores every custom card flattened (tag / meta_lines / body), so overriding a shipped spell or
--   monster collapsed it to a generic card. This adds one nullable jsonb column, `display`, that holds a
--   full typed display (a SpellDisplay, ItemDisplay, or MonsterDisplay) for the categories that have a
--   real card layout. When it is present the tool renders the card through the actual per-category
--   renderer; when it is null (every existing row, and every freeform 'custom' card) nothing changes and
--   the generic tag/meta/body path is used exactly as before.
--
--   Purely additive and backward compatible: old rows read display = null. The shape stored in `display`
--   is validated by the editor (lib/compendium/types.ts), not by the database, so no column constraints.
--
-- Idempotent. Run by hand in the Supabase editor. Requires p90 to have been applied first.
-- ============================================================================

alter table public.compendium_entries
  add column if not exists display jsonb;

-- ----------------------------------------------------------------------------
-- Verify (expect a row: column_name = 'display', data_type = 'jsonb', is_nullable = 'YES'):
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'compendium_entries' and column_name = 'display';
-- ----------------------------------------------------------------------------
