-- B1 Automated worldbuilding: faction capture. Adds faction_name to the GM event
-- proposal + canonical tables so the extractor and Accept + create can carry factions.

alter table public.gm_proposed_events add column if not exists faction_name text;
alter table public.gm_events          add column if not exists faction_name text;
