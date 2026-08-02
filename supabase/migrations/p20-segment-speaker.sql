-- ============================================================================
-- p20-segment-speaker.sql
-- Keep the diarization label on each transcript segment.
--
-- On the Discord path a segment's speaker is known before transcription: one file per person, so
-- transcript_segments.character_id is filled from the track and there is nothing to infer. A room
-- recording has no such structure. Deepgram returns a `speaker` index per utterance, and that index
-- is the ONLY handle on who said what until a GM maps the labels to characters.
--
-- Without this column the callback drops the index on the floor and the diarization we just paid
-- for is unrecoverable: the audio is already transcribed and re-running it costs another pass.
--
-- Nullable, because every existing segment and every Discord segment legitimately has no label.
-- The index is per RECORDING and means nothing across files, which is why it stays an int here
-- rather than becoming a foreign key to anything.
-- ============================================================================

alter table public.transcript_segments
  add column if not exists speaker smallint;

comment on column public.transcript_segments.speaker is
  'Deepgram diarization index, for room recordings only. Meaningful only within its own track: '
  'Speaker 0 in one recording has no relationship to Speaker 0 in another. Null on Discord '
  'segments, which already know their character from the track.';

create index if not exists transcript_segments_track_speaker_idx
  on public.transcript_segments (track_id, speaker)
  where speaker is not null;

-- Verify:
--   select speaker, count(*) from public.transcript_segments
--   where track_id = '<room track id>' group by speaker order by speaker;
