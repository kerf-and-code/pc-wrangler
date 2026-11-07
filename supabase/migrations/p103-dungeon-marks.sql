-- p103-dungeon-marks.sql
--
-- The adventure-book dungeon builder (2026-11-06) draws doors, furniture and room labels, and a title,
-- so a dungeon map needs somewhere to keep them. Two columns on the existing dungeon_maps row:
--
--   marks = [ { "features": { "<cell>": { "k": "pillar", "r": 0 } },
--               "doors":    { "<cell>h" | "<cell>v": "door" | "double" | "locked" | "secret" | "portcullis" | "arch" },
--               "labels":   { "<cell>": "A" } },                                   -- one object per level
--             ... ]
--   meta  = { "title": "...", "levelNames": ["...", "...", "..."], "autoNumber": true, "grid": true }
--
-- A door key names an EDGE: "<cell>h" is the top edge of that square, "<cell>v" its left edge.
--
-- Back-compat: both default to empty, so existing rows read as "no doors, no furniture, default title".
-- The existing GM-only policy on dungeon_maps already covers the new columns. Idempotent; run by hand
-- BEFORE deploying the new builder (until then the builder saves the floor plan but reports that the
-- doors and furniture could not be saved).

alter table public.dungeon_maps
  add column if not exists marks jsonb not null default '[]'::jsonb;

alter table public.dungeon_maps
  add column if not exists meta jsonb not null default '{}'::jsonb;

comment on column public.dungeon_maps.marks is
  'Per level: features (cell -> {k, r}), doors (edge key -> kind), labels (cell -> text). See p103.';
comment on column public.dungeon_maps.meta is
  'Map title, level names, autoNumber and grid toggles for the adventure-book renderer. See p103.';
