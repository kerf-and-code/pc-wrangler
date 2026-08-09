-- ============================================================================
-- p40-regenerate-slug.sql
-- Let a GM deliberately move an entry's URL.
--
-- WHY THIS IS A DELIBERATE ACT AND NOT AUTOMATIC
--   p37 fixed the slug at creation so that fixing a typo in a title never breaks a link somebody
--   shared. That is right by default and wrong occasionally: rename "The Toll-Bridge" to "Grultok's
--   Crossing" and the URL still says the-toll-bridge, which is odd for anyone who reads URLs.
--
--   So the GM can ask for a new one. The cost is that the old address stops working, and the UI
--   says so before they press it. This function does NOT warn - a database function cannot - which
--   is exactly why it is a separate explicit call rather than something an update trigger does
--   quietly on every title change.
--
-- SECURITY DEFINER, GM ONLY. It writes to entries on behalf of the caller, so it checks that the
-- caller runs the campaign the entry belongs to. Without that check any authenticated user could
-- move any entry's URL in any campaign.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

create or replace function public.regenerate_entry_slug(p_entry uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_campaign uuid;
  v_title    text;
  v_slug     text;
begin
  select e.campaign_id, e.title into v_campaign, v_title
  from public.entries e where e.id = p_entry;

  if v_campaign is null then
    raise exception 'No such entry.';
  end if;
  if not public.is_campaign_gm(v_campaign) then
    raise exception 'Only the GM of this campaign can change its URLs.';
  end if;

  -- Passing the entry's own id so the collision check ignores its CURRENT slug: without it, an
  -- entry whose title has not changed would collide with itself and come back as "-2".
  v_slug := public.free_entry_slug(v_campaign, v_title, p_entry);

  update public.entries set slug = v_slug where id = p_entry;
  return v_slug;
end;
$$;

revoke all on function public.regenerate_entry_slug(uuid) from public;
grant execute on function public.regenerate_entry_slug(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Verify, as the GM of the campaign that entry belongs to:
--   select public.regenerate_entry_slug('<entry-id>');
--
-- And confirm it refuses for someone else's campaign - it should raise, not return null.
-- ----------------------------------------------------------------------------
