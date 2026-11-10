# Migrations

Every file here is run by hand in the Supabase SQL editor. Nothing runs them automatically, so these
rules are what keep production and this folder in step.

## Writing a new one

1. Name it `pNNN-short-description.sql`, with the next free number. Never reuse a number.
2. Make it idempotent: `create table if not exists`, `add column if not exists`, `create or replace`,
   guarded constraints and policies. It must be safe to run twice.
3. When it restates a function or view that already exists, copy the **live** definition (from
   `0000-base-schema.sql` or a `pg_get_functiondef` query) and change only what it needs. Restating an
   older copy silently undoes every change made since.
4. If it needs an earlier migration, check for it and stop with a clear message if it is missing.
5. If the table holds personal data, add it to `export_my_data()` and `delete_my_account()`.
6. End it with the ledger line, so the database records that it ran:

   ```sql
   insert into public._migrations (name) values ('pNNN-short-description') on conflict do nothing;
   ```

7. Pair it with a read-only check in `supabase/checks`.

## Checking what has run

`supabase/checks/migration-ledger-check.sql` lists the ledger (`public._migrations`, created by
p146) newest first. p134 to p146 are recorded; older migrations were never recorded, so for those the
live schema is the only record.

## Never run

- `0000-base-schema.sql` is a snapshot of the live schema for reference and local testing. Running it on
  production puts back older function definitions.
- `consent-blanket-optout.sql`, `audio-retention-60d.sql` and `consent-backfill-blanket.sql` are
  superseded and refuse to run (each explains why at the top).
- The other unnumbered files (`a1` to `a4`, `b1` to `b4`, `capture-control-guild-guard`, `catalog`,
  `class_capabilities`, `fix-recaps-status`, `gm-review-support`, `insight-analytics-views`) are early
  work that later numbered migrations build on. Treat them as history: do not re-run one without first
  checking which later files restate what it defines.
