-- p153-ask-campaign.sql (2026-11-10, push 27, audit P1: ask the campaign)
--
-- A GM types a question ("what did the party promise the harbourmaster?") and gets an answer drawn
-- from the campaign's own record, with every claim pointing back at where it came from. Retrieval is
-- Postgres full-text search (Terry, 2026-11-10: no embeddings for now); Claude writes the answer
-- from what this function returns.
--
-- 1. Full-text indexes on the five sources, all with the 'simple' configuration: no stemming and no
--    stopword list, so it works the same for a table playing in German or Japanese (p152). The app
--    sends prefix terms (harbour:*), which covers plurals and most endings.
-- 2. ask_campaign_search(campaign, terms, limit, recent): GM only (owner or co-GM). Returns the best
--    matches across transcripts, story beats, Codex entries, characters and session recaps, each with
--    what the app needs to link back (session, track and time for a moment; the entry or character).
--    Transcript hits come with the lines around them, since one spoken line rarely answers anything.
--    recent > 0 adds that many of the latest recaps, for questions like "what happened last time?".
-- 3. ai_map_renders.kind gains 'ask', so questions get their own daily allowance (lib/ai-allowance).
--
-- Idempotent. Hand-run in the Supabase SQL editor.

-- 1. Indexes. The expressions must match the ones in the function below exactly.
create index if not exists transcript_segments_fts_idx on public.transcript_segments
  using gin (to_tsvector('simple'::regconfig, coalesce(text, '')));

create index if not exists entries_fts_idx on public.entries
  using gin (to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '')));

create index if not exists gm_events_fts_idx on public.gm_events
  using gin (to_tsvector('simple'::regconfig, coalesce(summary, '') || ' ' || coalesce(detail, '') || ' ' || coalesce(quote, '') || ' ' || coalesce(npc_name, '') || ' ' || coalesce(location_name, '') || ' ' || coalesce(faction_name, '')));

create index if not exists characters_fts_idx on public.characters
  using gin (to_tsvector('simple'::regconfig, coalesce(name, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(description, '')));

create index if not exists sessions_fts_idx on public.sessions
  using gin (to_tsvector('simple'::regconfig, coalesce(recap, '') || ' ' || coalesce(notes, '')));

-- 2. The search.
create or replace function public.ask_campaign_search(
  p_campaign uuid,
  p_terms text[],
  p_limit int default 24,
  p_recent int default 0
)
returns table (
  kind text,
  id uuid,
  title text,
  snippet text,
  session_id uuid,
  session_number int,
  track_id uuid,
  t_seconds numeric,
  rank real
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_terms text[];
  v_q tsquery;
  v_lim int := greatest(1, least(coalesce(p_limit, 24), 60));
  v_each int;
  v_hl text := 'StartSel="",StopSel="",MaxWords=45,MinWords=20,MaxFragments=2,FragmentDelimiter=" ... "';
begin
  if not public.is_campaign_gm(p_campaign) then
    raise exception 'not a GM of this campaign' using errcode = '42501';
  end if;

  -- Keep letters and digits only (any script), lower case, 2 to 40 characters, at most 12 terms.
  select array_agg(distinct t) into v_terms
  from (
    select left(lower(regexp_replace(x, '[^[:alnum:]]+', '', 'g')), 40) as t
    from unnest(coalesce(p_terms, '{}'::text[])) as x
  ) s
  where length(t) >= 2;
  v_terms := v_terms[1:12];

  if v_terms is not null and cardinality(v_terms) > 0 then
    v_q := to_tsquery('simple', array_to_string(array(select t || ':*' from unnest(v_terms) as t), ' | '));
  end if;

  -- Each source may fill up to half the limit, so a chatty transcript cannot crowd out the Codex.
  v_each := greatest(4, v_lim / 2);

  return query
  with hits as (
    (
      select 'transcript'::text as kind, s.id,
        coalesce(ch.name, case when s.gm_identity_id is not null then 'GM' end) as title,
        (
          select left(string_agg(coalesce(c2.name, case when n.gm_identity_id is not null then 'GM' end, '?') || ': ' || n.text, E'\n' order by n.start_ms, n.id), 900)
          from public.transcript_segments n
          left join public.characters c2 on c2.id = n.character_id
          where n.job_id = s.job_id
            and n.start_ms between s.start_ms - 20000 and s.start_ms + 25000
        ) as snippet,
        se.id as session_id, se.session_number, s.track_id,
        round(s.start_ms / 1000.0, 1) as t_seconds,
        ts_rank(to_tsvector('simple'::regconfig, coalesce(s.text, '')), v_q) as rank
      from public.transcript_segments s
      left join public.characters ch on ch.id = s.character_id
      left join public.capture_jobs j on j.id = s.job_id
      left join public.sessions se on se.id = j.session_id
      where v_q is not null
        and s.campaign_id = p_campaign
        and to_tsvector('simple'::regconfig, coalesce(s.text, '')) @@ v_q
      order by rank desc, s.start_ms
      limit v_each
    )
    union all
    (
      select 'event'::text, e.id,
        coalesce(k.label, e.kind, 'Story beat'),
        left(concat_ws(E'\n', e.summary, nullif(e.detail, ''), case when coalesce(e.quote, '') <> '' then '"' || e.quote || '"' end), 900),
        se.id, se.session_number, e.audio_track_id, e.t_start_seconds,
        ts_rank(to_tsvector('simple'::regconfig, coalesce(e.summary, '') || ' ' || coalesce(e.detail, '') || ' ' || coalesce(e.quote, '') || ' ' || coalesce(e.npc_name, '') || ' ' || coalesce(e.location_name, '') || ' ' || coalesce(e.faction_name, '')), v_q)
      from public.gm_events e
      left join public.gm_event_kinds k on k.kind = e.kind
      left join public.sessions se on se.id = e.session_id
      where v_q is not null
        and e.campaign_id = p_campaign
        and to_tsvector('simple'::regconfig, coalesce(e.summary, '') || ' ' || coalesce(e.detail, '') || ' ' || coalesce(e.quote, '') || ' ' || coalesce(e.npc_name, '') || ' ' || coalesce(e.location_name, '') || ' ' || coalesce(e.faction_name, '')) @@ v_q
      order by 9 desc
      limit v_each
    )
    union all
    (
      select 'entry'::text, en.id, en.title,
        ts_headline('simple', coalesce(en.summary, '') || ' ' || coalesce(en.body, ''), v_q, v_hl),
        null::uuid, null::int, null::uuid, null::numeric,
        (ts_rank(to_tsvector('simple'::regconfig, coalesce(en.title, '') || ' ' || coalesce(en.summary, '') || ' ' || coalesce(en.body, '')), v_q) * 1.5)::real
      from public.entries en
      where v_q is not null
        and en.campaign_id = p_campaign
        and to_tsvector('simple'::regconfig, coalesce(en.title, '') || ' ' || coalesce(en.summary, '') || ' ' || coalesce(en.body, '')) @@ v_q
      order by 9 desc
      limit v_each
    )
    union all
    (
      select 'character'::text, c.id, c.name,
        left(concat_ws(E'\n', nullif(concat_ws(' ', c.species, c.class), ''), nullif(c.summary, ''), nullif(c.description, '')), 700),
        null::uuid, null::int, null::uuid, null::numeric,
        (ts_rank(to_tsvector('simple'::regconfig, coalesce(c.name, '') || ' ' || coalesce(c.summary, '') || ' ' || coalesce(c.description, '')), v_q) * 1.5)::real
      from public.characters c
      where v_q is not null
        and c.campaign_id = p_campaign
        and c.alter_ego_of is null
        and to_tsvector('simple'::regconfig, coalesce(c.name, '') || ' ' || coalesce(c.summary, '') || ' ' || coalesce(c.description, '')) @@ v_q
      order by 9 desc
      limit v_each
    )
    union all
    (
      select 'recap'::text, se.id, 'Session ' || coalesce(se.session_number::text, '?'),
        ts_headline('simple', coalesce(se.recap, '') || ' ' || coalesce(se.notes, ''), v_q, v_hl),
        se.id, se.session_number, null::uuid, null::numeric,
        ts_rank(to_tsvector('simple'::regconfig, coalesce(se.recap, '') || ' ' || coalesce(se.notes, '')), v_q)
      from public.sessions se
      where v_q is not null
        and se.campaign_id = p_campaign
        and to_tsvector('simple'::regconfig, coalesce(se.recap, '') || ' ' || coalesce(se.notes, '')) @@ v_q
      order by 9 desc
      limit v_each
    )
  ),
  recent as (
    select 'recap'::text as kind, se.id, 'Session ' || coalesce(se.session_number::text, '?') as title,
      left(se.recap, 1500) as snippet,
      se.id as session_id, se.session_number, null::uuid as track_id, null::numeric as t_seconds,
      0::real as rank
    from public.sessions se
    where coalesce(p_recent, 0) > 0
      and se.campaign_id = p_campaign
      and coalesce(se.recap, '') <> ''
      and se.id not in (select h.id from hits h where h.kind = 'recap')
    order by se.session_number desc nulls last, se.created_at desc
    limit least(greatest(coalesce(p_recent, 0), 0), 4)
  )
  select * from (
    select * from (select * from hits order by rank desc limit v_lim) top
    union all
    select * from recent
  ) z
  order by z.rank desc, z.session_number desc nulls last;
end;
$$;

revoke all on function public.ask_campaign_search(uuid, text[], int, int) from public, anon;
grant execute on function public.ask_campaign_search(uuid, text[], int, int) to authenticated, service_role;

-- 3. A daily allowance of its own for questions.
alter table public.ai_map_renders drop constraint if exists ai_map_renders_kind_check;
alter table public.ai_map_renders add constraint ai_map_renders_kind_check
  check (kind = any (array['world'::text, 'battle'::text, 'trace'::text, 'ask'::text]));

insert into public._migrations (name) values ('p153-ask-campaign') on conflict do nothing;
