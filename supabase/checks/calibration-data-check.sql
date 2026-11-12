-- calibration-data-check.sql (2026-11-11, push 39). Read-only. How much fight data exists for encounter
-- calibration (predicted difficulty against how each fight went), per campaign.

select c.name as campaign,
       count(*)                                                        as fights,
       count(*) filter (where cb.status = 'ended')                     as ended,
       count(*) filter (where cb.encounter_id is not null)             as from_an_encounter,
       count(*) filter (where cb.rules in ('2014', '2024'))            as dnd,
       max(cb.round)                                                   as most_rounds,
       round(avg(cb.round) filter (where cb.status = 'ended'), 1)      as avg_rounds_ended,
       sum((select count(*) from jsonb_array_elements(cb.combatants) e where e ->> 'kind' = 'pc'))      as pc_slots,
       sum((select count(*) from jsonb_array_elements(cb.combatants) e
             where e ->> 'kind' = 'monster' and coalesce(e -> 'block' ->> 'cr', '') <> ''))              as monsters_with_cr,
       sum((select count(*) from jsonb_array_elements(cb.combatants) e
             where e ->> 'kind' = 'monster' and coalesce(e -> 'block' ->> 'cr', '') = ''))               as monsters_without_cr,
       min(cb.created_at)::date                                         as first_fight,
       max(cb.created_at)::date                                         as last_fight
  from public.combats cb join public.campaigns c on c.id = cb.campaign_id
 group by c.name
 order by fights desc;
