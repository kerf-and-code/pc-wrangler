-- supabase/checks/p169-numbers-you-can-trust-check.sql (push 46). Read only. Every row should say ok.

select 'migration recorded' as what,
       case when exists (select 1 from public._migrations where name = 'p169-numbers-you-can-trust') then 'ok' else 'MISSING' end as result
union all
select 'campaign_usage_summary, signed-in only',
       case when to_regprocedure('public.campaign_usage_summary(uuid, timestamptz)') is null then 'MISSING'
            when has_function_privilege('anon', 'public.campaign_usage_summary(uuid, timestamptz)', 'execute') then 'OPEN' else 'ok' end
union all
select 'usage_by_campaign, server only',
       case when to_regprocedure('public.usage_by_campaign(timestamptz)') is null then 'MISSING'
            when has_function_privilege('authenticated', 'public.usage_by_campaign(timestamptz)', 'execute') then 'OPEN' else 'ok' end
union all
select 'campaign_event_counts, signed-in only',
       case when to_regprocedure('public.campaign_event_counts(uuid)') is null then 'MISSING'
            when has_function_privilege('anon', 'public.campaign_event_counts(uuid)', 'execute') then 'OPEN' else 'ok' end
union all
select 'world_calendar_reshape, signed-in only',
       case when to_regprocedure('public.world_calendar_reshape(uuid, jsonb, integer, jsonb)') is null then 'MISSING'
            when has_function_privilege('anon', 'public.world_calendar_reshape(uuid, jsonb, integer, jsonb)', 'execute') then 'OPEN' else 'ok' end;

-- how many rows each total now covers, against what a 1,000-row read used to see
select campaign_id, count(*) as usage_rows_last_30_days from public.usage_events
 where created_at >= now() - interval '30 days' group by campaign_id order by 2 desc limit 20;
select campaign_id, count(*) as events_logged from public.events group by campaign_id order by 2 desc limit 20;

-- sessions open more than 18 hours: push 46 stops sending rolls into these; end them (Tonight or Sessions)
select id, campaign_id, session_number, started_at from public.sessions
 where started_at is not null and ended_at is null and started_at < now() - interval '18 hours' order by started_at;
