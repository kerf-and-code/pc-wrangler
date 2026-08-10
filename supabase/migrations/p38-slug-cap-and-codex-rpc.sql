-- ============================================================================
-- p38-slug-cap-and-codex-rpc.sql
-- Cap slug length, and return the slug from public_codex().
--
-- WHAT p37 REVEALED
--   Some entry TITLES are whole sentences - "Singing crystal wind chimes are available; they emit a
--   low frequency that deters goblins and giant mosquitoes" - almost certainly auto-created from
--   session beats, where the beat text became the title. p37 turned each into a 100-character slug.
--
--   The slug is the symptom; the title is the problem, and this migration does NOT try to fix the
--   titles. Rewriting a GM's entry titles automatically would be guessing at what they meant, and
--   guessing quietly is worse than a long URL. What it does is stop the URL being absurd.
--
-- CAPPED AT 60 CHARACTERS, ON A WORD BOUNDARY. Long enough that a real name survives whole -
--   "hollowmere-waystation" is 21 - and short enough that a sentence becomes a readable stub rather
--   than a paragraph in the address bar. Cutting mid-word would produce "...that-deters-gob".
--
-- THE RPC
--   The published page reads through public_codex(), so a column it does not return does not exist
--   as far as that page is concerned. RETURNS TABLE cannot change in place, so this drops and
--   recreates - and re-grants execute, because dropping a SECURITY DEFINER function drops its
--   grants and every published codex would 404 for anonymous readers while looking fine to a GM.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

create or replace function public.slugify(p_text text)
returns text
language sql
immutable
as $$
  with cleaned as (
    select trim(both '-' from
      regexp_replace(
        regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g')) as s
  )
  select nullif(
    case
      when length(s) <= 60 then s
      -- Back up to the last hyphen inside the limit so the cut lands between words.
      else trim(both '-' from left(s, 60 - position('-' in reverse(left(s, 61)))))
    end, '')
  from cleaned;
$$;

-- Re-slug only the ones the cap would shorten. Everything else keeps the URL it already has,
-- because a slug that changes is a link that breaks and there is no reason to touch the short ones.
do $$
declare r record;
begin
  for r in
    select id, campaign_id, title from public.entries
    where slug is not null and length(slug) > 60 order by created_at, id
  loop
    update public.entries
       set slug = public.free_entry_slug(r.campaign_id, r.title, r.id)
     where id = r.id;
  end loop;
end $$;

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
  slug text
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
  select 'entry'::text, e.type::text, e.id, e.title, e.body, e.tags, e.slug
  from public.entries e, camp
  where e.campaign_id = camp.id and e.is_public
  union all
  -- NPCs are `characters`, which have no slug column, so one is derived on the fly. They are read
  -- only by name here and never written back, so a derived value is safe - and giving characters a
  -- slug column of their own would be a second migration for a second table to solve a problem the
  -- public page does not have yet.
  select 'npc'::text, 'npc'::text, ch.id, ch.name, ch.description, ch.tags,
         public.slugify(ch.name)
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'npc' and ch.is_public;
$function$;

commit;

grant execute on function public.public_codex(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Verify:
--   select max(length(slug)) from public.entries;              -- expect <= 60
--   select * from public.public_codex('<your-slug>') limit 5;   -- expect seven columns
--
-- public_campaign() calls public_codex() for its item count, so confirm that still works:
--   select * from public.public_campaign('<your-slug>');
--
-- Then load /c/<slug> LOGGED OUT, in a private window.
-- ----------------------------------------------------------------------------
