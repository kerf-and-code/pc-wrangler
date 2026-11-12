-- supabase/migrations/p169-numbers-you-can-trust.sql (2026-11-12, push 46: audit round 2)
--
-- Totals counted in the database, not by reading rows into the browser. PostgREST hands back at most
-- 1,000 rows per read whatever limit is asked for, so a total summed from rows stopped at 1,000 and was
-- shown as the whole (R1, B9).
--
-- 1. campaign_usage_summary(campaign, since): what a campaign used since a time (AI calls and tokens,
--    image renders, transcription minutes split into per-speaker and room tracks, the sessions that
--    were transcribed, and AI calls by feature). For the campaign's GMs (co-GMs too).
-- 2. usage_by_campaign(since): the same totals for every campaign, for the owner's /admin page. The
--    service role only.
-- 3. campaign_event_counts(campaign): moments logged per character, for the Roster. GMs only.
-- 4. world_calendar_reshape(campaign, calendar, day, moves) (B8): saves a reshaped in-game calendar and
--    moves every stored date with it in one step. Dates are day numbers, so a month made longer or
--    shorter used to move every later date, by years for a world in year 1200. The page works out each
--    old day's new number (the same year, month and day in the new shape) and sends them here.
--
-- Idempotent. Run by hand after p168, then supabase/checks/p169-numbers-you-can-trust-check.sql.

-- 1 ---------------------------------------------------------------------------------------------------
create or replace function public.campaign_usage_summary(p_campaign uuid, p_since timestamptz)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if not public.is_campaign_gm(p_campaign) then raise exception 'not permitted'; end if;
  select jsonb_build_object(
    'rows', count(*),
    'aiCalls', count(*) filter (where kind = 'ai'),
    'tokensIn', coalesce(sum(input_tokens) filter (where kind in ('ai', 'image')), 0),
    'tokensOut', coalesce(sum(output_tokens) filter (where kind in ('ai', 'image')), 0),
    'images', coalesce(sum(coalesce(images, 1)) filter (where kind = 'image'), 0),
    'minutes', coalesce(sum(audio_seconds) filter (where kind = 'transcription'), 0) / 60.0,
    'speakerMinutes', coalesce(sum(audio_seconds) filter (where kind = 'transcription' and coalesce(provider, 'speaker') <> 'room'), 0) / 60.0,
    'roomMinutes', coalesce(sum(audio_seconds) filter (where kind = 'transcription' and provider = 'room'), 0) / 60.0,
    'sessions', count(distinct session_id) filter (where kind = 'transcription'),
    'roomSessions', count(distinct session_id) filter (where kind = 'transcription' and provider = 'room'))
    into v
    from public.usage_events
   where campaign_id = p_campaign and created_at >= p_since;
  return v || jsonb_build_object('byRoute', coalesce((
    select jsonb_agg(jsonb_build_array(route, n) order by n desc)
      from (select route, count(*) as n from public.usage_events
             where campaign_id = p_campaign and created_at >= p_since and kind <> 'transcription' and route is not null
             group by route) r), '[]'::jsonb));
end;
$function$;
revoke all on function public.campaign_usage_summary(uuid, timestamptz) from public, anon;
grant execute on function public.campaign_usage_summary(uuid, timestamptz) to authenticated;

-- 2 ---------------------------------------------------------------------------------------------------
create or replace function public.usage_by_campaign(p_since timestamptz)
 returns table (campaign_id uuid, minutes numeric, speaker_minutes numeric, room_minutes numeric, ai_calls bigint, tokens bigint, images bigint, sessions bigint, room_sessions bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select u.campaign_id,
         coalesce(sum(u.audio_seconds) filter (where u.kind = 'transcription'), 0) / 60.0,
         coalesce(sum(u.audio_seconds) filter (where u.kind = 'transcription' and coalesce(u.provider, 'speaker') <> 'room'), 0) / 60.0,
         coalesce(sum(u.audio_seconds) filter (where u.kind = 'transcription' and u.provider = 'room'), 0) / 60.0,
         count(*) filter (where u.kind = 'ai'),
         coalesce(sum(coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0)), 0)::bigint,
         coalesce(sum(coalesce(u.images, 1)) filter (where u.kind = 'image'), 0)::bigint,
         count(distinct u.session_id) filter (where u.kind = 'transcription'),
         count(distinct u.session_id) filter (where u.kind = 'transcription' and u.provider = 'room')
    from public.usage_events u
   where u.created_at >= p_since and u.campaign_id is not null
   group by u.campaign_id;
$function$;
revoke all on function public.usage_by_campaign(timestamptz) from public, anon, authenticated;

-- 3 ---------------------------------------------------------------------------------------------------
create or replace function public.campaign_event_counts(p_campaign uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_campaign_gm(p_campaign) then raise exception 'not permitted'; end if;
  return coalesce((select jsonb_object_agg(character_id, n)
                     from (select character_id, count(*) as n from public.events
                            where campaign_id = p_campaign and character_id is not null group by character_id) c), '{}'::jsonb);
end;
$function$;
revoke all on function public.campaign_event_counts(uuid) from public, anon;
grant execute on function public.campaign_event_counts(uuid) to authenticated;

-- 4 ---------------------------------------------------------------------------------------------------
create or replace function public.world_calendar_reshape(p_campaign uuid, p_calendar jsonb, p_day integer, p_moves jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  if not public.is_campaign_gm(p_campaign) then raise exception 'not permitted'; end if;
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) > 5000 then raise exception 'bad moves'; end if;
  update public.campaigns set world_calendar = p_calendar, world_day = p_day where id = p_campaign;
  -- every row is matched by its date before this update, so a chain of moves (a to b, b to c) is safe
  update public.sessions s
     set world_day = (m ->> 1)::integer
    from jsonb_array_elements(p_moves) m
   where s.campaign_id = p_campaign
     and jsonb_typeof(m -> 0) = 'number' and jsonb_typeof(m -> 1) = 'number'
     and s.world_day = (m ->> 0)::integer;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.world_calendar_reshape(uuid, jsonb, integer, jsonb) from public, anon;
grant execute on function public.world_calendar_reshape(uuid, jsonb, integer, jsonb) to authenticated;

insert into public._migrations (name) values ('p169-numbers-you-can-trust') on conflict do nothing;
