-- ============================================================================
-- p80-character-wiki-page.sql
-- Public, player-editable character PAGE on the wiki.
--
-- ADDITIVE and INDEPENDENT of p78-character-wiki.sql. p78 built the player's PRIVATE /
-- GM-shared narrative sections (character_wiki_sections + character_wiki_gm_edit), surfaced
-- at app/me/characters/[id]. THIS migration builds a SEPARATE thing: a PUBLIC character page
-- that reuses the GM's block system (text full/half, inserted images, side-panel images,
-- connections) and that the player opts in per character. The two coexist and share no tables.
--
-- WHY THIS IS SMALL: characters ALREADY has is_public (owner-settable via the existing
-- "owner or gm edits character" UPDATE policy) and portrait_url. public_codex already
-- publishes NPCs on is_public. So a PC opts in by setting its OWN is_public, and its hero
-- image is the Forge portrait. The only gap versus entries is a rich body (blocks) and a
-- one-line summary. Two columns, one storage policy, two RPC bodies. No new visibility flag.
--
-- Idempotent. Run by hand in the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The rich body a PC page needs, mirroring entries.blocks / entries.summary.
--    blocks is the ordered block list (text/header/image, width full|half, image align,
--    slot body|panel) written by the shared BlockEditor; summary is the italic lede.
--    Nullable: a PC with no page yet simply has null blocks and falls back to description.
-- ---------------------------------------------------------------------------
alter table public.characters
  add column if not exists blocks  jsonb,
  add column if not exists summary text;

-- ---------------------------------------------------------------------------
-- 2. Let a player upload block images for their OWN character.
--
--    PATH CONVENTION:  <campaign_id>/pc/<character_id>/blocks/<random>.<ext>
--      storage.foldername(name) = { <campaign_id>, 'pc', <character_id>, 'blocks' }
--      (the filename is random, so the character id is a path SEGMENT at index 3, unlike
--       the portrait policy which keys on the filename.)
--
--    can_write_character_portrait(text) is the generic owner-or-GM character check despite
--    its name: it guards the uuid format, then returns true when the caller owns the
--    character (profile_id = auth.uid()) or is its campaign GM. Reused here so there is one
--    definition of "may write this character's images". Because it guards the cast, a short
--    or malformed path yields false rather than raising, so this policy cannot abort a
--    statement the way an unguarded cast did in the p18 map-policy incident.
-- ---------------------------------------------------------------------------
drop policy if exists "player writes own pc block image" on storage.objects;
create policy "player writes own pc block image"
on storage.objects for all to authenticated
using (
  bucket_id = 'campaign-maps'
  and (storage.foldername(name))[2] = 'pc'
  and (storage.foldername(name))[4] = 'blocks'
  and public.can_write_character_portrait((storage.foldername(name))[3])
)
with check (
  bucket_id = 'campaign-maps'
  and (storage.foldername(name))[2] = 'pc'
  and (storage.foldername(name))[4] = 'blocks'
  and public.can_write_character_portrait((storage.foldername(name))[3])
);

-- ---------------------------------------------------------------------------
-- 3. public_codex: also publish opted-in player characters.
--    Return shape is UNCHANGED, so CREATE OR REPLACE keeps the anon EXECUTE grant (no
--    drop-and-regrant). PCs carry their own summary + blocks; NPCs still do not.
-- ---------------------------------------------------------------------------
create or replace function public.public_codex(p_slug text)
 returns table(item_kind text, item_type text, id uuid, title text, summary text, body text, blocks jsonb, tags text[], slug text, image_url text)
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  with camp as (
    select id from public.campaigns
    where public_slug = p_slug and public_published_at is not null
  )
  select 'entry'::text, e.type::text, e.id, e.title, e.summary, e.body, e.blocks, e.tags, e.slug, e.image_url
  from public.entries e, camp
  where e.campaign_id = camp.id and e.is_public
  union all
  -- NPCs bring the portrait the GM already uploaded in the Forge; no summary or blocks of their own.
  select 'npc'::text, 'npc'::text, ch.id, ch.name, null::text, ch.description, null::jsonb, ch.tags,
         public.slugify(ch.name), ch.portrait_url
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'npc' and ch.is_public
  union all
  -- Player characters the PLAYER has opted in (is_public, set by the owner via the existing character
  -- UPDATE policy). Unlike NPCs they carry their own summary + blocks (the player's rich page); the
  -- hero image reuses the Forge portrait. Campaign must still be published (the camp CTE gate).
  select 'pc'::text, 'pc'::text, ch.id, ch.name, ch.summary, ch.description, ch.blocks, ch.tags,
         public.slugify(ch.name), ch.portrait_url
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'pc' and ch.is_public;
$function$;

-- ---------------------------------------------------------------------------
-- 4. public_codex_links: include links touching opted-in PCs.
--    entity_links types a PC endpoint as 'character' (same as an NPC, since a PC is a
--    character row), so the only change is widening the pub set to kind in ('npc','pc').
--    Return shape unchanged -> CREATE OR REPLACE preserves the grant.
-- ---------------------------------------------------------------------------
create or replace function public.public_codex_links(p_slug text)
 returns table(source_type text, source_id uuid, target_type text, target_id uuid, relation text)
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  with camp as (
    select id from public.campaigns
    where public_slug = p_slug and public_published_at is not null
  ),
  pub as (
    -- the publicly visible items, typed the way entity_links refers to them
    select 'entry'::text as etype, e.id
    from public.entries e, camp
    where e.campaign_id = camp.id and e.is_public
    union all
    select 'character'::text, ch.id
    from public.characters ch, camp
    where ch.campaign_id = camp.id and ch.kind in ('npc', 'pc') and ch.is_public
  )
  select l.source_type, l.source_id, l.target_type, l.target_id, l.relation
  from public.entity_links l, camp
  where l.campaign_id = camp.id
    and exists (select 1 from pub p where p.etype = l.source_type and p.id = l.source_id)
    and exists (select 1 from pub p where p.etype = l.target_type and p.id = l.target_id);
$function$;

-- ----------------------------------------------------------------------------
-- Verify:
--   \d public.characters                    -- blocks (jsonb) and summary (text) present
--   as a PLAYER on their own PC: update characters set is_public = true where id = '<mine>';
--     then select item_kind, title, image_url from public.public_codex('<published-slug>')
--     -- the PC appears as item_kind 'pc' with its portrait as image_url
--   as a PLAYER: upload to campaign-maps at '<campaign>/pc/<own-char>/blocks/x.png' -> allowed;
--     to '<campaign>/pc/<someone-elses-char>/blocks/x.png' -> denied.
-- ----------------------------------------------------------------------------
