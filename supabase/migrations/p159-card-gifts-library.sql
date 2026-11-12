-- p159-card-gifts-library.sql (2026-11-11, push 35)
--
-- Cards the GM hands out, and a deck library that follows the GM across campaigns.
--
--   vtt_cards.given_by   who put this card in its holder's hand, when it was someone else (the GM dealing
--                        or handing it out, a player passing it). The Cards tab shows "from the GM".
--   tabletop_card_json   restated (p133) with givenBy.
--   tabletop_cards_to_hand, tabletop_card_move
--                        restated (p130) to set given_by. When the GM takes a chosen card from a deck's
--                        draw pile or discards and gives it to someone, chat says "gives Mira a card from
--                        Boons" (the card's face stays private to its new holder).
--   tabletop_card_use    a player uses a card in their hand (or one they played): chat says what it was
--                        and what it says, and it goes to its deck's discards, so the GM can hand it out
--                        again.
--   gm_card_decks        the GM's own deck library: a deck saved from a table, with its cards (and their
--                        pictures, copied to library/<owner>/ in the table-files bucket by
--                        app/api/tabletop/deck-library), added to any campaign they run. Owner only.
--   activity_call        restated (p158) so the Discord Activity can show a player's hand and use or play
--                        a card: tabletop_cards, tabletop_card_use, tabletop_card_move are allowed too.
--
-- Needs p130, p133 and p158. Idempotent. Hand-run in the Supabase SQL editor.
-- Check: supabase\checks\p159-card-gifts-library-check.sql

do $$
begin
  if to_regclass('public.vtt_cards') is null then raise exception 'run p130-tabletop-card-decks.sql first'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vtt_cards' and column_name = 'image_path') then
    raise exception 'run p133-tabletop-pictures.sql first';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'activity_call') then
    raise exception 'run p158-discord-activity.sql first';
  end if;
end;
$$;

alter table public.vtt_cards add column if not exists given_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------------------------------
-- the deck library
create table if not exists public.gm_card_decks (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 60),
  kind          text not null default 'custom' check (kind in ('standard', 'custom')),
  back_color    text not null default '#7a2e2e' check (back_color ~ '^#[0-9a-fA-F]{6}$'),
  back_path     text,
  players_draw  boolean not null default true,
  cards         jsonb not null check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) between 1 and 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists gm_card_decks_owner_idx on public.gm_card_decks (owner, created_at desc);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gm_card_decks_back_folder') then
    alter table public.gm_card_decks add constraint gm_card_decks_back_folder check (
      back_path is null or back_path ~ ('^library/' || owner::text || '/[0-9a-f-]{36}\.(png|jpg|webp|gif)$'));
  end if;
end;
$$;
alter table public.gm_card_decks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gm_card_decks' and policyname = 'gm_card_decks_owner') then
    create policy gm_card_decks_owner on public.gm_card_decks
      for all using (owner = auth.uid()) with check (owner = auth.uid());
  end if;
end;
$$;
revoke all on public.gm_card_decks from anon;
grant select, insert, update, delete on public.gm_card_decks to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- p133's card shape, with who gave it
create or replace function public.tabletop_card_json(c public.vtt_cards, p_show boolean)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select jsonb_build_object('id', c.id, 'deckId', c.deck_id, 'pile', c.pile, 'faceUp', c.face_up,
                            'holder', c.holder, 'playedBy', c.played_by, 'givenBy', c.given_by, 'shown', p_show)
      || case when p_show then jsonb_build_object('name', c.name, 'body', c.body, 'suit', c.suit, 'rank', c.rank,
                                                  'picture', public.tabletop_file_url(c.image_path)) else '{}'::jsonb end;
$function$;
revoke all on function public.tabletop_card_json(public.vtt_cards, boolean) from public, anon, authenticated;

-- p130's draw and deal, noting who dealt
create or replace function public.tabletop_cards_to_hand(p_deck uuid, p_to uuid, p_count integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_d   public.vtt_decks;
  v_n   integer := greatest(1, least(coalesce(p_count, 1), 10));
  v_got integer;
begin
  -- one draw at a time per deck, so two people never take the same card
  select * into v_d from public.vtt_decks where id = p_deck for update;
  with top as (
    select id, ord from public.vtt_cards where deck_id = p_deck and pile = 'draw' order by ord limit v_n for update
  ), numbered as (
    select id, row_number() over (order by ord) as rn from top
  ), base as (
    select coalesce(max(ord), 0) as m from public.vtt_cards where campaign_id = v_d.campaign_id and pile = 'hand' and holder = p_to
  )
  update public.vtt_cards c
     set pile = 'hand', holder = p_to, face_up = false, played_by = null, ord = base.m + numbered.rn, moved_at = now(),
         given_by = case when p_to is distinct from auth.uid() then auth.uid() end
    from numbered, base
   where c.id = numbered.id;
  get diagnostics v_got = row_count;
  if v_got = 0 then raise exception '% is empty: shuffle the discards back in first', v_d.name; end if;
  return v_got;
end;
$function$;
revoke all on function public.tabletop_cards_to_hand(uuid, uuid, integer) from public, anon, authenticated;

-- p130's move, noting who gave a card, and saying "gives" when the GM hands out a chosen card
create or replace function public.tabletop_card_move(p_card uuid, p_to text, p_face_up boolean default true, p_holder uuid default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_c    public.vtt_cards;
  v_d    public.vtt_decks;
  v_gm   boolean;
  v_to   uuid;
  v_ord  integer;
  v_up   boolean := coalesce(p_face_up, true);
  v_msg  text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_to not in ('table', 'discard', 'hand', 'draw') then raise exception 'cards go to the table, the discards, a hand or the deck'; end if;
  select * into v_c from public.vtt_cards where id = p_card for update;
  if v_c.id is null then raise exception 'card not found'; end if;
  select * into v_d from public.vtt_decks where id = v_c.deck_id;
  v_gm := public.is_campaign_gm(v_c.campaign_id);
  if not v_gm then
    if not public.tabletop_is_player(v_c.campaign_id) then raise exception 'not at this table'; end if;
    if not ((v_c.pile = 'hand' and v_c.holder = v_uid) or (v_c.pile = 'table' and v_c.played_by = v_uid)) then
      raise exception 'that card is not yours to move';
    end if;
    if p_to = 'draw' then raise exception 'only the GM puts cards back in the deck'; end if;
  end if;

  if p_to = 'hand' then
    v_to := coalesce(p_holder, v_uid);
    if not public.tabletop_card_seat(v_c.campaign_id, v_to) then raise exception 'that person is not at this table'; end if;
  end if;

  -- where it goes in its new pile: on top of the deck, or after what is already there
  if p_to = 'draw' then
    select coalesce(min(ord), 1) - 1 into v_ord from public.vtt_cards where deck_id = v_c.deck_id and pile = 'draw';
  elsif p_to = 'discard' then
    select coalesce(max(ord), 0) + 1 into v_ord from public.vtt_cards where deck_id = v_c.deck_id and pile = 'discard';
  elsif p_to = 'table' then
    v_ord := case when v_c.pile = 'table' then v_c.ord
                  else (select coalesce(max(ord), 0) + 1 from public.vtt_cards where campaign_id = v_c.campaign_id and pile = 'table') end;
  else
    select coalesce(max(ord), 0) + 1 into v_ord from public.vtt_cards where campaign_id = v_c.campaign_id and pile = 'hand' and holder = v_to;
  end if;

  -- what chat says: a card's name only once everyone can see it
  v_msg := case
    when p_to = 'table' and v_c.pile = 'table' and v_up and not v_c.face_up then format('reveals %s', v_c.name)
    when p_to = 'table' and v_c.pile = 'table' and not v_up and v_c.face_up then format('turns %s face down', v_c.name)
    when p_to = 'table' and v_c.pile = 'table' then null
    when p_to = 'table' and v_up then format('plays %s', v_c.name)
    when p_to = 'table' then 'plays a card face down'
    when p_to = 'discard' then format('discards %s', v_c.name)
    when p_to = 'draw' then format('puts a card back on top of %s', v_d.name)
    when v_to = v_uid and v_c.pile = 'table' then format('takes back %s', case when v_c.face_up then v_c.name else 'a card' end)
    when v_to = v_uid then null
    when v_c.pile in ('draw', 'discard') then format('gives %s a card from %s', public.tabletop_seat_name(v_c.campaign_id, v_to), v_d.name)
    else format('passes a card to %s', public.tabletop_seat_name(v_c.campaign_id, v_to)) end;

  update public.vtt_cards
     set pile = p_to,
         holder = case when p_to = 'hand' then v_to end,
         face_up = case when p_to = 'table' then v_up when p_to = 'discard' then true else false end,
         played_by = case when p_to = 'table' then coalesce(case when v_c.pile = 'table' then v_c.played_by end, v_uid) end,
         given_by = case when p_to = 'hand' and v_to <> v_uid then v_uid end,
         ord = v_ord,
         moved_at = now()
   where id = p_card;
  if v_msg is not null then perform public.tabletop_card_say(v_c.campaign_id, v_msg); end if;
end;
$function$;
revoke all on function public.tabletop_card_move(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.tabletop_card_move(uuid, text, boolean, uuid) to authenticated;

-- Use a card: from your hand (or one you played on the table), it is shown to everyone in chat and goes
-- to its deck's discards, ready to be handed out again.
create or replace function public.tabletop_card_use(p_card uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_c   public.vtt_cards;
  v_ord integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_c from public.vtt_cards where id = p_card for update;
  if v_c.id is null then raise exception 'card not found'; end if;
  if not ((v_c.pile = 'hand' and v_c.holder = v_uid) or (v_c.pile = 'table' and v_c.played_by = v_uid)) then
    raise exception 'that card is not yours to use';
  end if;
  if not public.is_campaign_gm(v_c.campaign_id) and not public.tabletop_is_player(v_c.campaign_id) then raise exception 'not at this table'; end if;
  select coalesce(max(ord), 0) + 1 into v_ord from public.vtt_cards where deck_id = v_c.deck_id and pile = 'discard';
  update public.vtt_cards
     set pile = 'discard', holder = null, face_up = true, played_by = null, given_by = null, ord = v_ord, moved_at = now()
   where id = p_card;
  perform public.tabletop_card_say(v_c.campaign_id,
    format('uses %s', v_c.name) || case when coalesce(trim(v_c.body), '') <> '' then ': ' || left(trim(v_c.body), 300) else '' end);
end;
$function$;
revoke all on function public.tabletop_card_use(uuid) from public, anon;
grant execute on function public.tabletop_card_use(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- p158's activity_call, with the cards
create or replace function public.activity_call(p_profile uuid, p_fn text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c uuid := (p_args ->> 'campaign')::uuid;
begin
  if p_profile is null then raise exception 'no profile'; end if;
  perform set_config('request.jwt.claim.sub', p_profile::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
  case p_fn
    when 'tabletop_state' then return public.tabletop_state(v_c);
    when 'tabletop_combat' then return public.tabletop_combat(v_c);
    when 'tabletop_feed' then
      return public.tabletop_feed(v_c, nullif(p_args ->> 'since', '')::timestamptz, coalesce((p_args ->> 'limit')::int, 60));
    when 'tabletop_move_token' then
      perform public.tabletop_move_token((p_args ->> 'token')::uuid, (p_args ->> 'x')::real, (p_args ->> 'y')::real, null);
      return 'true'::jsonb;
    when 'tabletop_open_session' then return to_jsonb(public.tabletop_open_session(v_c));
    when 'is_campaign_gm' then return to_jsonb(public.is_campaign_gm(v_c));
    when 'tabletop_is_player' then return to_jsonb(public.tabletop_is_player(v_c));
    when 'tabletop_cards' then return public.tabletop_cards(v_c);
    when 'tabletop_card_use' then
      perform public.tabletop_card_use((p_args ->> 'card')::uuid);
      return 'true'::jsonb;
    when 'tabletop_card_move' then
      perform public.tabletop_card_move((p_args ->> 'card')::uuid, p_args ->> 'to', coalesce((p_args ->> 'face_up')::boolean, true), null);
      return 'true'::jsonb;
    else raise exception 'activity_call: % is not allowed', p_fn;
  end case;
end;
$$;
revoke all on function public.activity_call(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.activity_call(uuid, text, jsonb) to service_role;

insert into public._migrations (name) values ('p159-card-gifts-library') on conflict do nothing;
