-- supabase/checks/storage-orphans-check.sql (2026-11-09)
-- Read-only. Audit T7: files that campaigns deleted before 2026-11-09 left behind in storage.
-- Campaign files live under <campaign id>/ in these three buckets, so a top-level folder that looks like
-- a campaign id but matches no campaign is a leftover. (custom-tiles/<user id>/ in campaign-maps is per
-- GM, not per campaign, and is not counted.) Deleting rows from storage.objects in SQL does NOT delete
-- the files, so do not "fix" anything here: send me the numbers and I will write the cleanup.

-- 1. Leftover files by bucket. Expect zero rows, or tell me the counts.
select o.bucket_id, count(*) as files, pg_size_pretty(sum(coalesce((o.metadata ->> 'size')::bigint, 0))) as size,
       count(distinct split_part(o.name, '/', 1)) as deleted_campaigns
  from storage.objects o
 where o.bucket_id in ('session-audio', 'campaign-maps', 'table-files')
   and split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and not exists (select 1 from public.campaigns c where c.id::text = split_part(o.name, '/', 1))
 group by o.bucket_id order by o.bucket_id;

-- 2. Voice recordings no row points at (the retention job can never delete these). Expect 0.
select count(*) as unreferenced_recordings
  from storage.objects o
 where o.bucket_id = 'session-audio'
   and not exists (select 1 from public.audio_tracks t where t.storage_path = o.name);
