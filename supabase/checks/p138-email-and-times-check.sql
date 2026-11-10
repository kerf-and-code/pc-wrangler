-- supabase/checks/p138-email-and-times-check.sql (2026-11-09)
-- Read-only. Run after p138.

-- 1. The new columns and table are there. Expect all true.
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'campaigns' and column_name = 'time_zone') as campaign_time_zone,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'discord_recap_post') as recap_post_ids,
       to_regclass('public.email_prefs') is not null as email_prefs,
       has_function_privilege('authenticated', 'public.set_my_email_prefs(boolean, boolean)', 'execute') as players_can_set;

-- 2. Campaigns still without a time zone. Each fills in the next time its GM opens the GM workspace;
--    until then its reminders print the time in UTC, labelled as such.
select count(*) filter (where time_zone is null) as without_time_zone, count(*) as campaigns from public.campaigns;

-- 3. Opt-outs so far (counts only).
select count(*) filter (where not reminders) as reminders_off, count(*) filter (where not recaps) as recaps_off from public.email_prefs;
