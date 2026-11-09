-- supabase/checks/p131-tabletop-addons-check.sql (2026-11-09)
-- Read-only. Run after p131.

-- 1. The three tables. Expect three rows, rls_on true:
--    addon_hooks   policies "addon_hooks_gm ALL"
--    addon_keys    policies "addon_keys_gm ALL"
--    addon_outbox  policies null (nobody but the server reads it)
select c.relname as table_name, c.relrowsecurity as rls_on,
       (select string_agg(policyname || ' ' || cmd, ', ') from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('addon_keys', 'addon_hooks', 'addon_outbox')
 order by 1;

-- 2. The two triggers. Expect addon_on_combat on combats and addon_on_message on vtt_messages, both enabled 'O'.
select tgname, tgrelid::regclass as on_table, tgenabled
  from pg_trigger where tgname in ('addon_on_message', 'addon_on_combat') order by 1;

-- 3. The functions. Expect every one definer true and anon false. authenticated: true only for
--    tabletop_has_hooks. service_role: true for addon_auth, addon_claim, addon_settle, addon_prune, addon_ping.
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
       has_function_privilege('service_role', p.oid, 'execute') as server_can_run
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('addon_on_message', 'addon_on_combat', 'addon_auth', 'addon_claim', 'addon_settle', 'addon_prune', 'addon_ping', 'tabletop_has_hooks')
 order by 1;

-- 4. The server can use the tables (the key route inserts keys with the service role).
--    Expect all true.
select has_table_privilege('service_role', 'public.addon_keys', 'insert') as keys_insert,
       has_table_privilege('service_role', 'public.addon_outbox', 'select') as outbox_select,
       has_table_privilege('service_role', 'public.vtt_messages', 'insert') as messages_insert;

-- 5. Nothing yet (until the GM adds keys or webhooks).
select (select count(*) from public.addon_keys) as keys, (select count(*) from public.addon_hooks) as hooks,
       (select count(*) from public.addon_outbox) as waiting;
