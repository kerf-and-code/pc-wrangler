-- supabase/migrations/p129-tabletop-token-bars.sql (2026-11-09)
--
-- Phase 5y: token bars (gap 9 in the tabletop audit doc).
--
--   vtt_token_bars  up to two resource bars per token besides hit points (ki, rage, spell slots, a
--                   timer): a label, a value out of a most, a colour, and who sees it: everyone, the
--                   token's owner and the GM, or the GM only. GM only by row level security; players get
--                   bars through tabletop_bars, so a GM-only bar never reaches their browser.
--   tabletop_bars   the bars on a scene. The GM: all. A player: on their own scene, the bars for everyone
--                   on tokens they can see (as tabletop_state shows tokens: their own, and visible tokens
--                   on revealed squares), and the owner bars on their own tokens.
--   tabletop_set_bar_value  the owner (or the GM) moves a bar's value, between 0 and its most. GM-only
--                   bars only by the GM.
--   tabletop_combat (p112) restated with one addition: a creature (not a pc) whose token the GM marked
--                   style.healthToPlayers shows players "healthy", "bloodied" (half its hit points or
--                   fewer) or "down", never the numbers. Players still never get a creature's hit points.
--
-- Idempotent. Run by hand after p128, then supabase/checks/p129-tabletop-token-bars-check.sql.

create table if not exists public.vtt_token_bars (
  token_id     uuid not null references public.vtt_tokens(id) on delete cascade,
  slot         smallint not null check (slot between 1 and 2),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  label        text not null check (char_length(trim(label)) between 1 and 24),
  value        integer not null default 0 check (value between 0 and 9999),
  most         integer not null default 1 check (most between 1 and 9999),
  color        text not null default '#7fc4ea' check (color ~ '^#[0-9a-fA-F]{6}$'),
  visibility   text not null default 'owner' check (visibility in ('all', 'owner', 'gm')),
  updated_at   timestamptz not null default now(),
  primary key (token_id, slot),
  check (value <= most)
);
create index if not exists vtt_token_bars_campaign_idx on public.vtt_token_bars (campaign_id);

alter table public.vtt_token_bars enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_token_bars' and policyname = 'vtt_token_bars_gm') then
    create policy vtt_token_bars_gm on public.vtt_token_bars
      for all using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
  end if;
end;
$$;
revoke all on public.vtt_token_bars from anon;
grant select, insert, update, delete on public.vtt_token_bars to authenticated;

create or replace function public.tabletop_bars(p_scene uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_sc  public.vtt_scenes;
  v_n   integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_sc from public.vtt_scenes where id = p_scene;
  if v_sc.id is null then raise exception 'scene not found'; end if;
  if public.is_campaign_gm(v_sc.campaign_id) then
    return coalesce((
      select jsonb_agg(jsonb_build_object('tokenId', b.token_id, 'slot', b.slot, 'label', b.label, 'value', b.value, 'most', b.most,
               'color', b.color, 'visibility', b.visibility) order by b.token_id, b.slot)
        from public.vtt_token_bars b join public.vtt_tokens t on t.id = b.token_id
       where t.scene_id = p_scene), '[]'::jsonb);
  end if;
  if not public.tabletop_is_player(v_sc.campaign_id) then raise exception 'not at this table'; end if;
  if public.tabletop_scene_for(v_sc.campaign_id, v_uid) is distinct from p_scene then return '[]'::jsonb; end if;
  select bm.n into v_n from public.battle_maps bm where bm.id = v_sc.battle_map_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object('tokenId', b.token_id, 'slot', b.slot, 'label', b.label, 'value', b.value, 'most', b.most,
             'color', b.color, 'visibility', b.visibility) order by b.token_id, b.slot)
      from public.vtt_token_bars b join public.vtt_tokens t on t.id = b.token_id,
           lateral (select v_uid = any (t.controlled_by)
                           or exists (select 1 from public.characters c where c.id = t.character_id and c.profile_id = v_uid) as own) o
     where t.scene_id = p_scene and not t.hidden and t.layer <> 'gm'
       and ((b.visibility = 'owner' and o.own)
            or (b.visibility = 'all' and (o.own or public.tabletop_revealed(v_sc.revealed, v_sc.fog_on, coalesce(v_n, 0), floor(t.x)::integer, floor(t.y)::integer))))
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.tabletop_bars(uuid) from public, anon;
grant execute on function public.tabletop_bars(uuid) to authenticated;

create or replace function public.tabletop_set_bar_value(p_token uuid, p_slot integer, p_value integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_t   public.vtt_tokens;
  v_b   public.vtt_token_bars;
  v_gm  boolean;
  v_v   integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_t from public.vtt_tokens where id = p_token;
  if v_t.id is null then raise exception 'token not found'; end if;
  select * into v_b from public.vtt_token_bars where token_id = p_token and slot = p_slot for update;
  if v_b.token_id is null then raise exception 'that bar is not there'; end if;
  v_gm := public.is_campaign_gm(v_t.campaign_id);
  if not v_gm then
    if v_b.visibility = 'gm' or v_t.hidden or v_t.layer = 'gm' or not (
         v_uid = any (v_t.controlled_by)
         or exists (select 1 from public.characters c where c.id = v_t.character_id and c.profile_id = v_uid)) then
      raise exception 'that bar is not yours to change';
    end if;
  end if;
  v_v := greatest(0, least(v_b.most, coalesce(p_value, 0)));
  update public.vtt_token_bars set value = v_v, updated_at = now() where token_id = p_token and slot = p_slot;
  return v_v;
end;
$function$;
revoke all on function public.tabletop_set_bar_value(uuid, integer, integer) from public, anon;
grant execute on function public.tabletop_set_bar_value(uuid, integer, integer) to authenticated;

-- tabletop_combat as p112 left it, plus the coarse health of a creature the GM chose to show.
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
        -- p129: a creature whose token the GM marked healthToPlayers shows players how it is doing, never
        -- the numbers: healthy, bloodied (half its hit points or fewer) or down
        || case when e.c ->> 'kind' <> 'pc' and h.show and jsonb_typeof(e.c -> 'maxHp') = 'number' and (e.c ->> 'maxHp')::numeric > 0 then
             jsonb_build_object('health', case
               when coalesce((e.c ->> 'defeated')::boolean, false) or coalesce((e.c ->> 'hp')::numeric, 0) <= 0 then 'down'
               when (e.c ->> 'hp')::numeric * 2 <= (e.c ->> 'maxHp')::numeric then 'bloodied'
               else 'healthy' end)
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
                                   where ch.id = (e.c ->> 'characterId')::uuid and ch.profile_id = v_uid) as mine) o,
           lateral (select coalesce(e.c ->> 'tokenId', '') ~ '^[0-9a-f-]{36}$'
                       and exists (select 1 from public.vtt_tokens tk
                                   where tk.id = (e.c ->> 'tokenId')::uuid and tk.campaign_id = p_campaign
                                     and coalesce(tk.style ->> 'healthToPlayers', '') = 'true') as show) h
      where not coalesce((e.c ->> 'hidden')::boolean, false)
    )
  );
end;
$function$;
revoke all on function public.tabletop_combat(uuid) from public, anon;
grant execute on function public.tabletop_combat(uuid) to authenticated;
