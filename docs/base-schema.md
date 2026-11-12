# The base schema file

Push 50 (audit round 2, T13). `supabase/migrations/0000-base-schema.sql` is the whole public schema
in one file: the way to stand up a fresh database (a staging project, a restore drill, local tests)
and the written record of what production should hold. It was 37 migrations behind and, because it
came from a catalog query, it had no identity columns and no function grants. Push 50 rebuilt it after
p170.

## Standing up a fresh database

1. A new Supabase project (it brings the auth, storage and realtime schemas and the roles).
2. In the SQL editor: `0000-base-schema.sql`, then every migration numbered after the header's last
   one (p171 onward), in order.
3. Storage buckets and their policies, and scheduled jobs, are not in the file: create the buckets
   `session-audio`, `campaign-maps` and `table-files` by hand with the same settings as production.

## Checking production against the files

Run `supabase/checks/schema-fingerprint-check.sql` in production. No rows means production matches
the files. Each row is a function or table that differs; a "function changed" row is the one that
matters most, because restating that function from the files would undo whatever changed it.

## Refreshing the file after more migrations

Needs PostgreSQL 16 or later installed locally (the client tools and a server) and Python.

1. Make an empty database and give it the Supabase stand-ins: the roles `anon`, `authenticated` and
   `service_role`; the schemas `auth`, `storage`, `realtime` and `extensions`; `auth.uid()`,
   `auth.role()` and `auth.jwt()` reading `request.jwt.claim.sub`, `request.jwt.claim.role` and
   `request.jwt.claims`; a table `auth.users (id uuid primary key, email text, raw_user_meta_data jsonb,
   raw_app_meta_data jsonb, is_anonymous boolean, created_at timestamptz)`; `storage.objects` and
   `storage.buckets`; and `create publication supabase_realtime`.
2. Run the current `0000-base-schema.sql`, then the newer migrations in order. Every one must run
   without an error; one that fails is the first thing to fix.
3. `pg_dump --schema-only --schema=public <that database> > dump.sql`
4. `python scripts/idempotent-schema.py dump.sql > body.sql`
5. Replace the part of `0000-base-schema.sql` between the "2 the schema" and "3 realtime" banners
   with `body.sql`, and update the header (last migration, date, counts).
6. Test: run the new file twice on a second empty database with the stand-ins, then compare
   `pg_dump --schema-only --schema=public` of both databases. They must be identical.
7. Regenerate the expected lists in `schema-fingerprint-check.sql` from the first database (the
   function signatures with `md5(prosrc)`, and each table's column count).

The 2026-11-12 refresh did exactly this: p134 to p170 all ran cleanly on the old file, the new file ran
twice without an error, and the two dumps matched line for line.

## What is not in the file

Data; the auth and storage schemas themselves; storage buckets and their policies; vault secrets;
scheduled jobs. The realtime publication is in it (section 3), for the twelve tables the app listens to.
