-- B4 Player Journal — the per-player "your story so far," scoped to the caller's
-- own character via characters.profile_id = auth.uid(). Reuses A3's codex_for_player
-- for revealed lore; this returns the posterior read and the player's beats.

create or replace function public.player_journal(p_share text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_campaign uuid;
  v_char uuid;
  v_name text;
  v_post jsonb;
  v_beats jsonb;
begin
  select c.id into v_campaign from public.campaigns c where c.share_code = p_share;
  if v_campaign is null then return null; end if;

  select ch.id, ch.name into v_char, v_name
  from public.characters ch
  where ch.campaign_id = v_campaign and ch.kind = 'pc' and ch.profile_id = auth.uid()
  limit 1;

  if v_char is null then
    return jsonb_build_object('character', null);
  end if;

  -- latest fitted posterior (how they actually play), 0-1 per axis
  select d.axis_scores into v_post
  from public.dispositions d
  where d.character_id = v_char and d.source = 'posterior'
  order by d.as_of desc
  limit 1;

  -- their beats: events they were part of + GM beats aimed at them, in order
  select coalesce(jsonb_agg(to_jsonb(b) order by b.n nulls last), '[]'::jsonb) into v_beats
  from (
    -- the player's own logged beats (events has no summary; use payload.rationale + event_type)
    select s.session_number as n,
           coalesce(nullif(e.payload->>'rationale',''), e.event_type) as summary,
           e.event_type as kind,
           'you'::text as who
    from public.events e
    left join public.sessions s on s.id = e.session_id
    where e.character_id = v_char
    union all
    select s.session_number as n, g.summary as summary, g.kind as kind, 'gm'::text as who
    from public.gm_events g
    left join public.sessions s on s.id = g.session_id
    where g.target_character_id = v_char
  ) b;

  return jsonb_build_object(
    'character', jsonb_build_object('id', v_char, 'name', v_name),
    'posterior', v_post,
    'beats', v_beats
  );
end;
$$;
grant execute on function public.player_journal(text) to anon, authenticated;
