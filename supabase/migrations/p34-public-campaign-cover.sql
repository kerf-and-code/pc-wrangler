-- ============================================================================
-- p34-public-campaign-cover.sql
-- Return the codex cover from public_campaign().
--
-- p33 added campaigns.codex_cover_url, but the published page does not select from campaigns - it
-- goes through public_campaign(), a SECURITY DEFINER function that decides exactly what an
-- anonymous visitor may see. A column the function does not return does not exist as far as that
-- page is concerned, which is the whole point of the function and why the cover needs adding here
-- explicitly rather than arriving for free.
--
-- WHY DROP AND RECREATE
--   Postgres will not change a function's RETURNS TABLE shape in place; CREATE OR REPLACE fails
--   with "cannot change return type of existing function". The drop and the create are in one
--   transaction so the public codex is never live with the function missing.
--
-- The body is otherwise unchanged from the deployed definition: same columns, same slug and
-- published-at guard, same count. Only the cover is added.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

begin;

drop function if exists public.public_campaign(text);

create function public.public_campaign(p_slug text)
returns table (
  name text,
  blurb text,
  published_at timestamp with time zone,
  items bigint,
  codex_cover_url text
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select c.name, c.public_blurb, c.public_published_at,
         (select count(*) from public.public_codex(p_slug)),
         c.codex_cover_url
  from public.campaigns c
  where c.public_slug = p_slug and c.public_published_at is not null;
$function$;

commit;

-- The function is SECURITY DEFINER, so it runs as its owner and needs execute granted to the
-- anonymous role the published page uses. Dropping the function dropped its grants with it.
grant execute on function public.public_campaign(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Verify with a slug you have actually published:
--   select * from public.public_campaign('<your-slug>');
--   -- expect five columns, the fifth being the cover (null until a GM sets one)
--
-- And confirm the page still loads for a logged-out visitor at /c/<slug>.
-- ----------------------------------------------------------------------------
