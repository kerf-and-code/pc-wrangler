-- p155-encounter-maps.sql (2026-11-11, push 31, tabletop item V4: one encounter, several maps)
--
-- An encounter can span several tabletop scenes: the decks of a ship, the floors of a tower, or two
-- halves of a split party fighting at once. encounters.maps lists those scenes (vtt_scenes ids, in
-- order; the first is where the fight starts), and each foe in encounters.foes may carry the scene
-- it starts on ("scene", inside the jsonb, no column of its own). When the fight runs, each monster
-- keeps that scene (combats.combatants[].sceneId) so "Put all on the table" puts every token on its
-- own map. The fight itself stays one combats row, so the turn order is shared across the maps.
--
-- Encounters keep their existing policy (the campaign's GMs). An empty list means what it always has:
-- the fight goes on the table's active scene.
--
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p155-encounter-maps-check.sql

alter table public.encounters add column if not exists maps jsonb not null default '[]'::jsonb;

alter table public.encounters drop constraint if exists encounters_maps_shape;
alter table public.encounters add constraint encounters_maps_shape check (
  jsonb_typeof(maps) = 'array' and jsonb_array_length(maps) <= 12
);

insert into public._migrations (name) values ('p155-encounter-maps') on conflict do nothing;
