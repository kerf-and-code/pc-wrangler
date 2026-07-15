-- Guild-scoped recording guard + durable channel persistence for capture_control.
--
-- LAYER 1 (the fix for the wrong-channel hazard). A Discord guild has ONE bot,
-- and one bot can occupy ONE voice channel at a time, so at most one capture may
-- be open per guild. The app-level guard in /record was campaign-scoped, so a
-- second /record that resolved to a different campaign in the same guild slipped
-- past it and created a competing capture request. That is what happened when a
-- GM re-issued /record during a reconnect window. This enforces the real
-- invariant at the database, so the read-then-insert guard can no longer race or
-- fail open: the second open row for a guild is simply rejected.
--
-- LAYER 2. Persist the voice channel the sidecar is recording, so recovery and
-- diagnostics never have to reconstruct it from in-memory state.
--
-- Idempotent: safe to run by hand more than once. A pre-check confirmed no guild
-- currently holds more than one open capture, so the unique index builds cleanly.

alter table public.capture_control
  add column if not exists channel_id text;

create unique index if not exists capture_control_one_open_per_guild
  on public.capture_control (guild_id)
  where status in ('requested', 'active', 'stopping');
