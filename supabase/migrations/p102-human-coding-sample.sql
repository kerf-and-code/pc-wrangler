-- p102-human-coding-sample.sql
--
-- Human second coding for reliability (replaces the LLM recode pass, which shared the extractor's
-- biases and could agree with it for the wrong reasons).
--
-- One row per transcript line drawn into a blind coding sample for a capture job. The sample is
-- STRATIFIED on the extractor's own call: lines it flagged (stratum 'flagged') and lines it did not
-- ('unflagged') are drawn separately, and each row carries its inclusion probability so the detection
-- kappa can be weighted back to the whole session. The stratum is never shown to the person coding:
-- this table has RLS on and NO policies, so only the server (service role) reads or writes it, and the
-- coding page receives the line text and nothing about the extractor.
--
-- human_event: the event type key the human chose, or null with coded_at set for "nothing here".
-- coded_at null means not coded yet.
--
-- Idempotent: safe to run more than once.

create table if not exists public.coding_samples (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.capture_jobs(id) on delete cascade,
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  segment_id       uuid not null references public.transcript_segments(id) on delete cascade,
  stratum          text not null check (stratum in ('flagged', 'unflagged')),
  stratum_size     integer not null check (stratum_size > 0),   -- lines in this stratum in the session
  inclusion_prob   double precision not null check (inclusion_prob > 0 and inclusion_prob <= 1),
  sort_key         double precision not null,                   -- random order shown to the coder
  human_event      text,
  coded_by         uuid,
  coded_at         timestamptz,
  created_at       timestamptz not null default now(),
  unique (job_id, segment_id)
);

create index if not exists coding_samples_job_idx on public.coding_samples (job_id, sort_key);

alter table public.coding_samples enable row level security;
-- No policies on purpose: reads and writes go through /api/coding-sample with the service role,
-- after an is_campaign_gm check, so the stratum can never reach the coder's browser.
