-- p159-card-gifts-library-check.sql (2026-11-11, push 35). Read-only. Run after p159-card-gifts-library.sql.

-- 1. The new column, the library table and its policy, and the ledger row.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'vtt_cards' and column_name = 'given_by';
select tablename, policyname from pg_policies where schemaname = 'public' and tablename = 'gm_card_decks';
select count(*) as ledger from public._migrations where name = 'p159-card-gifts-library';

-- 2. The functions, with who may call them (tabletop_card_use: authenticated; activity_call: service_role).
select p.proname, array_to_string(p.proacl, ', ') as grants
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('tabletop_card_use', 'tabletop_card_move', 'tabletop_cards_to_hand', 'activity_call')
 order by 1;

-- 3. activity_call now allows the cards (expect true).
select pg_get_functiondef('public.activity_call(uuid, text, jsonb)'::regprocedure) like '%tabletop_card_use%' as activity_allows_cards;

-- 4. Library decks per GM, and decks at tables today.
select count(*) as library_decks, count(distinct owner) as gms_with_a_library from public.gm_card_decks;
select count(*) as table_decks from public.vtt_decks;
