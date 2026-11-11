-- supabase/checks/p147-usage-calendar-check.sql (2026-11-10)
-- Read-only. Run after p147-usage-calendar.sql.

-- 1. The objects p147 makes. Expect 2 tables, 6 functions, 2 triggers.
select 'table' as what, c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('usage_events', 'calendar_feeds')
union all
select 'function', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('usage_events_fill_campaign', 'audio_tracks_usage', 'my_calendar_token',
                     'reset_my_calendar_token', 'calendar_feed', 'my_next_sessions')
union all
select 'trigger', t.tgname
  from pg_trigger t
 where t.tgname in ('usage_events_fill_campaign', 'audio_tracks_usage')
order by 1, 2;

-- 2. my_campaigns now leaves out characters that left and campaigns in the trash. Expect true.
select pg_get_functiondef('public.my_campaigns()'::regprocedure) like '%coalesce(ch.active, true)%'
   and pg_get_functiondef('public.my_campaigns()'::regprocedure) like '%c.deleted_at is null%' as my_campaigns_filtered;

-- 3. Usage by account (the campaign's owner), last 30 days. Empty until something runs after p147.
select coalesce(nullif(p.display_name, ''), c.gm_id::text, '(campaign deleted)') as account,
       count(*) filter (where u.kind = 'ai')                         as ai_calls,
       coalesce(sum(u.input_tokens), 0)                              as tokens_in,
       coalesce(sum(u.output_tokens), 0)                             as tokens_out,
       coalesce(sum(u.images), 0)                                    as images,
       round(coalesce(sum(u.audio_seconds), 0) / 60.0, 1)            as transcription_minutes
  from public.usage_events u
  left join public.campaigns c on c.id = u.campaign_id
  left join public.profiles p on p.id = c.gm_id
 where u.created_at > now() - interval '30 days'
 group by 1
 order by transcription_minutes desc, ai_calls desc;

-- 4. Usage by campaign and kind, last 30 days.
select coalesce(c.name, '(campaign deleted)') as campaign, u.kind, u.route,
       count(*) as calls, coalesce(sum(u.input_tokens), 0) as tokens_in, coalesce(sum(u.output_tokens), 0) as tokens_out,
       coalesce(sum(u.images), 0) as images, round(coalesce(sum(u.audio_seconds), 0) / 60.0, 1) as minutes
  from public.usage_events u
  left join public.campaigns c on c.id = u.campaign_id
 where u.created_at > now() - interval '30 days'
 group by 1, 2, 3
 order by 1, 2, 3;
