-- Does the player level have anything to estimate?
--
-- READ THIS BEFORE THE PHASE 5 BUILD.
--
-- A two-level model estimates a PLAYER latent by pooling across that player's
-- CHARACTERS. If every player has exactly one character, the player level has
-- nothing to pool over: phi[player] and theta[character] are identified only
-- through their priors, and the model is really the old one wearing a second
-- storey. It would still be correct, and it would still solve cold-start for the
-- NEXT character each person rolls, but it would not be estimating anything today.
--
-- That is worth knowing before, not after.
--
-- Read-only.

-- 1. THE ONE THAT DECIDES IT. Every player holding more than one character.
--    Each row here is a person the player level can actually learn something about.
select
  p.id                                   as profile_id,
  coalesce(p.display_name, '(unnamed)')  as player,
  case when p.is_anonymous then 'guest' else 'account' end as kind,
  count(distinct ch.id)                  as characters,
  count(distinct ch.campaign_id)         as campaigns,
  string_agg(distinct ch.name, ', ')     as roster
from public.profiles p
join public.characters ch on ch.profile_id = p.id and ch.kind = 'pc'
group by p.id, p.display_name, p.is_anonymous
having count(distinct ch.id) > 1
order by count(distinct ch.id) desc;

-- 2. The summary. If "players with 1 character" is essentially everyone, the player
--    level is a forward investment, not a present capability. Say so out loud rather
--    than shipping a model that quietly estimates nothing.
select
  characters_held,
  count(*) as players
from (
  select ch.profile_id, count(distinct ch.id) as characters_held
  from public.characters ch
  where ch.kind = 'pc' and ch.profile_id is not null
  group by ch.profile_id
) t
group by characters_held
order by characters_held;

-- 3. How much behavioral evidence exists per character? The model fits response
--    counts against opportunity exposure. A character with 1 session of events has a
--    posterior that is almost entirely prior.
select
  c.name                                   as campaign,
  ch.name                                  as character,
  count(distinct e.session_id)             as sessions_with_events,
  count(*) filter (where et.category = 'response') as response_events
from public.characters ch
join public.campaigns c on c.id = ch.campaign_id
left join public.events e on e.character_id = ch.id
left join public.event_types et on et.key = e.event_type
where ch.kind = 'pc'
group by c.name, ch.name
order by 3 desc, 4 desc;

-- 4. TPDI: how many self-reports exist, and are any already player-scope?
--    A player-scope response is campaign_id IS NULL and assigned_character_id IS NULL.
--    (Note: tpdi_autobind currently makes that shape nearly impossible to create,
--    which is one of the things Phase 5 has to fix.)
select
  count(*)                                                  as total,
  count(*) filter (where assigned_character_id is not null) as bound_to_a_character,
  count(*) filter (where assigned_character_id is null)     as unbound,
  count(distinct respondent_id)                             as distinct_people,
  count(distinct instrument_version)                        as instrument_versions
from public.tpdi_responses;
