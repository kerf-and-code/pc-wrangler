-- p117-outside-roll-damage.sql
--
-- Phase 5i (2026-11-07): damage from a D&D Beyond (Beyond20) or Foundry roll lands on a creature in
-- the running fight.
--
-- A roll made on D&D Beyond reaches the table through the Six Axes Capture extension as rows in
-- vtt_events: the attack roll and each damage roll of one attack arrive as separate rows. Until now
-- they only showed in chat, so a GM who picked the Fire Giant and rolled damage on D&D Beyond saw the
-- number and nothing happened to its HP.
--
-- combat_apply_outside_roll(p_combat, p_target, p_events, p_half) applies the damage those rows rolled
-- to one combatant. The numbers come from the logged rows, never from the browser, and each row can
-- be applied once (applied_at, applied_to), so the same hit cannot land twice.
--   the GM       any outside roll at the table, on anyone, whenever; the attack is not checked
--                against AC (the GM decides)
--   a player     only rolls logged against their own character, on their own turn, at a creature
--                the players can see; when the rows include the attack roll and the target has an
--                AC, a miss applies nothing (a natural 20 always hits); the rows are marked
--                "missed <target>" so the player cannot retry them, and the GM can still overrule
--                the miss and apply them
--   p_half       half the damage, rounded down (a save for half, a resistance)
-- Returns {target, damage, hit, attack, ac, critical}.
--
-- Idempotent. Run by hand after p116, then supabase/checks/p117-outside-roll-damage-check.sql.

alter table public.vtt_events add column if not exists applied_at timestamptz;
alter table public.vtt_events add column if not exists applied_to text;

create or replace function public.combat_apply_outside_roll(p_combat uuid, p_target text, p_events uuid[], p_half boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_cb     public.combats;
  v_gm     boolean;
  v_c      jsonb;
  v_ord    bigint;
  v_n      integer;
  v_found  integer;
  v_attack integer;
  v_crit   boolean := false;
  v_fumble boolean := false;
  v_ac     integer;
  v_hit    boolean := true;
  v_dmg    integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_events is null or cardinality(p_events) = 0 or cardinality(p_events) > 20 then raise exception 'Pick the rolls to apply.'; end if;
  select * into v_cb from public.combats where id = p_combat for update;
  if v_cb.id is null then raise exception 'fight not found'; end if;
  if v_cb.status <> 'active' then raise exception 'that fight is over'; end if;
  v_gm := public.is_campaign_gm(v_cb.campaign_id);
  if not v_gm and not public.tabletop_is_player(v_cb.campaign_id) then raise exception 'not at this table'; end if;

  -- the rows: this table's outside rolls, none applied yet, locked while we work
  perform 1 from public.vtt_events where id = any(p_events) for update;
  select count(*) into v_found from public.vtt_events e
   where e.id = any(p_events) and e.campaign_id = v_cb.campaign_id and e.source in ('beyond20', 'foundry');
  if v_found <> cardinality(p_events) then raise exception 'Those rolls are not from this table.'; end if;
  -- applied once; a player's miss is marked too, but the GM may overrule a miss
  if exists (select 1 from public.vtt_events where id = any(p_events) and applied_at is not null
              and not (v_gm and coalesce(applied_to, '') like 'missed %')) then
    raise exception 'That damage was already applied.';
  end if;

  if not v_gm then
    -- a player applies only their own character's rolls, on that character's turn
    if exists (select 1 from public.vtt_events e where e.id = any(p_events)
                and (e.character_id is null or not exists (select 1 from public.characters ch where ch.id = e.character_id and ch.profile_id = v_uid))) then
      raise exception 'Only your own character''s rolls.';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_cb.combatants) with ordinality as t(c, ord)
       where t.ord - 1 = v_cb.turn and (t.c ->> 'kind') = 'pc'
         and coalesce(t.c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
         and exists (select 1 from public.vtt_events e where e.id = any(p_events) and e.character_id = (t.c ->> 'characterId')::uuid)
    ) then
      raise exception 'it is not your turn';
    end if;
  end if;

  select e.c, e.ord into v_c, v_ord
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where e.c ->> 'id' = p_target
   limit 1;
  if v_c is null then raise exception 'no such combatant'; end if;
  if not v_gm and coalesce((v_c ->> 'hidden')::boolean, false) then raise exception 'no such combatant'; end if;

  -- the attack roll, if one came with the damage (the last one not discarded by advantage)
  select (e.rolls ->> 'total')::numeric::integer,
         coalesce((e.rolls ->> 'critical_success')::boolean, false),
         coalesce((e.rolls ->> 'critical_failure')::boolean, false)
    into v_attack, v_crit, v_fumble
    from public.vtt_events e
   where e.id = any(p_events) and e.event_type = 'to-hit' and coalesce((e.rolls ->> 'discarded')::boolean, false) = false
     and jsonb_typeof(e.rolls -> 'total') = 'number'
   order by e.received_at desc limit 1;

  select coalesce(sum((e.rolls ->> 'total')::numeric), 0)::integer, count(*) into v_dmg, v_n
    from public.vtt_events e
   where e.id = any(p_events) and e.event_type = 'damage' and jsonb_typeof(e.rolls -> 'total') = 'number';
  if v_n = 0 then raise exception 'No damage in those rolls.'; end if;

  v_ac := case when jsonb_typeof(v_c -> 'ac') = 'number' then (v_c ->> 'ac')::numeric::integer end;
  if not v_gm and v_attack is not null and v_ac is not null then
    v_hit := not v_fumble and (v_crit or v_attack >= v_ac);
  end if;

  v_dmg := greatest(0, least(9999, case when p_half then v_dmg / 2 else v_dmg end));
  if v_hit then
    v_c := public.combat_hurt(v_c, v_dmg);
    update public.combats
       set combatants = jsonb_set(combatants, array[(v_ord - 1)::text], v_c), updated_at = now()
     where id = v_cb.id;
  end if;
  update public.vtt_events
     set applied_at = now(), applied_to = left(case when v_hit then '' else 'missed ' end || coalesce(v_c ->> 'name', 'a creature'), 200)
   where id = any(p_events);

  return jsonb_build_object('target', v_c ->> 'name', 'damage', case when v_hit then v_dmg else 0 end, 'hit', v_hit,
    'attack', v_attack, 'ac', case when v_gm then v_ac end, 'critical', v_crit);
end;
$function$;
revoke all on function public.combat_apply_outside_roll(uuid, text, uuid[], boolean) from public, anon;
grant execute on function public.combat_apply_outside_roll(uuid, text, uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tabletop_feed, restated from p105 unchanged except that each outside roll now carries applied_to,
-- so the chat card can say "applied to the Fire Giant" instead of offering the button again. Same
-- signature and return type, so CREATE OR REPLACE keeps its grants.
create or replace function public.tabletop_feed(p_campaign uuid, p_since timestamptz default null, p_limit integer default 200)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
          and (p_since is null or e.received_at > p_since)
        order by e.received_at desc
        limit v_lim
      ) e
    )
  );
end;
$function$;
revoke all on function public.tabletop_feed(uuid, timestamptz, integer) from public, anon;
grant execute on function public.tabletop_feed(uuid, timestamptz, integer) to authenticated;
