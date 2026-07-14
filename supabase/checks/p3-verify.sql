-- Verify that p3-identity.sql landed. Read-only: changes nothing.
--
-- Every row should read PASS. Any FAIL tells you exactly which step did not take.
-- Run in the Supabase SQL editor as a single statement.
--
-- Note on check 3: pg_trigger.tgenabled is of type "char" (Postgres's internal
-- one-byte char), so `text || tgenabled` is an ambiguous operator and errors out.
-- It has to be cast with tgenabled::text.

with checks as (

  -- 1. profiles gained the four identity columns
  select 1 as step, 'profiles has email, avatar_url, is_anonymous, upgraded_at' as check_name,
    (select count(*) = 4
       from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('email','avatar_url','is_anonymous','upgraded_at')) as ok,
    (select string_agg(column_name, ', ' order by column_name)
       from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('email','avatar_url','is_anonymous','upgraded_at')) as detail

  union all
  -- 2. handle_new_user was rewritten (the new body reads raw_user_meta_data)
  select 2, 'handle_new_user populates from provider metadata',
    (select pg_get_functiondef(p.oid) like '%raw_user_meta_data%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user'),
    (select case when pg_get_functiondef(p.oid) like '%raw_user_meta_data%'
                 then 'new body' else 'STILL THE OLD BODY' end
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user')

  union all
  -- 3. the trigger is attached to auth.users and enabled  [tgenabled cast to text]
  select 3, 'on_auth_user_created trigger attached and enabled',
    (select count(*) = 1
       from pg_trigger
      where not tgisinternal
        and tgname = 'on_auth_user_created'
        and tgrelid = 'auth.users'::regclass
        and tgenabled <> 'D'),
    (select coalesce(
       string_agg(
         tgname || ' on ' || tgrelid::regclass::text || ' (' ||
         case tgenabled::text
           when 'O' then 'enabled'
           when 'D' then 'DISABLED'
           when 'R' then 'replica only'
           when 'A' then 'always'
           else 'unknown'
         end || ')',
         ', '
       ),
       'MISSING')
       from pg_trigger
      where not tgisinternal and tgname = 'on_auth_user_created')

  union all
  -- 4. the upgrade function exists and is executable by authenticated
  select 4, 'upgrade_profile_from_auth() exists',
    (select count(*) = 1
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'upgrade_profile_from_auth'),
    (select coalesce(
       (select 'exists; execute granted to: ' ||
               coalesce(string_agg(distinct grantee, ', '), 'NOBODY')
          from information_schema.role_routine_grants
         where routine_schema = 'public'
           and routine_name = 'upgrade_profile_from_auth'
           and privilege_type = 'EXECUTE'),
       'MISSING'))

  union all
  -- 5. THE SECURITY FIX: claim_character_invite refuses to steal a claimed character
  select 5, 'claim_character_invite blocks stealing a claimed character',
    (select pg_get_functiondef(p.oid) like '%already been claimed%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'claim_character_invite'),
    (select case when pg_get_functiondef(p.oid) like '%already been claimed%'
                 then 'guard present'
                 else 'VULNERABLE: still overwrites profile_id unconditionally' end
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'claim_character_invite')

  union all
  -- 6. the cross-campaign dossier RPC exists
  select 6, 'my_characters() exists',
    (select count(*) = 1
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'my_characters'),
    (select coalesce(
       (select 'returns ' || pg_get_function_result(p.oid)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'my_characters'),
       'MISSING'))

  union all
  -- 7a. threads table exists
  select 7, 'threads table exists',
    (select count(*) = 1
       from information_schema.tables
      where table_schema = 'public' and table_name = 'threads'),
    (select coalesce(count(*)::text || ' columns', 'MISSING')
       from information_schema.columns
      where table_schema = 'public' and table_name = 'threads')

  union all
  -- 7b. threads has RLS on, with all four owner-only policies
  select 7, 'threads RLS enabled with 4 owner-only policies',
    (select c.relrowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'threads')
    and (select count(*) = 4 from pg_policies
          where schemaname = 'public' and tablename = 'threads'),
    (select coalesce(
       (select 'rls=' ||
               (select case when c.relrowsecurity then 'on' else 'OFF' end
                  from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = 'threads')
               || ', policies: ' || coalesce(string_agg(policyname, ', ' order by policyname), 'NONE')
          from pg_policies where schemaname = 'public' and tablename = 'threads'),
       'MISSING'))

  union all
  -- 8. backfill: every profile agrees with auth.users about is_anonymous
  select 8, 'is_anonymous backfilled to match auth.users',
    (select count(*) = 0
       from public.profiles p
       join auth.users u on u.id = p.id
      where p.is_anonymous is distinct from coalesce(u.is_anonymous, false)),
    (select count(*)::text || ' profile(s) disagree with auth.users'
       from public.profiles p
       join auth.users u on u.id = p.id
      where p.is_anonymous is distinct from coalesce(u.is_anonymous, false))
)
select
  step,
  case when ok then 'PASS' else 'FAIL' end as result,
  check_name,
  detail
from checks
order by step, check_name;
