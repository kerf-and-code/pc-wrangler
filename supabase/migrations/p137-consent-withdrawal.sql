-- supabase/migrations/p137-consent-withdrawal.sql (2026-11-09)
--
-- Audit F5: a player can withdraw recording consent themselves, as easily as they gave it.
--
-- Standing consent is one recording_consents row per character with session_id null. Every reader (the
-- Discord recorder at finalize, the transcription gate, extraction, Capture and Tonight) counts only rows
-- with consented = true, so setting a player's standing rows to false is a withdrawal everywhere at once:
-- from the next recording finalized, their voice is not uploaded at all.
--
--   my_recording_consents()          the signed-in player's campaigns, their characters there, and whether
--                                    standing consent is given, withdrawn or not yet given.
--   set_my_recording_consent(c, on)  gives or withdraws standing consent for all of the caller's player
--                                    characters in campaign c (method 'player_web').
--
-- The Discord /consent command does the same through the service role. The GM can revoke a player's
-- standing consent on Capture (the existing "gm writes consents" policy), but never give it for them.
--
-- Idempotent. Run by hand after p136, then supabase/checks/p137-consent-withdrawal-check.sql.

create or replace function public.my_recording_consents()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x order by x ->> 'campaignName'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'campaignId', c.id,
               'campaignName', c.name,
               'characters', jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name) order by ch.name),
               -- withdrawn if any of the player's characters there has consent switched off; given only
               -- when every one of them has said yes; otherwise not yet given
               'state', case
                 when bool_or(rc.consented = false) then 'withdrawn'
                 when bool_and(rc.consented = true) then 'given'
                 else 'none' end) as x
        from public.characters ch
        join public.campaigns c on c.id = ch.campaign_id
        left join public.recording_consents rc
          on rc.campaign_id = ch.campaign_id and rc.character_id = ch.id and rc.session_id is null
       where ch.profile_id = auth.uid() and ch.kind = 'pc'
       group by c.id, c.name
    ) t;
$function$;
revoke all on function public.my_recording_consents() from public, anon;
grant execute on function public.my_recording_consents() to authenticated;

create or replace function public.set_my_recording_consent(p_campaign uuid, p_consented boolean)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ch  record;
  v_n   integer := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_consented is null then raise exception 'say yes or no'; end if;
  for v_ch in
    select ch.id from public.characters ch
     where ch.campaign_id = p_campaign and ch.profile_id = v_uid and ch.kind = 'pc'
  loop
    update public.recording_consents
       set consented = p_consented, method = 'player_web', profile_id = v_uid, recorded_by = v_uid, created_at = now()
     where campaign_id = p_campaign and character_id = v_ch.id and session_id is null;
    if not found then
      insert into public.recording_consents (campaign_id, session_id, character_id, profile_id, consented, method, recorded_by)
      values (p_campaign, null, v_ch.id, v_uid, p_consented, 'player_web', v_uid);
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'you have no character in that campaign'; end if;
  return v_n;
end;
$function$;
revoke all on function public.set_my_recording_consent(uuid, boolean) from public, anon;
grant execute on function public.set_my_recording_consent(uuid, boolean) to authenticated;
