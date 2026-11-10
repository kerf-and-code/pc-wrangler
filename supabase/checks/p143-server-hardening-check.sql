-- supabase/checks/p143-server-hardening-check.sql (2026-11-10)
-- Read-only. Run after supabase/migrations/p143-server-hardening.sql.

-- 1. Expect four trues.
select
  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'vtt_ingest_keys') as roll_keys_table,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'tool_render_reserve') as render_reserve_fn,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'claim_by_discord'
             and pg_get_functiondef(p.oid) like '%p143 (audit B6)%') as claim_fix,
  not exists (select 1 from pg_policies
               where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
                 and lower(regexp_replace(coalesce(qual, ''), '\s', '', 'g')) in (
                       '(bucket_id=''campaign-maps''::text)', 'bucket_id=''campaign-maps''::text',
                       '(bucket_id=''campaign-maps'')', 'bucket_id=''campaign-maps''')) as maps_not_listable;

-- 2. Every policy left on storage.objects that mentions campaign-maps. Each should be scoped to a
--    writer (a GM, a character's owner, a codex owner), none with a bare bucket check.
select policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and (coalesce(qual, '') ilike '%campaign-maps%' or coalesce(with_check, '') ilike '%campaign-maps%')
 order by policyname;

-- 3. The bucket itself stays public, so files still open by link. Expect public = true.
select id, public from storage.buckets where id = 'campaign-maps';

-- 4. Context for B6: how many reveals there are, and how many have no campaign (those never move).
select count(*) as reveals, count(*) filter (where campaign_id is null) as reveals_without_campaign
  from public.disposition_reveals;

-- 5. The free map render log must number its own rows (tool_render_reserve inserts without an id).
--    Expect is_identity YES or a nextval default.
select is_identity, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'tool_render_log' and column_name = 'id';
