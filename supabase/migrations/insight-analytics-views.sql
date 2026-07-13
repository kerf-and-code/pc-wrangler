-- Insight analytics views (the GM-facing disposition/equity surface).
-- These six views back /gm/dashboard, /gm/reliability, /gm/mechanics and the
-- disposition reads. They were cloned into the hub DB directly and had never
-- been committed to the repo, so a DB rebuild would silently break Insight
-- (handoff gotcha #9). Captured verbatim from pg_views on 2026-07-09.
--
-- Dependency order matters: v_session_equity and v_session_gini select FROM
-- v_session_spotlight, so spotlight must exist first. Everything here reads the
-- accepted `events` spine joined to the `event_types` catalog (category =
-- 'response' | 'opportunity'), so the views only return rows once player events
-- exist for a session. GM-only narration (gm_events) does NOT feed these.

-- Base: per-character weighted "response" share within a session.
create or replace view public.v_session_spotlight as
 with resp as (
   select e.campaign_id,
     e.session_id,
     e.character_id,
     sum(
       case
         when (e.event_type = any (array['decision'::text, 'character_choice'::text])) then 2.0
         else 1.0
       end) as weighted,
     count(*) as raw_events
   from (events e
     join event_types t on ((t.key = e.event_type)))
   where ((t.category = 'response'::text) and (e.character_id is not null))
   group by e.campaign_id, e.session_id, e.character_id
 )
 select r.campaign_id,
   r.session_id,
   r.character_id,
   c.name as character_name,
   r.raw_events,
   r.weighted,
   round((r.weighted / nullif(sum(r.weighted) over (partition by r.session_id), (0)::numeric)), 3) as share
 from (resp r
   left join characters c on ((c.id = r.character_id)));

-- Equity summary per session (coefficient of variation across characters).
create or replace view public.v_session_equity as
 select campaign_id,
   session_id,
   count(*) as n_active,
   round(sum(weighted), 2) as total_weighted,
   round(avg(weighted), 2) as mean_weighted,
   round(stddev_pop(weighted), 2) as sd_weighted,
   case
     when (avg(weighted) > (0)::numeric) then round((stddev_pop(weighted) / avg(weighted)), 3)
     else (0)::numeric
   end as cv
 from v_session_spotlight
 group by campaign_id, session_id;

-- Gini coefficient of spotlight weight per session.
create or replace view public.v_session_gini as
 with ranked as (
   select v_session_spotlight.campaign_id,
     v_session_spotlight.session_id,
     v_session_spotlight.weighted,
     row_number() over (partition by v_session_spotlight.session_id order by v_session_spotlight.weighted) as i,
     count(*) over (partition by v_session_spotlight.session_id) as n,
     sum(v_session_spotlight.weighted) over (partition by v_session_spotlight.session_id) as tot
   from v_session_spotlight
 )
 select campaign_id,
   session_id,
   max(n) as n_active,
   case
     when ((max(tot) > (0)::numeric) and (max(n) > 1)) then round((((2.0 * sum(((i)::numeric * weighted))) / ((max(n))::numeric * max(tot))) - (((max(n))::numeric + 1.0) / (max(n))::numeric)), 3)
     else (0)::numeric
   end as gini
 from ranked
 group by campaign_id, session_id;

-- Per-axis engagement: character responses vs session opportunities.
create or replace view public.v_session_axis_engagement as
 with opps as (
   select e.session_id,
     e.axis,
     count(*) as opportunities
   from (events e
     join event_types t on ((t.key = e.event_type)))
   where ((t.category = 'opportunity'::text) and (e.axis is not null))
   group by e.session_id, e.axis
 ), resp as (
   select e.campaign_id,
     e.session_id,
     e.character_id,
     e.axis,
     count(*) as responses
   from (events e
     join event_types t on ((t.key = e.event_type)))
   where ((t.category = 'response'::text) and (e.axis is not null) and (e.character_id is not null))
   group by e.campaign_id, e.session_id, e.character_id, e.axis
 )
 select r.campaign_id,
   r.session_id,
   r.character_id,
   r.axis,
   r.responses,
   coalesce(o.opportunities, (0)::bigint) as opportunities,
   case
     when (coalesce(o.opportunities, (0)::bigint) > 0) then round(((r.responses)::numeric / (o.opportunities)::numeric), 3)
     else null::numeric
   end as per_opportunity_rate
 from (resp r
   left join opps o on (((o.session_id = r.session_id) and (o.axis = r.axis))));

-- Arc freshness: how many sessions since each arc was last touched (staleness).
create or replace view public.v_arc_freshness as
 with cur as (
   select sessions.campaign_id,
     max(sessions.session_number) as current_session
   from sessions
   group by sessions.campaign_id
 ), lt as (
   select a_1.id as arc_id,
     s.session_number as last_touched_num
   from (arcs a_1
     left join sessions s on ((s.id = a_1.last_touched_session_id)))
 )
 select a.id as arc_id,
   a.campaign_id,
   a.title,
   a.status,
   a.character_id,
   ch.name as character_name,
   lt.last_touched_num,
   cur.current_session,
   case
     when (lt.last_touched_num is null) then cur.current_session
     else (cur.current_session - lt.last_touched_num)
   end as sessions_since_touched,
   ((a.status = any (array['open'::text, 'progressing'::text])) and ((lt.last_touched_num is null) or ((cur.current_session - lt.last_touched_num) >= 3))) as stale
 from (((arcs a
   join cur on ((cur.campaign_id = a.campaign_id)))
   left join lt on ((lt.arc_id = a.id)))
   left join characters ch on ((ch.id = a.character_id)));

-- Loot fairness: each character's share of campaign loot vs an even split.
create or replace view public.v_loot_fairness as
 with per_char as (
   select loot_grants.campaign_id,
     loot_grants.character_id,
     sum(coalesce(loot_grants.est_value, (0)::numeric)) as total_value,
     count(*) as items
   from loot_grants
   where (loot_grants.character_id is not null)
   group by loot_grants.campaign_id, loot_grants.character_id
 ), camp as (
   select per_char.campaign_id,
     sum(per_char.total_value) as camp_total,
     count(*) as n_recipients
   from per_char
   group by per_char.campaign_id
 )
 select p.campaign_id,
   p.character_id,
   ch.name as character_name,
   p.items,
   p.total_value,
   case
     when (c.camp_total > (0)::numeric) then round((p.total_value / c.camp_total), 3)
     else null::numeric
   end as share,
   case
     when (c.n_recipients > 0) then round((1.0 / (c.n_recipients)::numeric), 3)
     else null::numeric
   end as equal_share,
   case
     when (c.camp_total > (0)::numeric) then round(((p.total_value / c.camp_total) - (1.0 / (c.n_recipients)::numeric)), 3)
     else null::numeric
   end as deviation
 from ((per_char p
   join camp c on ((c.campaign_id = p.campaign_id)))
   left join characters ch on ((ch.id = p.character_id)));
