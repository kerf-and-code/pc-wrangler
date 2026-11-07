-- p112-combat-action-economy.sql
--
-- Phase 4c (2026-11-07): action economy. On its turn a creature has one action, one bonus action and
-- its movement, plus one reaction that comes back at the start of its own turn. The table now keeps
-- count, so a player can only do what their turn still allows (Terry: "a character can only move,
-- action(s), bonus action").
--
-- What lives on each combatant in combats.combatants:
--   econ             { action, bonus, reaction: true once used; moved, dash: feet; attacks: attacks
--                      left from an Attack action already taken; log: the last ten spends, each with the
--                      econ before it, so the last one can be undone }. Missing means a fresh turn.
--   speed            walking speed in feet (from the character sheet, or the GM); null = not tracked
--   attacksPerAction attacks one Attack action makes (Extra Attack); 1 when missing
--
-- Rules the database holds for players (the GM is never blocked; the GM's own spends are recorded):
--   * action, bonus action and movement only on your own turn; a reaction any time, once per round;
--   * an Attack action makes attacksPerAction attacks: the first spends the action, the rest spend
--     what is left of it;
--   * Dash (as an action, or a bonus action such as Cunning Action) adds your speed to this turn's move;
--   * speed is 0 while Grappled, Restrained, Paralyzed, Petrified, Stunned or Unconscious, doubled
--     while Hasted and halved while Slowed;
--   * nothing at all (no action, bonus action or reaction) while Incapacitated, Paralyzed,
--     Petrified, Stunned or Unconscious.
--
-- Where it is enforced:
--   * combat_act gains spend, undo, move, set_speed and set_attacks (and a p_note for what was done);
--   * combat_attack_resolve and combat_request_save take p_cost (attack, action, bonus or reaction);
--   * tabletop_move_token: a player's token in the running fight moves only on its turn and only as
--     far as its movement left, measured with the scene's diagonal rule;
--   * a trigger on combats gives the creature whose turn begins a fresh econ, so the Combat page and
--     the tabletop never have to remember to.
--
-- The old seven argument combat_attack_resolve, ten argument combat_request_save and six argument
-- combat_act are dropped and replaced (only /api/tabletop/roll and the app's own rpc calls use them,
-- by name). Deploy the app together with this migration.
--
-- Idempotent. Run by hand after p111, then supabase/checks/p112-combat-action-economy-check.sql.

-- ---------------------------------------------------------------------------------------------------
create or replace function public.combat_fresh_econ()
 returns jsonb
 language sql
 immutable
as $function$
  select '{"action":false,"bonus":false,"reaction":false,"moved":0,"dash":0,"attacks":0,"log":[]}'::jsonb;
$function$;
grant execute on function public.combat_fresh_econ() to authenticated, service_role;

-- A combatant's econ, filled out with defaults.
create or replace function public.combat_econ(p_c jsonb)
 returns jsonb
 language sql
 immutable
as $function$
  select public.combat_fresh_econ()
         || case when jsonb_typeof(p_c -> 'econ') = 'object' then p_c -> 'econ' else '{}'::jsonb end;
$function$;
grant execute on function public.combat_econ(jsonb) to authenticated, service_role;

-- Speed right now, after conditions; null when the fight does not track this creature's speed.
create or replace function public.combat_speed(p_c jsonb)
 returns integer
 language plpgsql
 immutable
as $function$
declare
  v_base  integer := case when jsonb_typeof(p_c -> 'speed') = 'number' then (p_c ->> 'speed')::numeric::integer end;
  v_conds jsonb := case when jsonb_typeof(p_c -> 'conditions') = 'array' then p_c -> 'conditions' else '[]'::jsonb end;
begin
  if v_base is null then return null; end if;
  if v_conds ?| array['Grappled', 'Restrained', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'] then return 0; end if;
  if v_conds ? 'Hasted' then v_base := v_base * 2; end if;
  if v_conds ? 'Slowed' then v_base := v_base / 2; end if;
  return v_base;
end;
$function$;
grant execute on function public.combat_speed(jsonb) to authenticated, service_role;

-- The condition that stops this creature acting at all, or null.
create or replace function public.combat_cant_act(p_c jsonb)
 returns text
 language sql
 immutable
as $function$
  select x from unnest(array['Unconscious', 'Petrified', 'Paralyzed', 'Stunned', 'Incapacitated']) x
   where jsonb_typeof(p_c -> 'conditions') = 'array' and (p_c -> 'conditions') ? x
   limit 1;
$function$;
grant execute on function public.combat_cant_act(jsonb) to authenticated, service_role;

-- Spend part of a turn. p_cost: action, attack (one attack of an Attack action), bonus, reaction, or
-- free (records nothing). p_force (the GM) records the spend without checking. Returns the combatant.
create or replace function public.combat_spend(p_c jsonb, p_cost text, p_what text, p_force boolean)
 returns jsonb
 language plpgsql
 immutable
as $function$
declare
  v_e    jsonb := public.combat_econ(p_c);
  v_prev jsonb;
  v_stop text := public.combat_cant_act(p_c);
  v_per  integer := greatest(1, least(8, coalesce(case when jsonb_typeof(p_c -> 'attacksPerAction') = 'number' then (p_c ->> 'attacksPerAction')::numeric::integer end, 1)));
  v_left integer;
  v_what text := left(coalesce(nullif(trim(p_what), ''), initcap(p_cost)), 60);
begin
  if p_cost = 'free' then return p_c; end if;
  if p_cost not in ('action', 'attack', 'bonus', 'reaction') then raise exception 'unknown cost'; end if;
  if not p_force and v_stop is not null then raise exception 'cannot act while %', v_stop; end if;
  v_prev := v_e - 'log';
  v_left := coalesce((v_e ->> 'attacks')::integer, 0);

  if p_cost = 'attack' and v_left > 0 then
    v_e := v_e || jsonb_build_object('attacks', v_left - 1);
  elsif p_cost in ('action', 'attack') then
    if not p_force and (v_e ->> 'action')::boolean then raise exception 'you have used your action this turn'; end if;
    v_e := v_e || jsonb_build_object('action', true, 'attacks', case when p_cost = 'attack' then v_per - 1 else 0 end);
  elsif p_cost = 'bonus' then
    if not p_force and (v_e ->> 'bonus')::boolean then raise exception 'you have used your bonus action this turn'; end if;
    v_e := v_e || jsonb_build_object('bonus', true);
  else
    if not p_force and (v_e ->> 'reaction')::boolean then raise exception 'you have used your reaction this round'; end if;
    v_e := v_e || jsonb_build_object('reaction', true);
  end if;

  if (lower(v_what) = 'dash' or lower(v_what) like '%: dash') and p_cost in ('action', 'bonus') then
    v_e := v_e || jsonb_build_object('dash', coalesce((v_e ->> 'dash')::integer, 0) + coalesce(public.combat_speed(p_c), 0));
  end if;

  v_e := v_e || jsonb_build_object('log',
    (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
       select x, o from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o)
        order by o desc limit 9) k)
    || jsonb_build_array(jsonb_build_object('cost', p_cost, 'what', v_what, 'at', extract(epoch from now()), 'prev', v_prev)));
  return p_c || jsonb_build_object('econ', v_e);
end;
$function$;
grant execute on function public.combat_spend(jsonb, text, text, boolean) to authenticated, service_role;

-- Mark the last spend as one a player cannot undo (an attack rolled, a save effect cast, a token moved:
-- they happened at the table). The GM can still undo it.
create or replace function public.combat_lock_last(p_c jsonb)
 returns jsonb
 language sql
 immutable
as $function$
  select case when jsonb_typeof(p_c -> 'econ' -> 'log') = 'array' and jsonb_array_length(p_c -> 'econ' -> 'log') > 0
              then jsonb_set(p_c, '{econ,log,-1,locked}', 'true'::jsonb) else p_c end;
$function$;
grant execute on function public.combat_lock_last(jsonb) to authenticated, service_role;

-- Move p_feet. Players need the movement left (speed after conditions, plus Dash); the GM is not checked.
create or replace function public.combat_move(p_c jsonb, p_feet integer, p_force boolean)
 returns jsonb
 language plpgsql
 immutable
as $function$
declare
  v_e     jsonb := public.combat_econ(p_c);
  v_speed integer := public.combat_speed(p_c);
  v_moved integer := coalesce((v_e ->> 'moved')::integer, 0);
  v_left  integer;
begin
  if coalesce(p_feet, 0) <= 0 then return p_c; end if;
  if p_feet > 2000 then raise exception 'that is too far for one move'; end if;
  if not p_force and v_speed is not null then
    v_left := v_speed + coalesce((v_e ->> 'dash')::integer, 0) - v_moved;
    if v_speed = 0 and coalesce((v_e ->> 'dash')::integer, 0) = 0 then raise exception 'your speed is 0 right now'; end if;
    if p_feet > v_left then raise exception 'not enough movement left: % ft', greatest(0, v_left); end if;
  end if;
  v_e := v_e || jsonb_build_object('moved', v_moved + p_feet,
    'log', (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
              select x, o from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o) order by o desc limit 9) k)
           || jsonb_build_array(jsonb_build_object('cost', 'move', 'what', p_feet || ' ft', 'at', extract(epoch from now()), 'prev', v_e - 'log')));
  return p_c || jsonb_build_object('econ', v_e);
end;
$function$;
grant execute on function public.combat_move(jsonb, integer, boolean) to authenticated, service_role;

-- Distance in feet between two points in squares, as lib/tabletop/geometry.ts measure() counts one leg.
create or replace function public.tabletop_feet(p_dx real, p_dy real, p_rule text, p_fps real)
 returns integer
 language plpgsql
 immutable
as $function$
declare
  v_dx real := abs(p_dx);
  v_dy real := abs(p_dy);
  v_diag real := least(abs(p_dx), abs(p_dy));
  v_sq real;
begin
  if p_rule = 'euclid' then v_sq := sqrt(v_dx * v_dx + v_dy * v_dy);
  elsif p_rule = 'alternate' then v_sq := greatest(v_dx, v_dy) + floor(round(v_diag) / 2);
  else v_sq := greatest(v_dx, v_dy);
  end if;
  return round(v_sq * coalesce(nullif(p_fps, 0), 5))::integer;
end;
$function$;
grant execute on function public.tabletop_feet(real, real, text, real) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- A fresh turn for whoever's turn begins. Fires when the turn passes to a different combatant or the
-- round changes; sorting the order or removing someone else keeps the current creature's turn as it is.
create or replace function public.combat_turn_econ()
 returns trigger
 language plpgsql
as $function$
declare
  v_n int := coalesce(jsonb_array_length(new.combatants), 0);
begin
  if v_n = 0 or new.turn is null or new.turn < 0 or new.turn >= v_n then return new; end if;
  if new.round is not distinct from old.round
     and (new.combatants -> new.turn ->> 'id') is not distinct from (old.combatants -> old.turn ->> 'id') then
    return new;
  end if;
  new.combatants := jsonb_set(new.combatants, array[new.turn::text, 'econ'], public.combat_fresh_econ());
  return new;
end;
$function$;
drop trigger if exists combat_turn_econ on public.combats;
create trigger combat_turn_econ before update of turn, round on public.combats
  for each row execute function public.combat_turn_econ();

-- ---------------------------------------------------------------------------------------------------
-- combat_act, as p110 with the action economy added:
--   spend        p_condition = action | attack | bonus | reaction, p_note = what for ("Dash", "Shove")
--   undo         take back the last spend or move on this combatant (a player cannot take back an
--                attack, a save effect or a token move: those happened at the table)
--   move         p_value feet, on your own turn, within your movement left
--   set_speed    p_value walking speed in feet (0 to 300)
--   set_attacks  p_value attacks per Attack action (1 to 8)
-- Players do these on their own character only; spend, undo and move need it to be their turn
-- (a reaction does not). The GM may do any of them on anyone, unchecked.
drop function if exists public.combat_act(uuid, text, text, integer, text, integer);
create or replace function public.combat_act(
  p_combat uuid, p_target text, p_action text,
  p_value integer default null, p_condition text default null, p_ac integer default null, p_note text default null
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_cb    public.combats;
  v_gm    boolean;
  v_c     jsonb;
  v_ord   bigint;
  v_mine  boolean;
  v_turn  boolean;
  v_hp    integer;
  v_max   integer;
  v_temp  integer;
  v_n     integer;
  v_conds jsonb;
  v_e     jsonb;
  v_last  jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_cb from public.combats where id = p_combat for update;
  if v_cb.id is null then raise exception 'fight not found'; end if;
  if v_cb.status <> 'active' then raise exception 'that fight is over'; end if;
  v_gm := public.is_campaign_gm(v_cb.campaign_id);
  if not v_gm and not public.tabletop_is_player(v_cb.campaign_id) then raise exception 'not at this table'; end if;

  select e.c, e.ord into v_c, v_ord
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where e.c ->> 'id' = p_target
   limit 1;
  if v_c is null then raise exception 'no such combatant'; end if;

  v_mine := (v_c ->> 'kind') = 'pc'
            and coalesce(v_c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
            and exists (select 1 from public.characters ch where ch.id = (v_c ->> 'characterId')::uuid and ch.profile_id = v_uid);
  v_turn := v_ord - 1 = v_cb.turn;

  if not v_gm then
    if coalesce((v_c ->> 'hidden')::boolean, false) then raise exception 'no such combatant'; end if;
    -- the turn gate: affecting anyone else needs your own character to hold the turn
    if not v_mine and not exists (
      select 1 from jsonb_array_elements(v_cb.combatants) with ordinality as t(c, ord)
       where t.ord - 1 = v_cb.turn and (t.c ->> 'kind') = 'pc'
         and coalesce(t.c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
         and exists (select 1 from public.characters ch where ch.id = (t.c ->> 'characterId')::uuid and ch.profile_id = v_uid)
    ) then
      raise exception 'it is not your turn';
    end if;
    if p_action in ('add_condition', 'remove_condition') then
      null;                                   -- anyone the players can see, on your turn
    elsif p_action in ('damage', 'heal', 'temp', 'sync_sheet', 'set_speed', 'set_attacks') and v_mine then
      null;                                   -- their own character
    elsif p_action in ('spend', 'undo', 'move') and v_mine then
      if not v_turn and not (p_action = 'spend' and p_condition = 'reaction') then
        raise exception 'it is not your turn';
      end if;
    else
      raise exception 'only the GM can do that';
    end if;
  end if;

  v_hp := case when jsonb_typeof(v_c -> 'hp') = 'number' then (v_c ->> 'hp')::numeric::integer end;
  v_max := case when jsonb_typeof(v_c -> 'maxHp') = 'number' then (v_c ->> 'maxHp')::numeric::integer end;
  v_temp := coalesce(case when jsonb_typeof(v_c -> 'tempHp') = 'number' then (v_c ->> 'tempHp')::numeric::integer end, 0);
  v_conds := case when jsonb_typeof(v_c -> 'conditions') = 'array' then v_c -> 'conditions' else '[]'::jsonb end;

  if p_action = 'damage' then
    v_n := greatest(0, coalesce(p_value, 0));
    if v_n > 9999 then raise exception 'that is too much damage for one hit'; end if;
    v_c := public.combat_hurt(v_c, v_n);
  elsif p_action = 'heal' then
    v_n := greatest(0, coalesce(p_value, 0));
    if v_n > 9999 then raise exception 'that is too much healing at once'; end if;
    if v_hp is not null then
      v_hp := case when v_max is null then v_hp + v_n else least(v_max, v_hp + v_n) end;
      v_c := v_c || jsonb_build_object('hp', v_hp);
      if v_hp > 0 then v_c := v_c || jsonb_build_object('defeated', false); end if;
    end if;
  elsif p_action = 'temp' then
    v_c := v_c || jsonb_build_object('tempHp', least(9999, greatest(0, coalesce(p_value, 0))));
  elsif p_action = 'sync_sheet' then
    if p_value is not null and p_value between 1 and 9999 and v_max is null then
      v_c := v_c || jsonb_build_object('maxHp', p_value);
      if v_hp is null then v_c := v_c || jsonb_build_object('hp', p_value); end if;
    end if;
    if p_ac is not null and p_ac between 1 and 60 and jsonb_typeof(v_c -> 'ac') is distinct from 'number' then
      v_c := v_c || jsonb_build_object('ac', p_ac);
    end if;
  elsif p_action = 'add_condition' then
    if p_condition is null or not (p_condition = any (public.combat_markers())) then raise exception 'not a condition the table knows'; end if;
    if not (v_conds ? p_condition) then v_c := v_c || jsonb_build_object('conditions', v_conds || to_jsonb(p_condition)); end if;
  elsif p_action = 'remove_condition' then
    v_c := v_c || jsonb_build_object('conditions', coalesce((select jsonb_agg(x) from jsonb_array_elements(v_conds) x where x <> to_jsonb(p_condition)), '[]'::jsonb));
  elsif p_action = 'spend' then
    v_c := public.combat_spend(v_c, coalesce(p_condition, ''), p_note, v_gm);
  elsif p_action = 'move' then
    v_c := public.combat_move(v_c, coalesce(p_value, 0), v_gm);
  elsif p_action = 'undo' then
    v_e := public.combat_econ(v_c);
    v_last := v_e -> 'log' -> -1;
    if v_last is null then raise exception 'nothing to undo this turn'; end if;
    if not v_gm and coalesce((v_last ->> 'locked')::boolean, false) then raise exception 'that already happened at the table; ask the GM to undo it'; end if;
    v_c := v_c || jsonb_build_object('econ', (public.combat_fresh_econ() || coalesce(v_last -> 'prev', '{}'::jsonb))
             || jsonb_build_object('log', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o)
                                                    where o < jsonb_array_length(v_e -> 'log')), '[]'::jsonb)));
  elsif p_action = 'set_speed' then
    if p_value is null or p_value < 0 or p_value > 300 then raise exception 'speed must be between 0 and 300 feet'; end if;
    v_c := v_c || jsonb_build_object('speed', p_value);
  elsif p_action = 'set_attacks' then
    if p_value is null or p_value < 1 or p_value > 8 then raise exception 'attacks per action must be between 1 and 8'; end if;
    v_c := v_c || jsonb_build_object('attacksPerAction', p_value);
  else
    raise exception 'unknown action';
  end if;

  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_ord then v_c else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = p_combat;
end;
$function$;
revoke all on function public.combat_act(uuid, text, text, integer, text, integer, text) from public, anon;
grant execute on function public.combat_act(uuid, text, text, integer, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Player attacks (p110) with a cost. p_cost: attack (part of the Attack action, Extra Attack counts),
-- action (a spell attack takes the whole action), bonus, or reaction (an opportunity attack, allowed on
-- someone else's turn while the reaction is unused). The GM may also pass free.
drop function if exists public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean);
create or replace function public.combat_attack_resolve(
  p_campaign uuid, p_character uuid, p_target text, p_total integer, p_natural integer, p_label text, p_gm boolean,
  p_cost text default 'attack'
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cb    public.combats;
  v_aord  bigint;
  v_att   jsonb;
  v_tgt   jsonb;
  v_ac    integer;
  v_hit   boolean;
  v_crit  boolean := coalesce(p_natural, 0) = 20;
  v_cost  text := coalesce(p_cost, 'attack');
begin
  if v_cost not in ('attack', 'action', 'bonus', 'reaction', 'free') or (v_cost = 'free' and not p_gm) then raise exception 'unknown cost'; end if;
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_att is null then raise exception 'your character is not in the fight'; end if;
  if not p_gm and v_cost <> 'reaction' and v_aord - 1 <> v_cb.turn then raise exception 'it is not your turn'; end if;
  select e.c into v_tgt from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord) where e.c ->> 'id' = p_target limit 1;
  if v_tgt is null or (not p_gm and coalesce((v_tgt ->> 'hidden')::boolean, false)) then raise exception 'no such combatant'; end if;
  if v_tgt ->> 'id' = v_att ->> 'id' then raise exception 'pick someone else to attack'; end if;
  v_att := public.combat_lock_last(public.combat_spend(v_att, v_cost, coalesce(nullif(p_label, ''), 'Attack') || ' on ' || coalesce(v_tgt ->> 'name', 'a target'), p_gm));
  v_ac := case when jsonb_typeof(v_tgt -> 'ac') = 'number' then (v_tgt ->> 'ac')::numeric::integer end;
  v_hit := case when coalesce(p_natural, 0) = 20 then true
                when coalesce(p_natural, 0) = 1 then false
                when v_ac is null then null
                else p_total >= v_ac end;
  v_att := v_att || jsonb_build_object('lastAttack', jsonb_build_object(
    'target', p_target, 'hit', v_hit, 'crit', v_crit and v_hit is true, 'label', left(coalesce(p_label, ''), 120),
    'at', extract(epoch from now()), 'applied', false));
  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_aord then v_att else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = v_cb.id;
  return jsonb_build_object('hit', v_hit, 'crit', v_crit and v_hit is true, 'target', v_tgt ->> 'name', 'combat', v_cb.id,
                            'attacksLeft', (public.combat_econ(v_att) ->> 'attacks')::integer);
end;
$function$;
revoke all on function public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean, text) from public, anon, authenticated;
grant execute on function public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- A player's save effect (p111) with a cost: action (most spells), bonus, or reaction (allowed on
-- someone else's turn while the reaction is unused). The GM may also pass free.
drop function if exists public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean);
create or replace function public.combat_request_save(
  p_campaign uuid, p_character uuid, p_targets text[], p_ability text, p_dc integer,
  p_damage integer, p_type text, p_half boolean, p_label text, p_gm boolean, p_cost text default 'action'
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cb    public.combats;
  v_att   jsonb;
  v_aord  bigint;
  v_names text[] := '{}';
  v_save  jsonb;
  v_new   jsonb;
  v_cost  text := coalesce(p_cost, 'action');
begin
  if v_cost not in ('action', 'bonus', 'reaction', 'free') or (v_cost = 'free' and not p_gm) then raise exception 'unknown cost'; end if;
  if p_ability not in ('str', 'dex', 'con', 'int', 'wis', 'cha') then raise exception 'pick an ability for the save'; end if;
  if p_dc is null or p_dc < 1 or p_dc > 40 then raise exception 'the DC must be between 1 and 40'; end if;
  if coalesce(array_length(p_targets, 1), 0) = 0 then raise exception 'pick at least one target'; end if;
  if array_length(p_targets, 1) > 30 then raise exception 'too many targets at once'; end if;
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_att is null then raise exception 'your character is not in the fight'; end if;
  if not p_gm and v_cost <> 'reaction' and v_aord - 1 <> v_cb.turn then raise exception 'it is not your turn'; end if;

  select coalesce(array_agg(e.c ->> 'name'), '{}') into v_names
    from jsonb_array_elements(v_cb.combatants) e(c)
   where e.c ->> 'id' = any (p_targets) and (p_gm or not coalesce((e.c ->> 'hidden')::boolean, false));
  if coalesce(array_length(v_names, 1), 0) = 0 then raise exception 'no such combatant'; end if;

  v_att := public.combat_lock_last(public.combat_spend(v_att, v_cost, left(coalesce(p_label, 'Save effect'), 60), p_gm));

  v_save := jsonb_build_object(
    'by', v_att ->> 'name', 'byId', v_att ->> 'id', 'label', left(coalesce(p_label, 'Save'), 120),
    'ability', p_ability, 'dc', p_dc, 'damage', greatest(0, least(9999, coalesce(p_damage, 0))),
    'type', left(coalesce(p_type, ''), 30), 'half', coalesce(p_half, true), 'conditions', '[]'::jsonb,
    'at', extract(epoch from now()));

  select jsonb_agg(
           case when e.ord = v_aord and not (e.c ->> 'id' = any (p_targets)) then v_att
                when e.c ->> 'id' = any (p_targets) and (p_gm or not coalesce((e.c ->> 'hidden')::boolean, false))
                then (case when e.ord = v_aord then v_att else e.c end) || jsonb_build_object('pendingSaves',
                       coalesce(case when jsonb_typeof(e.c -> 'pendingSaves') = 'array' then e.c -> 'pendingSaves' end, '[]'::jsonb)
                       || jsonb_build_array(v_save || jsonb_build_object('id', gen_random_uuid()::text)))
                when e.ord = v_aord then v_att
                else e.c end
           order by e.ord)
    into v_new
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord);
  update public.combats set combatants = v_new, updated_at = now() where id = v_cb.id;
  return jsonb_build_object('targets', to_jsonb(v_names));
end;
$function$;
revoke all on function public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean, text) from public, anon, authenticated;
grant execute on function public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- tabletop_move_token, as p108, plus movement in a running fight: a player's token that stands for a
-- combatant moves only on that combatant's turn, and only as far as its movement left. The distance
-- of each move is measured from where the token stood, with the scene's diagonal rule. Turning a token
-- in place is always allowed. The GM's moves are never limited.
create or replace function public.tabletop_move_token(p_token uuid, p_x real, p_y real, p_rot real default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_t    public.vtt_tokens;
  v_n    integer;
  v_fps  real;
  v_rule text;
  v_gm   boolean;
  v_cb   public.combats;
  v_c    jsonb;
  v_ord  bigint;
  v_x    real;
  v_y    real;
  v_ft   integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  v_gm := public.is_campaign_gm(v_t.campaign_id);
  if not (
    v_gm
    or (not v_t.hidden and v_t.layer <> 'gm' and (
          v_uid = any (v_t.controlled_by)
          or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)))
  ) then
    raise exception 'that token is not yours to move';
  end if;
  select b.n, b.feet_per_square, s.settings ->> 'diagonal' into v_n, v_fps, v_rule
    from public.vtt_scenes s join public.battle_maps b on b.id = s.battle_map_id where s.id = v_t.scene_id;
  v_n := coalesce(v_n, 100);
  v_x := greatest(-v_n, least(2 * v_n, p_x));
  v_y := greatest(-v_n, least(2 * v_n, p_y));

  if not v_gm then
    select * into v_cb from public.combats where campaign_id = v_t.campaign_id and status = 'active'
     order by updated_at desc limit 1 for update;
    if v_cb.id is not null then
      select e.c, e.ord into v_c, v_ord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
       where e.c ->> 'tokenId' = p_token::text
          or (v_t.character_id is not null and (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = v_t.character_id::text)
       order by (e.c ->> 'tokenId' = p_token::text) desc nulls last
       limit 1;
      if v_c is not null and not coalesce((v_c ->> 'defeated')::boolean, false) then
        v_ft := public.tabletop_feet(v_x - v_t.x, v_y - v_t.y, coalesce(v_rule, 'five'), coalesce(v_fps, 5));
        if v_ft > 0 then
          if v_ord - 1 <> v_cb.turn then raise exception 'wait for your turn to move'; end if;
          v_c := public.combat_lock_last(public.combat_move(v_c, v_ft, false));
          update public.combats
             set combatants = (select jsonb_agg(case when e.ord = v_ord then v_c else e.c end order by e.ord)
                                 from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
                 updated_at = now()
           where id = v_cb.id;
        end if;
      end if;
    end if;
  end if;

  update public.vtt_tokens
     set x = v_x, y = v_y,
         rot = coalesce(p_rot, rot),
         updated_at = now()
   where id = p_token;
end;
$function$;
revoke all on function public.tabletop_move_token(uuid, real, real, real) from public, anon;
grant execute on function public.tabletop_move_token(uuid, real, real, real) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tabletop_combat, phase 4c: as p111, plus the action economy. Your own character shows its econ,
-- speed (as set and right now) and attacks per action. Everyone sees how far the creature whose turn
-- it is has moved, and whether its action and bonus action are used (what the table can see).
create or replace function public.tabletop_combat(p_campaign uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_gm  boolean;
  v_cb  public.combats;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;

  select * into v_cb from public.combats
  where campaign_id = p_campaign and status = 'active'
  order by updated_at desc limit 1;
  if v_cb.id is null then return null; end if;

  return jsonb_build_object(
    'id', v_cb.id,
    'name', v_cb.name,
    'round', v_cb.round,
    'order', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',          e.c ->> 'id',
          'name',        e.c ->> 'name',
          'kind',        e.c ->> 'kind',
          'initiative',  e.c -> 'initiative',
          'defeated',    coalesce((e.c ->> 'defeated')::boolean, false),
          'is_turn',     (e.ord - 1) = v_cb.turn,
          'tokenId',     e.c -> 'tokenId',
          'characterId', e.c -> 'characterId',
          'conditions',  coalesce(e.c -> 'conditions', '[]'::jsonb),
          'mine',        o.mine,
          'awaitingSave', jsonb_typeof(e.c -> 'pendingSaves') = 'array' and jsonb_array_length(e.c -> 'pendingSaves') > 0
        )
        || case when e.c ->> 'kind' = 'pc' then jsonb_build_object(
             'hp',     e.c -> 'hp',
             'maxHp',  e.c -> 'maxHp',
             'tempHp', e.c -> 'tempHp')
           else '{}'::jsonb end
        || case when (e.ord - 1) = v_cb.turn and not o.mine then jsonb_build_object(
             'turnUsed', jsonb_build_object(
               'action', (public.combat_econ(e.c) ->> 'action')::boolean,
               'bonus',  (public.combat_econ(e.c) ->> 'bonus')::boolean,
               'moved',  (public.combat_econ(e.c) ->> 'moved')::integer))
           else '{}'::jsonb end
        || case when o.mine then jsonb_build_object(
             'ac', e.c -> 'ac',
             'pendingSaves', coalesce(case when jsonb_typeof(e.c -> 'pendingSaves') = 'array' then e.c -> 'pendingSaves' end, '[]'::jsonb),
             'lastSave', e.c -> 'lastSave',
             'econ', public.combat_econ(e.c) - 'log'
                     || jsonb_build_object('log', coalesce((select jsonb_agg(l - 'prev' order by o2) from jsonb_array_elements(public.combat_econ(e.c) -> 'log') with ordinality as x(l, o2)), '[]'::jsonb)),
             'speed', e.c -> 'speed',
             'speedNow', public.combat_speed(e.c),
             'attacksPerAction', coalesce(e.c -> 'attacksPerAction', '1'::jsonb),
             'cantAct', public.combat_cant_act(e.c))
           else '{}'::jsonb end
        order by e.ord), '[]'::jsonb)
      from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord),
           lateral (select (e.c ->> 'kind') = 'pc'
                       and coalesce(e.c ->> 'characterId', '') ~ '^[0-9a-f-]{36}$'
                       and exists (select 1 from public.characters ch
                                   where ch.id = (e.c ->> 'characterId')::uuid and ch.profile_id = v_uid) as mine) o
      where not coalesce((e.c ->> 'hidden')::boolean, false)
    )
  );
end;
$function$;
revoke all on function public.tabletop_combat(uuid) from public, anon;
grant execute on function public.tabletop_combat(uuid) to authenticated;
