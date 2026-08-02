-- ============================================================================
-- p21-segment-attribution.sql
-- Let a single track hold segments belonging to different people.
--
-- THE PROBLEM THIS SOLVES
--   Both extractors partition a job BY TRACK. The GM extractor takes segments whose track carries a
--   gm_identity_id; the player extractor takes the rest. That works perfectly when Discord hands us
--   one file per person, because the track IS the identity.
--
--   A room recording breaks it completely. One microphone, one track, everyone on it. A room track
--   has no gm_identity_id, so the whole night - narration, rulings, lore, NPC voices - falls to the
--   PLAYER extractor. GM speech would be extracted as player events and fed to the disposition
--   model as player behaviour, which is worse than not capturing it at all: it is wrong data
--   presented with the same confidence as right data.
--
--   transcript_segments already carries character_id. This adds the GM counterpart, so attribution
--   can live at the segment where a room recording needs it, while the Discord path keeps working
--   exactly as before (its segments inherit from the track and these stay null).
--
-- Nullable, and null means "ask the track", which is what every existing row means.
-- ============================================================================

alter table public.transcript_segments
  add column if not exists gm_identity_id uuid references public.gm_identities (id) on delete set null;

comment on column public.transcript_segments.gm_identity_id is
  'Set only on room recordings, where one track holds several speakers and attribution cannot be '
  'inherited from the track. Null everywhere else, meaning "this segment belongs to whoever the '
  'track belongs to".';

create index if not exists transcript_segments_gm_identity_idx
  on public.transcript_segments (gm_identity_id)
  where gm_identity_id is not null;

-- Verify:
--   select count(*) filter (where character_id is not null)  as to_characters,
--          count(*) filter (where gm_identity_id is not null) as to_gm,
--          count(*) filter (where character_id is null and gm_identity_id is null) as unmapped
--   from public.transcript_segments where track_id = '<room track id>';
