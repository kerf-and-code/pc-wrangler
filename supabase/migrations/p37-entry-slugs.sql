-- ============================================================================
-- p37-entry-slugs.sql
-- A stable, readable URL segment for every codex entry.
--
-- WHY SLUGS AT ALL
--   /c/<campaign>/locations/the-toll-bridge is shareable and readable; /c/<campaign>/e/<uuid> is
--   neither. The published codex is the one surface a GM hands to people, so the URL is part of it.
--
-- GENERATED ONCE AND KEPT. This is the decision that matters. If a slug followed the title, a GM
-- fixing a typo would break every link anyone had shared - silently, because nothing tells you a
-- URL you sent last week now 404s. So the slug is written when an entry is created and never
-- changes on its own. A GM who WANTS a new one gets a regenerate control that says plainly what it
-- costs.
--
-- UNIQUE PER CAMPAIGN, not globally: two campaigns may both have a Toll-Bridge and neither should
-- have to be "the-toll-bridge-2" because the other got there first.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

alter table public.entries
  add column if not exists slug text;

-- Lowercase, alphanumerics and single hyphens. Deliberately plain: a slug that carries accents or
-- punctuation is a slug that behaves differently depending on which browser typed it.
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g')
    ), '');
$$;

-- Find a free slug for a campaign, appending -2, -3 and so on. Excludes the row itself so an
-- update does not collide with its own current value.
create or replace function public.free_entry_slug(p_campaign uuid, p_base text, p_self uuid)
returns text
language plpgsql
stable
as $$
declare
  base text := coalesce(public.slugify(p_base), 'entry');
  try  text := base;
  n    integer := 1;
begin
  while exists (
    select 1 from public.entries e
    where e.campaign_id = p_campaign
      and e.slug = try
      and (p_self is null or e.id <> p_self)
  ) loop
    n := n + 1;
    try := base || '-' || n;
  end loop;
  return try;
end;
$$;

-- Backfill. Ordered by created_at so the OLDEST entry keeps the clean slug and later duplicates
-- take the suffix - the opposite would hand the plain URL to whichever row the planner happened to
-- reach first, which is not stable between runs.
do $$
declare r record;
begin
  for r in
    select id, campaign_id, title from public.entries
    where slug is null order by created_at, id
  loop
    update public.entries
       set slug = public.free_entry_slug(r.campaign_id, r.title, r.id)
     where id = r.id;
  end loop;
end $$;

-- New entries get one automatically, because a slug that has to be remembered at every insert site
-- is a slug that will be missing from one of them.
create or replace function public.entries_set_slug()
returns trigger language plpgsql as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := public.free_entry_slug(new.campaign_id, new.title, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists entries_slug on public.entries;
create trigger entries_slug
  before insert on public.entries
  for each row execute function public.entries_set_slug();

create unique index if not exists entries_campaign_slug_uniq
  on public.entries (campaign_id, slug)
  where slug is not null;

-- ----------------------------------------------------------------------------
-- Verify:
--   select count(*) from public.entries where slug is null;   -- expect 0
--   select campaign_id, slug, count(*) from public.entries
--   group by campaign_id, slug having count(*) > 1;           -- expect no rows
--   select title, slug from public.entries limit 10;
-- ----------------------------------------------------------------------------
