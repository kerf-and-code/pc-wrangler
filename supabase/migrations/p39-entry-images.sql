-- ============================================================================
-- p39-entry-images.sql
-- An image for each codex entry, and surface the one NPCs already have.
--
-- HALF OF THIS ALREADY EXISTED. characters.portrait_url has been populated since the Forge shipped
-- portrait uploads, and NPCs on the published wiki are characters - so every NPC portrait a GM has
-- ever uploaded is already sitting there unused by the public page. Only entries need a new column.
--
-- ONE URL, NOT A GALLERY. A place gets a picture, not an album. A gallery needs ordering, captions,
-- a lightbox and a delete-one-of-many flow, and none of that is what a GM asks for when they say
-- "each entry needs an image". If galleries are ever wanted they are a table, not a widening of
-- this column.
--
-- STORAGE IS ALREADY CLEARED: p36 grants the campaign's GM write access to <campaign_id>/codex/*,
-- so entry images go to <campaign_id>/codex/entries/<entry_id>.<ext> with no new policy.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

alter table public.entries
  add column if not exists image_url text;

comment on column public.entries.image_url is
  'Optional image for this entry, shown on its wiki page and as a thumbnail in category lists. '
  'Null renders no image rather than a placeholder.';

-- The published page reads through public_codex(), so a column it does not return does not exist as
-- far as that page is concerned. RETURNS TABLE cannot change in place, hence drop and recreate -
-- and re-grant, because dropping a SECURITY DEFINER function drops its grants and every published
-- codex would 404 for anonymous readers while looking fine to a signed-in GM.
begin;

drop function if exists public.public_codex(text);

create function public.public_codex(p_slug text)
returns table (
  item_kind text,
  item_type text,
  id uuid,
  title text,
  body text,
  tags text[],
  slug text,
  image_url text
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with camp as (
    select id from public.campaigns
    where public_slug = p_slug and public_published_at is not null
  )
  select 'entry'::text, e.type::text, e.id, e.title, e.body, e.tags, e.slug, e.image_url
  from public.entries e, camp
  where e.campaign_id = camp.id and e.is_public
  union all
  -- NPCs bring the portrait the GM already uploaded in the Forge. Nothing new to fill in.
  select 'npc'::text, 'npc'::text, ch.id, ch.name, ch.description, ch.tags,
         public.slugify(ch.name), ch.portrait_url
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'npc' and ch.is_public;
$function$;

commit;

grant execute on function public.public_codex(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Verify:
--   select * from public.public_codex('<your-slug>') limit 5;   -- expect eight columns
--   select count(*) filter (where image_url is not null) as npcs_with_a_portrait
--   from public.characters where kind = 'npc';
--
-- public_campaign() calls public_codex() for its item count, so confirm that still returns:
--   select * from public.public_campaign('<your-slug>');
--
-- Then load /c/<slug> LOGGED OUT, in a private window.
-- ----------------------------------------------------------------------------
