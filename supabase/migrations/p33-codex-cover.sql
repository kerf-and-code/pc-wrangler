-- ============================================================================
-- p33-codex-cover.sql
-- A cover image for the published codex.
--
-- The public codex currently opens on a heading and a list. A GM wants it to open the way a
-- campaign page should: their own image, and a search box over it, with the sections reachable
-- down the side rather than as a row of chips above the fold.
--
-- WHY A URL COLUMN AND NOT A NEW TABLE
--   One image per campaign, set by the GM, shown in one place. A table would buy nothing and cost a
--   join on a page that is deliberately anonymous and cached. Portraits already work this way, so
--   the upload path and the storage bucket are the ones that exist rather than new ones.
--
-- READABLE BY ANYONE, because the codex is. The existing public read policy on campaigns already
-- exposes name and blurb to an anonymous visitor for a published slug; the cover is the same kind
-- of thing and needs no policy of its own.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

alter table public.campaigns
  add column if not exists codex_cover_url text;

comment on column public.campaigns.codex_cover_url is
  'Optional image shown at the head of the published codex at /c/<slug>. Null renders the page '
  'without a cover rather than with a placeholder - an empty frame looks broken, no frame does not.';

-- ----------------------------------------------------------------------------
-- Verify:
--   select id, name, share_code, codex_cover_url from public.campaigns where share_code is not null;
-- ----------------------------------------------------------------------------
