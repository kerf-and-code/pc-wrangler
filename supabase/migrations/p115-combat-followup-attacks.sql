-- p115-combat-followup-attacks.sql
--
-- Phase 5b (2026-11-07): spells that make several attacks from one casting. Eldritch Blast's beams,
-- Scorching Ray's rays and the like spend the action once, on the first attack; each further attack
-- from the play sheet comes as a follow-up. combat_attack_resolve (p112) is restated with one change:
-- p_cost may be 'followup', allowed when the attacker's last spend was the same spell (the label up to
-- its first " (") within the last 90 seconds, up to ten in a row. A follow-up spends nothing more and
-- is logged (locked, like every attack) so the GM sees each one. Everything else is unchanged: same
-- signature, so CREATE OR REPLACE keeps the service-role grant, restated anyway.
--
-- Idempotent. Run by hand after p114, then supabase/checks/p115-combat-followup-attacks-check.sql.

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
  v_e     jsonb;
  v_last  jsonb;
  v_stem  text := split_part(coalesce(nullif(p_label, ''), 'Attack'), ' (', 1);
  v_n     integer;
begin
  if v_cost not in ('attack', 'action', 'bonus', 'reaction', 'free', 'followup') or (v_cost = 'free' and not p_gm) then raise exception 'unknown cost'; end if;
  select * into v_cb from public.combats where campaign_id = p_campaign and status = 'active'
   order by updated_at desc limit 1 for update;
  if v_cb.id is null then raise exception 'no fight is running'; end if;
  select e.c, e.ord into v_att, v_aord from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
   where (e.c ->> 'kind') = 'pc' and e.c ->> 'characterId' = p_character::text limit 1;
  if v_att is null then raise exception 'your character is not in the fight'; end if;
  if not p_gm and v_cost <> 'reaction' and v_aord - 1 <> v_cb.turn then raise exception 'it is not your turn'; end if;
  -- a follow-up: another attack from the same casting (Eldritch Blast's beams, Scorching Ray's rays).
  -- Allowed when the attacker's last spend was that same spell within the last 90 seconds, up to ten
  -- in a row; it spends nothing more and is logged.
  if v_cost = 'followup' then
    v_e := public.combat_econ(v_att);
    v_last := v_e -> 'log' -> -1;
    if v_last is null or split_part(v_last ->> 'what', ' (', 1) <> v_stem
       or extract(epoch from now()) - coalesce((v_last ->> 'at')::numeric, 0) > 90 then
      raise exception 'cast the spell first';
    end if;
    select count(*) into v_n from jsonb_array_elements(v_e -> 'log') l where split_part(l ->> 'what', ' (', 1) = v_stem;
    if v_n >= 10 then raise exception 'that casting has no attacks left'; end if;
  end if;
  select e.c into v_tgt from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord) where e.c ->> 'id' = p_target limit 1;
  if v_tgt is null or (not p_gm and coalesce((v_tgt ->> 'hidden')::boolean, false)) then raise exception 'no such combatant'; end if;
  if v_tgt ->> 'id' = v_att ->> 'id' then raise exception 'pick someone else to attack'; end if;
  if v_cost = 'followup' then
    v_att := v_att || jsonb_build_object('econ', v_e || jsonb_build_object('log',
      (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (select x, o from jsonb_array_elements(v_e -> 'log') with ordinality as l(x, o) order by o desc limit 9) k)
      || jsonb_build_array(jsonb_build_object('cost', 'followup', 'what', left(coalesce(nullif(p_label, ''), 'Attack') || ' on ' || coalesce(v_tgt ->> 'name', 'a target'), 60),
                                              'at', extract(epoch from now()), 'locked', true, 'prev', v_e - 'log'))));
  else
    v_att := public.combat_lock_last(public.combat_spend(v_att, v_cost, coalesce(nullif(p_label, ''), 'Attack') || ' on ' || coalesce(v_tgt ->> 'name', 'a target'), p_gm));
  end if;
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
