-- Identity landscape. Read-only. Run after p3-verify.sql passes.
--
-- Tells us what the durable-account work is actually operating on: how many real
-- people exist, how many are guests, how many characters are unclaimed, and
-- whether anyone already holds more than one character (which is the whole point
-- of the multi-character stable).

-- 1. Who exists.
select
  'profiles' as scope,
  count(*)                                        as total,
  count(*) filter (where is_anonymous)            as guests,
  count(*) filter (where not is_anonymous)        as durable,
  count(*) filter (where upgraded_at is not null) as upgraded
from public.profiles;

-- 2. Characters: claimed, unclaimed, and by whom.
select
  'characters' as scope,
  count(*)                                          as total,
  count(*) filter (where kind = 'pc')               as pcs,
  count(*) filter (where kind = 'pc' and profile_id is null)     as unclaimed_pcs,
  count(*) filter (where kind = 'pc' and profile_id is not null) as claimed_pcs,
  count(distinct profile_id) filter (where kind = 'pc')          as distinct_owners
from public.characters;

-- 3. THE ONE THAT MATTERS: does anyone already hold multiple characters?
--    Every row here is a player whose stable already exists and who has been
--    invisible to the product until now.
select
  p.id                                    as profile_id,
  coalesce(p.display_name, '(no name)')   as player,
  case when p.is_anonymous then 'guest' else 'durable' end as account,
  count(ch.id)                            as characters,
  count(distinct ch.campaign_id)          as campaigns,
  string_agg(ch.name, ', ' order by ch.name) as roster
from public.profiles p
join public.characters ch on ch.profile_id = p.id and ch.kind = 'pc'
group by p.id, p.display_name, p.is_anonymous
having count(ch.id) > 1
order by count(ch.id) desc;

-- 4. TPDI: how much self-report already exists, and at what scope.
--    A row with campaign_id IS NULL and assigned_character_id IS NULL is already
--    a player-scope response, which is exactly what the Phase 5 player prior needs.
select
  'tpdi_responses' as scope,
  count(*)                                                   as total,
  count(*) filter (where assigned_character_id is not null)  as character_scoped,
  count(*) filter (where assigned_character_id is null
                     and campaign_id is null)                as already_player_scoped,
  count(*) filter (where assigned_character_id is null
                     and campaign_id is not null)            as campaign_orphans,
  count(distinct respondent_id)                              as distinct_respondents,
  count(distinct instrument_version)                         as instrument_versions
from public.tpdi_responses;

-- 5. Dispositions: what the model has produced so far, by scope.
--    character_id IS NULL is already a player-scope row shape.
select
  'dispositions' as scope,
  count(*)                                          as total,
  count(*) filter (where character_id is not null)  as character_scoped,
  count(*) filter (where character_id is null)      as player_scoped,
  count(*) filter (where source = 'prior')          as priors,
  count(*) filter (where source = 'posterior')      as posteriors,
  count(distinct model_version)                     as model_versions
from public.dispositions;
