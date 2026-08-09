-- ============================================================================
-- p35-player-notes.sql
-- A player's own notes. Private, and built so they stay that way.
--
-- THE DESIGN CONSTRAINT IS THE POINT
--   These are for the player's eyes only, always. Not private-by-default with a share button later:
--   private, full stop. So there is no visibility column, no share code, no "reveal to GM" flag and
--   no policy that mentions campaign membership or a GM. The absence of those is the feature - a
--   schema with a visibility column invites someone to add a UI for it in six months, and by then
--   people will have written things down on the promise that nobody else reads them.
--
--   A GM cannot read this table. Not through a policy exception, not through the roster, not
--   through a SECURITY DEFINER helper. If that ever needs to change it should be a new table with
--   new consent, not a widened policy here.
--
-- TWO KINDS OF NOTE, ONE TABLE
--   A free note belongs to the player and a campaign. An entry note additionally points at a codex
--   entry. Splitting them into two tables would double the policy surface for one nullable column,
--   and the policy surface is the part that has to be right.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

create table if not exists public.player_notes (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  -- Null for a free-standing note; set when the note is attached to a codex entry.
  entry_id    uuid references public.entries (id) on delete cascade,
  body        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One note per player per entry: the UI edits a single box rather than appending a thread, so a
-- second row would be a silent duplicate the player could not see or delete.
create unique index if not exists player_notes_one_per_entry
  on public.player_notes (profile_id, entry_id)
  where entry_id is not null;

create index if not exists player_notes_owner_campaign_idx
  on public.player_notes (profile_id, campaign_id);

alter table public.player_notes enable row level security;

-- ONE POLICY, ALL COMMANDS, OWNER ONLY. Written as a single `for all` rather than four separate
-- policies so there is no chance of the select and the update disagreeing - which is exactly the
-- bug that stopped every player reading their own character until today.
drop policy if exists "own notes only" on public.player_notes;
create policy "own notes only"
  on public.player_notes
  for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create or replace function public.touch_player_notes()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists player_notes_touch on public.player_notes;
create trigger player_notes_touch
  before update on public.player_notes
  for each row execute function public.touch_player_notes();

-- ----------------------------------------------------------------------------
-- Verify, and confirm the isolation rather than assuming it:
--   select policyname, cmd, qual from pg_policies
--   where schemaname = 'public' and tablename = 'player_notes';
--   -- expect ONE row, ALL, (profile_id = auth.uid())
--
-- As a GM, against a campaign you run, this must return nothing:
--   select count(*) from public.player_notes;
-- ----------------------------------------------------------------------------
