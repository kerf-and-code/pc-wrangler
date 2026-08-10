-- p42-lore-backup.sql
-- Change 3 safety net. The retro pass deletes sentence-titled lore entries and retitles others, so
-- before that route exists this preserves a full, restorable copy of every current lore entry.
--
-- Idempotent in three ways: the table is created only if absent, RLS is enabled (harmless to
-- re-assert), and the snapshot inserts only when the backup is still empty, so re-running never
-- double-snapshots or disturbs the pristine copy.

create table if not exists public.lore_backup (
  backup_id    uuid primary key default gen_random_uuid(),
  entry_id     uuid not null,
  campaign_id  uuid,
  type         text,
  title        text,
  body         text,
  visibility   text,
  created_by   uuid,
  tags         text[],
  is_public    boolean,
  slug         text,
  image_url    text,
  backed_up_at timestamptz not null default now(),
  reason       text
);

-- A brand-new public table is exposed through the API. Enable RLS with NO policies so the anon and
-- authenticated keys cannot touch it: only the service role (this SQL editor, and the admin client
-- the routes use) bypasses RLS and can read or restore from it. Without this the backup would be
-- world-readable, which is the opposite of a safe place to keep originals.
alter table public.lore_backup enable row level security;

-- One-time snapshot of every lore entry exactly as it stands now. The NOT EXISTS guard makes the
-- whole INSERT a no-op once the table has any rows, so this file is safe to run again.
insert into public.lore_backup
  (entry_id, campaign_id, type, title, body, visibility, created_by, tags, is_public, slug, image_url, reason)
select e.id, e.campaign_id, e.type, e.title, e.body, e.visibility, e.created_by, e.tags, e.is_public, e.slug, e.image_url,
       'pre-change-3 snapshot'
from public.entries e
where e.type = 'lore'
  and not exists (select 1 from public.lore_backup);
