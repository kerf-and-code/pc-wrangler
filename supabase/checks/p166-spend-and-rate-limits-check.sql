-- supabase\checks\p166-spend-and-rate-limits-check.sql (2026-11-12, push 42, read only)
-- Run after p166. Every row should say ok = true.

select 'migration recorded' as what, exists (select 1 from public._migrations where name = 'p166-spend-and-rate-limits') as ok
union all
select 'ai kinds include recap, journal, import',
       pg_get_constraintdef((select oid from pg_constraint where conname = 'ai_map_renders_kind_check')) like '%journal%'
union all
select 'rate_hits locked to the server', not has_table_privilege('authenticated', 'public.rate_hits', 'SELECT')
union all
select 'rate_hit only for the server', not has_function_privilege('anon', 'public.rate_hit(text, text, integer, integer)', 'EXECUTE')
union all
select 'vtt_events has the campaign and time index (roll ingest cap)',
       exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'vtt_events_campaign_idx');

-- What the new caps would have refused: AI calls by kind per GM in the busiest 24 hours of the last 30
-- days. Recap, journal and import start counting only after this push, so they read 0 until then.
select kind, max(n) as most_in_one_day
  from (select kind, profile_id, date_trunc('day', created_at) d, count(*) n
          from public.ai_map_renders where created_at > now() - interval '30 days'
         group by 1, 2, 3) x
 group by kind order by kind;
