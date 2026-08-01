-- ============================================================================
-- p16-schema-health.sql
-- A function the app can call to ask the database what is actually installed.
--
-- WHY THIS EXISTS
--   Migrations here are run BY HAND in the Supabase editor, which means the repo holds intent and
--   the database holds truth, and the two drift silently. p14-portrait-uploads.sql sat unapplied
--   for a week while the app cheerfully rendered an upload button that could only fail on RLS.
--   Two migrations referenced in the project notes (p13-pc-library, p15-character-identities) are
--   not even in the repo, so it is not clear from the files alone what has been run.
--
--   A registry table that migrations write to would only record INTENT, and would be wrong the
--   moment someone forgot to insert a row. This instead PROBES REALITY: it looks in the catalog
--   for the objects and policies each feature needs, so it cannot disagree with the database.
--
-- SECURITY DEFINER because pg_policies is filtered to the caller's own privileges otherwise, and a
-- player has none on storage.objects. What it returns is only the NAMES of tables and policies plus
-- a boolean - no data, no schema contents - so exposing it to any signed-in user is not a leak, and
-- the alternative (GM-only) would hide the player-facing failures from the people who hit them.
--
-- Idempotent. Adding a new check is one more UNION ALL branch.
-- ============================================================================

create or replace function public.schema_health()
returns table (
  check_key text,
  label     text,
  ok        boolean,
  detail    text,
  migration text
)
language sql
security definer
set search_path = public, storage, pg_catalog
stable
as $$
  -- p14: without these two policies the portrait uploader fails on RLS. The bucket is public-read,
  -- so only the WRITE side needs a policy.
  select
    'portrait_player'::text,
    'Players can upload portraits for their own characters'::text,
    exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'player writes own pc portrait'
    ),
    'storage.objects policy "player writes own pc portrait"'::text,
    'p14-portrait-uploads.sql'::text

  union all
  select
    'portrait_statblock',
    'GMs can upload portraits for their own monster stat blocks',
    exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'gm writes own statblock portrait'
    ),
    'storage.objects policy "gm writes own statblock portrait"',
    'p14-portrait-uploads.sql'

  -- p13: the PC library. The project notes record this as applied, but the file is not in the repo,
  -- so the only way to know is to look.
  union all
  select
    'pc_library',
    'Players can save reusable character builds',
    to_regclass('public.pc_library') is not null,
    'table public.pc_library',
    'p13-pc-library.sql'

  -- p15: cross-campaign character identity. Built, never copied into the repo, never run.
  union all
  select
    'character_identities',
    'Characters link across campaigns',
    to_regclass('public.character_identities') is not null,
    'table public.character_identities',
    'p15-character-identities.sql'

  -- p7: the heartbeat column the sidecar stamps. If this is ever missing, a capture can never be
  -- adopted or reconciled and a stuck recording cannot be recovered.
  union all
  select
    'capture_heartbeat',
    'The voice sidecar can claim and recover recordings',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'capture_control'
        and column_name = 'heartbeat_at'
    ),
    'column public.capture_control.heartbeat_at',
    'p7-capture-heartbeat.sql'
$$;

revoke all on function public.schema_health() from public;
grant execute on function public.schema_health() to authenticated;

comment on function public.schema_health() is
  'Probes the catalog for the objects each feature needs. Returns one row per check; ok=false means '
  'the named migration has not been run against this database.';
