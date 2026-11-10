-- supabase/migrations/p136-audit-same-campaign.sql (2026-11-09)
--
-- Audit B5: a row on the tabletop could point into ANOTHER campaign. The GM policies on vtt_pins,
-- vtt_handouts, vtt_tokens and the rest check only the row's own campaign, so a GM of campaign A could
-- write a pin or handout in A that names a hidden wiki entry of campaign B, and the GM read functions then
-- returned that entry's full text; a token or drawing in A could name a scene of B and show on B's table.
-- (vtt_cards already guards its deck; this does the same for everything else.)
--
--   vtt_same_campaign   one trigger, on every table below: a scene, wiki entry, token, character or
--                       battle map a row names must belong to the row's campaign. On update it checks only
--                       when a reference or the campaign changed, so an old row can still be edited.
--   tabletop_handouts, tabletop_pin_entry, tabletop_pins   read an entry only from the row's campaign.
--
-- Idempotent. Run by hand after p135, then supabase/checks/p136-audit-same-campaign-check.sql (which also
-- lists any rows that already cross campaigns).

create or replace function public.vtt_same_campaign()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  j  jsonb := to_jsonb(new);
  o  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  c  uuid  := (j ->> 'campaign_id')::uuid;
  moved boolean := tg_op = 'INSERT' or (j -> 'campaign_id') is distinct from (o -> 'campaign_id');
  k  text;
  v  uuid;
  ok boolean;
begin
  foreach k in array array['scene_id', 'entry_id', 'token_id', 'character_id', 'battle_map_id'] loop
    continue when not (j ? k) or j ->> k is null;
    continue when not moved and (j -> k) is not distinct from (o -> k);
    v := (j ->> k)::uuid;
    ok := case k
      when 'scene_id'      then exists (select 1 from public.vtt_scenes x  where x.id = v and x.campaign_id = c)
      when 'entry_id'      then exists (select 1 from public.entries x     where x.id = v and x.campaign_id = c)
      when 'token_id'      then exists (select 1 from public.vtt_tokens x  where x.id = v and x.campaign_id = c)
      when 'character_id'  then exists (select 1 from public.characters x  where x.id = v and x.campaign_id = c)
      when 'battle_map_id' then exists (select 1 from public.battle_maps x where x.id = v and x.campaign_id = c)
    end;
    if not ok then
      raise exception 'that % belongs to another campaign', replace(replace(k, '_id', ''), '_', ' ') using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$function$;
revoke all on function public.vtt_same_campaign() from public, anon, authenticated;

do $c$
declare t text;
begin
  foreach t in array array['vtt_pins', 'vtt_handouts', 'vtt_tokens', 'vtt_drawings', 'vtt_templates', 'vtt_effects',
                           'vtt_scene_players', 'vtt_token_notes', 'vtt_scenes', 'player_notes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_same_campaign', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.vtt_same_campaign()',
                   t || '_same_campaign', t);
  end loop;
end;
$c$;

-- The three reads, as live on 2026-11-09 (0000-base-schema.sql), each joining entries on the row's campaign.

CREATE OR REPLACE FUNCTION public.tabletop_handouts(p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if public.is_campaign_gm(p_campaign) then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'entryId', h.entry_id, 'title', coalesce(e.title, h.title), 'type', e.type, 'summary', e.summary,
               'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at,
               'picture', public.tabletop_file_url(h.image_path), 'picturePath', h.image_path, 'note', h.note,
               'shownTo', case when h.shown_to is null then null else (
                 select coalesce(jsonb_agg(ch.name order by ch.name), '[]'::jsonb) from public.characters ch where ch.id = any (h.shown_to)) end)
             order by h.shown_at desc)
        from public.vtt_handouts h left join public.entries e on e.id = h.entry_id and e.campaign_id = h.campaign_id
       where h.campaign_id = p_campaign and (h.entry_id is null or e.id is not null)), '[]'::jsonb);
  end if;
  if not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'entryId', h.entry_id, 'title', coalesce(e.title, h.title), 'type', e.type, 'summary', e.summary,
             'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at,
             'picture', public.tabletop_file_url(h.image_path), 'note', h.note)
           order by h.shown_at desc)
      from public.vtt_handouts h left join public.entries e on e.id = h.entry_id and e.campaign_id = h.campaign_id
     where h.campaign_id = p_campaign
       and (h.entry_id is null or e.id is not null)
       and exists (
         select 1 from public.characters me
          where me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = v_uid
            and (h.shown_to is null or me.id = any (h.shown_to))
            and (h.entry_id is null
                 or e.visibility in ('common', 'player')
                 or exists (select 1 from public.entry_reveals r
                             where r.target_type = 'entry' and r.target_id = e.id and r.revealed_to_character_id = me.id)))
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_pin_entry(p_pin uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_p   public.vtt_pins;
  v_sc  public.vtt_scenes;
  v_n   integer;
  v_e   public.entries;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_p from public.vtt_pins where id = p_pin;
  if v_p.id is null or v_p.entry_id is null then raise exception 'nothing to read there'; end if;
  select * into v_sc from public.vtt_scenes where id = v_p.scene_id;
  if not public.is_campaign_gm(v_p.campaign_id) then
    select b.n into v_n from public.battle_maps b where b.id = v_sc.battle_map_id;
    if not (public.tabletop_is_player(v_p.campaign_id)
            and v_p.players_see
            and public.tabletop_scene_for(v_p.campaign_id, v_uid) = v_p.scene_id
            and (v_n is null or public.tabletop_revealed(v_sc.revealed, v_sc.fog_on, v_n, floor(v_p.x)::integer, floor(v_p.y)::integer))
            and public.tabletop_player_reads_entry(v_p.campaign_id, v_p.entry_id)) then
      raise exception 'nothing to read there';
    end if;
  end if;
  select * into v_e from public.entries where id = v_p.entry_id and campaign_id = v_p.campaign_id;
  if v_e.id is null then raise exception 'nothing to read there'; end if;
  return jsonb_build_object('id', v_p.id, 'entryId', v_e.id, 'title', v_e.title, 'type', v_e.type, 'summary', v_e.summary,
    'body', v_e.body, 'blocks', v_e.blocks, 'imageUrl', v_e.image_url, 'shownAt', now());
end;
$function$;

CREATE OR REPLACE FUNCTION public.tabletop_pins(p_scene uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_sc    public.vtt_scenes;
  v_n     integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_sc from public.vtt_scenes where id = p_scene;
  if v_sc.id is null then raise exception 'scene not found'; end if;
  if public.is_campaign_gm(v_sc.campaign_id) then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'x', p.x, 'y', p.y, 'label', p.label, 'color', p.color,
               'entryId', p.entry_id, 'entryTitle', e.title, 'gmNote', p.gm_note, 'playersSee', p.players_see) order by p.created_at)
        from public.vtt_pins p left join public.entries e on e.id = p.entry_id and e.campaign_id = p.campaign_id
       where p.scene_id = p_scene), '[]'::jsonb);
  end if;
  if not public.tabletop_is_player(v_sc.campaign_id) then raise exception 'not at this table'; end if;
  if public.tabletop_scene_for(v_sc.campaign_id, v_uid) is distinct from p_scene then return '[]'::jsonb; end if;
  select b.n into v_n from public.battle_maps b where b.id = v_sc.battle_map_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'x', p.x, 'y', p.y, 'label', p.label, 'color', p.color,
             'entryId', case when ok.reads then p.entry_id end, 'entryTitle', case when ok.reads then e.title end,
             'playersSee', true) order by p.created_at)
      from public.vtt_pins p
      left join public.entries e on e.id = p.entry_id and e.campaign_id = p.campaign_id
      cross join lateral (select p.entry_id is not null and public.tabletop_player_reads_entry(v_sc.campaign_id, p.entry_id) as reads) ok
     where p.scene_id = p_scene and p.players_see
       and (v_n is null or public.tabletop_revealed(v_sc.revealed, v_sc.fog_on, v_n, floor(p.x)::integer, floor(p.y)::integer))
  ), '[]'::jsonb);
end;
$function$;
