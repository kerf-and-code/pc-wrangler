-- supabase/migrations/p168-fights-and-saves.sql (2026-11-12, push 45: audit round 2)
--
-- 1. B7: combats.version, raised by the database on every update of a fight, whoever writes it (the
--    tabletop, the Combat page, the save, attack and initiative functions). The GM screens now write
--    "only if the version is still the one I read" and replay their change on a fresh read otherwise
--    (lib/tabletop/fight-write.ts), so a player's save or attack between the GM's read and write is no
--    longer overwritten.
--
-- 2. T17 and G3: combat_calibration (p161) restated. Its body now runs inside its own exception block:
--    a value it cannot read (a hand-edited combatant, an odd type) skips the measurement for that write
--    and raises a warning, instead of failing the update and leaving the fight unsaveable. It also reads
--    a monster's CR from the combatant itself (`cr`) when there is no stat block snapshot, which is how
--    a monster put on the tabletop from the library now arrives, so a fight started at the tabletop can
--    be predicted. The casts it makes on stored values are checked first.
--
-- 3. R7, G5: tabletop_gm_ids(campaign), every GM of the campaign (the owner and active co-GMs), for the
--    tabletop to tell a GM's ping, vanish and chat apart. Anyone at the table may call it.
--
-- 4. U14: initiative_my_characters(share), for the Initiative page players are sent to. For the
--    signed-in caller only, their own player characters in the campaign with that share code, with the
--    save bonuses off each saved sheet, and the campaign id, so the page can show and answer a save
--    waiting on them. Nothing for an anonymous visitor or someone with no character there.
--
-- Idempotent. Run by hand after p167, then supabase/checks/p168-fights-and-saves-check.sql.

-- 1 ---------------------------------------------------------------------------------------------------
alter table public.combats add column if not exists version bigint not null default 0;

create or replace function public.combat_bump_version()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$function$;
revoke all on function public.combat_bump_version() from public, anon, authenticated;

drop trigger if exists combats_version on public.combats;
create trigger combats_version before update on public.combats
  for each row execute function public.combat_bump_version();

-- 2 ---------------------------------------------------------------------------------------------------
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
  -- p168 (T17): whatever goes wrong in here, the fight still saves; only the measurement is skipped
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
        'cr', coalesce(nullif(e -> 'block' ->> 'cr', ''), nullif(e ->> 'cr', '')), 'hp', e -> 'hp', 'maxHp', e -> 'maxHp', 'round', new.round));
    end if;
    -- a player character dropping to 0
    if tg_op = 'UPDATE' and e ->> 'kind' = 'pc' and jsonb_typeof(e -> 'hp') = 'number' and (e ->> 'hp')::numeric <= 0 then
      select x into o from jsonb_array_elements(case when jsonb_typeof(old.combatants) = 'array' then old.combatants else '[]'::jsonb end) x
       where x ->> 'id' = v_id limit 1;
      if o is not null and jsonb_typeof(o -> 'hp') = 'number' and (o ->> 'hp')::numeric > 0 then
        v_downs := v_downs || jsonb_build_object(v_id, coalesce(case when jsonb_typeof(v_downs -> v_id) = 'number' then (v_downs ->> v_id)::numeric::integer end, 0) + 1);
      end if;
    end if;
  end loop;

  v_cal := v_cal || jsonb_build_object('start', v_start, 'downs', v_downs);

  -- the fight ends: where everyone stands
  if tg_op = 'UPDATE' and new.status = 'ended' and old.status is distinct from 'ended' then
    select coalesce(jsonb_object_agg(x ->> 'id', jsonb_build_object('hp', x -> 'hp', 'maxHp', x -> 'maxHp',
             'defeated', coalesce(x -> 'defeated' = 'true'::jsonb, false))), '{}'::jsonb)
      into v_ends
      from jsonb_array_elements(case when jsonb_typeof(new.combatants) = 'array' then new.combatants else '[]'::jsonb end) x
     where x ->> 'id' is not null;
    v_cal := v_cal || jsonb_build_object('end', jsonb_build_object('round', new.round, 'at', now(), 'combatants', v_ends));
  end if;

  exception when others then
    raise warning 'combat_calibration: not measured for combat % (%)', new.id, sqlerrm;
    new.calibration := coalesce(case when tg_op = 'UPDATE' then old.calibration end, new.calibration, '{}'::jsonb);
    return new;
  end;

  new.calibration := v_cal;
  return new;
end;
$function$;
revoke all on function public.combat_calibration() from public, anon, authenticated;
-- the trigger from p161 already calls this function; create or replace keeps it

-- 3 ---------------------------------------------------------------------------------------------------
create or replace function public.tabletop_gm_ids(p_campaign uuid)
 returns uuid[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not (public.is_campaign_gm(p_campaign) or public.tabletop_is_player(p_campaign)) then
    raise exception 'not at this table';
  end if;
  return array(
    select c.gm_id from public.campaigns c where c.id = p_campaign and c.gm_id is not null
    union
    select m.profile_id from public.memberships m
     where m.campaign_id = p_campaign and m.role in ('gm', 'co-gm') and m.active and m.profile_id is not null);
end;
$function$;
revoke all on function public.tabletop_gm_ids(uuid) from public, anon;
grant execute on function public.tabletop_gm_ids(uuid) to authenticated;

-- 4 ---------------------------------------------------------------------------------------------------
create or replace function public.initiative_my_characters(p_share text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_camp uuid;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return null; end if;
  select c.id into v_camp from public.campaigns c where c.share_code = lower(trim(p_share)) limit 1;
  if v_camp is null then return null; end if;
  return jsonb_build_object('campaign', v_camp, 'characters', coalesce((
    select jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.name, 'saves', ch.build -> 'sheetSnapshot' -> 'saves') order by ch.name)
      from public.characters ch
     where ch.campaign_id = v_camp and ch.profile_id = v_uid and ch.kind = 'pc' and coalesce(ch.active, true)), '[]'::jsonb));
end;
$function$;
revoke all on function public.initiative_my_characters(text) from public, anon;
grant execute on function public.initiative_my_characters(text) to authenticated;

insert into public._migrations (name) values ('p168-fights-and-saves') on conflict do nothing;
