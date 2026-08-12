-- p55-public-world-snapshot.sql
-- The wiki is read by strangers with no session, through security-definer public_* RPCs keyed by the
-- campaign slug. This adds the world-map equivalent: given a slug, return the snapshot URL, but only
-- when the map is published. Anon holds no rights of its own; the function decides. Returns null when
-- the campaign does not exist, has no map, or the map is not published, so the wiki simply shows
-- nothing in those cases. Mirrors how public_campaign resolves a slug. Idempotent.

create or replace function public.public_world_snapshot(p_slug text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select wm.snapshot_url
  from campaigns c
  join world_maps wm on wm.campaign_id = c.id
  where c.slug = p_slug
    and wm.published
    and wm.snapshot_url is not null
  limit 1;
$function$;

grant execute on function public.public_world_snapshot(text) to anon, authenticated;
