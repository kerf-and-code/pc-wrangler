-- supabase/migrations/p170-data-follows-the-campaign.sql (2026-11-12, push 48: audit round 2)
--
-- 1. G6: webhooks (add-on hooks, p131) keep firing after the GM who made them is removed as co-GM or
--    hands the campaign over. addon_hooks_prune(campaign) switches off every enabled hook of the
--    campaign whose maker is no longer one of its GMs (campaign_gm_of, p149), and triggers run it
--    whenever a membership or the owner changes. Run once now for every campaign. A switched-off hook
--    stays listed; a current GM can make a new one.
-- 2. R8: accept_campaign_transfer (p140) restated: it revokes the co-GM invites nobody used, prunes the
--    webhooks, and marks the transfer accepted before the memberships change, so notify_on_cogm can tell
--    a handover from a removal; its refusal for an account without GM access no longer mentions the access
--    code retired in push 41.5. notify_on_cogm (p150) restated to skip the old owner in a handover: they
--    were told "You are no longer a co-GM" of a campaign they had just handed over. Invites left open by
--    handovers already done are revoked once.
-- 3. G2: homebrew stat blocks made in the library (campaign_id empty) but used by exactly one campaign
--    of the same GM (in its encounters or on its tabletop) now belong to that campaign, so export,
--    Duplicate, handover and co-GMs include them. Blocks used by several campaigns, or none, stay in the
--    library. The statblock editor now files new blocks under the active campaign when you are its GM.
--    Players never read stat blocks (every reader is a GM screen), so the policy that let any member of
--    a campaign read its blocks is replaced by one for its GMs: tying a block to a campaign must not show
--    the monster's numbers to the players. Writing a block into a campaign now needs GM access to it.
-- 4. T16: prune_growing_tables(), for the daily campaign-purge job. Removes what nothing reads any more:
--    rate-limit hits (they hold IP addresses) after 2 days, delivered or dropped webhook deliveries after
--    14 days, read notifications after 90 days and any notification after a year, expired or used
--    Discord setup codes after 7 days, and finished co-GM invites and handover offers after 90 days.
--    The service role only.
--
-- Idempotent. Run by hand after p169, then supabase/checks/p170-data-follows-the-campaign-check.sql.

-- 1 ---------------------------------------------------------------------------------------------------
create or replace function public.addon_hooks_prune(p_campaign uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  update public.addon_hooks h set enabled = false
   where h.campaign_id = p_campaign and h.enabled
     and (h.created_by is null or not public.campaign_gm_of(p_campaign, h.created_by));
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.addon_hooks_prune(uuid) from public, anon, authenticated;

create or replace function public.addon_hooks_follow_gms()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.addon_hooks_prune(coalesce(new.campaign_id, old.campaign_id));
  return null;
exception when others then
  raise warning 'addon_hooks_follow_gms: %', sqlerrm;
  return null;
end;
$function$;
revoke all on function public.addon_hooks_follow_gms() from public, anon, authenticated;

create or replace function public.addon_hooks_follow_owner()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.gm_id is distinct from old.gm_id then perform public.addon_hooks_prune(new.id); end if;
  return null;
exception when others then
  raise warning 'addon_hooks_follow_owner: %', sqlerrm;
  return null;
end;
$function$;
revoke all on function public.addon_hooks_follow_owner() from public, anon, authenticated;

drop trigger if exists addon_hooks_follow_gms on public.memberships;
create trigger addon_hooks_follow_gms after update of role, active or delete on public.memberships
  for each row execute function public.addon_hooks_follow_gms();
drop trigger if exists addon_hooks_follow_owner on public.campaigns;
create trigger addon_hooks_follow_owner after update of gm_id on public.campaigns
  for each row execute function public.addon_hooks_follow_owner();

do $$
declare r record;
begin
  for r in select distinct campaign_id from public.addon_hooks where enabled loop
    perform public.addon_hooks_prune(r.campaign_id);
  end loop;
end;
$$;

-- 2 ---------------------------------------------------------------------------------------------------
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
    raise exception 'you need GM access to take over a campaign: ask for GM access on your Campaigns page first';
  end if;
  select * into v_c from public.campaigns where id = v_t.campaign_id for update;
  if v_c.deleted_at is not null then raise exception 'this campaign is in the trash'; end if;
  if v_c.gm_id is distinct from v_t.from_id then raise exception 'this campaign has changed hands since the offer'; end if;

  -- p170: marked accepted FIRST, so the membership change below is recognised as a handover by
  -- notify_on_cogm (it compares accepted_at with now(), the time of this transaction)
  update public.campaign_transfers set accepted_at = now(), accepted_by = v_uid where id = v_t.id;
  update public.campaigns set gm_id = v_uid where id = v_c.id;
  insert into public.memberships (campaign_id, profile_id, role, active)
  values (v_c.id, v_uid, 'gm', true)
  on conflict (campaign_id, profile_id) do update set role = 'gm', active = true;
  update public.memberships set role = 'player'
   where campaign_id = v_c.id and profile_id = v_t.from_id and role = 'gm';
  update public.stat_blocks set gm_id = v_uid where campaign_id = v_c.id and gm_id = v_t.from_id;
  update public.compendium_entries set gm_id = v_uid where campaign_id = v_c.id and gm_id = v_t.from_id;
  update public.dm_boards set gm_id = v_uid where campaign_id = v_c.id and gm_id = v_t.from_id;
  -- p170 (R8): co-GM invites the old owner made and nobody used stop working with the handover
  update public.campaign_gm_invites set revoked_at = now()
   where campaign_id = v_c.id and accepted_at is null and revoked_at is null;
  -- p170 (G6): webhooks that no current GM made stop firing (addon_hooks_follow_gms does the same on
  -- every later change of who runs the campaign)
  perform public.addon_hooks_prune(v_c.id);
  return v_c.id;
end;
$function$;
revoke all on function public.accept_campaign_transfer(text) from public, anon;
grant execute on function public.accept_campaign_transfer(text) to authenticated;
-- invites left open by handovers already done: revoke them now, once
update public.campaign_gm_invites i set revoked_at = now()
 where i.accepted_at is null and i.revoked_at is null
   and exists (select 1 from public.campaign_transfers t
                where t.campaign_id = i.campaign_id and t.accepted_at is not null and i.created_at < t.accepted_at);

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
  -- p170 (R8): the old owner in a handover accepted in this transaction is not a removed co-GM
  if exists (select 1 from public.campaign_transfers t
              where t.campaign_id = v_c.id and t.from_id = v_row.profile_id and t.accepted_at = now()) then
    return null;
  end if;
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
revoke all on function public.notify_on_cogm() from public, anon, authenticated;
-- the trigger from p150 already calls this function; create or replace keeps it

-- 3 ---------------------------------------------------------------------------------------------------
-- library blocks used by exactly one campaign of the same GM
with uses as (
  select (f ->> 'statBlockId')::uuid as sb, e.campaign_id
    from public.encounters e, jsonb_array_elements(case when jsonb_typeof(e.foes) = 'array' then e.foes else '[]'::jsonb end) f
   where coalesce(f ->> 'statBlockId', '') ~ '^[0-9a-fA-F-]{36}$'
  union
  select t.stat_block_id, t.campaign_id from public.vtt_tokens t where t.stat_block_id is not null
), one as (
  select sb, min(campaign_id::text)::uuid as campaign_id from uses group by sb having count(distinct campaign_id) = 1
)
update public.stat_blocks s set campaign_id = one.campaign_id
  from one join public.campaigns c on c.id = one.campaign_id
 where s.id = one.sb and s.campaign_id is null and c.gm_id = s.gm_id;

drop policy if exists "members read pinned stat blocks" on public.stat_blocks;
drop policy if exists "gm manages own stat blocks" on public.stat_blocks;
create policy "gm manages own stat blocks" on public.stat_blocks for all to public
  using (gm_id = auth.uid() or (campaign_id is not null and public.is_campaign_gm(campaign_id)))
  with check ((gm_id = auth.uid() and (campaign_id is null or public.is_campaign_gm(campaign_id)))
              or (campaign_id is not null and public.is_campaign_gm(campaign_id)));

-- 4 ---------------------------------------------------------------------------------------------------
create or replace function public.prune_growing_tables()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_out jsonb := '{}'::jsonb;
  v_n   integer;
begin
  delete from public.rate_hits where at < now() - interval '2 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('rate_hits', v_n);
  delete from public.addon_outbox where (delivered_at is not null or dropped_at is not null) and created_at < now() - interval '14 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('addon_outbox', v_n);
  delete from public.notifications where (read_at is not null and read_at < now() - interval '90 days') or created_at < now() - interval '365 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('notifications', v_n);
  delete from public.discord_setup_codes where coalesce(used_at, expires_at) < now() - interval '7 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('discord_setup_codes', v_n);
  delete from public.campaign_gm_invites where coalesce(accepted_at, revoked_at, expires_at) < now() - interval '90 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('campaign_gm_invites', v_n);
  delete from public.campaign_transfers where coalesce(accepted_at, cancelled_at, expires_at) < now() - interval '90 days';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('campaign_transfers', v_n);
  return v_out;
end;
$function$;
revoke all on function public.prune_growing_tables() from public, anon, authenticated;

insert into public._migrations (name) values ('p170-data-follows-the-campaign') on conflict do nothing;
