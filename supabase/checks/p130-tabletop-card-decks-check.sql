-- supabase/checks/p130-tabletop-card-decks-check.sql (2026-11-09)
-- Read-only. Run after p130.

-- 1. The two tables, GM only. Expect two rows, rls_on true, policies "vtt_cards_gm ALL" and "vtt_decks_gm ALL".
select c.relname as table_name, c.relrowsecurity as rls_on,
       (select string_agg(policyname || ' ' || cmd, ', ') from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('vtt_decks', 'vtt_cards')
 order by 1;

-- 2. The functions. Expect definer true and anon false for all ten. authenticated true for the five
--    the table calls (tabletop_cards, tabletop_card_move, tabletop_deck_deal, tabletop_deck_draw,
--    tabletop_deck_shuffle) and false for the five helpers (tabletop_card_json is not a definer: expect
--    definer false for it).
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('tabletop_cards', 'tabletop_card_move', 'tabletop_deck_deal', 'tabletop_deck_draw', 'tabletop_deck_shuffle',
                     'tabletop_card_seat', 'tabletop_seat_name', 'tabletop_card_say', 'tabletop_card_json', 'tabletop_cards_to_hand')
 order by 4 desc, 1;

-- 3. Decks and cards so far (none until the GM makes a deck).
select (select count(*) from public.vtt_decks) as decks, (select count(*) from public.vtt_cards) as cards;
