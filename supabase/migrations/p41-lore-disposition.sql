-- p41-lore-disposition.sql
-- Change 2, step 1: a triage state for lore beats the fold (change 1) could not place.
--
-- After change 1, a lore beat that named no single entity is an approved gm_event of kind 'lore'
-- with all three entity FKs null. That is the "needs triage" state the proposals surface reads.
-- attach and create-new resolve a beat by setting an FK, so they need no marker here. keep and
-- dismiss do not set an FK, so they carry their outcome in this column instead:
--
--   null         needs triage (a new unresolved beat), OR resolved by attach/create (an FK is set)
--   'legacy'     approved before this change; kept out of the new surface so it starts empty
--   'kept'       the GM chose to keep it as its own titled lore entry
--   'dismissed'  the GM discarded it as table talk
--
-- The surface query is:
--   kind = 'lore' and npc_id is null and location_id is null and faction_id is null
--                 and lore_disposition is null
--
-- IDEMPOTENT BY CONSTRUCTION. The column add and the one-time legacy backfill run ONLY when the
-- column does not yet exist, inside a guard. Re-running the file does nothing, so a new unresolved
-- beat approved after this migration is never swept into 'legacy' by a second run. That distinction
-- is the whole reason the backfill is not a bare UPDATE: a bare "set legacy where disposition null"
-- would, on any later re-run, quietly hide every beat awaiting triage.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name  = 'gm_events'
      and column_name = 'lore_disposition'
  ) then
    alter table public.gm_events
      add column lore_disposition text
      check (lore_disposition in ('legacy', 'kept', 'dismissed'));

    -- Every lore beat that exists at this instant predates the surface, so it is filed as legacy and
    -- the GM sees only what they approve from here on. The visible backlog of sentence-titled lore
    -- entries is cleaned by the retro pass (change 3), separately and by review, not here.
    update public.gm_events
       set lore_disposition = 'legacy'
     where kind = 'lore';
  end if;
end $$;
