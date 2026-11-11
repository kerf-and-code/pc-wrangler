-- p150-notifications.sql (2026-11-10, push 19)
--
-- In-app notifications (the bell) and an optional daily email digest. Terry's calls (2026-11-10): the
-- digest is off until a person turns it on; notify on all four groups of events:
--   players  a session is scheduled, moved or cancelled; a recap is sent out
--   GMs      a player answers an RSVP or joins with a character; a recording is ready to review or its
--            processing failed; a co-GM accepts an invite or steps down (and a removed co-GM is told)
--
-- What this does:
--   1. notifications: one row per person per event. RLS: a person reads, marks read and deletes only their
--      own rows; nobody inserts from the browser. Repeat events with the same key (an RSVP changed twice,
--      a session moved again) update the row and mark it unread instead of piling up.
--   2. email_prefs.digest (default false), my_email_prefs() now returns it, set_my_email_digest().
--   3. notify() and the recipient helpers, and triggers on sessions, recap_sends, attendance, characters,
--      capture_jobs and memberships. The person who caused an event is never notified about it. A trigger
--      that fails only logs a warning: it can never block the change it watches.
--   4. digest_batch() for the daily digest job (service role only).
--   5. RSVPs: rsvp_for_share writes going, maybe or declined into attendance.status, but the base schema's
--      attendance_status_check allows only present, absent, late and partial. If the live constraint is
--      that one, every RSVP fails. The check file shows which it is; this widens the constraint to allow
--      both sets only when 'going' is missing. Widening a check cannot break an existing row.
--
-- Idempotent throughout. Run supabase\checks\p150-notifications-check.sql before and after.

-- 1. -------------------------------------------------------------------------------------------------
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  kind        text not null check (kind in ('session_scheduled', 'session_moved', 'session_cancelled', 'recap_sent',
                                            'rsvp', 'player_joined', 'review_ready', 'processing_failed',
                                            'cogm_joined', 'cogm_left', 'cogm_removed')),
  title       text not null check (char_length(title) <= 300),
  link        text check (link is null or (char_length(link) <= 500 and link like '/%')),
  data        jsonb not null default '{}'::jsonb,
  dedupe_key  text not null check (char_length(dedupe_key) <= 200),
  actor_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  emailed_at  timestamptz,
  unique (profile_id, dedupe_key)
);
create index if not exists notifications_profile_idx on public.notifications (profile_id, created_at desc);
create index if not exists notifications_digest_idx on public.notifications (created_at) where read_at is null and emailed_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
drop policy if exists "own notifications read" on public.notifications;
create policy "own notifications read" on public.notifications for select to authenticated using (profile_id = auth.uid());
drop policy if exists "own notifications mark" on public.notifications;
create policy "own notifications mark" on public.notifications for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists "own notifications delete" on public.notifications;
create policy "own notifications delete" on public.notifications for delete to authenticated using (profile_id = auth.uid());

-- 2. -------------------------------------------------------------------------------------------------
alter table public.email_prefs add column if not exists digest boolean not null default false;

create or replace function public.my_email_prefs()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
           'email', u.email,
           'reminders', coalesce(p.reminders, true),
           'recaps', coalesce(p.recaps, true),
           'digest', coalesce(p.digest, false))
    from auth.users u
    left join public.email_prefs p on p.email = lower(u.email)
   where u.id = auth.uid() and u.email is not null;
$function$;

create or replace function public.set_my_email_digest(p_on boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_email text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then raise exception 'your account has no email address'; end if;
  insert into public.email_prefs (email, digest, updated_at) values (v_email, coalesce(p_on, false), now())
  on conflict (email) do update set digest = excluded.digest, updated_at = now();
end;
$function$;
revoke all on function public.set_my_email_digest(boolean) from public, anon;
grant execute on function public.set_my_email_digest(boolean) to authenticated;

-- 3. -------------------------------------------------------------------------------------------------
-- Everyone who runs the campaign: the owner and active GM or co-GM memberships.
create or replace function public.campaign_gm_ids(p_campaign uuid)
returns uuid[]
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select c.gm_id as x from public.campaigns c where c.id = p_campaign
    union
    select m.profile_id from public.memberships m
     where m.campaign_id = p_campaign and m.role in ('gm', 'co-gm') and m.active) g
  where x is not null;
$$;

-- The players: owners of active player characters, minus anyone who runs the campaign.
create or replace function public.campaign_player_ids(p_campaign uuid)
returns uuid[]
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(distinct ch.profile_id), '{}')
    from public.characters ch
   where ch.campaign_id = p_campaign and ch.kind = 'pc' and coalesce(ch.active, true)
     and ch.profile_id is not null
     and not (ch.profile_id = any (public.campaign_gm_ids(p_campaign)));
$$;

create or replace function public.notify(p_to uuid[], p_campaign uuid, p_kind text, p_title text, p_link text,
                                         p_data jsonb, p_key text, p_actor uuid)
returns void
language sql security definer
set search_path to 'public'
as $$
  insert into public.notifications (profile_id, campaign_id, kind, title, link, data, dedupe_key, actor_id)
  select distinct t, p_campaign, p_kind, left(p_title, 300), p_link, coalesce(p_data, '{}'::jsonb), left(p_key, 200), p_actor
    from unnest(coalesce(p_to, '{}'::uuid[])) t
   where t is not null and t is distinct from p_actor
     and exists (select 1 from public.profiles pr where pr.id = t)
  on conflict (profile_id, dedupe_key) do update
    set kind = excluded.kind, title = excluded.title, link = excluded.link, data = excluded.data,
        actor_id = excluded.actor_id, created_at = now(), read_at = null, emailed_at = null;
$$;

revoke all on function public.campaign_gm_ids(uuid)     from public, anon, authenticated;
revoke all on function public.campaign_player_ids(uuid) from public, anon, authenticated;
revoke all on function public.notify(uuid[], uuid, text, text, text, jsonb, text, uuid) from public, anon, authenticated;

-- "Session 4" or "a session"
create or replace function public.notify_session_label(p_number integer)
returns text language sql immutable as $$
  select case when p_number is null then 'a session' else 'Session ' || p_number end;
$$;

-- sessions: scheduled, moved, cancelled -> players
create or replace function public.notify_on_session()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_c    public.campaigns;
  v_kind text;
  v_what text;
  v_link text;
begin
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  if tg_op = 'INSERT' then
    if new.scheduled_at is null or new.status <> 'scheduled' or new.scheduled_at < now() then return null; end if;
    v_kind := 'session_scheduled'; v_what := 'is scheduled';
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_kind := 'session_cancelled'; v_what := 'is cancelled';
  elsif new.status = 'scheduled' and new.scheduled_at is not null and new.scheduled_at >= now()
        and new.scheduled_at is distinct from old.scheduled_at then
    v_kind := case when old.scheduled_at is null then 'session_scheduled' else 'session_moved' end;
    v_what := case when old.scheduled_at is null then 'is scheduled' else 'has moved' end;
  else
    return null;
  end if;
  v_link := case when v_c.share_code is not null then '/schedule?share=' || v_c.share_code else '/me/campaigns' end;
  perform public.notify(public.campaign_player_ids(v_c.id), v_c.id, v_kind,
    v_c.name || ': ' || initcap(left(public.notify_session_label(new.session_number), 1)) || substr(public.notify_session_label(new.session_number), 2) || ' ' || v_what,
    v_link, jsonb_build_object('session_id', new.id, 'session_number', new.session_number, 'scheduled_at', new.scheduled_at, 'time_zone', v_c.time_zone),
    'session:' || new.id, auth.uid());
  return null;
exception when others then
  raise warning 'notify_on_session: %', sqlerrm;
  return null;
end;
$$;
drop trigger if exists notify_on_session on public.sessions;
create trigger notify_on_session after insert or update of scheduled_at, status on public.sessions
  for each row execute function public.notify_on_session();

-- recap_sends: a recap went out -> players
create or replace function public.notify_on_recap_send()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_c public.campaigns;
  v_n integer;
begin
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  select session_number into v_n from public.sessions where id = new.session_id;
  perform public.notify(public.campaign_player_ids(v_c.id), v_c.id, 'recap_sent',
    v_c.name || ': the ' || coalesce('Session ' || v_n || ' ', '') || 'recap is out',
    case when v_c.share_code is not null then '/recaps?share=' || v_c.share_code else '/me/campaigns' end,
    jsonb_build_object('session_id', new.session_id, 'session_number', v_n),
    'recap:' || new.session_id, new.sent_by);
  return null;
exception when others then
  raise warning 'notify_on_recap_send: %', sqlerrm;
  return null;
end;
$$;
do $$ begin
  if to_regclass('public.recap_sends') is not null then
    drop trigger if exists notify_on_recap_send on public.recap_sends;
    create trigger notify_on_recap_send after insert on public.recap_sends
      for each row execute function public.notify_on_recap_send();
  else
    raise notice 'p150: recap_sends missing (p134 not run?), recap notifications skipped';
  end if;
end $$;

-- attendance: an RSVP -> GMs
create or replace function public.notify_on_rsvp()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_c    public.campaigns;
  v_n    integer;
  v_who  text;
  v_verb text;
begin
  if new.status not in ('going', 'maybe', 'declined') then return null; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  select session_number into v_n from public.sessions where id = new.session_id;
  select coalesce(
           (select ch.name from public.characters ch where ch.id = new.character_id),
           (select ch.name from public.characters ch where ch.campaign_id = v_c.id and ch.kind = 'pc' and ch.profile_id = new.profile_id
             order by ch.active desc nulls last, ch.name limit 1),
           nullif(trim((select pr.display_name from public.profiles pr where pr.id = new.profile_id)), ''),
           'A player') into v_who;
  v_verb := case new.status when 'going' then ' is going to ' when 'maybe' then ' might make ' else ' can''t make ' end;
  perform public.notify(public.campaign_gm_ids(v_c.id), v_c.id, 'rsvp',
    v_c.name || ': ' || v_who || v_verb || public.notify_session_label(v_n),
    '/gm/sessions?campaign=' || v_c.id,
    jsonb_build_object('session_id', new.session_id, 'session_number', v_n, 'status', new.status),
    'rsvp:' || new.session_id || ':' || new.profile_id, new.profile_id);
  return null;
exception when others then
  raise warning 'notify_on_rsvp: %', sqlerrm;
  return null;
end;
$$;
drop trigger if exists notify_on_rsvp on public.attendance;
create trigger notify_on_rsvp after insert or update of status on public.attendance
  for each row execute function public.notify_on_rsvp();

-- characters: a player takes a character (claims one, or makes their own) -> GMs
create or replace function public.notify_on_join()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_c   public.campaigns;
  v_who text;
begin
  if new.kind <> 'pc' or new.profile_id is null or new.campaign_id is null then return null; end if;
  if tg_op = 'UPDATE' and old.profile_id is not null then return null; end if;
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  if new.profile_id = any (public.campaign_gm_ids(v_c.id)) then return null; end if;
  select coalesce(nullif(trim(pr.display_name), ''), 'A player') into v_who from public.profiles pr where pr.id = new.profile_id;
  perform public.notify(public.campaign_gm_ids(v_c.id), v_c.id, 'player_joined',
    v_c.name || ': ' || coalesce(v_who, 'A player') || ' joined as ' || new.name,
    '/gm?campaign=' || v_c.id,
    jsonb_build_object('character_id', new.id),
    'join:' || new.id, new.profile_id);
  return null;
exception when others then
  raise warning 'notify_on_join: %', sqlerrm;
  return null;
end;
$$;
drop trigger if exists notify_on_join on public.characters;
create trigger notify_on_join after insert or update of profile_id on public.characters
  for each row execute function public.notify_on_join();

-- capture_jobs: ready to review, or failed -> GMs
create or replace function public.notify_on_job()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_c public.campaigns;
  v_n integer;
begin
  if new.status is not distinct from old.status or new.status not in ('review', 'error') then return null; end if;
  select * into v_c from public.campaigns where id = new.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null then return null; end if;
  select session_number into v_n from public.sessions where id = new.session_id;
  if new.status = 'review' then
    perform public.notify(public.campaign_gm_ids(v_c.id), v_c.id, 'review_ready',
      v_c.name || ': ' || initcap(left(public.notify_session_label(v_n), 1)) || substr(public.notify_session_label(v_n), 2) || ' is ready to review',
      '/gm/review?campaign=' || v_c.id,
      jsonb_build_object('job_id', new.id, 'session_id', new.session_id, 'session_number', v_n),
      'job:' || new.id, null);
  else
    perform public.notify(public.campaign_gm_ids(v_c.id), v_c.id, 'processing_failed',
      v_c.name || ': processing ' || public.notify_session_label(v_n) || ' failed',
      '/gm/reliability?campaign=' || v_c.id,
      jsonb_build_object('job_id', new.id, 'session_id', new.session_id, 'session_number', v_n),
      'job:' || new.id, null);
  end if;
  return null;
exception when others then
  raise warning 'notify_on_job: %', sqlerrm;
  return null;
end;
$$;
drop trigger if exists notify_on_job on public.capture_jobs;
create trigger notify_on_job after update of status on public.capture_jobs
  for each row execute function public.notify_on_job();

-- memberships: co-GM joins, steps down, or is removed
create or replace function public.notify_on_cogm()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_was boolean := tg_op <> 'INSERT' and old.role in ('gm', 'co-gm') and old.active;
  v_is  boolean := tg_op <> 'DELETE' and new.role in ('gm', 'co-gm') and new.active;
  v_row public.memberships := coalesce(new, old);
  v_c   public.campaigns;
  v_who text;
begin
  if v_was = v_is then return null; end if;
  select * into v_c from public.campaigns where id = v_row.campaign_id;
  if v_c.id is null or v_c.deleted_at is not null or v_row.profile_id = v_c.gm_id then return null; end if;
  select coalesce(nullif(trim(pr.display_name), ''), 'Your co-GM') into v_who from public.profiles pr where pr.id = v_row.profile_id;
  v_who := coalesce(v_who, 'Your co-GM');
  if v_is then
    perform public.notify(array[v_c.gm_id], v_c.id, 'cogm_joined', v_who || ' is now a co-GM of ' || v_c.name,
      '/gm?campaign=' || v_c.id, '{}'::jsonb, 'cogm:' || v_c.id || ':' || v_row.profile_id, v_row.profile_id);
  elsif auth.uid() is not distinct from v_row.profile_id then
    perform public.notify(array[v_c.gm_id], v_c.id, 'cogm_left', v_who || ' stepped down as co-GM of ' || v_c.name,
      '/gm?campaign=' || v_c.id, '{}'::jsonb, 'cogm:' || v_c.id || ':' || v_row.profile_id, v_row.profile_id);
  else
    perform public.notify(array[v_row.profile_id], v_c.id, 'cogm_removed', 'You are no longer a co-GM of ' || v_c.name,
      '/me/campaigns', '{}'::jsonb, 'cogm:' || v_c.id || ':' || v_row.profile_id, auth.uid());
  end if;
  return null;
exception when others then
  raise warning 'notify_on_cogm: %', sqlerrm;
  return null;
end;
$$;
drop trigger if exists notify_on_cogm on public.memberships;
create trigger notify_on_cogm after insert or update of role, active or delete on public.memberships
  for each row execute function public.notify_on_cogm();

revoke all on function public.notify_session_label(integer) from public, anon, authenticated;
revoke all on function public.notify_on_session()    from public, anon, authenticated;
revoke all on function public.notify_on_recap_send() from public, anon, authenticated;
revoke all on function public.notify_on_rsvp()       from public, anon, authenticated;
revoke all on function public.notify_on_join()       from public, anon, authenticated;
revoke all on function public.notify_on_job()        from public, anon, authenticated;
revoke all on function public.notify_on_cogm()       from public, anon, authenticated;

-- 4. -------------------------------------------------------------------------------------------------
-- One row per person who turned the digest on and has unread, unsent notifications from the last two
-- days. The job emails each, then sets emailed_at on exactly the ids it sent.
create or replace function public.digest_batch(p_limit integer default 500)
returns table (profile_id uuid, email text, items jsonb)
language sql stable security definer
set search_path to 'public'
as $$
  select n.profile_id, lower(u.email),
         jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'link', n.link, 'data', n.data,
                                      'created_at', n.created_at) order by n.created_at desc)
    from public.notifications n
    join auth.users u on u.id = n.profile_id and u.email is not null and not coalesce(u.is_anonymous, false)
    join public.email_prefs p on p.email = lower(u.email) and p.digest
   where n.read_at is null and n.emailed_at is null and n.created_at > now() - interval '2 days'
   group by n.profile_id, lower(u.email)
   limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;
revoke all on function public.digest_batch(integer) from public, anon, authenticated;
grant execute on function public.digest_batch(integer) to service_role;
grant select, update, delete on public.notifications to service_role;

-- 5. -------------------------------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.attendance'::regclass and conname = 'attendance_status_check';
  if v_def is not null and v_def not like '%going%' then
    alter table public.attendance drop constraint attendance_status_check;
    alter table public.attendance add constraint attendance_status_check
      check (status = any (array['present', 'absent', 'late', 'partial', 'going', 'maybe', 'declined']));
    raise notice 'p150: attendance_status_check widened to allow RSVP answers (was %)', v_def;
  end if;
end $$;

insert into public._migrations (name) values ('p150-notifications') on conflict do nothing;
