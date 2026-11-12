-- p166-spend-and-rate-limits.sql (2026-11-12, push 42: audit round 2, T12 and T22)
--
--   T12  ai_map_renders.kind gains 'recap', 'journal' and 'import', so writing a recap, building the
--        campaign journal and importing notes each get a daily allowance per GM (lib/ai-allowance.ts),
--        the same way map renders and questions already do. Those were the largest AI spends with no cap.
--   T22  rate_hit(bucket, key, max, window): a small counter the public routes use to slow a script
--        down: the contact form, the pilot application and the Discord Activity sign-in, per address
--        and in total per day. Rows older than two days are pruned as it goes.
--
-- Idempotent. Hand-run in the Supabase SQL editor BEFORE deploying push 42 (the recap, journal and
-- import routes write the new kinds). Check: supabase\checks\p166-spend-and-rate-limits-check.sql

alter table public.ai_map_renders drop constraint if exists ai_map_renders_kind_check;
alter table public.ai_map_renders add constraint ai_map_renders_kind_check
  check (kind = any (array['world'::text, 'battle'::text, 'trace'::text, 'ask'::text,
                           'recap'::text, 'journal'::text, 'import'::text]));

create table if not exists public.rate_hits (
  id     bigserial primary key,
  bucket text not null,
  key    text not null,
  at     timestamptz not null default now()
);
create index if not exists rate_hits_bucket_key_at_idx on public.rate_hits (bucket, key, at);
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;

-- Counts hits in this bucket for this key within the window; if under p_max, records one and returns
-- true. Hits for one bucket are taken one at a time, so requests fired together cannot all slip under.
create or replace function public.rate_hit(p_bucket text, p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_key text := coalesce(nullif(p_key, ''), 'unknown');
begin
  perform pg_advisory_xact_lock(hashtext('public.rate_hit:' || coalesce(p_bucket, '')));
  if (select count(*) from public.rate_hits
       where bucket = p_bucket and key = v_key and at > now() - make_interval(secs => p_window_seconds)) >= p_max then
    return false;
  end if;
  insert into public.rate_hits (bucket, key) values (p_bucket, v_key);
  if random() < 0.02 then delete from public.rate_hits where at < now() - interval '2 days'; end if;
  return true;
end;
$$;
revoke all on function public.rate_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, text, integer, integer) to service_role;

insert into public._migrations (name) values ('p166-spend-and-rate-limits') on conflict do nothing;
