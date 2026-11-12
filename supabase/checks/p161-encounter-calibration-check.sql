-- p161-encounter-calibration-check.sql (2026-11-11, push 39). Read-only. Run after p161-encounter-calibration.sql.

-- 1. The column, the trigger and the ledger row.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'combats' and column_name = 'calibration';
select tgname, tgenabled from pg_trigger where tgrelid = 'public.combats'::regclass and tgname = 'combats_calibration';
select count(*) as ledger from public._migrations where name = 'p161-encounter-calibration';

-- 2. Fights measured so far (start recorded, and ended ones with their end).
select c.name as campaign,
       count(*) filter (where cb.calibration ? 'start')                       as measured,
       count(*) filter (where cb.calibration ? 'end')                         as measured_and_ended,
       sum(coalesce((select sum(value::int) from jsonb_each_text(cb.calibration -> 'downs')), 0)) as drops
  from public.combats cb join public.campaigns c on c.id = cb.campaign_id
 group by c.name order by measured desc;
