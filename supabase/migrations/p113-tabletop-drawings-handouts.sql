-- p113-tabletop-drawings-handouts.sql
--
-- Phase 4d (2026-11-07): drawing and text on the table, and handouts.
--
-- DRAWINGS (vtt_drawings): a dry-erase board over the map. Everyone at the table draws and writes
-- (Terry, 2026-11-07); each person erases their own, and the GM erases anything. The GM can also draw
-- on a GM-only layer that players never receive (RLS leaves it out of their reads and their Realtime).
--   kind     'pen' (freehand), 'line', 'rect', 'ellipse', 'text'
--   points   jsonb array of [x, y] in squares from the grid's top-left: the whole stroke for a pen, the
--            two corners for a line, rectangle or ellipse, the anchor for text
--   width    stroke width in squares (0.02 to 1)
--   fill     rectangles and ellipses: filled with the colour at low opacity
--   text     the words for a text drawing; size is the text height in squares
--   layer    'table' (everyone sees it) or 'gm' (the GM only)
--
-- HANDOUTS: a handout is a wiki entry shown from the table (Terry, 2026-11-07). Showing one reveals the
-- entry to the chosen player characters (or every player character) through entry_reveals, the
-- wiki's own per-character reveal, so it stays in their Codex; and it is logged in vtt_handouts so the
-- table can pop it up and list it. Hiding it again takes back only the reveals that showing it added.
--   tabletop_show_handout(p_campaign, p_entry, p_characters)   the GM; null characters = every PC
--   tabletop_hide_handout(p_handout)                           the GM
--   tabletop_handouts(p_campaign)                              the GM sees every handout; a player
--                                                              sees the ones shown to their character,
--                                                              with the entry's content
--
-- Idempotent. Run by hand after p112, then supabase/checks/p113-tabletop-drawings-handouts-check.sql.

-- ---------------------------------------------------------------------------------------------------
create table if not exists public.vtt_drawings (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  scene_id    uuid not null references public.vtt_scenes(id) on delete cascade,
  owner       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  layer       text not null default 'table' check (layer in ('table', 'gm')),
  kind        text not null check (kind in ('pen', 'line', 'rect', 'ellipse', 'text')),
  points      jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 1 and 4000),
  color       text not null default '#e0703a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  width       real not null default 0.08 check (width >= 0.02 and width <= 1),
  fill        boolean not null default false,
  text        text check (text is null or char_length(text) <= 200),
  size        real not null default 0.6 check (size >= 0.2 and size <= 6),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind <> 'text' or (text is not null and char_length(trim(text)) > 0))
);
create index if not exists vtt_drawings_scene_idx on public.vtt_drawings (scene_id);

alter table public.vtt_drawings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_drawings' and policyname = 'vtt_drawings_gm') then
    create policy vtt_drawings_gm on public.vtt_drawings
      for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_drawings' and policyname = 'vtt_drawings_player_read') then
    create policy vtt_drawings_player_read on public.vtt_drawings
      for select using (layer = 'table' and tabletop_is_player(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_drawings' and policyname = 'vtt_drawings_player_insert') then
    create policy vtt_drawings_player_insert on public.vtt_drawings
      for insert with check (owner = auth.uid() and layer = 'table' and tabletop_is_player(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_drawings' and policyname = 'vtt_drawings_player_update') then
    create policy vtt_drawings_player_update on public.vtt_drawings
      for update using (owner = auth.uid() and layer = 'table' and tabletop_is_player(campaign_id))
      with check (owner = auth.uid() and layer = 'table' and tabletop_is_player(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_drawings' and policyname = 'vtt_drawings_player_delete') then
    create policy vtt_drawings_player_delete on public.vtt_drawings
      for delete using (owner = auth.uid() and tabletop_is_player(campaign_id));
  end if;
end $$;

grant select, insert, update, delete on public.vtt_drawings to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vtt_drawings') then
    alter publication supabase_realtime add table public.vtt_drawings;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
create table if not exists public.vtt_handouts (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  entry_id      uuid not null references public.entries(id) on delete cascade,
  shown_to      uuid[],                                   -- character ids; null = every player character
  added_reveals uuid[] not null default '{}',            -- entry_reveals rows this showing created
  shown_by      uuid default auth.uid(),
  shown_at      timestamptz not null default now()
);
create index if not exists vtt_handouts_campaign_idx on public.vtt_handouts (campaign_id, shown_at desc);

alter table public.vtt_handouts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_handouts' and policyname = 'vtt_handouts_gm') then
    create policy vtt_handouts_gm on public.vtt_handouts
      for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));
  end if;
end $$;

-- Show a wiki entry to player characters. Returns the handout id and the characters it reached.
create or replace function public.tabletop_show_handout(p_campaign uuid, p_entry uuid, p_characters uuid[] default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_chars uuid[];
  v_added uuid[];
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only the GM shows handouts'; end if;
  if not exists (select 1 from public.entries e where e.id = p_entry and e.campaign_id = p_campaign) then
    raise exception 'that entry is not in this campaign';
  end if;
  select coalesce(array_agg(ch.id), '{}') into v_chars
    from public.characters ch
   where ch.campaign_id = p_campaign and ch.kind = 'pc'
     and (p_characters is null or ch.id = any (p_characters));
  if coalesce(array_length(v_chars, 1), 0) = 0 then raise exception 'no player characters to show it to'; end if;

  with ins as (
    insert into public.entry_reveals (campaign_id, target_type, target_id, revealed_to_character_id)
    select p_campaign, 'entry', p_entry, c from unnest(v_chars) c
    on conflict (target_type, target_id, revealed_to_character_id) do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_added from ins;

  insert into public.vtt_handouts (campaign_id, entry_id, shown_to, added_reveals)
  values (p_campaign, p_entry, case when p_characters is null then null else v_chars end, v_added)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'characters', to_jsonb(v_chars));
end;
$function$;
revoke all on function public.tabletop_show_handout(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.tabletop_show_handout(uuid, uuid, uuid[]) to authenticated;

-- Take a handout back: the log row, and the reveals that showing it added (reveals the GM made in the
-- wiki before, or that another showing added, stay).
create or replace function public.tabletop_hide_handout(p_handout uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_h public.vtt_handouts;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_h from public.vtt_handouts where id = p_handout;
  if v_h.id is null then raise exception 'that handout is gone'; end if;
  if not public.is_campaign_gm(v_h.campaign_id) then raise exception 'only the GM hides handouts'; end if;
  delete from public.vtt_handouts where id = p_handout;
  delete from public.entry_reveals r
   where r.id = any (v_h.added_reveals)
     and not exists (select 1 from public.vtt_handouts o where o.campaign_id = v_h.campaign_id and r.id = any (o.added_reveals));
end;
$function$;
revoke all on function public.tabletop_hide_handout(uuid) from public, anon;
grant execute on function public.tabletop_hide_handout(uuid) to authenticated;

-- The handouts at this table. The GM: every handout, newest first, with who it was shown to. A player:
-- the ones shown to their character that the wiki still lets them read, with the entry's content.
create or replace function public.tabletop_handouts(p_campaign uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if public.is_campaign_gm(p_campaign) then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'entryId', h.entry_id, 'title', e.title, 'type', e.type, 'summary', e.summary,
               'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at,
               'shownTo', case when h.shown_to is null then null else (
                 select coalesce(jsonb_agg(ch.name order by ch.name), '[]'::jsonb) from public.characters ch where ch.id = any (h.shown_to)) end)
             order by h.shown_at desc)
        from public.vtt_handouts h join public.entries e on e.id = h.entry_id
       where h.campaign_id = p_campaign), '[]'::jsonb);
  end if;
  if not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'entryId', h.entry_id, 'title', e.title, 'type', e.type, 'summary', e.summary,
             'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at)
           order by h.shown_at desc)
      from public.vtt_handouts h join public.entries e on e.id = h.entry_id
     where h.campaign_id = p_campaign
       and exists (
         select 1 from public.characters me
          where me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = v_uid
            and (h.shown_to is null or me.id = any (h.shown_to))
            and (e.visibility in ('common', 'player')
                 or exists (select 1 from public.entry_reveals r
                             where r.target_type = 'entry' and r.target_id = e.id and r.revealed_to_character_id = me.id)))
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.tabletop_handouts(uuid) from public, anon;
grant execute on function public.tabletop_handouts(uuid) to authenticated;
