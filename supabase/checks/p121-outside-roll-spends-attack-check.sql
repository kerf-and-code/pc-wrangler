-- supabase/checks/p121-outside-roll-spends-attack-check.sql (2026-11-08)
-- Read-only. Run after p121. Expect one row: security_definer true, anon_can_run false,
-- authenticated_can_run true, spends_attack true (the function body now calls combat_spend).

select p.proname,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
       position('combat_spend' in pg_get_functiondef(p.oid)) > 0 as spends_attack
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'combat_apply_outside_roll';
