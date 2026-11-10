-- supabase/checks/p141-tabletop-system-check.sql (2026-11-09)
-- Read-only. Run after p141.

-- 1. Signed-in users can call it. Expect true.
select has_function_privilege('authenticated', 'public.tabletop_system(uuid)', 'execute') as can_call;

-- 2. The systems campaigns use (audit U25 asked for this): "5.5e" rows are shown as D&D 2024 now.
select system, count(*) from public.campaigns group by system order by 2 desc;
