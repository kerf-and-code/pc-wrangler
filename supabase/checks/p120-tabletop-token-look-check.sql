-- supabase/checks/p120-tabletop-token-look-check.sql (2026-11-08)
-- Read-only. Run after p120. Expect two rows, both security_definer true, anon_can_run false,
-- authenticated_can_run true; and a count of tokens that already carry a frame (0 before anyone uses
-- the token maker).

select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('tabletop_can_edit_token', 'tabletop_set_token_look')
 order by p.proname;

select count(*) as tokens_with_frames from public.vtt_tokens where jsonb_typeof(style -> 'frame') = 'object';
