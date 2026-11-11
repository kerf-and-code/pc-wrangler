-- p154-world-calendar-check.sql (2026-11-11, push 29). Read-only. Run after p154-world-calendar.sql.

-- 1. The three columns, the constraints and the ledger row.
select (select count(*) from information_schema.columns where table_schema = 'public'
          and ((table_name = 'campaigns' and column_name in ('world_calendar', 'world_day'))
               or (table_name = 'sessions' and column_name = 'world_day'))) as columns_of_3,
       (select count(*) from pg_constraint where conname in ('campaigns_world_calendar_shape', 'campaigns_world_day_range',
          'sessions_world_day_range')) as constraints_of_3,
       (select count(*) from public._migrations where name = 'p154-world-calendar') as ledger;

-- 2. Campaigns keeping in-game time, with their calendar and how many sessions are dated.
select c.name as campaign,
       c.world_calendar ->> 'preset' as preset,
       jsonb_array_length(c.world_calendar -> 'months') as months,
       c.world_day as today,
       (select count(*) from public.sessions s where s.campaign_id = c.id and s.world_day is not null) as dated_sessions
  from public.campaigns c
 where c.world_calendar is not null
 order by c.name;
