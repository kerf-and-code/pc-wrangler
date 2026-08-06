-- ============================================================================
-- p27-anonymous-vibe.sql
-- Let a player submit a check-in that genuinely is not linked to them.
--
-- WHAT WAS WRONG WITH THE OLD "ANONYMOUS"
--   Leaving the name blank hid the name from the GM and nothing else. profile_id was written on
--   every row, NOT NULL, and /gm/search filters vibe results BY profile_id - so a GM could pick a
--   character and read that player's supposedly anonymous notes. It was anonymous in the display
--   and not in the data, which is the worse of the two places to be anonymous, because the promise
--   the interface makes is the one people rely on.
--
-- WHAT CHANGES
--   profile_id becomes nullable, and an anonymous submission writes null. There is then nothing on
--   the row tying it to an account: no id, no name, and the timestamp is coarsened (see below).
--
-- WHAT IT COSTS, AND WHY THAT IS THE RIGHT TRADE
--   The upsert keys on (session_id, profile_id), which is how a player edits an answer and how the
--   table stops one person submitting five times. With no profile_id there is nothing to match, so
--   an anonymous check-in is WRITE-ONCE and could in principle be sent twice. That is the honest
--   shape of anonymity: a system that can stop you submitting twice is a system that knows it was
--   you. The UI says so rather than pretending otherwise.
--
-- THE TIMESTAMP IS COARSENED TO THE HOUR
--   At a five-person table, timing is the realistic way anonymity breaks: a GM who sees a note
--   arrive at 21:03:14 often knows exactly who was on their phone at 21:03. Storing the hour keeps
--   the ordering useful and removes the tell. It is not perfect - nothing is, at that table size -
--   but it costs nothing and closes the easiest route.
--
-- Idempotent. Run by hand in the Supabase editor.
-- ============================================================================

alter table public.vibe_checks alter column profile_id drop not null;

comment on column public.vibe_checks.profile_id is
  'Null means the player chose to submit anonymously. Nothing else on the row identifies them: '
  'player_name is forced null and created_at is coarsened to the hour.';

-- Dropped rather than replaced: the signature gains a parameter, and CREATE OR REPLACE with a
-- different argument list creates a SECOND overload instead, which leaves PostgREST choosing
-- between two functions of the same name. The new parameter has a default, so a client that still
-- sends the original six named arguments keeps working.
drop function if exists public.submit_vibe_check(text, integer, integer, text, text, text);

create or replace function public.submit_vibe_check(
  code             text,
  p_session_number integer,
  p_satisfaction   integer,
  p_spotlight      text,
  p_note           text,
  p_player_name    text,
  p_anonymous      boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_campaign uuid;
  v_session  uuid;
  v_uid      uuid := auth.uid();
begin
  -- Still required. The caller has to be SOMEBODY for the share link to be checked at all; being
  -- anonymous is about what is STORED, not about skipping the gate.
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select c.id, s.id into v_campaign, v_session
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code and s.session_number = p_session_number
  limit 1;
  if v_session is null then
    raise exception 'invalid link or session';
  end if;

  if p_satisfaction is not null and (p_satisfaction < 1 or p_satisfaction > 5) then
    raise exception 'satisfaction out of range';
  end if;
  if p_spotlight is not null
     and p_spotlight not in ('wanted_more','about_right','wanted_less') then
    raise exception 'invalid spotlight value';
  end if;

  if coalesce(p_anonymous, false) then
    -- No profile_id, so no upsert: there is deliberately nothing to match against. The name is
    -- forced null even if one was typed, because a form that lets you tick "anonymous" and still
    -- sends your name is a trap rather than a choice.
    insert into public.vibe_checks
      (campaign_id, session_id, profile_id, satisfaction, spotlight_feeling, note, player_name, created_at)
    values
      (v_campaign, v_session, null, p_satisfaction, p_spotlight,
       nullif(trim(p_note), ''), null, date_trunc('hour', now()));
    return;
  end if;

  -- the signup trigger normally makes this; ensure it for anon players
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  insert into public.vibe_checks
    (campaign_id, session_id, profile_id, satisfaction, spotlight_feeling, note, player_name)
  values
    (v_campaign, v_session, v_uid, p_satisfaction, p_spotlight,
     nullif(trim(p_note), ''), nullif(trim(p_player_name), ''))
  on conflict (session_id, profile_id) do update
    set satisfaction      = excluded.satisfaction,
        spotlight_feeling = excluded.spotlight_feeling,
        note              = excluded.note,
        player_name       = excluded.player_name,
        created_at        = now();
end;
$function$;

revoke all on function public.submit_vibe_check(text, integer, integer, text, text, text, boolean) from public;
grant execute on function public.submit_vibe_check(text, integer, integer, text, text, text, boolean) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Verify:
--   select count(*) filter (where profile_id is null) as anonymous,
--          count(*) filter (where profile_id is not null) as attributed
--   from public.vibe_checks;
--
-- The three existing rows keep their profile_id. They were submitted before anonymity was offered,
-- so nobody was promised otherwise, and rewriting history would be its own kind of dishonest.
-- ----------------------------------------------------------------------------
