-- Corrected. The audit view does not select `level`, so join back to characters.
-- Read-only.

-- 0. FIRST: did the seed actually land? Expect 61 / 75 / 14.
--    If these are zero, p4-seed-catalog.sql did not run, and every species_unknown
--    / class_unknown flag in the audit is meaningless (it is comparing against an
--    empty table). Run the seed, then come back.
select 'species'          as catalog, count(*) as rows, 61 as expected from public.species
union all
select 'species_variants', count(*), 75 from public.species_variants
union all
select 'classes',          count(*), 14 from public.classes;

-- 1. The ten characters with no subclass recorded, by level.
--
--    THIS IS THE QUESTION THAT MATTERS. A level 1 or 2 character legitimately has
--    no subclass yet, so contributing nothing to coverage is CORRECT, not a bug. A
--    level 8 Fighter with no subclass is a real gap the GM should fill.
--
--    If most of these are low level, the party coverage is fine and there is nothing
--    to backfill. Do not "fix" data that was never broken.
select
  ch.name,
  ch.class,
  ch.level,
  c.name as campaign,
  case
    when ch.level is null      then 'level unknown'
    when ch.level <= 2         then 'fine: no subclass yet at this level'
    else 'GAP: should have a subclass by now'
  end as verdict
from public.characters ch
join public.campaigns c on c.id = ch.campaign_id
where ch.kind = 'pc'
  and ch.subclass is null
order by ch.level nulls first, ch.name;

-- 2. Summary of the same, so you can see it at a glance.
select
  case
    when level is null then 'level unknown'
    when level <= 2    then 'fine (level 1-2, no subclass yet)'
    else 'real gap (level 3+, subclass missing)'
  end as bucket,
  count(*) as characters
from public.characters
where kind = 'pc' and subclass is null
group by 1
order by 2 desc;
