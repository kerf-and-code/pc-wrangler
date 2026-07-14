-- Phase 3: the player dossier RPCs.
--
-- THE PROBLEM THESE SOLVE, AND WHY THE HUB'S VERSIONS DO NOT WORK HERE.
--
-- The hub's /me pages read public.memberships directly and gate on
-- is_campaign_member(). But in this app NOTHING EVER CREATES A MEMBERSHIP ROW FOR A
-- PLAYER. claim_character_invite sets characters.profile_id and stops there. So
-- is_campaign_member() is false for every player in the database, and the hub's
-- queries would return empty, silently.
--
-- That is not a bug in the pilot, it is the pilot's design: players are not
-- members. They reach their data through SECURITY DEFINER functions
-- (player_journal, codex_for_player, roster_for_share) that bypass RLS and gate on
-- ownership instead.
--
-- The tempting shortcut is to start inserting membership rows on claim. That would
-- be a mistake dressed as a one-liner: is_campaign_member() gates a dozen RLS
-- policies (members read events, characters, arcs, loot, attendance, consents), so
-- flipping it true for players would hand every player read access to every other
-- player's events, the full roster, all loot, and the consent table, all at once.
-- A permission expansion that large should be a deliberate decision, not a side
-- effect of porting a page.
--
-- So these functions gate on the thing that IS true of a player: they own a PC in
-- the campaign.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. my_campaigns(): every campaign this person plays in.
-- ---------------------------------------------------------------------------
-- Derived from characters they own, NOT from memberships. Returns the GM's display
-- name too, which the caller cannot get on its own now that profiles is self-only.
create or replace function public.my_campaigns()
returns table (
  campaign_id     uuid,
  campaign_name   text,
  system          text,
  share_code      text,
  gm_name         text,
  my_characters   bigint,
  last_session_at timestamptz
)
language sql
security definer
set search_path to 'public'
as $$
  select
    c.id,
    c.name,
    c.system,
    c.share_code,
    coalesce(nullif(gm.display_name, ''), 'Your GM'),
    count(ch.id),
    (select max(s.started_at)
       from public.sessions s
      where s.campaign_id = c.id and s.started_at is not null)
  from public.characters ch
  join public.campaigns c  on c.id = ch.campaign_id
  left join public.profiles gm on gm.id = c.gm_id
  where ch.profile_id = auth.uid()
    and ch.kind = 'pc'
  group by c.id, c.name, c.system, c.share_code, gm.display_name
  order by c.name;
$$;

revoke all on function public.my_campaigns() from public;
grant execute on function public.my_campaigns() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. codex_for_campaign(): the shared canon a player can see, by campaign id.
-- ---------------------------------------------------------------------------
-- Same shape as the existing codex_for_player(share_code), but keyed on campaign id
-- so the /me hub can fan out across several campaigns without juggling share codes.
--
-- Gate rebased from is_campaign_member() (always false here) to "you own a PC in
-- this campaign". Reveals still resolve per character, exactly as codex_for_player
-- does.
create or replace function public.codex_for_campaign(p_campaign uuid)
returns table (item_kind text, item_type text, id uuid, title text, body text)
language sql
security definer
set search_path to 'public'
as $$
  with me as (
    -- The gate AND the reveal target, in one: you must own a PC here to see
    -- anything, and reveals are addressed to that PC.
    select ch.id
    from public.characters ch
    where ch.campaign_id = p_campaign
      and ch.kind = 'pc'
      and ch.profile_id = auth.uid()
    limit 1
  ),
  revealed as (
    select er.target_type, er.target_id
    from public.entry_reveals er, me
    where er.revealed_to_character_id = me.id
  )
  select 'entry'::text, e.type, e.id, e.title, e.body
  from public.entries e
  where exists (select 1 from me)
    and e.campaign_id = p_campaign
    and (e.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type = 'entry' and r.target_id = e.id))
  union all
  select 'npc'::text, 'npc'::text, ch.id, ch.name, ch.description
  from public.characters ch
  where exists (select 1 from me)
    and ch.campaign_id = p_campaign
    and ch.kind = 'npc'
    and (ch.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type = 'character' and r.target_id = ch.id));
$$;

revoke all on function public.codex_for_campaign(uuid) from public;
grant execute on function public.codex_for_campaign(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tighten threads: a thread may only point at a character you actually own.
-- ---------------------------------------------------------------------------
-- The RLS on threads checks profile_id = auth.uid(), which stops you reading or
-- writing someone else's thread. It does NOT stop you attaching your own thread to
-- someone else's character_id, which would leak that character's id into your rows
-- and, worse, let you build a thread list referencing a party you are not in.
--
-- Enforced with a trigger rather than a check constraint, because it needs a
-- subquery.
create or replace function public.threads_guard_character()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.character_id is not null then
    if not exists (
      select 1 from public.characters ch
      where ch.id = new.character_id
        and ch.profile_id = auth.uid()
    ) then
      raise exception 'you can only attach a thread to a character you own';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists threads_guard_character_trg on public.threads;
create trigger threads_guard_character_trg
  before insert or update on public.threads
  for each row execute function public.threads_guard_character();
