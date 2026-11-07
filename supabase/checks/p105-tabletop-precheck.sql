-- p105-tabletop-precheck.sql: READ-ONLY. Run in the Supabase SQL editor before the tabletop migration
-- (p105) is written. Each query answers one thing the migration would otherwise have to guess.
-- Paste every result back. Nothing here writes.

-- 1. Columns of every table the tabletop reads or links to.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('campaigns', 'sessions', 'characters', 'stat_blocks', 'vtt_events', 'combats',
                     'battle_maps', 'memberships', 'profiles', 'capture_jobs', 'chat_messages', 'chat_grants')
order by table_name, ordinal_position;

-- 2. The helper functions the new policies would call, and the player-facing ones to mirror.
select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_campaign_gm', 'is_campaign_member', 'my_campaigns', 'combat_for_player',
                    'session_consent_ok', 'claim_by_discord',
                    'chat_context', 'chat_fetch', 'chat_post', 'chat_grant', 'chat_grant_revoke', 'chat_grants_mine');

-- 3. Existing RLS policies on the tables the tabletop touches.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('characters', 'sessions', 'vtt_events', 'combats', 'battle_maps', 'stat_blocks', 'campaigns',
                    'chat_messages', 'chat_grants')
order by tablename, policyname;

-- 4. Which tables Realtime already publishes (the tabletop adds its own).
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename;

-- 5. How an OPEN session is marked: the latest sessions per campaign for your demo campaign.
select *
from public.sessions
where campaign_id = '8ceb1857-5656-4652-b94c-c08f8c364f1f'
order by created_at desc
limit 3;

-- 6. Where table rolls would go: the sources already in vtt_events and how many rows each has.
select source, fidelity, count(*) as n, max(rolled_at) as latest
from public.vtt_events
group by source, fidelity
order by n desc;

-- 7. Storage buckets (token images need a home; is campaign-maps public?).
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

-- 8. Did p104 run? (expect one row with rls = true)
select c.relname, c.relrowsecurity as rls from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'battle_maps';

-- 9. How the party chat is used today (does the tabletop chat join it or sit beside it?).
select count(*) as messages, count(distinct author_profile) as authors, max(created_at) as latest from public.chat_messages;

-- 10. The tabletop's table names are free (expect zero rows).
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('vtt_scenes', 'vtt_tokens', 'vtt_messages');
