-- p111-combat-saves.sql
--
-- Phase 4b (2026-11-07): an effect that calls for a saving throw does nothing until the target rolls
-- it. The damage (rolled once, as 5e rolls an area's damage once) and any conditions wait on the target
-- as a pending save; the save decides full damage, half, or none.
--
-- A pending save lives on the target combatant in combats.combatants, in a pendingSaves array:
--   { id, by, byId, label, ability ("str".."cha"), dc, damage, type, half, conditions: [], at }
--
-- Who makes and settles them:
--   * The GM puts them on targets from the Combat page or the tabletop (direct writes, as before), rolls
--     a monster's save there, and can settle a player's for them (they saved / they failed).
--   * A player whose turn it is puts them on the targets of their own save effect (a Fireball on the
--     ogres) through /api/tabletop/roll, which rolls the damage on the server and calls
--     combat_request_save. The GM then rolls each monster's save.
--   * A player rolls their own character's save through /api/tabletop/roll, which rolls on the server
--     and calls combat_resolve_save: the comparison with the DC and the damage happen here.
-- Both functions run as the service role only; the route checks who is rolling first. tabletop_combat
-- shows a player the pending saves on their own character, and whether anyone else is waiting on one.
--
-- Idempotent. Run by hand after p110, then supabase/checks/p111-combat-saves-check.sql.

-- ---------------------------------------------------------------------------------------------------
-- Apply damage to one combatant jsonb: temporary HP first, never below 0, a monster at 0 is defeated.
create or replace function public.combat_hurt(p_c jsonb, p_amount integer)
 returns jsonb
 language plpgsql
 immutable
as $function$
declare
  v_n    integer := greatest(0, least(9999, coalesce(p_amount, 0)));
  v_hp   integer := case when jsonb_typeof(p_c -> 'hp') = 'number' then (p_c ->> 'hp')::numeric::integer end;
  v_temp integer := coalesce(case when jsonb_typeof(p_c -> 'tempHp') = 'number' then (p_c ->> 'tempHp')::numeric::integer end, 0);
  v_c    jsonb := p_c;
begin
  v_c := v_c || jsonb_build_object('tempHp', v_temp - least(v_temp, v_n));
  if v_hp is not null then
    v_hp := greatest(0, v_hp - (v_n - least(v_temp, v_n)));
    v_c := v_c || jsonb_build_object('hp', v_hp);
    if v_hp = 0 and (v_c ->> 'kind') = 'monster' then v_c := v_c || jsonb_build_object('defeated', true); end if;
  end if;
  return v_c;
end;
$function$;
grant execute on function public.combat_hurt(jsonb, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- A player's save effect on one or more targets. Called by /api/tabletop/roll (service role) after it
-- has checked the caller owns p_character (or is the GM) and rolled the damage.
create or replace function public.combat_request_save(
  p_campaign uuid, p_character uuid, p_targets text[], p_ability text, p_dc integer,
  p_damage integer, p_type text, p_half boolean, p_label text, p_gm boolean
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
begin
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
  if not p_gm and v_aord - 1 <> v_cb.turn then raise exception 'it is not your turn'; end if;

  select coalesce(array_agg(e.c ->> 'name'), '{}') into v_names
    from jsonb_array_elements(v_cb.combatants) e(c)
   where e.c ->> 'id' = any (p_targets) and (p_gm or not coalesce((e.c ->> 'hidden')::boolean, false));
  if coalesce(array_length(v_names, 1), 0) = 0 then raise exception 'no such combatant'; end if;

  v_save := jsonb_build_object(
    'by', v_att ->> 'name', 'byId', v_att ->> 'id', 'label', left(coalesce(p_label, 'Save'), 120),
    'ability', p_ability, 'dc', p_dc, 'damage', greatest(0, least(9999, coalesce(p_damage, 0))),
    'type', left(coalesce(p_type, ''), 30), 'half', coalesce(p_half, true), 'conditions', '[]'::jsonb,
    'at', extract(epoch from now()));

  select jsonb_agg(
           case when e.c ->> 'id' = any (p_targets) and (p_gm or not coalesce((e.c ->> 'hidden')::boolean, false))
                then e.c || jsonb_build_object('pendingSaves',
                       coalesce(case when jsonb_typeof(e.c -> 'pendingSaves') = 'array' then e.c -> 'pendingSaves' end, '[]'::jsonb)
                       || jsonb_build_array(v_save || jsonb_build_object('id', gen_random_uuid()::text)))
                else e.c end
           order by e.ord)
    into v_new
    from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord);
  update public.combats set combatants = v_new, updated_at = now() where id = v_cb.id;
  return jsonb_build_object('targets', to_jsonb(v_names));
end;
$function$;
revoke all on function public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.combat_request_save(uuid, uuid, text[], text, integer, integer, text, boolean, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- A player's own save against a pending effect: compare with the DC, apply full, half or no damage
-- and the conditions on a failure, and take the pending save off. Called by /api/tabletop/roll.
create or replace function public.combat_resolve_save(p_campaign uuid, p_character uuid, p_save text, p_total integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cb    public.combats;
  v_c     jsonb;
  v_ord   bigint;
  v_ps    jsonb;
  v_ok    boolean;
  v_dmg   integer;
  v_conds jsonb;
  v_x     jsonb;
begin
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_c, v_ord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_c is null then raise exception 'your character is not in the fight'; end if;
  select s into v_ps from jsonb_array_elements(case when jsonb_typeof(v_c -> 'pendingSaves') = 'array' then v_c -> 'pendingSaves' else '[]'::jsonb end) s
   where s ->> 'id' = p_save limit 1;
  if v_ps is null then raise exception 'that save is already settled'; end if;

  v_ok := coalesce(p_total, 0) >= (v_ps ->> 'dc')::integer;
  v_dmg := case when v_ok then (case when coalesce((v_ps ->> 'half')::boolean, true) then ((v_ps ->> 'damage')::integer / 2) else 0 end)
                else (v_ps ->> 'damage')::integer end;
  v_c := public.combat_hurt(v_c, v_dmg);
  if not v_ok and jsonb_typeof(v_ps -> 'conditions') = 'array' then
    v_conds := case when jsonb_typeof(v_c -> 'conditions') = 'array' then v_c -> 'conditions' else '[]'::jsonb end;
    for v_x in select * from jsonb_array_elements(v_ps -> 'conditions') loop
      if not (v_conds @> jsonb_build_array(v_x)) then v_conds := v_conds || jsonb_build_array(v_x); end if;
    end loop;
    v_c := v_c || jsonb_build_object('conditions', v_conds);
  end if;
  v_c := v_c || jsonb_build_object(
    'pendingSaves', coalesce((select jsonb_agg(s) from jsonb_array_elements(v_c -> 'pendingSaves') s where s ->> 'id' <> p_save), '[]'::jsonb),
    'lastSave', jsonb_build_object('label', v_ps ->> 'label', 'by', v_ps ->> 'by', 'total', p_total, 'dc', v_ps -> 'dc', 'saved', v_ok, 'damage', v_dmg, 'at', extract(epoch from now())));
  update public.combats
     set combatants = (select jsonb_agg(case when e.ord = v_ord then v_c else e.c end order by e.ord)
                         from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)),
         updated_at = now()
   where id = v_cb.id;
  return jsonb_build_object('saved', v_ok, 'damage', v_dmg, 'dc', (v_ps ->> 'dc')::integer, 'label', v_ps ->> 'label', 'by', v_ps ->> 'by');
end;
$function$;
revoke all on function public.combat_resolve_save(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.combat_resolve_save(uuid, uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- tabletop_combat, phase 4b: as p110, plus the pending saves on the caller's own character (and their
-- last save), and for everyone else only whether they are waiting on one.
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
        || case when o.mine then jsonb_build_object(
             'ac', e.c -> 'ac',
             'pendingSaves', coalesce(case when jsonb_typeof(e.c -> 'pendingSaves') = 'array' then e.c -> 'pendingSaves' end, '[]'::jsonb),
             'lastSave', e.c -> 'lastSave')
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
