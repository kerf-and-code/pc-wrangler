-- p152-audio-language.sql (2026-11-10, push 26, audit P2)
--
-- The language a table plays in. campaigns.audio_language holds an ISO 639-1 code ("es", "de"); empty
-- means English, as before. It sets the language recordings are transcribed in (the sidecar's Groq
-- Whisper, Replicate WhisperX for room recordings, Deepgram as the fallback) and the language recaps and
-- the campaign journal are written in. The GM sets it in the Workspace's campaign settings; the existing
-- campaigns update policy (is_campaign_gm) already covers it.
--
-- Idempotent. Run supabase\checks\p152-audio-language-check.sql after.

alter table public.campaigns add column if not exists audio_language text;

do $$ begin
  alter table public.campaigns add constraint campaigns_audio_language_shape
    check (audio_language is null or audio_language ~ '^[a-z]{2}$');
exception when duplicate_object then null;
end $$;

comment on column public.campaigns.audio_language is
  'ISO 639-1 code of the language the table plays in (transcription, recaps, journal). Null means English. Push 26.';

insert into public._migrations (name) values ('p152-audio-language') on conflict do nothing;
