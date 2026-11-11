-- p156-codex-theme.sql (2026-11-11, push 32, audit P11: themes for the published codex)
--
-- A GM picks a look for their public codex (/c/[slug]) from a short curated list (lib/codex-themes.ts).
--
--   campaigns.codex_theme          the theme's key; null is the original gold look ("forge")
--   public_campaign_theme(slug)    what the public page reads, for a published campaign only
--
-- A function of its own rather than another column on public_campaign(): that function's shape is
-- what the live page depends on, and changing a RETURNS TABLE means dropping and recreating it. This
-- adds nothing to it. GMs already update their campaign row under the existing policy.
--
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p156-codex-theme-check.sql

alter table public.campaigns add column if not exists codex_theme text;

alter table public.campaigns drop constraint if exists campaigns_codex_theme_check;
alter table public.campaigns add constraint campaigns_codex_theme_check
  check (codex_theme is null or codex_theme in ('forge', 'frost', 'verdant', 'crimson', 'arcane'));

create or replace function public.public_campaign_theme(p_slug text)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select c.codex_theme
  from public.campaigns c
  where c.public_slug = p_slug and c.public_published_at is not null
  limit 1;
$$;

revoke all on function public.public_campaign_theme(text) from public;
grant execute on function public.public_campaign_theme(text) to anon, authenticated;

insert into public._migrations (name) values ('p156-codex-theme') on conflict do nothing;
