-- roster-removed-players-check.sql  (read-only)
--
-- Why does a player removed from the roster still show on Tonight's "Who is here"?
-- Tonight lists characters with kind = 'pc' and active = true and alter_ego_of is null. This shows,
-- for one campaign, every player character with exactly those fields, so you can see whether the
-- removed players are still active = true (the remove did not stick), or are a second character row
-- for the same player.
--
-- Set the campaign name in the first CTE, then run. One result set. Changes nothing.

with camp as (
  select id, name from public.campaigns
  where name ilike '%PUT CAMPAIGN NAME HERE%'
),
latest as (
  select s.campaign_id, s.id as session_id, s.session_number
  from public.sessions s
  join camp on camp.id = s.campaign_id
  order by s.session_number desc nulls last
  limit 1
)
select
  camp.name                                   as campaign,
  ch.name                                     as character,
  ch.active,
  ch.alter_ego_of is not null                 as is_alter_ego,
  ch.discord_user_id is not null              as discord_linked,
  ch.profile_id is not null                   as player_account_linked,
  (ch.active is true and ch.alter_ego_of is null) as shows_on_tonight,
  latest.session_number                       as latest_session,
  exists (select 1 from public.attendance a
          where a.session_id = latest.session_id and a.character_id = ch.id) as has_attendance_on_latest,
  ch.id                                       as character_id
from public.characters ch
join camp on camp.id = ch.campaign_id
left join latest on latest.campaign_id = ch.campaign_id
where ch.kind = 'pc'
order by ch.active desc, ch.name;
