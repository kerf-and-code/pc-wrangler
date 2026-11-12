-- npc-text-in-locations-check.sql (2026-11-11, push 40). Read-only dry run for p163-npc-text-fix.sql.
--
-- The old Review bug (fixed 2026-08-02) wrote an NPC's beat text onto the LOCATION from the same beat and
-- left the NPC empty. Candidates: a location with text, linked to exactly one NPC whose description is
-- empty. names_npc says whether the location's text mentions that NPC by name; p163 moves ONLY those rows,
-- and only in the campaigns of the GM who runs Emberwatch (so another GM's campaign is never touched).
-- Read every row before running p163.

with links as (
  select l.campaign_id,
         case when l.source_type = 'entry' then l.source_id else l.target_id end as entry_id,
         case when l.source_type = 'character' then l.source_id else l.target_id end as character_id
    from public.entity_links l
   where (l.source_type = 'entry' and l.target_type = 'character')
      or (l.source_type = 'character' and l.target_type = 'entry')
),
npc_links as (
  select distinct lk.campaign_id, lk.entry_id, lk.character_id
    from links lk join public.characters ch on ch.id = lk.character_id and ch.kind = 'npc'
),
one_npc as (
  select entry_id from npc_links group by entry_id having count(distinct character_id) = 1
)
select c.name as campaign,
       c.gm_id = (select gm_id from public.campaigns where name = 'Emberwatch' order by created_at limit 1) as yours,
       e.title as location, ch.name as npc,
       position(lower(ch.name) in lower(e.body)) > 0 as names_npc,
       left(regexp_replace(e.body, '\s+', ' ', 'g'), 160) as location_text
  from npc_links nl
  join one_npc o on o.entry_id = nl.entry_id
  join public.entries e on e.id = nl.entry_id and e.type = 'location'
  join public.characters ch on ch.id = nl.character_id
  join public.campaigns c on c.id = e.campaign_id
 where coalesce(trim(e.body), '') <> ''
   and coalesce(trim(ch.description), '') = ''
 order by yours desc, c.name, e.title;
