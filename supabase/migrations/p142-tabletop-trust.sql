-- supabase/migrations/p142-tabletop-trust.sql (2026-11-09)
--
-- Push 6 of the audit plan: tabletop trust.
--
--   B8   tabletop_set_initiative   sets one character's initiative in the active fight with the row locked,
--                                  and re-sorts the turn order in the same step (as lib/combat sortForTurns
--                                  does) when the fight has not started. Two players rolling at once used
--                                  to overwrite each other. Server only: /api/tabletop/roll calls it.
--   B9   tabletop_feed             the GM's own roller (six_axes_roller) and transcribed spoken rolls stay
--                                  out of players' table feed.
--   B16  tabletop_say              only the GM speaks under a name.
--   B18  vtt_scenes                a player reads only the scene they are on.
--   B11  realtime.messages         the tabletop's live channel ("tabletop:<campaign id>") becomes private:
--                                  only the campaign's GM and players with a character there can join,
--                                  send or receive on it (tabletop_topic_ok). Skipped where the realtime
--                                  schema does not exist (a local copy). The app joins it as private unless
--                                  NEXT_PUBLIC_TABLETOP_PUBLIC_CHANNEL is "1", the way back if needed.
--
-- Idempotent. Run by hand after p141, BEFORE deploying this push, then
-- supabase/checks/p142-tabletop-trust-check.sql.

create or replace function public.tabletop_set_initiative(p_campaign uuid, p_character uuid, p_total integer)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cb  public.combats;
  v_new jsonb;
begin
  select * into v_cb from public.combats
   where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1
   for update;
  if v_cb.id is null then return false; end if;
  if not exists (
    select 1 from jsonb_array_elements(v_cb.combatants) c
     where c ->> 'kind' = 'pc' and c ->> 'characterId' = p_character::text and (c -> 'initiative' is null or c -> 'initiative' = 'null'::jsonb)
  ) then return false; end if;

  select jsonb_agg(case when x.c ->> 'kind' = 'pc' and x.c ->> 'characterId' = p_character::text
                        then x.c || jsonb_build_object('initiative', p_total) else x.c end order by x.n)
    into v_new
    from jsonb_array_elements(v_cb.combatants) with ordinality x(c, n);

  if v_cb.round = 1 and v_cb.turn = 0 then
    -- the turn order, as sortForTurns: rolled first (highest, then initiative bonus, then players before
    -- monsters, then name), unrolled after in the order they were added
    select jsonb_agg(y.c order by
             (y.c -> 'initiative' is null or y.c -> 'initiative' = 'null'::jsonb),
             case when y.c -> 'initiative' is null or y.c -> 'initiative' = 'null'::jsonb then y.n end,
             (y.c ->> 'initiative')::numeric desc,
             coalesce((y.c ->> 'initBonus')::numeric, 0) desc,
             (y.c ->> 'kind' = 'pc') desc,
             y.c ->> 'name',
             y.n)
      into v_new
      from jsonb_array_elements(v_new) with ordinality y(c, n);
    update public.combats set combatants = v_new, turn = 0, updated_at = now() where id = v_cb.id;
  else
    update public.combats set combatants = v_new, updated_at = now() where id = v_cb.id;
  end if;
  return true;
end;
$function$;
revoke all on function public.tabletop_set_initiative(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.tabletop_set_initiative(uuid, uuid, integer) to service_role;

-- B18: a player sees only their own scene's row.
drop policy if exists vtt_scenes_player_read on public.vtt_scenes;
create policy vtt_scenes_player_read on public.vtt_scenes for select to public
  using (tabletop_is_player(campaign_id) and id = tabletop_scene_for(campaign_id, auth.uid()));

-- B11: who may use a tabletop live channel.
create or replace function public.tabletop_topic_ok(p_topic text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_c uuid;
begin
  if p_topic is null or p_topic !~ '^tabletop:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_c := substring(p_topic from 10)::uuid;
  return public.is_campaign_gm(v_c) or public.tabletop_is_player(v_c);
end;
$function$;
revoke all on function public.tabletop_topic_ok(text) from public, anon;
grant execute on function public.tabletop_topic_ok(text) to authenticated;

do $c$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'p142: no realtime schema here, live-channel policies skipped';
    return;
  end if;
  execute 'drop policy if exists "tabletop members receive" on realtime.messages';
  execute 'create policy "tabletop members receive" on realtime.messages for select to authenticated using (public.tabletop_topic_ok(realtime.topic()))';
  execute 'drop policy if exists "tabletop members send" on realtime.messages';
  execute 'create policy "tabletop members send" on realtime.messages for insert to authenticated with check (public.tabletop_topic_ok(realtime.topic()))';
end;
$c$;

-- The feed and say, as live on 2026-11-09 (0000-base-schema.sql), with the p142 changes marked.

CREATE OR REPLACE FUNCTION public.tabletop_feed(p_campaign uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_gm      boolean;
  v_session uuid;
  v_lim     integer := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  v_session := public.tabletop_open_session(p_campaign);

  return jsonb_build_object(
    'messages', (
      select coalesce(jsonb_agg(to_jsonb(m) - 'campaign_id' order by m.created_at), '[]'::jsonb)
      from (
        select * from public.vtt_messages m
        where m.campaign_id = p_campaign
          and (p_since is null or m.created_at > p_since)
          and (m.author_profile = v_uid
               or (m.whisper_to is not null and v_uid = any (m.whisper_to))
               or (m.whisper_to is null and v_gm)
               or (m.whisper_to is null and not m.gm_only))
        order by m.created_at desc
        limit v_lim
      ) m
    ),
    'outside_rolls', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'actor_name', e.actor_name, 'character_id', e.character_id, 'source', e.source,
        'event_type', e.event_type, 'name', e.name, 'rolls', e.rolls, 'at', coalesce(e.rolled_at, e.received_at),
        'applied_to', e.applied_to
      ) order by coalesce(e.rolled_at, e.received_at)), '[]'::jsonb)
      from (
        select * from public.vtt_events e
        where v_session is not null and e.session_id = v_session
          and e.source not in ('six_axes_tabletop', 'demo')
          -- p142 (audit B9): the GM's own roller and transcribed spoken rolls are for the GM only
          and (v_gm or e.source not in ('six_axes_roller', 'spoken'))
          and (p_since is null or e.received_at > p_since)
        order by e.received_at desc
        limit v_lim
      ) e
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_say(p_campaign uuid, p_body text, p_kind text DEFAULT 'say'::text, p_as_name text DEFAULT NULL::text, p_character uuid DEFAULT NULL::uuid, p_whisper_to uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_gm   boolean;
  v_id   uuid;
  v_to   uuid[];
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  if p_kind not in ('say', 'emote', 'whisper') then raise exception 'unknown message kind'; end if;
  if coalesce(trim(p_body), '') = '' then return null; end if;
  if char_length(trim(p_body)) > 2000 then raise exception 'message too long (2000 characters at most)'; end if;
  -- a player speaks as their own character; the GM may speak as any character in the campaign or a name
  if p_character is not null and not exists (
    select 1 from public.characters c where c.id = p_character and c.campaign_id = p_campaign
      and (v_gm or c.profile_id = v_uid)) then
    raise exception 'you cannot speak as that character';
  end if;
  if p_kind = 'whisper' then
    -- recipients must be at this table: the GM or the owner of a pc here
    select array_agg(distinct r) into v_to
    from unnest(coalesce(p_whisper_to, '{}')) r
    where r = (select gm_id from public.campaigns where id = p_campaign)
       or exists (select 1 from public.characters c where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = r);
    if v_to is null or array_length(v_to, 1) is null then raise exception 'nobody at this table by that name'; end if;
  end if;
  insert into public.vtt_messages (campaign_id, session_id, author_profile, as_name, character_id, kind, body, whisper_to)
  values (p_campaign, public.tabletop_open_session(p_campaign), v_uid,
          -- p142 (audit B16): only the GM speaks under a name; a player is themselves or their character
          case when v_gm then nullif(trim(coalesce(p_as_name, '')), '') else null end,
          p_character, p_kind, trim(p_body), case when p_kind = 'whisper' then v_to else null end)
  returning id into v_id;
  return v_id;
end;
$function$;
