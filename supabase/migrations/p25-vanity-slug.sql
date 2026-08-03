-- ============================================================================
-- p25-vanity-slug.sql
-- Let a GM choose a readable address for a published codex.
--
-- WHY THIS IS SAFE NOW AND WOULD NOT HAVE BEEN BEFORE
--   p23 mints a random 16-hex slug, deliberately: an unlisted campaign is readable by anyone with
--   the link, so the link itself is the only thing standing between a stranger and the page. A
--   guessable address would undo that.
--
--   p24 split listing from publishing. A LISTED campaign is in the sitemap and asking to be indexed,
--   so unguessability buys it nothing - the whole point is to be found. That is the case where a
--   readable slug costs nothing and gains a lot: a codex you can say out loud in a Discord message
--   is shared, and one that reads like a hash is not.
--
--   So this function refuses to set a vanity slug on an unlisted campaign. It is not a nag; it is
--   the condition that makes the trade honest.
--
-- WHY A FUNCTION RATHER THAN A CLIENT UPDATE
--   Validation belongs where it cannot be skipped. A slug has to be URL-safe, not collide, not
--   impersonate a reserved word, and not be so short it lands on someone else's page by typo.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

-- Words that must not become a campaign address. Not because they collide with a route - these all
-- live under /c/ - but because /c/admin or /c/login reads as something official, and a codex is
-- authored by a stranger.
create or replace function public.reserved_slug(p_slug text)
returns boolean
language sql
immutable
as $$
  select p_slug = any (array[
    'admin','api','auth','login','logout','signup','sign-up','signin','sign-in',
    'new','edit','delete','settings','account','billing','support','help',
    'gm','me','play','chat','codex','journal','record','claim','join','setup',
    'privacy','terms','about','pricing','blog','docs','status','six-axes','sixaxes'
  ]);
$$;

create or replace function public.set_public_slug(p_campaign uuid, p_slug text)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s text;
begin
  if not public.is_campaign_gm(p_campaign) then
    raise exception 'Only the GM of this campaign can change its address.';
  end if;

  s := lower(trim(coalesce(p_slug, '')));

  if s = '' then
    raise exception 'Give the address some text.';
  end if;
  if length(s) < 3 or length(s) > 40 then
    raise exception 'An address has to be between 3 and 40 characters.';
  end if;
  -- Letters, digits and single inner hyphens. No leading or trailing hyphen, because a trailing one
  -- is invisible when someone reads the link aloud and produces a 404 nobody can explain.
  if s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Use lowercase letters, numbers and hyphens only, and do not start or end with a hyphen.';
  end if;
  if public.reserved_slug(s) then
    raise exception 'That address is reserved. Pick another.';
  end if;

  -- Only for a campaign that has asked to be findable. See the note at the top: on an unlisted
  -- campaign the random address IS the privacy, and replacing it with a guessable one would quietly
  -- remove a protection the GM never agreed to give up.
  if not exists (
    select 1 from public.campaigns
    where id = p_campaign and public_listed and public_published_at is not null
  ) then
    raise exception 'Publish the campaign and turn on search indexing first. While a campaign is unlisted, its random address is what keeps it private.';
  end if;

  if exists (select 1 from public.campaigns where public_slug = s and id <> p_campaign) then
    raise exception 'Another campaign already uses that address.';
  end if;

  update public.campaigns set public_slug = s where id = p_campaign;
  return s;
end;
$$;

revoke all on function public.set_public_slug(uuid, text) from public;
revoke all on function public.reserved_slug(text) from public;
grant execute on function public.set_public_slug(uuid, text) to authenticated;

-- Verify (from the app as the GM; the SQL editor has no auth.uid() so it will refuse):
--   select public.set_public_slug('<campaign id>', 'emberwatch');
