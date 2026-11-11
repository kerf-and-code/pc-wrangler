-- p156-codex-theme-check.sql (2026-11-11, push 32). Read-only. Run after p156-codex-theme.sql.

-- 1. The column, the constraint, the function and the ledger row.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'campaigns' and column_name = 'codex_theme') as theme_column,
       (select count(*) from pg_constraint where conname = 'campaigns_codex_theme_check') as constraint_present,
       to_regprocedure('public.public_campaign_theme(text)') as theme_fn,
       (select array_to_string(proacl, ', ') from pg_proc where proname = 'public_campaign_theme') as grants,
       (select count(*) from public._migrations where name = 'p156-codex-theme') as ledger;

-- 2. Published codexes and the look each one wears (null is the original gold).
select name, public_slug, codex_theme
  from public.campaigns
 where public_published_at is not null
 order by name;
