-- supabase/checks/p170-data-follows-the-campaign-check.sql (push 48). Read only. Every row should say ok.

select 'migration recorded' as what,
       case when exists (select 1 from public._migrations where name = 'p170-data-follows-the-campaign') then 'ok' else 'MISSING' end as result
union all
select 'addon_hooks_prune, server only',
       case when to_regprocedure('public.addon_hooks_prune(uuid)') is null then 'MISSING'
            when has_function_privilege('authenticated', 'public.addon_hooks_prune(uuid)', 'execute') then 'OPEN' else 'ok' end
union all
select 'prune_growing_tables, server only',
       case when to_regprocedure('public.prune_growing_tables()') is null then 'MISSING'
            when has_function_privilege('authenticated', 'public.prune_growing_tables()', 'execute') then 'OPEN' else 'ok' end
union all
select 'webhook triggers on memberships and campaigns',
       case when (select count(*) from pg_trigger where tgname in ('addon_hooks_follow_gms', 'addon_hooks_follow_owner') and not tgisinternal) = 2 then 'ok' else 'MISSING' end
union all
select 'players no longer read stat blocks',
       case when exists (select 1 from pg_policy where polrelid = 'public.stat_blocks'::regclass and polname = 'members read pinned stat blocks') then 'STILL THERE' else 'ok' end
union all
select 'enabled webhooks whose maker is not a GM',
       case when exists (select 1 from public.addon_hooks h where h.enabled
                          and (h.created_by is null or not public.campaign_gm_of(h.campaign_id, h.created_by))) then 'FOUND' else 'ok' end
union all
select 'open co-GM invites on campaigns handed over',
       case when exists (select 1 from public.campaign_gm_invites i join public.campaign_transfers t on t.campaign_id = i.campaign_id
                          where t.accepted_at is not null and i.created_at < t.accepted_at
                            and i.accepted_at is null and i.revoked_at is null) then 'FOUND' else 'ok' end;

-- library stat blocks still shared by several campaigns (left in the library on purpose)
select count(*) as library_blocks_left from public.stat_blocks where campaign_id is null;

-- what the daily prune would remove today (nothing is removed by this query)
select 'rate_hits older than 2 days' as what, count(*) from public.rate_hits where at < now() - interval '2 days'
union all
select 'notifications read 90+ days ago', count(*) from public.notifications where read_at < now() - interval '90 days';
