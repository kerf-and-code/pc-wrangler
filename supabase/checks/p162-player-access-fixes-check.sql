-- p162-player-access-fixes-check.sql (2026-11-11, push 40). Read-only. Run after p162-player-access-fixes.sql.

-- 1. The three functions and who may call them (world_map_poi_detail_for_player: anon and authenticated;
--    the other two: authenticated).
select p.proname, array_to_string(p.proacl, ', ') as grants
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('character_campaign_public', 'world_map_poi_detail_for_player', 'forge_access')
 order by 1;
select count(*) as ledger from public._migrations where name = 'p162-player-access-fixes';

-- 2. Still on the list from the audit: every policy that admits only "members" (memberships rows, which
--    players never get). Each is on a table players reach another way (share-code and SECURITY DEFINER
--    functions) or that only the GM reads; this lists them so a new player-facing page that reads one
--    directly is caught.
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public' and (qual like '%is_campaign_member%' or with_check like '%is_campaign_member%')
 order by tablename, policyname;
