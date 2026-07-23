-- p10-map-is-a-place.sql
--
-- Let a map say which place it depicts.
--
-- WHY
--
-- Maps were modelled as pure backdrops: a name, an image, and pins on top. But a campaign's
-- maps are usually maps OF somewhere. In Emberwatch, "Hallowmere" is the site map of the
-- Hollowmere Waystation and "The Ashmoore" is the site map of The Ashmoor, which means
-- neither place can be pinned: you cannot put a pin for Hollowmere on the map that already
-- is Hollowmere.
--
-- The consequence showed up the moment a session trace was attempted. Session 2 visited
-- The Toll-Bridge, The Ashmoor, Hollowmere Waystation and The old hill-fort, and exactly
-- one of those four had a pin, so there was no line to draw. The places were not missing,
-- they were the maps.
--
-- With this column a trace stop resolves to EITHER a pin on the current map OR a map of its
-- own, and "the party went to Hollowmere" can open the Hollowmere map instead of pointing
-- at nothing.
--
-- WHY THERE IS NO BACKFILL
--
-- Name matching would fail on the only two maps that exist: "Hallowmere" against
-- "Hollowmere Waystation" and "The Ashmoore" against "The Ashmoor" differ by more than
-- case or whitespace. Guessing across that gap is exactly the silent mis-link this column
-- exists to prevent, so the GM picks from a dropdown instead. Two maps, two clicks.
--
-- ON DELETE SET NULL: deleting the Codex entry for a place should orphan the link, never
-- delete the map image behind it.

alter table public.maps
  add column if not exists linked_entry_id uuid references public.entries(id) on delete set null;

-- The query this exists for is "is there a map of this place?", asked once per stop while
-- drawing a trace.
create index if not exists maps_linked_entry_idx on public.maps(linked_entry_id);
