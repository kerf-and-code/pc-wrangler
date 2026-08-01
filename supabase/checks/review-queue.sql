-- supabase/checks/review-queue.sql
--
-- Exactly what is waiting for the GM, by campaign and session. Read-only.
--
-- WHY THIS IS NOT JUST "count the proposed rows"
--
-- Three things in the review UI mean a raw count misleads:
--
--   npc_* kinds       bulk accept SKIPS them on purpose, so an NPC is never created
--                     without the GM seeing the row. They can only be cleared one at a
--                     time, and they are usually why a queue that "looks nearly done"
--                     still will not finalize.
--   meta kind         hidden unless the GM ticks "show meta". Invisible work: the count
--                     says items remain and the page appears empty.
--   the confidence    bulk accept only takes beats at or above the slider. Anything
--   threshold         below it stays behind however many times the button is pressed.
--
-- So the queue is broken out by those, not lumped together.
--
-- WHY THE JOB HAS TO REACH 'review' FIRST
--
-- /api/review/finalize only fires when the job is at 'review' AND zero rows remain
-- proposed. A job stuck at draft, transcribing, or extracting has work the GM cannot do
-- yet no matter how much they want to, so those are listed separately as blocked rather
-- than as a queue.
--
-- Written as ONE statement: the Supabase SQL editor shows only the LAST result set.

with jobq as (
  select
    j.id           as job_id,
    j.campaign_id,
    j.session_id,
    j.status       as job_status,
    j.error,
    c.name         as campaign,
    c.share_code,
    s.session_number,
    (select count(*) from public.proposed_events p
       where p.job_id = j.id and p.status = 'proposed')                     as player_left,
    (select count(*) from public.gm_proposed_events g
       where g.job_id = j.id and g.status = 'proposed'
         and left(g.kind, 4) <> 'npc_' and g.kind <> 'meta')                 as gm_left,
    (select count(*) from public.gm_proposed_events g
       where g.job_id = j.id and g.status = 'proposed'
         and left(g.kind, 4) = 'npc_')                                          as gm_npc_left,
    (select count(*) from public.gm_proposed_events g
       where g.job_id = j.id and g.status = 'proposed' and g.kind = 'meta') as gm_meta_left
  from public.capture_jobs j
  join public.campaigns c on c.id = j.campaign_id
  left join public.sessions s on s.id = j.session_id
),
totals as (
  select
    sum(player_left)  as player_left,
    sum(gm_left)      as gm_left,
    sum(gm_npc_left)  as gm_npc_left,
    sum(gm_meta_left) as gm_meta_left
  from jobq
)

select section, item, detail
from (

  -- ---------------------------------------------------------------- totals
  select 1 as sort, 'to review'::text as section, 'player events'::text as item,
         coalesce((select player_left from totals), 0)::text as detail, '1'::text as k
  union all
  select 1, 'to review', 'GM beats (bulk-acceptable)',
         coalesce((select gm_left from totals), 0)::text, '2'
  union all
  select 1, 'to review', 'GM beats, npc_* (one at a time)',
         coalesce((select gm_npc_left from totals), 0)::text, '3'
  union all
  select 1, 'to review', 'GM beats, meta (tick "show meta" to see)',
         coalesce((select gm_meta_left from totals), 0)::text, '4'

  -- ------------------------------------------------- the queue, worst first
  -- Only jobs actually reviewable. Everything else is in the blocked section.
  union all
  select 2, 'queue'::text,
         (q.campaign || '  session ' || coalesce(q.session_number::text, '?')
          || '   [' || q.share_code || ']')::text,
         (q.player_left::text || ' player, ' || q.gm_left::text || ' GM'
          || case when q.gm_npc_left > 0 then ', ' || q.gm_npc_left::text || ' NPC (per row)' else '' end
          || case when q.gm_meta_left > 0 then ', ' || q.gm_meta_left::text || ' meta (hidden)' else '' end
         )::text,
         lpad((999999 - (q.player_left + q.gm_left + q.gm_npc_left + q.gm_meta_left))::text, 7, '0')
  from jobq q
  where q.job_status = 'review'
    and (q.player_left + q.gm_left + q.gm_npc_left + q.gm_meta_left) > 0

  -- -------------------------------------------- ready to finish, nothing left
  -- At 'review' with an empty queue. finalize should have fired and did not, so the
  -- recap never drafted. Opening the Review page re-triggers it.
  union all
  select 3, 'stuck at review, queue empty'::text,
         (q.campaign || '  session ' || coalesce(q.session_number::text, '?'))::text,
         ('job ' || left(q.job_id::text, 8) || '   open Review to let it finalize')::text,
         q.campaign
  from jobq q
  where q.job_status = 'review'
    and (q.player_left + q.gm_left + q.gm_npc_left + q.gm_meta_left) = 0

  -- ------------------------------------------------------------- blocked
  union all
  select 4, 'not reviewable yet'::text,
         (q.campaign || '  session ' || coalesce(q.session_number::text, '?'))::text,
         (q.job_status || coalesce('   ' || q.error, ''))::text,
         q.job_status || q.campaign
  from jobq q
  where q.job_status not in ('review', 'done')

  -- ------------------------------------------------------- sessions to close
  -- /stop no longer closes a session, by design, so the GM closes it on the Session Log.
  -- While it stays open, party chat is hidden and D&D Beyond rolls keep landing in it.
  union all
  select 5, 'open sessions to close'::text,
         (c.name || '  session ' || coalesce(s.session_number::text, '?'))::text,
         ('started ' || to_char(s.started_at, 'YYYY-MM-DD') || ', status ' || s.status)::text,
         to_char(s.started_at, 'YYYY-MM-DD')
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  where s.started_at is not null and s.ended_at is null

) report
order by sort, k, item;
