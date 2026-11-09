-- supabase/migrations/p133-tabletop-pictures.sql (2026-11-09)
--
-- Phase 6d: pictures the GM uploads for the table, kept private.
--
--   Picture handouts  a handout can now be a picture the GM uploads (a letter, a wanted poster, a map
--                     scrap) with a title and an optional caption, not only a wiki entry. It pops up for
--                     the players it is shown to, like any handout, and stays in their Handouts tab.
--   Card pictures     a deck can have a picture for its back, and each card a picture for its face.
--
-- The pictures live in a PRIVATE storage bucket, table-files, at <campaign>/<handouts|cards|decks>/<file>.
-- Nobody reads it directly: /api/tabletop/table-file asks tabletop_file_ok whether the signed-in person
-- may see that picture now, and only then answers with a short-lived link. So a picture handout stays
-- secret until it is shown, and a card's face only reaches whoever can see that card: its holder, the
-- table once it is face up, whoever played it face down, the GM.
--
--   vtt_handouts.entry_id may now be empty; such a handout has title, image_path and note instead.
--   vtt_decks.back_path, vtt_cards.image_path  each must sit in its own campaign's folder.
--   tabletop_show_image_handout  the GM shows a picture.
--   tabletop_handouts, tabletop_cards, tabletop_card_json  restated with the pictures.
--   tabletop_file_ok             may this person see this picture now.
--
-- Needs p130 (decks). Idempotent. Run by hand after p132, then supabase/checks/p133-tabletop-pictures-check.sql.

do $$
begin
  if to_regclass('public.vtt_cards') is null then raise exception 'run p130-tabletop-card-decks.sql first'; end if;
end;
$$;

-- the private bucket (no storage policies: only the server touches it)
insert into storage.buckets (id, name, public) values ('table-files', 'table-files', false)
on conflict (id) do nothing;
-- and storage itself refuses anything but a picture of 10 MB or less, where this storage version can say so
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 10485760 where id = 'table-files';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'] where id = 'table-files';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
alter table public.vtt_handouts alter column entry_id drop not null;
alter table public.vtt_handouts add column if not exists title text;
alter table public.vtt_handouts add column if not exists image_path text;
alter table public.vtt_handouts add column if not exists note text;
alter table public.vtt_decks add column if not exists back_path text;
alter table public.vtt_cards add column if not exists image_path text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_handouts_entry_or_picture') then
    alter table public.vtt_handouts add constraint vtt_handouts_entry_or_picture check (
      entry_id is not null
      or (image_path is not null and char_length(trim(coalesce(title, ''))) between 1 and 80 and char_length(coalesce(note, '')) <= 600));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vtt_handouts_picture_folder') then
    alter table public.vtt_handouts add constraint vtt_handouts_picture_folder check (
      image_path is null or image_path ~ ('^' || campaign_id::text || '/handouts/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vtt_decks_back_folder') then
    alter table public.vtt_decks add constraint vtt_decks_back_folder check (
      back_path is null or back_path ~ ('^' || campaign_id::text || '/decks/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vtt_cards_picture_folder') then
    alter table public.vtt_cards add constraint vtt_cards_picture_folder check (
      image_path is null or image_path ~ ('^' || campaign_id::text || '/cards/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'));
  end if;
end;
$$;

-- the address the table asks for a picture at
create or replace function public.tabletop_file_url(p_path text)
 returns text
 language sql
 immutable
as $function$
  select case when p_path is null then null
              else '/api/tabletop/table-file?c=' || split_part(p_path, '/', 1) || '&p=' || p_path end;
$function$;
revoke all on function public.tabletop_file_url(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Show a picture to player characters (null = every player character). Returns the handout id and the
-- characters it reached, as tabletop_show_handout does.
create or replace function public.tabletop_show_image_handout(p_campaign uuid, p_title text, p_path text, p_note text default null, p_characters uuid[] default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_chars uuid[];
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_campaign_gm(p_campaign) then raise exception 'only the GM shows handouts'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'give the picture a title'; end if;
  select coalesce(array_agg(ch.id), '{}') into v_chars
    from public.characters ch
   where ch.campaign_id = p_campaign and ch.kind = 'pc'
     and (p_characters is null or ch.id = any (p_characters));
  if coalesce(array_length(v_chars, 1), 0) = 0 then raise exception 'no player characters to show it to'; end if;
  insert into public.vtt_handouts (campaign_id, entry_id, title, image_path, note, shown_to, added_reveals)
  values (p_campaign, null, left(trim(p_title), 80), p_path, nullif(left(coalesce(p_note, ''), 600), ''),
          case when p_characters is null then null else v_chars end, '{}')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'characters', to_jsonb(v_chars));
end;
$function$;
revoke all on function public.tabletop_show_image_handout(uuid, text, text, text, uuid[]) from public, anon;
grant execute on function public.tabletop_show_image_handout(uuid, text, text, text, uuid[]) to authenticated;

-- p113's tabletop_handouts, with picture handouts. A player gets a picture handout shown to their
-- character; a wiki handout still only while the wiki lets them read the entry.
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
               'id', h.id, 'entryId', h.entry_id, 'title', coalesce(e.title, h.title), 'type', e.type, 'summary', e.summary,
               'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at,
               'picture', public.tabletop_file_url(h.image_path), 'picturePath', h.image_path, 'note', h.note,
               'shownTo', case when h.shown_to is null then null else (
                 select coalesce(jsonb_agg(ch.name order by ch.name), '[]'::jsonb) from public.characters ch where ch.id = any (h.shown_to)) end)
             order by h.shown_at desc)
        from public.vtt_handouts h left join public.entries e on e.id = h.entry_id
       where h.campaign_id = p_campaign and (h.entry_id is null or e.id is not null)), '[]'::jsonb);
  end if;
  if not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'entryId', h.entry_id, 'title', coalesce(e.title, h.title), 'type', e.type, 'summary', e.summary,
             'body', e.body, 'blocks', e.blocks, 'imageUrl', e.image_url, 'shownAt', h.shown_at,
             'picture', public.tabletop_file_url(h.image_path), 'note', h.note)
           order by h.shown_at desc)
      from public.vtt_handouts h left join public.entries e on e.id = h.entry_id
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
revoke all on function public.tabletop_handouts(uuid) from public, anon;
grant execute on function public.tabletop_handouts(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- p130's card shape, with the face's picture when the face is shown
create or replace function public.tabletop_card_json(c public.vtt_cards, p_show boolean)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select jsonb_build_object('id', c.id, 'deckId', c.deck_id, 'pile', c.pile, 'faceUp', c.face_up,
                            'holder', c.holder, 'playedBy', c.played_by, 'shown', p_show)
      || case when p_show then jsonb_build_object('name', c.name, 'body', c.body, 'suit', c.suit, 'rank', c.rank,
                                                  'picture', public.tabletop_file_url(c.image_path)) else '{}'::jsonb end;
$function$;
revoke all on function public.tabletop_card_json(public.vtt_cards, boolean) from public, anon, authenticated;

-- p130's tabletop_cards, with each deck's back picture
create or replace function public.tabletop_cards(p_campaign uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_gm  boolean;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gm := public.is_campaign_gm(p_campaign);
  if not v_gm and not public.tabletop_is_player(p_campaign) then raise exception 'not at this table'; end if;
  return jsonb_build_object(
    'decks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.name, 'kind', d.kind, 'backColor', d.back_color, 'playersDraw', d.players_draw,
               'back', public.tabletop_file_url(d.back_path),
               'total', (select count(*) from public.vtt_cards c where c.deck_id = d.id),
               'draw', (select count(*) from public.vtt_cards c where c.deck_id = d.id and c.pile = 'draw'),
               'discard', (select count(*) from public.vtt_cards c where c.deck_id = d.id and c.pile = 'discard'),
               'discardTop', (select public.tabletop_card_json(c, true) from public.vtt_cards c
                               where c.deck_id = d.id and c.pile = 'discard' order by c.ord desc limit 1))
             order by d.created_at), '[]'::jsonb)
        from public.vtt_decks d where d.campaign_id = p_campaign),
    'table', (
      select coalesce(jsonb_agg(public.tabletop_card_json(c, c.face_up or v_gm or c.played_by = v_uid) order by c.ord), '[]'::jsonb)
        from public.vtt_cards c where c.campaign_id = p_campaign and c.pile = 'table'),
    'hand', (
      select coalesce(jsonb_agg(public.tabletop_card_json(c, true) order by c.ord), '[]'::jsonb)
        from public.vtt_cards c where c.campaign_id = p_campaign and c.pile = 'hand' and c.holder = v_uid),
    'hands', (
      select coalesce(jsonb_agg(jsonb_build_object('holder', h.holder, 'name', public.tabletop_seat_name(p_campaign, h.holder), 'count', h.n)
             order by h.holder), '[]'::jsonb)
        from (select holder, count(*) as n from public.vtt_cards
               where campaign_id = p_campaign and pile = 'hand' and holder is not null group by holder) h),
    'others', case when v_gm then (
      select coalesce(jsonb_agg(public.tabletop_card_json(c, true) order by c.holder, c.ord), '[]'::jsonb)
        from public.vtt_cards c where c.campaign_id = p_campaign and c.pile = 'hand' and c.holder is distinct from v_uid) end
  );
end;
$function$;
revoke all on function public.tabletop_cards(uuid) from public, anon;
grant execute on function public.tabletop_cards(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- May the signed-in person see this picture now? The GM: anything in their campaign's folder. A player
-- at the table: a picture handout shown to their character; any deck's back; a card's face when they
-- can see the card (in their hand, face up on the table or played by them, or in the discards, which lie
-- face up). Several copies of a card can share a picture: seeing any one of them is enough.
create or replace function public.tabletop_file_ok(p_campaign uuid, p_path text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_path is null or p_path !~ ('^' || p_campaign::text || '/(handouts|cards|decks)/[0-9a-f-]{36}\.(png|jpg|webp|gif)$') then
    return false;
  end if;
  if public.is_campaign_gm(p_campaign) then return true; end if;
  if not public.tabletop_is_player(p_campaign) then return false; end if;
  return exists (
           select 1 from public.vtt_handouts h
            where h.campaign_id = p_campaign and h.image_path = p_path
              and (h.shown_to is null or exists (
                    select 1 from public.characters me
                     where me.campaign_id = p_campaign and me.kind = 'pc' and me.profile_id = v_uid and me.id = any (h.shown_to))))
      or exists (select 1 from public.vtt_decks d where d.campaign_id = p_campaign and d.back_path = p_path)
      or exists (
           select 1 from public.vtt_cards c
            where c.campaign_id = p_campaign and c.image_path = p_path
              and ((c.pile = 'hand' and c.holder = v_uid)
                   or (c.pile = 'table' and (c.face_up or c.played_by = v_uid))
                   or c.pile = 'discard'));
end;
$function$;
revoke all on function public.tabletop_file_ok(uuid, text) from public, anon;
grant execute on function public.tabletop_file_ok(uuid, text) to authenticated;

-- Is anything still using this picture? (The server removes a file only when nothing is.)
create or replace function public.tabletop_file_in_use(p_path text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.vtt_handouts where image_path = p_path)
      or exists (select 1 from public.vtt_decks where back_path = p_path)
      or exists (select 1 from public.vtt_cards where image_path = p_path);
$function$;
revoke all on function public.tabletop_file_in_use(text) from public, anon, authenticated;
grant execute on function public.tabletop_file_in_use(text) to service_role;
