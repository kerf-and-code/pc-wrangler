-- Verify the two parts of p3-security-fixes.sql that the schema dump cannot display.
-- Read-only.

-- 1. security_invoker on every view. All eight must read TRUE.
--    If any is FALSE, that view still runs as its owner and bypasses RLS.
select
  c.relname as view_name,
  coalesce(
    (select option_value
       from pg_options_to_table(c.reloptions)
      where option_name = 'security_invoker'),
    'false'
  ) as security_invoker,
  case
    when coalesce(
      (select option_value from pg_options_to_table(c.reloptions)
        where option_name = 'security_invoker'), 'false') = 'true'
    then 'PASS'
    else 'FAIL: bypasses RLS'
  end as result
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by c.relname;

-- 2. Column-level grants on profiles. This is what actually withholds the email,
--    because RLS is row-level and cannot hide a column.
--
--    EXPECTED: authenticated has select on id, display_name, avatar_url,
--    is_anonymous, created_at, updated_at, upgraded_at, AND email.
--
--    The email grant is intentional and is NOT a hole: the "read own profile" and
--    "read co-member profile" policies decide which ROWS you see, and a co-member
--    row is only reachable through profiles_public, which does not select email.
--    App code must read other people through profiles_public.
select
  grantee,
  string_agg(column_name, ', ' order by column_name) as columns_selectable
from information_schema.role_column_grants
where table_schema = 'public'
  and table_name = 'profiles'
  and privilege_type = 'SELECT'
  and grantee in ('anon', 'authenticated')
group by grantee
order by grantee;

-- 3. Sanity: anon must have NO select on profiles at all.
select
  case when count(*) = 0 then 'PASS' else 'FAIL: anon can still read profiles' end as result,
  count(*) as anon_selectable_columns
from information_schema.role_column_grants
where table_schema = 'public'
  and table_name = 'profiles'
  and privilege_type = 'SELECT'
  and grantee = 'anon';
