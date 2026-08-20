-- ============================================================================
-- p77-import-backfill.sql
-- Campaign backfill: "upload your notes, we take care of the rest."
--
-- A GM uploads existing notes (an Obsidian vault, a World Anvil export, a Word/PDF/text dump). The
-- server parses and extracts codex candidates and per-session recaps, and files them HERE, in a
-- staging area, where the GM reviews and approves before anything touches the live codex. Only on
-- commit do real rows appear in public.characters / public.entries (via the same shapes the
-- lore-triage/lore-retro routes use) and, for the timeline, in the session tables.
--
-- Why staging and not direct-create: a bulk import is exactly where a bad PDF could dump junk into a
-- shared codex. Nothing here is player-visible; nothing lands in the campaign until the GM says so.
-- Structural candidates (Obsidian/World Anvil, where the NAME and TYPE were authored by the GM, not
-- guessed) can be pre-approved in the UI; loose-prose candidates default to needing a glance.
--
-- Ownership + RLS mirror the rest of the app: the GM who owns the campaign (campaigns.gm_id, via the
-- existing public.is_campaign_gm helper) is the only one who can see or act on an import. The routes
-- do their writes with the service-role admin client, so these policies are defense in depth.
--
-- Idempotent. Run by hand in the Supabase SQL editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- import_jobs: one upload/backfill run.
-- ---------------------------------------------------------------------------
create table if not exists public.import_jobs (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  created_by      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status          text not null default 'parsing',
  source_format   text,                              -- obsidian | worldanvil-json | markdown | pdf | ...
  session_mode    text,                              -- auto | per-file | markers | none
  file_count      integer not null default 0,
  note_count      integer not null default 0,
  candidate_count integer not null default 0,
  session_count   integer not null default 0,
  stats           jsonb,
  warnings        jsonb not null default '[]'::jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.import_jobs
  drop constraint if exists import_jobs_status_check;
alter table public.import_jobs
  add constraint import_jobs_status_check
  check (status in ('parsing','extracting','review','committing','committed','error'));

create index if not exists import_jobs_campaign_idx
  on public.import_jobs (campaign_id, created_at desc);

-- ---------------------------------------------------------------------------
-- import_candidates: one proposed codex entity, awaiting the GM's decision.
-- ---------------------------------------------------------------------------
create table if not exists public.import_candidates (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.import_jobs(id) on delete cascade,
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  kind         text not null,                        -- npc | location | faction | item | lore | pc
  name         text not null,
  body         text,
  links        jsonb not null default '[]'::jsonb,   -- names/ids this entity references
  confidence   numeric,
  origin       text,                                 -- structural | prose
  source_note  text,                                 -- where it came from (path / title), for the GM
  dedupe_kind  text,                                 -- an existing entity it looks like: character | entry
  dedupe_id    uuid,                                 -- ...and that entity's id, if matched
  decision     text not null default 'pending',      -- pending | approved | rejected | merged
  created_kind text,                                 -- after commit: what was written
  created_id   uuid,                                 -- ...and its id
  created_at   timestamptz not null default now()
);

alter table public.import_candidates
  drop constraint if exists import_candidates_kind_check;
alter table public.import_candidates
  add constraint import_candidates_kind_check
  check (kind in ('npc','location','faction','item','lore','pc'));

alter table public.import_candidates
  drop constraint if exists import_candidates_decision_check;
alter table public.import_candidates
  add constraint import_candidates_decision_check
  check (decision in ('pending','approved','rejected','merged'));

create index if not exists import_candidates_job_idx
  on public.import_candidates (job_id, kind, decision);

-- ---------------------------------------------------------------------------
-- import_sessions: one session's worth of timeline, awaiting the GM's decision.
-- ---------------------------------------------------------------------------
create table if not exists public.import_sessions (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.import_jobs(id) on delete cascade,
  campaign_id        uuid not null references public.campaigns(id) on delete cascade,
  idx                integer not null,               -- order along the timeline
  label              text,
  occurred_on        date,                            -- parsed date, when the notes carried one
  recap              text,
  entity_names       jsonb not null default '[]'::jsonb,
  decision           text not null default 'pending', -- pending | approved | rejected
  created_session_id uuid,                            -- the session row created on commit, if any
  created_at         timestamptz not null default now()
);

alter table public.import_sessions
  drop constraint if exists import_sessions_decision_check;
alter table public.import_sessions
  add constraint import_sessions_decision_check
  check (decision in ('pending','approved','rejected'));

create index if not exists import_sessions_job_idx
  on public.import_sessions (job_id, idx);

-- ---------------------------------------------------------------------------
-- RLS: the campaign's GM, and only the campaign's GM.
-- ---------------------------------------------------------------------------
alter table public.import_jobs       enable row level security;
alter table public.import_candidates enable row level security;
alter table public.import_sessions   enable row level security;

drop policy if exists "import_jobs: gm all" on public.import_jobs;
create policy "import_jobs: gm all" on public.import_jobs
  for all to authenticated
  using (public.is_campaign_gm(campaign_id))
  with check (public.is_campaign_gm(campaign_id));

drop policy if exists "import_candidates: gm all" on public.import_candidates;
create policy "import_candidates: gm all" on public.import_candidates
  for all to authenticated
  using (public.is_campaign_gm(campaign_id))
  with check (public.is_campaign_gm(campaign_id));

drop policy if exists "import_sessions: gm all" on public.import_sessions;
create policy "import_sessions: gm all" on public.import_sessions
  for all to authenticated
  using (public.is_campaign_gm(campaign_id))
  with check (public.is_campaign_gm(campaign_id));

grant select, insert, update, delete
  on public.import_jobs, public.import_candidates, public.import_sessions
  to authenticated;

-- ----------------------------------------------------------------------------
-- Verify:
--   select count(*) from public.import_jobs;         -- expect 0 on a fresh run
--   \d public.import_candidates                        -- columns + checks present
--   select polname from pg_policies where tablename = 'import_candidates';
-- ----------------------------------------------------------------------------
