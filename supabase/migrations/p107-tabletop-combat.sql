-- p107-tabletop-combat.sql
--
-- The tabletop's turn tracker (2026-11-07) runs the SAME fight as the Combat page: the campaign's
-- active combats row (p101). The GM reads and writes it directly (RLS "gm all combats"). Players
-- cannot read combats, and their existing view, combat_for_player(share), is keyed on the share code,
-- so this adds the tabletop's equivalent keyed on the campaign, with the same privacy:
--
--   * hidden combatants are left out (an ambush not yet sprung);
--   * monsters show name, initiative, whose turn and defeated, but never HP, AC, conditions or the
--     stat block;
--   * player characters also show HP, max HP, temp HP and conditions, so the party can see itself.
--
-- Each entry carries the combatant id, the characterId (pcs) and the tokenId the tabletop stamps on a
-- combatant it adds, so a token on the map can show its own bar and markers.
--
-- Also publishes combats to Realtime. Only the GM passes its RLS, which is the point: a GM with the
-- table open sees edits made on the Combat page and tells the players' tables to refresh.
--
-- Idempotent. Run by hand after p105, then supabase/checks/p107-tabletop-combat-check.sql.

create or replace function public.tabletop_combat(p_campaign uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_gm boolean;
  v_cb public.combats;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
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
          'characterId', e.c -> 'characterId'
        )
        || case when e.c ->> 'kind' = 'pc' then jsonb_build_object(
             'hp',         e.c -> 'hp',
             'maxHp',      e.c -> 'maxHp',
             'tempHp',     e.c -> 'tempHp',
             'conditions', coalesce(e.c -> 'conditions', '[]'::jsonb))
           else '{}'::jsonb end
        order by e.ord), '[]'::jsonb)
      from jsonb_array_elements(v_cb.combatants) with ordinality as e(c, ord)
      where not coalesce((e.c ->> 'hidden')::boolean, false)
    )
  );
end;
$function$;
revoke all on function public.tabletop_combat(uuid) from public, anon;
grant execute on function public.tabletop_combat(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'combats') then
    alter publication supabase_realtime add table public.combats;
  end if;
end $$;
