-- p154-world-calendar.sql (2026-11-11, push 29, audit F15: in-game calendar)
--
-- In-game time for a campaign. The GM picks a calendar (a preset or their own months), the world's
-- date moves forward as the story does, and each session can carry the in-game date it started on,
-- so the Timeline reads "Session 7, 14 Frostfall 1203, 12 days after session 6".
--
--   campaigns.world_calendar  the calendar: { v, preset, months: [{ name, days }], weekdays: [], era }
--                             (lib/world-calendar.ts reads and checks it; null: no calendar yet)
--   campaigns.world_day       today's date in the world, as a day number in that calendar
--   sessions.world_day        the in-game day a session started on (optional)
--
-- A day number counts days from the first day of year 1 (day 0), so dates sort and subtract without
-- knowing the calendar; the app turns them into month names. GMs already update campaigns and
-- sessions under the existing policies, and players already read both, so no policy changes.
--
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p154-world-calendar-check.sql

alter table public.campaigns add column if not exists world_calendar jsonb;
alter table public.campaigns add column if not exists world_day integer;
alter table public.sessions add column if not exists world_day integer;

alter table public.campaigns drop constraint if exists campaigns_world_calendar_shape;
alter table public.campaigns add constraint campaigns_world_calendar_shape check (
  world_calendar is null
  or (jsonb_typeof(world_calendar) = 'object'
      and jsonb_typeof(world_calendar -> 'months') = 'array'
      and jsonb_array_length(world_calendar -> 'months') between 1 and 24
      and pg_column_size(world_calendar) <= 8192)
);

alter table public.campaigns drop constraint if exists campaigns_world_day_range;
alter table public.campaigns add constraint campaigns_world_day_range check (world_day is null or world_day between -100000000 and 100000000);

alter table public.sessions drop constraint if exists sessions_world_day_range;
alter table public.sessions add constraint sessions_world_day_range check (world_day is null or world_day between -100000000 and 100000000);

insert into public._migrations (name) values ('p154-world-calendar') on conflict do nothing;
