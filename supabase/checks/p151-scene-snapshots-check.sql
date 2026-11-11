-- p151-scene-snapshots-check.sql (2026-11-10, push 25). Read-only. Run after p151-scene-snapshots.sql.

-- 1. The table, the functions and the ledger row.
select to_regclass('public.scene_snapshots') as snapshots_table,
       to_regprocedure('public.snapshot_scene(uuid,text)') as snapshot_scene,
       to_regprocedure('public.restore_scene_snapshot(uuid)') as restore,
       to_regprocedure('public.snapshot_campaign_scenes_at_close(uuid,uuid)') as at_close,
       (select count(*) from public._migrations where name = 'p151-scene-snapshots') as ledger;

-- 2. Who may call what: the close-time function for the service role only.
select p.proname, array_to_string(p.proacl, ', ') as grants
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('snapshot_scene', 'scene_snapshots_for', 'restore_scene_snapshot',
                                               'snapshot_campaign_scenes_at_close', 'scene_snapshot_take')
 order by 1;

-- 3. Snapshots so far, per campaign, and how big they are.
select c.name as campaign, count(*) as snapshots, pg_size_pretty(sum(pg_column_size(s.data))::bigint) as size, max(s.taken_at) as newest
  from public.scene_snapshots s join public.campaigns c on c.id = s.campaign_id
 group by c.name order by newest desc;
