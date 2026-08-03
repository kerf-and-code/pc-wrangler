-- ============================================================================
-- p22-room-consent-gate.sql
-- Let the Capture page's consent gate clear for an in-person recording.
--
-- THE PROBLEM
--   session_consent_ok() answers one question: has every character marked PRESENT either given
--   standing consent or been opted out of this session. That is exactly right for Discord, where
--   each person has their own track and one holdout can be excluded without touching anyone else.
--
--   A room recording cannot work that way. One microphone holds the whole table, so a single voice
--   cannot be removed from the file, which is why in-person consent is ROOM-LEVEL and affirmed by
--   the GM before recording starts. The per-character question is not merely unanswered for those
--   sessions, it is the wrong question - and because it can never be satisfied, the Capture page
--   showed NOT CLEARED and refused to queue transcription for audio that was properly consented.
--
-- WHAT CHANGES
--   The function now returns true if EITHER the original per-character rule holds OR room consent
--   is on file for a capture job on this session. Nothing about the per-character rule is relaxed.
--
-- WHY THIS IS SAFE
--   This function is a UI GATE, not the enforcement point. The real enforcement lives in
--   app/api/transcribe/submit, which decides PER TRACK: a speaker track still needs its character's
--   standing consent and no opt-out, and a room track needs room consent stamped on its job. A
--   session holding both kinds is judged correctly track by track no matter what this returns.
--
-- Idempotent (create or replace). Run by hand in the Supabase editor.
-- ============================================================================

create or replace function public.session_consent_ok(p_session uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  with s as (
    select id, campaign_id from public.sessions where id = p_session
  ),
  present as (
    select a.character_id
    from public.attendance a
    where a.session_id = p_session
      and a.status in ('present', 'late', 'partial')
      and a.character_id is not null
  ),
  blanket as (  -- characters with standing (campaign-wide) consent
    select rc.character_id
    from public.recording_consents rc, s
    where rc.campaign_id = s.campaign_id
      and rc.session_id is null
      and rc.consented
  ),
  optout as (   -- characters the GM opted out of THIS session
    select rc.character_id
    from public.recording_consents rc
    where rc.session_id = p_session
      and rc.consented = false
  ),
  room as (     -- in-person: the GM affirmed the whole room agreed, before recording started
    select 1
    from public.capture_jobs j
    where j.session_id = p_session
      and j.room_consent_at is not null
      and exists (
        select 1 from public.audio_tracks a
        where a.job_id = j.id and a.kind = 'room'
      )
  )
  select
    exists (select 1 from room)
    or (
      -- at least one recordable character: consented and not opted out
      exists (
        select 1 from present p
        where p.character_id in (select character_id from blanket)
          and p.character_id not in (select character_id from optout)
      )
      -- and nobody present is un-consented AND not excluded
      and not exists (
        select 1 from present p
        where p.character_id not in (select character_id from blanket)
          and p.character_id not in (select character_id from optout)
      )
    );
$function$;

-- Verify against the session you just recorded:
--   select public.session_consent_ok('<session 6 id>');   -- expect true
