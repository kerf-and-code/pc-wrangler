# Backup and restore

Push 50 (audit round 2, T13). What protects Six Axes' data, how to take your own copy, and how to
prove a copy can be restored. The production steps need the database password, which only Terry
types; nothing here was run against production.

## 1. Supabase's own backups

Open the Supabase dashboard, the project, **Database**, **Backups**. That page says what the current
plan keeps (how many days of daily backups, and whether point-in-time recovery is on). Write it here
once checked:

- Daily backups kept: _______
- Point-in-time recovery: _______

Restoring from that page replaces the whole project's database with the backup, so everything done
after the backup is lost, and the app is down while it runs. It is for disasters, not for one bad edit.

## 2. Your own copy (weekly, and before any risky migration)

Supabase's backups live inside Supabase. A copy on your own disk covers the case where the project
itself is lost.

Install the PostgreSQL client tools (version 16 or later: the "Command Line Tools" option of the
PostgreSQL installer for Windows). Take the connection string from the dashboard: **Connect**,
**Session pooler** (port 5432), and put the password in when it asks. Then, in cmd:

```
pg_dump "postgresql://postgres.<project>:<password>@<host>:5432/postgres" -Fc --no-owner --no-privileges -n public -n auth -n storage -f six-axes-2026-11-12.dump
```

Keep the `.dump` files somewhere that is not this computer only (an external drive or cloud storage).
They contain everyone's data, including emails: treat them like the database itself.

What the dump does not hold: the files in storage (maps, portraits, tokens, handouts and the session
audio). The `storage` schema in it is only their list. Campaign files can be copied with the Supabase
dashboard or any S3 tool using the project's S3 access keys (**Storage**, **Settings**). Session audio
is deleted after 60 days by design and does not need a copy.

## 3. The restore drill (once now, then after any big change)

A backup nobody has restored is a hope. The drill restores a dump into a scratch database and checks
every table came back.

1. Run `supabase/checks/backup-row-counts.sql` in production and save the result.
2. Take a dump as in section 2.
3. Restore it somewhere that is not production: a new free Supabase project, or a local PostgreSQL.
   For a local one:
   ```
   createdb drill
   psql -d drill -c "create role anon; create role authenticated; create role service_role; create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions"
   pg_restore --no-owner --no-privileges -d drill six-axes-2026-11-12.dump
   ```
   One error about `schema "public" already exists` is expected and harmless. Errors about Supabase's
   own extensions (vault, pg_net) are expected on a plain PostgreSQL.
4. Run `backup-row-counts.sql` on the copy and compare it with step 1. Every count should match,
   except tables written to between steps 1 and 2.
5. Write the date and the result here.

Drill log:
- 2026-11-12, local test database, not production: dump of the test schema with its data, restored
  with the commands above into an empty PostgreSQL 16 database; one expected error (`schema public
  already exists`); all 111 row counts matched. This proves the commands; the production drill is
  still to do.

## 4. Getting back one thing (not the whole database)

To undo one bad change (a deleted campaign past its 30 days in the trash, an edit that overwrote
something), restore a dump into a scratch database as in the drill, find the rows there, and copy just
those back with SQL. Ask before running anything that writes to production.
