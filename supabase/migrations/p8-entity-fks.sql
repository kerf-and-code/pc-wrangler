-- p8-entity-fks.sql
--
-- Give GM events real pointers to the Codex entries they create, instead of only the
-- name strings they were extracted with.
--
-- WHY
--
-- gm_events already carries npc_id as a proper foreign key, but location_name and
-- faction_name stay text-only. So an event knows it happened at "Candlekeep" but has no
-- link to the Candlekeep entry, and anything that wants to join sessions to places has to
-- match on the string. That breaks the moment a GM renames an entry, and it makes the
-- Timeline unable to show where a session went without fragile text matching.
--
-- npc_id proves the pattern is right. This extends it to the other two kinds.
--
-- ON DELETE SET NULL, not cascade: deleting a Codex entry should orphan the pointer, never
-- delete the historical record of what happened at the table. The name string stays
-- alongside as the fallback, which is also what makes the backfill re-runnable.
--
-- Both tables get the columns so the proposed and approved rows stay the same shape, the
-- way npc_id already does.

alter table public.gm_events
  add column if not exists location_id uuid references public.entries(id) on delete set null;

alter table public.gm_events
  add column if not exists faction_id uuid references public.entries(id) on delete set null;

alter table public.gm_proposed_events
  add column if not exists location_id uuid references public.entries(id) on delete set null;

alter table public.gm_proposed_events
  add column if not exists faction_id uuid references public.entries(id) on delete set null;

-- Indexed because the intended query is "every event at this place", which is the
-- Timeline's entity filter and the Codex page's appearance list.
create index if not exists gm_events_location_idx on public.gm_events(location_id);
create index if not exists gm_events_faction_idx  on public.gm_events(faction_id);
