-- supabase/migrations/p138-email-and-times.sql (2026-11-09)
--
-- Push 1 of the audit plan: email and times (U2, T12, F7 reminders, P10).
--
--   campaigns.time_zone      the campaign's IANA time zone ("America/Los_Angeles"). Filled from the GM's
--                            browser; reminder emails print session times in it (they printed GMT).
--   email_prefs              one row per email address: reminders and recaps on or off. Keyed by address,
--                            not account, so it also covers the recap addresses a GM types in. Written by
--                            the one-click unsubscribe route (service role) and by the player's Settings
--                            page through the two functions below. Server only otherwise.
--   my_email_prefs()         the signed-in user's own preferences (defaults: both on).
--   set_my_email_prefs(r, c) sets them.
--   sessions.discord_recap_post   {channel, ids}: the Discord messages a recap was posted as, so posting
--                            again after an edit updates them instead of posting a duplicate.
--
-- Idempotent. Run by hand after p137, BEFORE deploying this push (the senders read email_prefs), then
-- supabase/checks/p138-email-and-times-check.sql.

alter table public.campaigns add column if not exists time_zone text;
do $c$ begin
  alter table public.campaigns add constraint campaigns_time_zone_shape
    check (time_zone is null or (char_length(time_zone) <= 64 and time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'));
exception when duplicate_object then null;
end $c$;

alter table public.sessions add column if not exists discord_recap_post jsonb;

create table if not exists public.email_prefs (
  email      text primary key check (email = lower(email) and char_length(email) <= 320),
  reminders  boolean not null default true,
  recaps     boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.email_prefs enable row level security;
revoke all on public.email_prefs from anon, authenticated;
grant select, insert, update on public.email_prefs to service_role;

create or replace function public.my_email_prefs()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
           'email', u.email,
           'reminders', coalesce(p.reminders, true),
           'recaps', coalesce(p.recaps, true))
    from auth.users u
    left join public.email_prefs p on p.email = lower(u.email)
   where u.id = auth.uid() and u.email is not null;
$function$;
revoke all on function public.my_email_prefs() from public, anon;
grant execute on function public.my_email_prefs() to authenticated;

create or replace function public.set_my_email_prefs(p_reminders boolean, p_recaps boolean)
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
  insert into public.email_prefs (email, reminders, recaps, updated_at)
  values (v_email, coalesce(p_reminders, true), coalesce(p_recaps, true), now())
  on conflict (email) do update
    set reminders = excluded.reminders, recaps = excluded.recaps, updated_at = now();
end;
$function$;
revoke all on function public.set_my_email_prefs(boolean, boolean) from public, anon;
grant execute on function public.set_my_email_prefs(boolean, boolean) to authenticated;
