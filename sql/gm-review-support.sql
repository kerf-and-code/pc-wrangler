-- gm-review support: conventions the Accept + create / multi-select cross-linking
-- flow relies on. The tables (entries, entity_links, characters) already exist;
-- this file documents the contract and is a safe no-op if everything is present.
--
-- entries:        Codex entries. type in (note, location, lore). created_by NOT NULL
--                 (must be set to the GM uid on insert). tags text[] (e.g. ['faction'],
--                 ['item']). visibility in (gm, player, common).
-- entity_links:   cross-references. source_type/target_type in ('entry','character'),
--                 source_id/target_id the entity ids, relation free text.
-- characters:     NPCs are kind='npc' (no created_by requirement).
--
-- Relation defaults written by the multi-select accept (app/api/gm-review/route.ts):
--   npc  -> faction   : "member of"     npc  -> location : "at"
--   location -> faction: "held by"      npc  -> item     : "carries"
--   item -> location  : "found at"      item -> faction  : "tied to"
--   lore -> {npc,location,faction,item} : "concerns"
--
-- Ensure entity_links has an index for the Connections lookups (safe if it exists):
create index if not exists entity_links_source_idx on public.entity_links(source_type, source_id);
create index if not exists entity_links_target_idx on public.entity_links(target_type, target_id);
create index if not exists entity_links_campaign_idx on public.entity_links(campaign_id);
