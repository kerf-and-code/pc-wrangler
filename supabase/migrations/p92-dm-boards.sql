-- ============================================================================
-- p92-dm-boards.sql
-- DM Screen boards for the voice compendium (/gm/screen).
--
-- THE MODEL
--   A GM sends any compendium card "to the DM Screen" and arranges it on a free-form board. Each board
--   is one row here; its placed cards live in the `cards` jsonb array, each a SNAPSHOT of the card plus
--   its position and size:
--     [{ id, entry: <full CompendiumEntry at send time>, x, y, w, h }, ...]
--   Snapshots on purpose: the board is a situational scratch space, so a card stays put even if the
--   source entry later changes, and viewing a board needs no per-system index loaded.
--
--   SCOPE is account-wide with an optional campaign tag (Terry's call, same shape as compendium_entries):
--   boards follow the GM across campaigns; campaign_id can pin a board to one game. A GM can keep many
--   named boards. Owner-only: a GM sees only their own boards.
--
-- ONE POLICY, ALL COMMANDS, OWNER ONLY - same shape as p90-compendium-entries / p35-player-notes.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

create table if not exists public.dm_boards (
  id           uuid primary key default gen_random_uuid(),
  gm_id        uuid not null references auth.users (id) on delete cascade,
  -- Null = account-wide (all the GM's campaigns); set = pinned to one campaign.
  campaign_id  uuid references public.campaigns (id) on delete cascade,
  name         text not null default 'New board',
  -- The placed cards: [{ id, entry, x, y, w, h }]. Snapshots, so the board is self-contained.
  cards        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Query path: a GM's boards, newest first.
create index if not exists dm_boards_owner_idx
  on public.dm_boards (gm_id);

alter table public.dm_boards enable row level security;

drop policy if exists "own dm boards only" on public.dm_boards;
create policy "own dm boards only"
  on public.dm_boards
  for all
  using (gm_id = auth.uid())
  with check (gm_id = auth.uid());

create or replace function public.touch_dm_boards()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dm_boards_touch on public.dm_boards;
create trigger dm_boards_touch
  before update on public.dm_boards
  for each row execute function public.touch_dm_boards();

-- ----------------------------------------------------------------------------
-- Verify (expect ONE policy row, ALL, (gm_id = auth.uid())):
--   select policyname, cmd, qual from pg_policies
--   where schemaname = 'public' and tablename = 'dm_boards';
-- ----------------------------------------------------------------------------
