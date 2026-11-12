-- p160-roll20-capture-check.sql (2026-11-11, push 38). Read-only. Run after p160-roll20-capture.sql.

-- 1. The new column, its index and the ledger row.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'vtt_events' and column_name = 'external_id';
select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname = 'vtt_events_external_uniq';
select count(*) as ledger from public._migrations where name = 'p160-roll20-capture';

-- 2. Rolls by source (Roll20 rolls appear as roll20 once players turn it on).
select source, count(*) as rolls, count(*) filter (where fidelity = 'canonical') as verified,
       count(*) filter (where character_id is null) as unattributed, max(received_at) as latest
  from public.vtt_events group by source order by source;

-- 3. Roll20 names that matched no character (rename the character in Six Axes, or the roll in Roll20, to match).
select actor_name, count(*) as rolls, max(received_at) as latest
  from public.vtt_events
 where source = 'roll20' and character_id is null and actor_name is not null
 group by actor_name order by rolls desc limit 30;
