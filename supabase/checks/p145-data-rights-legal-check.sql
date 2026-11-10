-- supabase/checks/p145-data-rights-legal-check.sql (2026-11-10)
-- Read-only. Run after supabase/migrations/p145-data-rights-legal.sql.

-- 1. Expect six trues.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'terms_accepted_at') as terms_columns,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'accept_terms') as accept_terms_fn,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'sync_my_email') as sync_email_fn,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'export_my_data' and pg_get_functiondef(p.oid) like '%character_pages%') as export_updated,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'delete_my_account' and pg_get_functiondef(p.oid) like '%map_paths%') as delete_updated,
  exists (select 1 from storage.buckets where id = 'campaign-maps' and 'image/*' = any (allowed_mime_types)) as maps_types_limited;

-- 2. The campaign-maps bucket. Expect public true, 62914560, {image/*,audio/*}.
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'campaign-maps';

-- 3. Files already in campaign-maps that are NOT an image or audio (they stay; new ones of these types
--    are refused). Expect 0 rows, or a short list worth a look.
select metadata ->> 'mimetype' as mimetype, count(*) as files
  from storage.objects
 where bucket_id = 'campaign-maps'
   and coalesce(metadata ->> 'mimetype', '') !~ '^(image|audio)/'
 group by 1 order by 2 desc;

-- 4. How many accounts will be asked to accept the terms on their next visit (signed-in, not guests).
select count(*) filter (where terms_accepted_at is null) as to_ask, count(*) as accounts
  from public.profiles where not is_anonymous;
