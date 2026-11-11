-- p155-encounter-maps-check.sql (2026-11-11, push 31). Read-only. Run after p155-encounter-maps.sql.

-- 1. The column, its constraint and the ledger row.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'encounters' and column_name = 'maps') as maps_column,
       (select count(*) from pg_constraint where conname = 'encounters_maps_shape') as constraint_present,
       (select count(*) from public._migrations where name = 'p155-encounter-maps') as ledger;

-- 2. Encounters that span more than one map, and whether every listed map still exists.
select c.name as campaign, e.name as encounter, jsonb_array_length(e.maps) as maps,
       (select count(*) from jsonb_array_elements_text(e.maps) m
          where not exists (select 1 from public.vtt_scenes s where s.id::text = m)) as missing_maps
  from public.encounters e join public.campaigns c on c.id = e.campaign_id
 where jsonb_array_length(e.maps) > 0
 order by c.name, e.name;
