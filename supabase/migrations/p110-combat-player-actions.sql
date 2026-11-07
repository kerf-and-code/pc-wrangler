-- p110-combat-player-actions.sql
--
-- Phase 4a (2026-11-07): one fight, three screens, everyone acting on it. The GM runs the fight from the
-- Combat page and the tabletop (both write combats directly, RLS "gm all combats"); players act on it
-- from their character sheet and the tabletop through combat_act below, which changes ONE combatant in
-- one locked statement, so a player's heal and the GM's damage never overwrite each other.
--
-- What a player may do:
--   * on their own character: take damage, heal, set temporary HP, add or remove conditions and
--     effects, and fill in max HP and AC from their sheet when the fight has none yet;
--   * on anyone else the players can see (allies and monsters): add or remove conditions and effects,
--     so a player can mark their own Bless, Hex or Frightened on the right target.
-- Monster HP and AC stay with the GM, and hidden combatants stay out of reach.
--
-- The turn gate (Terry, 2026-11-07): only the creature whose turn it is affects anyone else. A player
-- marks an effect on another combatant, or attacks one, only while their own character holds the turn.
-- Changes to your own character (healing yourself, noting damage, dropping a condition) are allowed any
-- time, since they are bookkeeping. The GM is never gated. Reactions on someone else's turn are the GM's
-- to apply until the table tracks action economy (move, action, bonus action, reaction).
--
-- Player attacks: a player picks the monster they attack. /api/tabletop/roll rolls on the server and
-- calls combat_attack_resolve, which compares the roll with the target's AC here, so the AC never
-- leaves the database, and remembers the result on the attacker. A damage roll aimed at the same
-- target then lands through combat_attack_damage only after a hit, once, within three minutes. Both
-- run as the service role only; the route checks who is rolling first.
--
-- tabletop_combat (p107) is restated with two changes: monsters now show their conditions and effects
-- to players (players apply them, so they have to see them; HP, AC and the stat block stay hidden), and
-- every entry says whether it is the caller's own character, with that character's AC.
--
-- Idempotent. Run by hand after p107, then supabase/checks/p110-combat-player-actions-check.sql.

-- The conditions and effects a player may put on a combatant. Kept in step with lib/combat.ts
-- (CONDITIONS) and lib/combat-effects.ts (BUFFS, DEBUFFS).
create or replace function public.combat_markers()
 returns text[]
 language sql
 immutable
as $function$
  select array[
    'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
    'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating',
    'Blessed', 'Hasted', 'Inspired', 'Raging', 'Dodging', 'Shielded',
    'Baned', 'Slowed', 'Hexed', 'Marked', 'Outlined', 'Vulnerable'
  ]::text[];
$function$;
grant execute on function public.combat_markers() to authenticated;

-- ---------------------------------------------------------------------------------------------------
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
          'mine',        o.mine
        )
        || case when e.c ->> 'kind' = 'pc' then jsonb_build_object(
             'hp',     e.c -> 'hp',
             'maxHp',  e.c -> 'maxHp',
             'tempHp', e.c -> 'tempHp')
           else '{}'::jsonb end
        || case when o.mine then jsonb_build_object('ac', e.c -> 'ac') else '{}'::jsonb end
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

-- ---------------------------------------------------------------------------------------------------
-- One action on one combatant.
--   damage  p_value   temporary HP first, then HP, never below 0 (a monster at 0 is defeated)
--   heal    p_value   up to max HP (anyone above 0 is no longer down)
--   temp    p_value   temporary HP set to this (they do not stack)
--   add_condition / remove_condition   p_condition, one of combat_markers()
--   sync_sheet        p_value = max HP, p_ac = AC from the character sheet; fills only what is empty,
--                     and current HP too when it is empty
create or replace function public.combat_act(
  p_combat uuid, p_target text, p_action text,
  p_value integer default null, p_condition text default null, p_ac integer default null
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
  v_hp    integer;
  v_max   integer;
  v_temp  integer;
  v_n     integer;
  v_conds jsonb;
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
    elsif p_action in ('damage', 'heal', 'temp', 'sync_sheet') and v_mine then
      null;                                   -- their own character
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
    v_c := v_c || jsonb_build_object('tempHp', v_temp - least(v_temp, v_n));
    if v_hp is not null then
      v_hp := greatest(0, v_hp - (v_n - least(v_temp, v_n)));
      v_c := v_c || jsonb_build_object('hp', v_hp);
      if v_hp = 0 and (v_c ->> 'kind') = 'monster' then v_c := v_c || jsonb_build_object('defeated', true); end if;
    end if;
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
revoke all on function public.combat_act(uuid, text, text, integer, text, integer) from public, anon;
grant execute on function public.combat_act(uuid, text, text, integer, text, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Player attacks, called by /api/tabletop/roll with the service role after it has checked that the
-- caller owns p_character (or is the GM). Compares the server's roll with the target's AC and keeps
-- the result on the attacker as lastAttack.
create or replace function public.combat_attack_resolve(
  p_campaign uuid, p_character uuid, p_target text, p_total integer, p_natural integer, p_label text, p_gm boolean
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
begin
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_att is null then raise exception 'your character is not in the fight'; end if;
  if not p_gm and v_aord - 1 <> v_cb.turn then raise exception 'it is not your turn'; end if;
  select e.c into v_tgt from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord) where e.c ->> 'id' = p_target limit 1;
  if v_tgt is null or (not p_gm and coalesce((v_tgt ->> 'hidden')::boolean, false)) then raise exception 'no such combatant'; end if;
  if v_tgt ->> 'id' = v_att ->> 'id' then raise exception 'pick someone else to attack'; end if;
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
  return jsonb_build_object('hit', v_hit, 'crit', v_crit and v_hit is true, 'target', v_tgt ->> 'name', 'combat', v_cb.id);
end;
$function$;
revoke all on function public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.combat_attack_resolve(uuid, uuid, text, integer, integer, text, boolean) to service_role;

-- The damage of that attack: lands only after a hit on the same target, once, within three minutes.
create or replace function public.combat_attack_damage(p_campaign uuid, p_character uuid, p_target text, p_amount integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cb    public.combats;
  v_aord  bigint;
  v_att   jsonb;
  v_tord  bigint;
  v_tgt   jsonb;
  v_la    jsonb;
  v_hp    integer;
  v_temp  integer;
  v_n     integer := greatest(0, least(9999, coalesce(p_amount, 0)));
begin
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  v_la := v_att -> 'lastAttack';
  if v_att is null or v_la is null or v_la ->> 'target' <> p_target or (v_la ->> 'hit') is distinct from 'true'
     or coalesce((v_la ->> 'applied')::boolean, false) or extract(epoch from now()) - (v_la ->> 'at')::numeric > 180 then
    raise exception 'roll a hit on them first';
  end if;
  select e.c, e.ord into v_tgt, v_tord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord) where e.c ->> 'id' = p_target limit 1;
  if v_tgt is null then raise exception 'no such combatant'; end if;
  v_hp := case when jsonb_typeof(v_tgt -> 'hp') = 'number' then (v_tgt ->> 'hp')::numeric::integer end;
  v_temp := coalesce(case when jsonb_typeof(v_tgt -> 'tempHp') = 'number' then (v_tgt ->> 'tempHp')::numeric::integer end, 0);
  v_tgt := v_tgt || jsonb_build_object('tempHp', v_temp - least(v_temp, v_n));
  if v_hp is not null then
    v_hp := greatest(0, v_hp - (v_n - least(v_temp, v_n)));
    v_tgt := v_tgt || jsonb_build_object('hp', v_hp);
    if v_hp = 0 and (v_tgt ->> 'kind') = 'monster' then v_tgt := v_tgt || jsonb_build_object('defeated', true); end if;
  end if;
  v_att := v_att || jsonb_build_object('lastAttack', v_la || jsonb_build_object('applied', true, 'damage', v_n));
  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_aord then v_att when e.ord = v_tord then v_tgt else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = v_cb.id;
  return jsonb_build_object('applied', true, 'target', v_tgt ->> 'name', 'defeated', coalesce((v_tgt ->> 'defeated')::boolean, false));
end;
$function$;
revoke all on function public.combat_attack_damage(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.combat_attack_damage(uuid, uuid, text, integer) to service_role;
