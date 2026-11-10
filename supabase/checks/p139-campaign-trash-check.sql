-- supabase/checks/p139-campaign-trash-check.sql (2026-11-09)
-- Read-only. Run after p139.

-- 1. The pieces are in place. Expect all true.
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'campaigns' and column_name = 'deleted_at') as deleted_at_column,
       position('deleted_at is null' in lower((select qual from pg_policies where schemaname = 'public' and tablename = 'campaigns' and policyname = 'members read campaigns'))) > 0 as read_policy_hides_trash,
       position('deleted_at is not null' in pg_get_functiondef('public.is_campaign_member(uuid)'::regprocedure)) > 0 as members_check_trash,
       has_function_privilege('authenticated', 'public.restore_campaign(uuid)', 'execute') as gms_can_restore;

-- 2. Campaigns in the trash and when each will be erased (no names).
select id, deleted_at, deleted_at + interval '30 days' as erase_at from public.campaigns where deleted_at is not null order by deleted_at;
