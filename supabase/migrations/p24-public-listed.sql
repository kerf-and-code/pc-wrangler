-- ============================================================================
-- p24-public-listed.sql
-- Separate "anyone with the link can read this" from "search engines may index it".
--
-- WHY THESE ARE NOT THE SAME SWITCH
--   Publishing a codex gives it a public address. That is what a GM wants when they hand the link
--   to their players, to a friend, or to a forum thread. It is NOT the same as consenting to have
--   the campaign's NPCs and places appear in search results indefinitely, attached to a name their
--   table chose in private.
--
--   Every other disclosure in this product is opt-in, and indexing is the most far-reaching one
--   here: a link can be un-shared, but a crawled page persists in caches and results after the GM
--   unpublishes. So listing is its own decision and defaults to false, exactly as publishing does.
--
-- WHAT IT CONTROLS
--   * the sitemap only lists campaigns with public_listed = true
--   * an unlisted campaign renders with robots noindex, so a crawler that finds the link anyway
--     is asked not to keep it
--   Neither is a security boundary - a determined crawler can ignore both - which is why the read
--   gate in p23 stays exactly as it is. This governs discovery, not access.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

alter table public.campaigns
  add column if not exists public_listed boolean not null default false;

comment on column public.campaigns.public_listed is
  'Opt-in to appearing in the sitemap and being indexed. Independent of public_published_at: a '
  'campaign can be readable by link while asking search engines to stay away.';

-- The sitemap reads this and nothing else. SECURITY DEFINER for the same reason as public_codex:
-- anon holds no rights on campaigns, and the one gate lives in one place.
create or replace function public.public_listed_campaigns()
returns table (slug text, name text, published_at timestamptz)
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select c.public_slug, c.name, c.public_published_at
  from public.campaigns c
  where c.public_published_at is not null
    and c.public_listed
    and c.public_slug is not null
  order by c.public_published_at desc
  limit 5000;
$$;

-- Tells the page whether to emit noindex. Returns nothing for an unpublished slug, so the page
-- cannot accidentally treat a withdrawn campaign as listed.
create or replace function public.public_campaign_listing(p_slug text)
returns boolean
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select coalesce(
    (select c.public_listed from public.campaigns c
      where c.public_slug = p_slug and c.public_published_at is not null),
    false);
$$;

revoke all on function public.public_listed_campaigns() from public;
revoke all on function public.public_campaign_listing(text) from public;
grant execute on function public.public_listed_campaigns() to anon, authenticated;
grant execute on function public.public_campaign_listing(text) to anon, authenticated;

-- Verify:
--   select * from public.public_listed_campaigns();          -- empty until a GM opts in
--   select public.public_campaign_listing('<slug>');         -- false
