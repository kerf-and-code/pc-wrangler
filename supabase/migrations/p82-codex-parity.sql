-- ============================================================================
-- p82-codex-parity.sql
-- Player codex parity: codex_for_campaign now returns the same rich fields the GM and the public wiki
-- already show for a revealed entry - summary, blocks, tags, image_url - so /me/codex can render the
-- full page and split lore into Factions / Items / Lore by tag on the client (exactly like the wiki),
-- instead of a plain title + body.
--
-- The GATE and reveal logic are UNCHANGED: you must own a PC in the campaign, and an entry shows only
-- if it is common/player or revealed to your PC. NPCs still carry no summary/blocks of their own; their
-- image is the Forge portrait, and their tags come through so a tagged NPC lands in the right place.
--
-- The RETURNS TABLE shape gains columns, which Postgres cannot change in place, so this DROPs and
-- RECREATEs the function and RE-GRANTs execute (a dropped SECURITY DEFINER function loses its grants).
--
-- Idempotent. Run by hand in the Supabase SQL editor.
-- ============================================================================

drop function if exists public.codex_for_campaign(uuid);

create or replace function public.codex_for_campaign(p_campaign uuid)
 returns table(item_kind text, item_type text, id uuid, title text, summary text, body text, blocks jsonb, tags text[], image_url text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with me as (
    -- The gate AND the reveal target, in one: you must own a PC here to see anything, and reveals
    -- are addressed to that PC.
    select ch.id
    from public.characters ch
    where ch.campaign_id = p_campaign
      and ch.kind = 'pc'
      and ch.profile_id = auth.uid()
    limit 1
  ),
  revealed as (
    select er.target_type, er.target_id
    from public.entry_reveals er, me
    where er.revealed_to_character_id = me.id
  )
  select 'entry'::text, e.type, e.id, e.title, e.summary, e.body, e.blocks, e.tags, e.image_url
  from public.entries e
  where exists (select 1 from me)
    and e.campaign_id = p_campaign
    and (e.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type = 'entry' and r.target_id = e.id))
  union all
  select 'npc'::text, 'npc'::text, ch.id, ch.name, null::text, ch.description, null::jsonb, ch.tags, ch.portrait_url
  from public.characters ch
  where exists (select 1 from me)
    and ch.campaign_id = p_campaign
    and ch.kind = 'npc'
    and (ch.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type = 'character' and r.target_id = ch.id));
$function$;

grant execute on function public.codex_for_campaign(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Verify (as a player who owns a PC in the campaign):
--   select item_type, title, (blocks is not null) as has_blocks, tags, image_url
--   from public.codex_for_campaign('<campaign-uuid>');
--   -- revealed entries carry summary/blocks/tags/image_url; factions/items show item_type='lore' with
--   -- their tag, so the client can split them.
-- ----------------------------------------------------------------------------
