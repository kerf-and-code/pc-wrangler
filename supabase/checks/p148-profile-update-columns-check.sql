-- supabase/checks/p148-profile-update-columns-check.sql (2026-11-10)
-- Read-only. Run it BEFORE p148 to see whether the hole was open, and AFTER to confirm it is closed.

-- 1. Which profile columns a signed-in account may update. Before p148 this lists every column
--    (access_granted and access_role among them); after, only display_name.
select a.attname as column_name,
       has_column_privilege('authenticated', 'public.profiles', a.attname, 'UPDATE') as authenticated_can_update,
       has_column_privilege('anon', 'public.profiles', a.attname, 'UPDATE') as anon_can_update
  from pg_attribute a
 where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
 order by a.attnum;

-- 2. Accounts holding GM access, newest first, so anything unexpected stands out. Look for a name you
--    did not hand the GM code to; the owner console (/admin) can revoke it.
select p.id, p.display_name, p.email, p.is_anonymous, p.access_granted, p.access_role, p.created_at
  from public.profiles p
 where p.access_role = 'gm'
 order by p.created_at desc;

-- 3. Your own user id, for the OWNER_IDS setting: find your row by your sign-in email.
select u.id, u.email, u.last_sign_in_at
  from auth.users u
 order by u.last_sign_in_at desc nulls last
 limit 10;
