-- supabase/migrations/p146-ops-reliability.sql (2026-11-10)
--
-- Push 10, audits T6 and L-T3: nothing recorded which migrations had run, so whether one applied (after
-- a dashboard network error, say) could only be worked out by reading the schema, and re-running an old
-- file could quietly put back an older function or view.
--
-- public._migrations is the ledger. From now on every migration ends with
--   insert into public._migrations (name) values ('<file name without .sql>') on conflict do nothing;
-- and supabase/checks/migration-ledger-check.sql lists what is recorded. supabase/migrations/README.md
-- says how to write one.
--
-- Backfill: only the migrations known to have run (p134 to p145, the audit rounds, each confirmed by
-- its check). Older ones are not guessed at; record them by hand if you ever confirm one.
--
-- Also re-asserts security_invoker on the four views p3-security-fixes.sql set it on. Re-running the
-- unnumbered audio-retention-60d.sql would have dropped it (and let signed-in users read the retention
-- view past RLS); that file now refuses to run, and this puts the setting back if it was ever lost.
--
-- T25: D&D Beyond, sheet and spoken rolls (vtt_events) reached an open table only through a feed poll
-- every 6 seconds per tab, because nothing announced them. A trigger now announces each batch on the
-- table's live channel ('feed', on both the private channel and the public fallback), so the table
-- fetches at once and can poll slowly (TabletopClient) while the live channel is up. The announcement
-- carries nothing but the campaign's topic; the table still reads the rows through tabletop_feed and its
-- permission checks. If realtime.send is not available the trigger is not created and tables keep the
-- fast poll; a failed announcement never fails the insert.
--
-- Idempotent. Run by hand after p145, then supabase/checks/migration-ledger-check.sql.

create table if not exists public._migrations (
  name       text primary key,
  applied_at timestamptz not null default now(),
  note       text
);
alter table public._migrations enable row level security;
revoke all on table public._migrations from anon, authenticated;
grant select, insert on table public._migrations to service_role;

insert into public._migrations (name, note) values
  ('p134-audit-open-session-recap-sends', 'backfilled by p146'),
  ('p135-audit-claims-ai-caps', 'backfilled by p146'),
  ('p136-audit-same-campaign', 'backfilled by p146'),
  ('p137-consent-withdrawal', 'backfilled by p146'),
  ('p138-email-and-times', 'backfilled by p146'),
  ('p139-campaign-trash', 'backfilled by p146'),
  ('p140-campaign-handover-export', 'backfilled by p146'),
  ('p141-tabletop-system', 'backfilled by p146'),
  ('p142-tabletop-trust', 'backfilled by p146'),
  ('p143-server-hardening', 'backfilled by p146'),
  ('p144-consent-and-audio', 'backfilled by p146'),
  ('p145-data-rights-legal', 'backfilled by p146')
on conflict (name) do nothing;

do $v$
declare
  v text;
begin
  foreach v in array array['v_audio_due_for_purge', 'v_campaign_audio_retention', 'v_session_spotlight', 'v_session_equity'] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = true)', v);
    end if;
  end loop;
end
$v$;

-- ------------------------------------------------------------------------------------------- T25
create or replace function public.tabletop_feed_signal()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_c uuid;
begin
  for v_c in select distinct campaign_id from new_rows where campaign_id is not null loop
    begin
      perform realtime.send('{}'::jsonb, 'feed', 'tabletop:' || v_c::text, true);
      perform realtime.send('{}'::jsonb, 'feed', 'tabletop:' || v_c::text, false);
    exception when others then
      null; -- a missed announcement only means the table picks the roll up on its next poll
    end;
  end loop;
  return null;
end;
$function$;
revoke all on function public.tabletop_feed_signal() from public, anon, authenticated;

do $t25$ begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    drop trigger if exists vtt_events_feed_signal on public.vtt_events;
    create trigger vtt_events_feed_signal
      after insert on public.vtt_events
      referencing new table as new_rows
      for each statement execute function public.tabletop_feed_signal();
  else
    raise notice 'p146: realtime.send not found, so no feed trigger; tables keep the fast poll';
  end if;
end $t25$;

insert into public._migrations (name) values ('p146-ops-reliability') on conflict do nothing;
