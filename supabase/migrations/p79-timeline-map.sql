-- p79: silence-trim timeline map on audio_tracks.
--
-- When the sidecar runs with TRIM_SILENCE=1 it removes the silence from a speaker's track
-- before uploading, to cut the Deepgram bill (we pay per minute of audio, and a speaker who
-- talks for 8 minutes of a 3-hour session otherwise uploads the whole 3 hours). Doing that
-- moves Deepgram's word timestamps onto a shorter, TRIMMED clock, so we store the map back to
-- real session time here.
--
-- Shape: an ordered jsonb array, one entry per kept (speech) span, in order:
--   [{ "t0": <trimmed_start_ms>, "r0": <real_start_ms>, "d": <span_dur_ms> }, ...]
-- A trimmed timestamp `tms` in [t0, t0+d] maps to real session time r0 + (tms - t0). The
-- transcribe callback applies this so transcript_segments.start_ms stays session-relative,
-- which is what the recap builder relies on to interleave speakers (it orders by start_ms
-- across every track in the job).
--
-- Nullable and off by default: a track uploaded WITHOUT trimming has no map, and the callback
-- writes its timestamps straight through exactly as before. This is what makes the feature a
-- clean A/B - the behavior is carried by the presence of the map on the row, not by any flag
-- the callback has to know about. Idempotent; run by hand.

alter table public.audio_tracks add column if not exists timeline_map jsonb;

comment on column public.audio_tracks.timeline_map is
  'Set only when the track was silence-trimmed before upload. Ordered jsonb array '
  '[{t0:trimmed_start_ms, r0:real_start_ms, d:span_dur_ms}] mapping Deepgram''s trimmed-time '
  'timestamps back to real session time. Null = untrimmed, timestamps used as-is.';
