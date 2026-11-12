-- p160-roll20-capture.sql (2026-11-11, push 38: rolls made in Roll20)
--
-- Roll20 rolls reach Six Axes through the Six Axes Capture extension, which reads them from the Roll20
-- chat (Roll20's own scripting cannot send anything out, and needs a Pro subscription). Every player at
-- the table who has the extension sees every roll in that chat, so the same roll can arrive several
-- times. Each Roll20 chat message has its own id; it is stored here and a second copy is ignored.
--
--   vtt_events.external_id    the id the roll had where it was made (a Roll20 chat message id).
--                             Empty for every older source, which keeps working unchanged.
--   vtt_events_external_uniq  one row per (campaign, source, external id). Rows with no external id
--                             never collide (unique indexes treat empty values as all different).
--
-- Idempotent. Hand-run in the Supabase SQL editor. Check: supabase\checks\p160-roll20-capture-check.sql

alter table public.vtt_events add column if not exists external_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vtt_events_external_id_len') then
    alter table public.vtt_events add constraint vtt_events_external_id_len check (external_id is null or char_length(external_id) between 1 and 100);
  end if;
end;
$$;

create unique index if not exists vtt_events_external_uniq on public.vtt_events (campaign_id, source, external_id);

insert into public._migrations (name) values ('p160-roll20-capture') on conflict do nothing;
