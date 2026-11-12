-- p162-player-access-fixes.sql (2026-11-11, push 40: the player-table access audit)
--
-- Players never get memberships rows (my_campaigns() derives a player's tables from characters.profile_id),
-- so any policy that lets "members" read something shuts players out (p32 found this on characters). The
-- audit of every table a player's own pages read found two more places, plus a Forge message that could
-- not say why a character failed to open:
--
--   character_campaign_public(character)   the campaign's public wiki address and publish date, for
--                                           the owner of a character in it. /me/characters/[id] read
--                                           campaigns directly, which "members read campaigns" refuses
--                                           a player, so every player was told their GM had not
--                                           published, and never got the link to their page.
--   world_map_poi_detail_for_player(share, poi)
--                                           a marker's linked place (title and text) and person (name)
--                                           on the player world map. The viewer read entries and
--                                           characters directly, which a player cannot, so every
--                                           marker's popup was empty for players. Only a marker the
--                                           players can see, and only a place the players may read
--                                           (common or player, or revealed to one of the caller's
--                                           characters).
--   forge_access(kind, id)                  why the Forge could not open something: missing,
--                                           not_yours, trashed (the campaign is in the trash), or ok.
--                                           Says only that a row exists, never what is in it.
--
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p162-player-access-fixes-check.sql

create or replace function public.character_campaign_public(p_character uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('public_slug', c.public_slug, 'public_published_at', c.public_published_at)
    from public.characters ch
    join public.campaigns c on c.id = ch.campaign_id and c.deleted_at is null
   where ch.id = p_character
     and (ch.profile_id = auth.uid() or public.is_campaign_gm(c.id))
   limit 1;
$function$;
revoke all on function public.character_campaign_public(uuid) from public, anon;
grant execute on function public.character_campaign_public(uuid) to authenticated;

create or replace function public.world_map_poi_detail_for_player(p_share text, p_poi uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with p as (
    select mp.entry_id, mp.character_id, c.id as campaign_id
      from public.map_pois mp
      join public.world_maps wm on wm.id = mp.world_map_id
      join public.campaigns c on c.id = wm.campaign_id and c.deleted_at is null
     where mp.id = p_poi and c.share_code = p_share and mp.visibility in ('common', 'player')
     limit 1
  )
  select case when not exists (select 1 from p) then null::jsonb else jsonb_build_object(
    'entry', (select jsonb_build_object('title', e.title, 'body', e.body)
                from p join public.entries e on e.id = p.entry_id and e.campaign_id = p.campaign_id
               where e.visibility in ('common', 'player')
                  or exists (select 1 from public.entry_reveals r
                              join public.characters me on me.id = r.revealed_to_character_id
                             where r.target_type = 'entry' and r.target_id = e.id
                               and me.campaign_id = p.campaign_id and me.profile_id = auth.uid())),
    'character', (select jsonb_build_object('name', ch.name)
                    from p join public.characters ch on ch.id = p.character_id and ch.campaign_id = p.campaign_id))
  end;
$function$;
revoke all on function public.world_map_poi_detail_for_player(text, uuid) from public;
grant execute on function public.world_map_poi_detail_for_player(text, uuid) to anon, authenticated;

create or replace function public.forge_access(p_kind text, p_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_camp  uuid;
  v_gone  boolean;
begin
  if auth.uid() is null then return 'signed_out'; end if;
  if p_kind = 'library' then
    select l.profile_id into v_owner from public.pc_library l where l.id = p_id;
    if not found then return 'missing'; end if;
    return case when v_owner = auth.uid() then 'ok' else 'not_yours' end;
  end if;
  select ch.profile_id, ch.campaign_id, c.deleted_at is not null into v_owner, v_camp, v_gone
    from public.characters ch left join public.campaigns c on c.id = ch.campaign_id
   where ch.id = p_id;
  if not found then return 'missing'; end if;
  if v_gone then return 'trashed'; end if;
  return case when v_owner = auth.uid() or public.is_campaign_gm(v_camp) then 'ok' else 'not_yours' end;
end;
$function$;
revoke all on function public.forge_access(text, uuid) from public, anon;
grant execute on function public.forge_access(text, uuid) to authenticated;

insert into public._migrations (name) values ('p162-player-access-fixes') on conflict do nothing;
