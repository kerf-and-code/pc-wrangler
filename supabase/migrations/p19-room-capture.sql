-- ============================================================================
-- p19-room-capture.sql
-- In-person capture: one microphone in the room instead of one track per speaker.
--
-- WHY THE EXISTING SHAPE DOES NOT FIT
--   Every audio_track today belongs to exactly one person: character_id for a player,
--   gm_identity_id for the narrator. That is true because Discord hands the sidecar a separate
--   stream per speaker, so attribution is solved before the audio ever leaves the machine.
--
--   A room recording is the opposite. One file, everyone in it, and nobody attributed until
--   Deepgram's diarization splits it into Speaker 0..N and a human tells us which speaker is which.
--   So a room track needs to be a legitimate track with NO owner, and it needs somewhere to keep
--   the mapping once it exists.
--
-- WHY CONSENT IS RECORDED ON THE JOB, NOT PER SPEAKER
--   Consent elsewhere is per person and enforced at finalize: unconsented audio is never uploaded.
--   That is impossible with a single mixed track, because one person's voice cannot be removed from
--   the file before it leaves the room. So in-person consent is ROOM-LEVEL: everyone present agrees
--   or the recording does not start. One rule, statable in a sentence, and it keeps the promise the
--   product already makes rather than quietly weakening it.
--
--   The GM affirms it once per recording and we store who affirmed and when. This is a record of an
--   assertion, not proof of consent - it exists so there is an audit trail and so the UI can refuse
--   to start without it.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- audio_tracks: a track that belongs to the room rather than to a person
-- ----------------------------------------------------------------------------

alter table public.audio_tracks
  add column if not exists kind text not null default 'speaker';

alter table public.audio_tracks
  drop constraint if exists audio_tracks_kind_check;
alter table public.audio_tracks
  add constraint audio_tracks_kind_check check (kind in ('speaker', 'room'));

comment on column public.audio_tracks.kind is
  'speaker = one person, attributed by character_id or gm_identity_id (the Discord path). '
  'room = one microphone capturing everyone, attributed later via speaker_map (the in-person path).';

-- The diarization mapping, filled in after transcription and edited by the GM.
--   { "0": {"character_id": "...", "confidence": "confirmed"},
--     "1": {"gm": true, "confidence": "enrolled"} }
-- Deliberately jsonb rather than a join table: the labels are per-recording and meaningless outside
-- it (Deepgram's Speaker 0 in one file has no relationship to Speaker 0 in another), so there is
-- nothing to normalise and a row per label would invite treating them as durable identities.
alter table public.audio_tracks
  add column if not exists speaker_map jsonb;

comment on column public.audio_tracks.speaker_map is
  'For kind=room only. Maps a Deepgram diarization label to a character or the GM. Labels are '
  'per-recording and carry no meaning across files, which is why this is not a join table.';

-- ----------------------------------------------------------------------------
-- capture_jobs: room-level consent, affirmed once per recording
-- ----------------------------------------------------------------------------

alter table public.capture_jobs
  add column if not exists room_consent_by uuid references auth.users (id) on delete set null;

alter table public.capture_jobs
  add column if not exists room_consent_at timestamptz;

comment on column public.capture_jobs.room_consent_by is
  'The GM who affirmed that everyone in the room agreed to be recorded. In-person consent is '
  'room-level because a single mixed track cannot exclude one voice before upload.';

-- ----------------------------------------------------------------------------
-- Health check: surface this migration the same way as the others
-- ----------------------------------------------------------------------------

create or replace function public.schema_health()
returns table (check_key text, label text, ok boolean, detail text, migration text)
language sql
security definer
set search_path = public, storage, pg_catalog
stable
as $$
  select 'portrait_player'::text,
         'Players can upload portraits for their own characters'::text,
         exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                   and policyname='player writes own pc portrait'),
         'storage.objects policy "player writes own pc portrait"'::text,
         'p14-portrait-uploads.sql'::text
  union all
  select 'portrait_statblock',
         'GMs can upload portraits for their own monster stat blocks',
         exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
                   and policyname='gm writes own statblock portrait'),
         'storage.objects policy "gm writes own statblock portrait"',
         'p14-portrait-uploads.sql'
  union all
  select 'portrait_helpers',
         'The portrait policies can actually see who owns what',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public'
             and p.proname in ('can_write_character_portrait','can_write_statblock_portrait')) = 2,
         'functions public.can_write_character_portrait / can_write_statblock_portrait',
         'p17-portrait-policy-definer.sql'
  union all
  select 'map_path_guard',
         'Uploads outside a campaign folder do not abort on a bad path',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='is_campaign_gm_segment'),
         'function public.is_campaign_gm_segment',
         'p18-map-policy-uuid-guard.sql'
  union all
  select 'room_capture',
         'In-person sessions can be recorded from one microphone',
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='audio_tracks' and column_name='kind')
         and exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='capture_jobs'
                    and column_name='room_consent_by'),
         'audio_tracks.kind and capture_jobs.room_consent_by',
         'p19-room-capture.sql'
  union all
  select 'pc_library',
         'Players can save reusable character builds',
         to_regclass('public.pc_library') is not null,
         'table public.pc_library',
         'p13-pc-library.sql'
  union all
  select 'character_identities',
         'Characters link across campaigns',
         to_regclass('public.character_identities') is not null,
         'table public.character_identities',
         'p15-character-identities.sql'
  union all
  select 'capture_heartbeat',
         'The voice sidecar can claim and recover recordings',
         exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='capture_control'
                    and column_name='heartbeat_at'),
         'column public.capture_control.heartbeat_at',
         'p7-capture-heartbeat.sql'
$$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated;

-- ----------------------------------------------------------------------------
-- Verify
--   select kind, count(*) from public.audio_tracks group by kind;
--   select check_key, ok from public.schema_health() order by check_key;
-- ----------------------------------------------------------------------------
