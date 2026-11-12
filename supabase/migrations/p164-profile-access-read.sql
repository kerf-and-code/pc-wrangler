-- p164-profile-access-read.sql (2026-11-12, audit round 2, LV18: no GM could start a campaign)
--
-- The GM Workspace (app/gm/page.tsx) and Your campaigns (app/me/campaigns/page.tsx) read the signed-in
-- account's own access_granted and access_role from public.profiles in the browser. p3-security-fixes
-- replaced the table-wide SELECT with a column list, and access_granted and access_role were added to
-- profiles later without being put on that list. So both reads return 403 (seen live for the owner
-- account), the pages take that as "no GM access", the Workspace hides New campaign and tells every GM
-- "You co-GM the campaigns above", and Your campaigns offers every GM "Ask for GM access".
--
-- This grants SELECT on those two columns only. The row policy "read own profile" (id = auth.uid()) is
-- unchanged, so an account still reads only its own row: a player can see that they are not a GM,
-- which the pages already tell them. UPDATE stays limited to display_name (p148), so nobody can grant
-- themselves access from the browser.
--
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p164-profile-access-read-check.sql

grant select (access_granted, access_role) on public.profiles to authenticated;

insert into public._migrations (name) values ('p164-profile-access-read') on conflict do nothing;
