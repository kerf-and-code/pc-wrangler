-- supabase/checks/p140-campaign-handover-export-check.sql (2026-11-09)
-- Read-only. Run after p140.

-- 1. The pieces are in place. Expect all true.
select to_regclass('public.campaign_transfers') is not null as transfers_table,
       has_function_privilege('authenticated', 'public.accept_campaign_transfer(text)', 'execute') as can_accept,
       exists (select 1 from storage.buckets where id = 'campaign-exports' and not public) as private_export_bucket;

-- 2. Handover offers by state (no emails).
select case when accepted_at is not null then 'accepted' when cancelled_at is not null then 'cancelled'
            when expires_at <= now() then 'expired' else 'open' end as state, count(*)
  from public.campaign_transfers group by 1 order by 1;
