-- supabase/migrations/p140-campaign-handover-export.sql (2026-11-09)
--
-- Push 3 of the audit plan: hand a campaign to another GM (F2), and export a campaign (F3).
--
-- Handover. The owner offers the campaign to an email address; Six Axes emails that person a link
-- (app/api/gm/campaign/transfer). They accept while signed in as that address, with GM access. Then:
--   campaigns.gm_id becomes theirs; their membership becomes gm; the old owner stays as a player (so
--   their own characters and history stay put); the campaign's stat blocks, compendium entries and DM
--   boards move with it (those three are owned per GM, so the new GM could not see them otherwise).
-- An offer lasts 7 days, one open offer per campaign, and the owner can cancel it. A trashed campaign
-- cannot be offered or accepted. This also unblocks account deletion for a GM (my_deletion_blockers).
--
--   offer_campaign_transfer(c, email) -> {token, expiresAt}   the owner (route calls it, then emails)
--   cancel_campaign_transfer(c)                               the owner
--   my_campaign_transfer(c)        -> the open offer, for the owner's workspace
--   campaign_transfer_info(token)  -> what the accept page shows
--   accept_campaign_transfer(token) -> the campaign id
--
-- Export. A private bucket, campaign-exports, server only (no policies): the export route builds a zip
-- there under <campaign id>/ and hands back a one-hour link. Campaign purges remove it with the rest.
--
-- Idempotent. Run by hand after p139, then supabase/checks/p140-campaign-handover-export-check.sql.

create table if not exists public.campaign_transfers (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  from_id      uuid not null references public.profiles(id) on delete cascade,
  to_email     text not null check (to_email = lower(to_email) and char_length(to_email) <= 320),
  token        text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz
);
create index if not exists campaign_transfers_campaign_idx on public.campaign_transfers (campaign_id) where accepted_at is null and cancelled_at is null;
alter table public.campaign_transfers enable row level security;
revoke all on public.campaign_transfers from anon, authenticated;

create or replace function public.offer_campaign_transfer(p_campaign uuid, p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_c     public.campaigns;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_mine  text;
  v_token text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  v_exp   timestamptz := now() + interval '7 days';
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if v_c.id is null or v_c.gm_id is distinct from auth.uid() then raise exception 'only the campaign''s GM can hand it over'; end if;
  if v_c.deleted_at is not null then raise exception 'restore the campaign from the trash first'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'that does not look like an email address'; end if;
  select lower(email) into v_mine from auth.users where id = auth.uid();
  if v_email = v_mine then raise exception 'that is your own address'; end if;
  update public.campaign_transfers set cancelled_at = now()
   where campaign_id = p_campaign and accepted_at is null and cancelled_at is null;
  insert into public.campaign_transfers (campaign_id, from_id, to_email, token, expires_at)
  values (p_campaign, auth.uid(), v_email, v_token, v_exp);
  return jsonb_build_object('token', v_token, 'expiresAt', v_exp);
end;
$function$;
revoke all on function public.offer_campaign_transfer(uuid, text) from public, anon;
grant execute on function public.offer_campaign_transfer(uuid, text) to authenticated;

create or replace function public.cancel_campaign_transfer(p_campaign uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.campaigns where id = p_campaign and gm_id = auth.uid()) then
    raise exception 'only the campaign''s GM can cancel a handover';
  end if;
  update public.campaign_transfers set cancelled_at = now()
   where campaign_id = p_campaign and accepted_at is null and cancelled_at is null;
end;
$function$;
revoke all on function public.cancel_campaign_transfer(uuid) from public, anon;
grant execute on function public.cancel_campaign_transfer(uuid) to authenticated;

create or replace function public.my_campaign_transfer(p_campaign uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('toEmail', t.to_email, 'expiresAt', t.expires_at)
    from public.campaign_transfers t
    join public.campaigns c on c.id = t.campaign_id and c.gm_id = auth.uid()
   where t.campaign_id = p_campaign and t.accepted_at is null and t.cancelled_at is null and t.expires_at > now()
   order by t.created_at desc limit 1;
$function$;
revoke all on function public.my_campaign_transfer(uuid) from public, anon;
grant execute on function public.my_campaign_transfer(uuid) to authenticated;

create or replace function public.campaign_transfer_info(p_token text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
           'campaignName', c.name,
           'fromName', coalesce(nullif(p.display_name, ''), 'Your GM'),
           'forYou', t.to_email = (select lower(u.email) from auth.users u where u.id = auth.uid()),
           'state', case
             when t.accepted_at is not null then 'accepted'
             when t.cancelled_at is not null then 'cancelled'
             when t.expires_at <= now() then 'expired'
             when c.deleted_at is not null then 'trashed'
             else 'open' end)
    from public.campaign_transfers t
    join public.campaigns c on c.id = t.campaign_id
    left join public.profiles p on p.id = t.from_id
   where t.token = p_token and auth.uid() is not null;
$function$;
revoke all on function public.campaign_transfer_info(text) from public, anon;
grant execute on function public.campaign_transfer_info(text) to authenticated;

create or replace function public.accept_campaign_transfer(p_token text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_t     public.campaign_transfers;
  v_c     public.campaigns;
  v_email text;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  select * into v_t from public.campaign_transfers where token = p_token for update;
  if v_t.id is null then raise exception 'this handover link does not exist'; end if;
  if v_t.accepted_at is not null then raise exception 'this handover was already accepted'; end if;
  if v_t.cancelled_at is not null then raise exception 'the GM cancelled this handover'; end if;
  if v_t.expires_at <= now() then raise exception 'this handover link has expired; ask the GM for a new one'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is distinct from v_t.to_email then raise exception 'this handover was sent to a different email address; sign in with that one'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and access_granted and access_role = 'gm') then
    raise exception 'you need GM access to take over a campaign: enter your GM access code first';
  end if;
  select * into v_c from public.campaigns where id = v_t.campaign_id for update;
  if v_c.deleted_at is not null then raise exception 'this campaign is in the trash'; end if;
  if v_c.gm_id is distinct from v_t.from_id then raise exception 'this campaign has changed hands since the offer'; end if;

  update public.campaigns set gm_id = v_uid where id = v_c.id;
  insert into public.memberships (campaign_id, profile_id, role, active)
  values (v_c.id, v_uid, 'gm', true)
  on conflict (campaign_id, profile_id) do update set role = 'gm', active = true;
  update public.memberships set role = 'player'
   where campaign_id = v_c.id and profile_id = v_t.from_id and role = 'gm';
  update public.stat_blocks set gm_id = v_uid where campaign_id = v_c.id and gm_id = v_t.from_id;
  update public.compendium_entries set gm_id = v_uid where campaign_id = v_c.id and gm_id = v_t.from_id;
  update public.dm_boards set gm_id = v_uid where campaign_id = v_c.id and gm_id = v_t.from_id;
  update public.campaign_transfers set accepted_at = now(), accepted_by = v_uid where id = v_t.id;
  return v_c.id;
end;
$function$;
revoke all on function public.accept_campaign_transfer(text) from public, anon;
grant execute on function public.accept_campaign_transfer(text) to authenticated;

insert into storage.buckets (id, name, public) values ('campaign-exports', 'campaign-exports', false)
on conflict (id) do nothing;
do $c$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 209715200 where id = 'campaign-exports';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set allowed_mime_types = array['application/zip'] where id = 'campaign-exports';
  end if;
end;
$c$;
