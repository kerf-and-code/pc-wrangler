-- One-time backfill: give every already-claimed character who previously
-- consented a standing (blanket) consent row, so the new session_consent_ok
-- gate does not suddenly read them as un-consented. Idempotent (the NOT EXISTS
-- guard means re-running is a no-op). Run AFTER the claim-consent surfaces ship.

insert into public.recording_consents (campaign_id, session_id, character_id, profile_id, consented, method)
select distinct c.campaign_id, null::uuid, c.id, c.profile_id, true, 'backfill_blanket'
from public.characters c
where c.kind = 'pc'
  and exists (
    select 1 from public.recording_consents rc
    where rc.character_id = c.id and rc.consented = true
  )
  and not exists (
    select 1 from public.recording_consents rc2
    where rc2.character_id = c.id and rc2.session_id is null and rc2.consented = true
  );
