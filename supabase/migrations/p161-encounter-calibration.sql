-- p161-encounter-calibration.sql (2026-11-11, push 39: encounter calibration)
--
-- Calibration compares the difficulty the encounter math predicts with how a fight actually went. A
-- fight row only ever held its CURRENT state, so once it ended nobody could say how much HP the party
-- lost or how often someone dropped. This records what calibration needs, in the database, whichever
-- screen runs the fight (the Combat page, the tabletop, a player's sheet, the Discord Activity):
--
--   combats.calibration  jsonb, written only by the trigger below:
--     start   { <combatant id>: { kind, name, characterId, level, cr, hp, maxHp, round } }
--             each combatant as it was the first time it appeared in the fight (most are there from
--             the start; one added later is recorded when it joins, with the round it joined)
--     downs   { <combatant id>: n }  times a player character went from above 0 HP to 0 or below
--     end     { round, at, combatants: { <id>: { hp, maxHp, defeated } } }  when the fight ends
--
--   combat_calibration()  BEFORE INSERT OR UPDATE trigger on combats that keeps it.
--
-- PC levels come from characters.level when the character first appears; monster CR from the stat
-- block snapshot on the combatant (block.cr). A monster with no stat block has no CR and is counted as
-- such in the report rather than guessed. Fights from before this migration have no calibration and the
-- report leaves them out of its numbers.
--
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p161-encounter-calibration-check.sql

alter table public.combats add column if not exists calibration jsonb not null default '{}'::jsonb;

create or replace function public.combat_calibration()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cal   jsonb := coalesce(case when tg_op = 'UPDATE' then old.calibration end, new.calibration, '{}'::jsonb);
  v_start jsonb := coalesce(v_cal -> 'start', '{}'::jsonb);
  v_downs jsonb := coalesce(v_cal -> 'downs', '{}'::jsonb);
  e       jsonb;
  o       jsonb;
  v_id    text;
  v_lvl   integer;
  v_ends  jsonb;
begin
  for e in select x from jsonb_array_elements(case when jsonb_typeof(new.combatants) = 'array' then new.combatants else '[]'::jsonb end) x loop
    v_id := e ->> 'id';
    continue when v_id is null;
    -- first sight of this combatant
    if not v_start ? v_id then
      v_lvl := null;
      if e ->> 'kind' = 'pc' and coalesce(e ->> 'characterId', '') ~ '^[0-9a-f-]{36}$' then
        select ch.level into v_lvl from public.characters ch where ch.id = (e ->> 'characterId')::uuid;
      end if;
      v_start := v_start || jsonb_build_object(v_id, jsonb_build_object(
        'kind', e ->> 'kind', 'name', e ->> 'name', 'characterId', e -> 'characterId', 'level', v_lvl,
        'cr', nullif(e -> 'block' ->> 'cr', ''), 'hp', e -> 'hp', 'maxHp', e -> 'maxHp', 'round', new.round));
    end if;
    -- a player character dropping to 0
    if tg_op = 'UPDATE' and e ->> 'kind' = 'pc' and jsonb_typeof(e -> 'hp') = 'number' and (e ->> 'hp')::numeric <= 0 then
      select x into o from jsonb_array_elements(case when jsonb_typeof(old.combatants) = 'array' then old.combatants else '[]'::jsonb end) x
       where x ->> 'id' = v_id limit 1;
      if o is not null and jsonb_typeof(o -> 'hp') = 'number' and (o ->> 'hp')::numeric > 0 then
        v_downs := v_downs || jsonb_build_object(v_id, coalesce((v_downs ->> v_id)::integer, 0) + 1);
      end if;
    end if;
  end loop;

  v_cal := v_cal || jsonb_build_object('start', v_start, 'downs', v_downs);

  -- the fight ends: where everyone stands
  if tg_op = 'UPDATE' and new.status = 'ended' and old.status is distinct from 'ended' then
    select coalesce(jsonb_object_agg(x ->> 'id', jsonb_build_object('hp', x -> 'hp', 'maxHp', x -> 'maxHp',
             'defeated', coalesce((x ->> 'defeated')::boolean, false))), '{}'::jsonb)
      into v_ends
      from jsonb_array_elements(case when jsonb_typeof(new.combatants) = 'array' then new.combatants else '[]'::jsonb end) x
     where x ->> 'id' is not null;
    v_cal := v_cal || jsonb_build_object('end', jsonb_build_object('round', new.round, 'at', now(), 'combatants', v_ends));
  end if;

  new.calibration := v_cal;
  return new;
end;
$function$;
revoke all on function public.combat_calibration() from public, anon, authenticated;

drop trigger if exists combats_calibration on public.combats;
create trigger combats_calibration before insert or update on public.combats
  for each row execute function public.combat_calibration();

insert into public._migrations (name) values ('p161-encounter-calibration') on conflict do nothing;
