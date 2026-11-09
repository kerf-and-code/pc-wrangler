-- supabase/migrations/p121-outside-roll-spends-attack.sql (2026-11-08)
--
-- Phase 5o: applying a D&D Beyond (Beyond20) or Foundry attack now spends the attack, as the table's own
-- attack form does (combat_attack_resolve, p112/p115). Before, a player could roll on D&D Beyond, apply
-- the damage, and still have their action, so the turn tracker drifted from what happened.
--
-- combat_apply_outside_roll is restated from p117 unchanged except for one step: when the rows being
-- applied include an attack roll and come from a character in the fight, that character spends one
-- attack (the Attack action's first attack spends the action; Extra Attack's further attacks spend
-- nothing more), hit or miss, and the spend is locked so a player cannot undo it (the GM can). A player
-- with no attack left gets "you have used your action this turn" and nothing is applied; the GM is
-- never stopped. Rows with only damage (a spell with a save, a GM's monster) spend nothing, since the
-- roll does not say which action it was.
--
-- Same signature and return type, so CREATE OR REPLACE keeps the grants. Idempotent. Run by hand after
-- p120, then supabase/checks/p121-outside-roll-spends-attack-check.sql.

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
  v_char   uuid;
  v_att    jsonb;
  v_aord   bigint;
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

  -- p121: an attack roll spends the roller's attack, hit or miss (combat_spend raises for a player with
  -- no attack left, which undoes the whole apply)
  if v_attack is not null then
    select min(e.character_id::text)::uuid into v_char from public.vtt_events e where e.id = any(p_events) and e.character_id is not null;
    if v_char is not null then
      select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
       where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = v_char::text limit 1;
      if v_att is not null and v_aord <> v_ord then
        v_att := public.combat_lock_last(public.combat_spend(v_att,
          'attack', left('Attack on ' || coalesce(v_c ->> 'name', 'a target') || ' (rolled outside)', 60), v_gm));
        update public.combats
           set combatants = jsonb_set(combatants, array[(v_aord - 1)::text], v_att), updated_at = now()
         where id = v_cb.id;
      end if;
    end if;
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
