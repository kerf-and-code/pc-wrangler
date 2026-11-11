-- p153-ask-campaign-check.sql (2026-11-10, push 27). Read-only. Run after p153-ask-campaign.sql.

-- 1. The function, the five indexes, the widened allowance kinds and the ledger row.
select to_regprocedure('public.ask_campaign_search(uuid,text[],integer,integer)') as search_fn,
       (select count(*) from pg_indexes where schemaname = 'public'
          and indexname in ('transcript_segments_fts_idx', 'entries_fts_idx', 'gm_events_fts_idx',
                            'characters_fts_idx', 'sessions_fts_idx')) as fts_indexes_of_5,
       (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_map_renders_kind_check') as kinds,
       (select count(*) from public._migrations where name = 'p153-ask-campaign') as ledger;

-- 2. Who may call it: authenticated and the service role, not anon.
select p.proname, array_to_string(p.proacl, ', ') as grants
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'ask_campaign_search';

-- 3. How much each campaign has to search, and how big the new indexes are.
select c.name as campaign,
       (select count(*) from public.transcript_segments s where s.campaign_id = c.id) as transcript_lines,
       (select count(*) from public.gm_events e where e.campaign_id = c.id) as story_beats,
       (select count(*) from public.entries en where en.campaign_id = c.id) as codex_entries,
       (select count(*) from public.sessions se where se.campaign_id = c.id and coalesce(se.recap, '') <> '') as recaps
  from public.campaigns c
 order by transcript_lines desc
 limit 20;

select indexname, pg_size_pretty(pg_relation_size(('public.' || indexname)::regclass)) as size
  from pg_indexes
 where schemaname = 'public' and indexname like '%\_fts\_idx' escape '\'
 order by 1;

-- 4. Questions asked so far (each one holds a row in the daily allowance).
select date_trunc('day', created_at) as day, count(*) as questions
  from public.ai_map_renders where kind = 'ask'
 group by 1 order by 1 desc limit 14;
