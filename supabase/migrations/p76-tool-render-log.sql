-- p76-tool-render-log.sql
-- Metering for the free, no-login AI map render (/api/tools/map-render). One row per successful render,
-- so the route can enforce a global daily ceiling and a soft per-IP daily cap. Service-role only: no
-- client ever reads or writes this, so RLS is enabled with NO policies (the anon/auth roles get nothing;
-- the service role bypasses RLS). Idempotent; run by hand.

create table if not exists public.tool_render_log (
  id         bigint generated always as identity primary key,
  tool       text not null default 'map-render',
  ip         text,
  created_at timestamptz not null default now()
);

create index if not exists tool_render_log_created_idx on public.tool_render_log (created_at);
create index if not exists tool_render_log_ip_created_idx on public.tool_render_log (ip, created_at);

alter table public.tool_render_log enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) touches this table.
