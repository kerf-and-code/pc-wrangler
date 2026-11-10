-- supabase/checks/p137-consent-withdrawal-check.sql (2026-11-09)
-- Read-only. Run after p137.

-- 1. Both functions exist and signed-in users can call them. Expect true, true.
select has_function_privilege('authenticated', 'public.my_recording_consents()', 'execute') as can_list,
       has_function_privilege('authenticated', 'public.set_my_recording_consent(uuid, boolean)', 'execute') as can_set;

-- 2. Standing consent by state and by how it was last set (no names). After players use the new
--    controls you will see player_web, discord_command and gm_revoke here.
select consented, method, count(*) as characters
  from public.recording_consents
 where session_id is null
 group by consented, method
 order by consented desc, method;
