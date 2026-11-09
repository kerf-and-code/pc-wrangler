-- supabase/checks/p119-tabletop-token-markers-check.sql (2026-11-08)
-- Read-only. Run after p119. Expect one row: security_definer true, anon_can_run false,
-- authenticated_can_run true, and tokens_with_markers a count (0 before anyone marks a token).

select p.proname,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
       (select count(*) from public.vtt_tokens t where jsonb_typeof(t.style -> 'markers') = 'array') as tokens_with_markers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'tabletop_set_token_markers';
