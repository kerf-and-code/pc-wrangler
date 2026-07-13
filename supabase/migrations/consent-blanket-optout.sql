-- Consent model: blanket-at-claim + GM per-session opt-out.
--
-- recording_consents rows now carry two meanings, both keyed on character_id:
--   * blanket / standing consent : session_id IS NULL, consented = true
--       (written when the player claims their character, Discord /claim or web /join)
--   * per-session opt-out (GM)    : session_id = <that session>, consented = false
--       (the GM excludes a character from one session on the Capture page)
--
-- A session is OK to process when every PRESENT character is either
-- blanket-consented or opted-out (excluded), and at least one present character
-- is actually recordable (blanket-consented and not opted out). Opt-out excludes
-- that character's track; it does not block the session for everyone else.
--
-- NOTE: this gate authorizes the session. The opt-out is *enforced* by skipping
-- opted-out characters' audio_tracks during transcription/extraction (separate
-- change in the pipeline routes). This function is idempotent (create or replace).

-- Blanket consent needs session_id to allow NULL ("no session" = standing consent),
-- and a partial unique index to dedupe standing rows (the table's
-- UNIQUE(session_id, character_id) can't, since NULLs are distinct in Postgres).
alter table public.recording_consents alter column session_id drop not null;

create unique index if not exists recording_consents_blanket_unq
  on public.recording_consents (campaign_id, character_id)
  where session_id is null;

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
  )
  select
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
    );
$function$;
