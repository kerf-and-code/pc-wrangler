-- supabase/migrations/p130-tabletop-card-decks.sql (2026-11-09)
--
-- Phase 6a: card decks at the tabletop (gap 11 in the tabletop audit doc).
--
--   vtt_decks   a deck in a campaign: a standard deck of playing cards or the GM's own cards (a name and
--               a line of text each), a back colour, and whether players may draw from it.
--   vtt_cards   every card and where it is: the draw pile (in order, top first), someone's hand, the
--               table (face up or down), or the discard pile.
--   Both are GM only by row level security. Players never read them: the draw pile's order and other
--   people's hands stay on the server. Players see the table through tabletop_cards and act through
--   the functions below, which also say what happened in chat (as an emote: "draws a card from Tarot").
--
--   tabletop_cards        for the caller: each deck with its counts and the top discard, the cards on
--                         the table (face down ones without their face, unless the caller played it or
--                         is the GM), the caller's own hand, how many cards each person holds, and, for
--                         the GM, every hand's faces.
--   tabletop_deck_draw    draw 1 to 10 cards from the top into your own hand (players only when the deck
--                         allows it).
--   tabletop_deck_deal    the GM deals 1 to 10 cards to someone at the table.
--   tabletop_card_move    play a card from your hand to the table (face up or down), flip it, discard
--                         it, take it back, or pass it to someone at the table. The GM can move any card,
--                         and put one back on top of its deck.
--   tabletop_deck_shuffle the GM shuffles the discards back in, or gathers every card and shuffles.
--   Shuffles order by gen_random_uuid(), which draws on the server's strong random source.
--
-- Idempotent. Run by hand after p129, then supabase/checks/p130-tabletop-card-decks-check.sql.

create table if not exists public.vtt_decks (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 60),
  kind          text not null default 'custom' check (kind in ('standard', 'custom')),
  back_color    text not null default '#7a2e2e' check (back_color ~ '^#[0-9a-fA-F]{6}$'),
  players_draw  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists vtt_decks_campaign_idx on public.vtt_decks (campaign_id);

create table if not exists public.vtt_cards (
  id           uuid primary key default gen_random_uuid(),
  deck_id      uuid not null references public.vtt_decks(id) on delete cascade,
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 80),
  body         text not null default '' check (char_length(body) <= 600),
  suit         text check (suit in ('hearts', 'diamonds', 'clubs', 'spades', 'joker')),
  rank         text check (rank ~ '^(A|[2-9]|10|J|Q|K|R|B)$'),
  pile         text not null default 'draw' check (pile in ('draw', 'hand', 'table', 'discard')),
  holder       uuid references public.profiles(id) on delete set null,
  face_up      boolean not null default false,
  played_by    uuid references public.profiles(id) on delete set null,
  ord          integer not null default 0,
  moved_at     timestamptz not null default now()
);
create index if not exists vtt_cards_deck_idx on public.vtt_cards (deck_id, pile, ord);
create index if not exists vtt_cards_campaign_idx on public.vtt_cards (campaign_id, pile, holder);

alter table public.vtt_decks enable row level security;
alter table public.vtt_cards enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_decks' and policyname = 'vtt_decks_gm') then
    create policy vtt_decks_gm on public.vtt_decks
      for all using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
  end if;
  -- a card's campaign must be its deck's campaign
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vtt_cards' and policyname = 'vtt_cards_gm') then
    create policy vtt_cards_gm on public.vtt_cards
      for all using (public.is_campaign_gm(campaign_id))
      with check (public.is_campaign_gm(campaign_id)
                  and exists (select 1 from public.vtt_decks d where d.id = deck_id and d.campaign_id = vtt_cards.campaign_id));
  end if;
end;
$$;
revoke all on public.vtt_decks from anon;
revoke all on public.vtt_cards from anon;
grant select, insert, update, delete on public.vtt_decks to authenticated;
grant select, insert, update, delete on public.vtt_cards to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- internal helpers (no one calls these directly)

-- someone at this table: the GM, or the owner of a pc in the campaign
create or replace function public.tabletop_card_seat(p_campaign uuid, p_uid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p_uid is not null and (
    p_uid = (select gm_id from public.campaigns where id = p_campaign)
    or exists (select 1 from public.characters c where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = p_uid));
$function$;
revoke all on function public.tabletop_card_seat(uuid, uuid) from public, anon, authenticated;

-- the name chat uses for someone at this table ("GM", or their character)
create or replace function public.tabletop_seat_name(p_campaign uuid, p_uid uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when p_uid = (select gm_id from public.campaigns where id = p_campaign) then 'GM'
              else coalesce((select c.name from public.characters c
                              where c.campaign_id = p_campaign and c.kind = 'pc' and c.profile_id = p_uid
                              order by c.active desc, c.name limit 1), 'someone') end;
$function$;
revoke all on function public.tabletop_seat_name(uuid, uuid) from public, anon, authenticated;

-- one line in the table's chat, from the caller, as an emote
create or replace function public.tabletop_card_say(p_campaign uuid, p_body text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  insert into public.vtt_messages (campaign_id, session_id, author_profile, kind, body)
  values (p_campaign, public.tabletop_open_session(p_campaign), auth.uid(), 'emote', left(p_body, 2000));
$function$;
revoke all on function public.tabletop_card_say(uuid, text) from public, anon, authenticated;

-- a card as the browser sees it; its face only when p_show
create or replace function public.tabletop_card_json(c public.vtt_cards, p_show boolean)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select jsonb_build_object('id', c.id, 'deckId', c.deck_id, 'pile', c.pile, 'faceUp', c.face_up,
                            'holder', c.holder, 'playedBy', c.played_by, 'shown', p_show)
      || case when p_show then jsonb_build_object('name', c.name, 'body', c.body, 'suit', c.suit, 'rank', c.rank) else '{}'::jsonb end;
$function$;
revoke all on function public.tabletop_card_json(public.vtt_cards, boolean) from public, anon, authenticated;

-- moves the top p_count cards of a deck into p_to's hand; how many moved
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
     set pile = 'hand', holder = p_to, face_up = false, played_by = null, ord = base.m + numbered.rn, moved_at = now()
    from numbered, base
   where c.id = numbered.id;
  get diagnostics v_got = row_count;
  if v_got = 0 then raise exception '% is empty: shuffle the discards back in first', v_d.name; end if;
  return v_got;
end;
$function$;
revoke all on function public.tabletop_cards_to_hand(uuid, uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
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

create or replace function public.tabletop_deck_draw(p_deck uuid, p_count integer default 1)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_d   public.vtt_decks;
  v_got integer;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_d from public.vtt_decks where id = p_deck;
  if v_d.id is null then raise exception 'deck not found'; end if;
  if not public.is_campaign_gm(v_d.campaign_id) then
    if not public.tabletop_is_player(v_d.campaign_id) then raise exception 'not at this table'; end if;
    if not v_d.players_draw then raise exception 'only the GM draws from %', v_d.name; end if;
  end if;
  v_got := public.tabletop_cards_to_hand(p_deck, v_uid, p_count);
  perform public.tabletop_card_say(v_d.campaign_id, format('draws %s from %s', case when v_got = 1 then 'a card' else v_got || ' cards' end, v_d.name));
  return v_got;
end;
$function$;
revoke all on function public.tabletop_deck_draw(uuid, integer) from public, anon;
grant execute on function public.tabletop_deck_draw(uuid, integer) to authenticated;

create or replace function public.tabletop_deck_deal(p_deck uuid, p_to uuid, p_count integer default 1)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_d   public.vtt_decks;
  v_got integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_d from public.vtt_decks where id = p_deck;
  if v_d.id is null then raise exception 'deck not found'; end if;
  if not public.is_campaign_gm(v_d.campaign_id) then raise exception 'only the GM deals'; end if;
  if not public.tabletop_card_seat(v_d.campaign_id, p_to) then raise exception 'that person is not at this table'; end if;
  v_got := public.tabletop_cards_to_hand(p_deck, p_to, p_count);
  perform public.tabletop_card_say(v_d.campaign_id, format('deals %s from %s to %s',
    case when v_got = 1 then 'a card' else v_got || ' cards' end, v_d.name, public.tabletop_seat_name(v_d.campaign_id, p_to)));
  return v_got;
end;
$function$;
revoke all on function public.tabletop_deck_deal(uuid, uuid, integer) from public, anon;
grant execute on function public.tabletop_deck_deal(uuid, uuid, integer) to authenticated;

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
    else format('passes a card to %s', public.tabletop_seat_name(v_c.campaign_id, v_to)) end;

  update public.vtt_cards
     set pile = p_to,
         holder = case when p_to = 'hand' then v_to end,
         face_up = case when p_to = 'table' then v_up when p_to = 'discard' then true else false end,
         played_by = case when p_to = 'table' then coalesce(case when v_c.pile = 'table' then v_c.played_by end, v_uid) end,
         ord = v_ord,
         moved_at = now()
   where id = p_card;
  if v_msg is not null then perform public.tabletop_card_say(v_c.campaign_id, v_msg); end if;
end;
$function$;
revoke all on function public.tabletop_card_move(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.tabletop_card_move(uuid, text, boolean, uuid) to authenticated;

create or replace function public.tabletop_deck_shuffle(p_deck uuid, p_all boolean default false)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_d public.vtt_decks;
  v_n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_d from public.vtt_decks where id = p_deck for update;
  if v_d.id is null then raise exception 'deck not found'; end if;
  if not public.is_campaign_gm(v_d.campaign_id) then raise exception 'only the GM shuffles'; end if;
  if coalesce(p_all, false) then
    update public.vtt_cards set pile = 'draw', holder = null, face_up = false, played_by = null, moved_at = now()
     where deck_id = p_deck and pile <> 'draw';
  else
    update public.vtt_cards set pile = 'draw', face_up = false, moved_at = now() where deck_id = p_deck and pile = 'discard';
  end if;
  update public.vtt_cards c set ord = s.rn
    from (select id, row_number() over (order by gen_random_uuid()) as rn from public.vtt_cards where deck_id = p_deck and pile = 'draw') s
   where c.id = s.id;
  select count(*) into v_n from public.vtt_cards where deck_id = p_deck and pile = 'draw';
  perform public.tabletop_card_say(v_d.campaign_id,
    case when coalesce(p_all, false) then format('gathers every card and shuffles %s', v_d.name) else format('shuffles %s', v_d.name) end);
  return v_n;
end;
$function$;
revoke all on function public.tabletop_deck_shuffle(uuid, boolean) from public, anon;
grant execute on function public.tabletop_deck_shuffle(uuid, boolean) to authenticated;
