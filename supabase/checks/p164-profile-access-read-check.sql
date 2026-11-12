-- supabase\checks\p164-profile-access-read-check.sql (2026-11-12, read only)
-- After p164: signed-in accounts may SELECT access_granted and access_role, and still may UPDATE only display_name.
-- Expect rows 1 to 3: true, true, false.

select 'select access_granted' as what, has_column_privilege('authenticated', 'public.profiles', 'access_granted', 'SELECT') as allowed
union all
select 'select access_role', has_column_privilege('authenticated', 'public.profiles', 'access_role', 'SELECT')
union all
select 'update access_role (must stay false)', has_column_privilege('authenticated', 'public.profiles', 'access_role', 'UPDATE')
union all
select 'migration recorded', exists (select 1 from public._migrations where name = 'p164-profile-access-read');
