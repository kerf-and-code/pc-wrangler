-- B2 Prep assistance: "Suggest prep" turns stale threads + quiet players into plan items.
-- Schema: a `source` flag on plan items so suggested items can be badged. (The substance
-- of B2 is the /api/prep/suggest route; this file only guarantees the column exists.)

alter table public.session_plan_items add column if not exists source text not null default 'gm';
