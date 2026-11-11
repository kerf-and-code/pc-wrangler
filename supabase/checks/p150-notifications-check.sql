-- p150-notifications-check.sql (2026-11-10, push 19). Read-only. Run before and after p150-notifications.sql.

-- 1. RSVPs. rsvp_for_share writes going, maybe or declined. If this constraint lists only present, absent,
--    late and partial (before p150), every RSVP has been failing. After p150 it lists both sets.
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint where conrelid = 'public.attendance'::regclass and contype = 'c';
select status, count(*) from public.attendance group by status order by 2 desc;

-- 2. The new pieces. After p150: notifications, the digest column, the RPCs, and the ledger row.
select to_regclass('public.notifications') as notifications,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'email_prefs' and column_name = 'digest') as digest_column,
       to_regprocedure('public.set_my_email_digest(boolean)') as set_digest,
       to_regprocedure('public.digest_batch(integer)') as digest_batch,
       (select count(*) from public._migrations where name = 'p150-notifications') as ledger;

-- 3. The triggers. After p150: six rows (five if recap_sends is missing), all enabled 'O'.
select tgrelid::regclass as on_table, tgname, tgenabled as enabled
  from pg_trigger where tgname like 'notify_on_%' order by 1;

-- 4. Who may touch notifications from the browser: select, delete, and update of read_at only.
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'notifications' and grantee in ('anon', 'authenticated') order by 1, 2;
select grantee, column_name, privilege_type from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'notifications' and grantee = 'authenticated' and privilege_type = 'UPDATE';

-- 5. Traffic so far, and who has the digest on.
select kind, count(*) as total, count(*) filter (where read_at is null) as unread, count(emailed_at) as emailed
  from public.notifications group by kind order by 2 desc;
select count(*) filter (where digest) as digest_on, count(*) as with_prefs from public.email_prefs;
