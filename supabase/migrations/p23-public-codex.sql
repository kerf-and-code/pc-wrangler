-- ============================================================================
-- p23-public-codex.sql
-- Phase 2 foundation: a campaign codex that can be published as a public, readable site.
--
-- WHY A SEPARATE SLUG AND NOT share_code
--   Every existing public surface keys on campaigns.share_code, and share_code is ALSO the player
--   entry point: /play?share=<code> is where a person claims a character and sees the table. If the
--   public wiki lived on that code, publishing a campaign page would hand its private entry link to
--   every reader, and it could never be revoked without breaking the players' link too.
--
--   public_slug is separate, independently rotatable, and carries no ability to claim anything.
--   Randomly generated rather than derived from the campaign name: a guessable slug is an
--   enumeration surface, and a name-derived one breaks when the campaign is renamed.
--
-- WHY PUBLISHING IS OPT-IN TWICE
--   A codex holds things said at somebody's table and details of players' characters. Publishing it
--   is not a display preference, it is a disclosure. So it takes TWO deliberate acts: the GM
--   publishes the campaign, AND marks each entry public. Neither default is true, and the campaign
--   switch alone reveals nothing.
--
--   This mirrors the consent model rather than inventing a second standard. It also means a GM can
--   publish the setting and the cast while keeping the plot hooks their players have not found yet,
--   which is the difference between a shareable wiki and a spoiler.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Campaign: the public identity, separate from the player one
-- ----------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists public_slug text,
  add column if not exists public_published_at timestamptz,
  add column if not exists public_blurb text;

create unique index if not exists campaigns_public_slug_key
  on public.campaigns (public_slug)
  where public_slug is not null;

comment on column public.campaigns.public_slug is
  'Address of the published codex. Deliberately NOT share_code: that one is the player entry point '
  'and grants character claiming, so reusing it would make every reader a potential claimant.';
comment on column public.campaigns.public_published_at is
  'Null means unpublished. Nothing is readable by anon while this is null, whatever individual '
  'entries are marked.';

-- ----------------------------------------------------------------------------
-- Per-item opt-in. Default false everywhere: publishing is a decision, not a fallthrough.
-- ----------------------------------------------------------------------------

alter table public.entries
  add column if not exists is_public boolean not null default false;

alter table public.characters
  add column if not exists is_public boolean not null default false;

create index if not exists entries_public_idx
  on public.entries (campaign_id) where is_public;
create index if not exists characters_public_idx
  on public.characters (campaign_id) where is_public;

-- ----------------------------------------------------------------------------
-- Slug minting. Random, not derived, and long enough not to be worth guessing.
-- ----------------------------------------------------------------------------

create or replace function public.mint_public_slug(p_campaign uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  s text;
begin
  if not public.is_campaign_gm(p_campaign) then
    raise exception 'Only the GM of this campaign can publish it.';
  end if;
  loop
    -- 16 hex chars. Collisions are handled by the loop rather than assumed away.
    s := encode(gen_random_bytes(8), 'hex');
    exit when not exists (select 1 from public.campaigns where public_slug = s);
  end loop;
  update public.campaigns set public_slug = s where id = p_campaign;
  return s;
end;
$$;

revoke all on function public.mint_public_slug(uuid) from public;
grant execute on function public.mint_public_slug(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- The public read. One function, granted to anon, returning ONLY published material.
--
-- SECURITY DEFINER because anon has no rights on entries or characters and should not gain any:
-- everything a reader can see passes through this one gate, so the rule lives in exactly one place
-- rather than being spread across RLS policies that a later migration might widen by accident.
-- ----------------------------------------------------------------------------

create or replace function public.public_codex(p_slug text)
returns table (
  item_kind text,   -- 'entry' | 'npc'
  item_type text,   -- entries.type, or 'npc'
  id uuid,
  title text,
  body text,
  tags text[]
)
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  with camp as (
    select id from public.campaigns
    where public_slug = p_slug and public_published_at is not null
  )
  select 'entry'::text, e.type::text, e.id, e.title, e.body, e.tags
  from public.entries e, camp
  where e.campaign_id = camp.id and e.is_public
  union all
  select 'npc'::text, 'npc'::text, ch.id, ch.name, ch.description, ch.tags
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'npc' and ch.is_public;
$$;

create or replace function public.public_campaign(p_slug text)
returns table (name text, blurb text, published_at timestamptz, items bigint)
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select c.name, c.public_blurb, c.public_published_at,
         (select count(*) from public.public_codex(p_slug))
  from public.campaigns c
  where c.public_slug = p_slug and c.public_published_at is not null;
$$;

revoke all on function public.public_codex(text) from public;
revoke all on function public.public_campaign(text) from public;
grant execute on function public.public_codex(text) to anon, authenticated;
grant execute on function public.public_campaign(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Verify. The middle one is the one that matters: an unpublished campaign must return nothing even
-- when its entries are individually marked public.
--
--   select public.mint_public_slug('<campaign id>');
--   select * from public.public_codex('<slug>');            -- empty until published
--   update public.campaigns set public_published_at = now() where id = '<campaign id>';
--   select * from public.public_codex('<slug>');
-- ----------------------------------------------------------------------------
