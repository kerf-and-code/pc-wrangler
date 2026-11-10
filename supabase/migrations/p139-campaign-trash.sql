-- supabase/migrations/p139-campaign-trash.sql (2026-11-09)
--
-- Push 2 of the audit plan: campaign safety (F4, U16).
--
-- Deleting a campaign now moves it to the trash for 30 days instead of erasing it at once:
--
--   trash_campaign(c)        the campaign's GM (owner) moves it to the trash. Players lose it immediately:
--                            is_campaign_member and tabletop_is_player say no for a trashed campaign (most
--                            player access rules go through them), its share code, Discord channel link and
--                            public codex are switched off, and nobody's campaign list shows it. What was
--                            switched off is kept in trash_restore.
--   restore_campaign(c)      brings it back within the 30 days, links and all.
--   my_trashed_campaigns()   the GM's trash, with the date each one will be erased.
--   The daily /api/cron/campaign-purge erases campaigns trashed more than 30 days ago, files included.
--   "Delete forever now" in the trash uses /api/gm/campaign/delete as before.
--
-- Idempotent. Run by hand after p138, BEFORE deploying this push, then
-- supabase/checks/p139-campaign-trash-check.sql.

alter table public.campaigns add column if not exists deleted_at timestamptz;
alter table public.campaigns add column if not exists trash_restore jsonb;
create index if not exists campaigns_deleted_at_idx on public.campaigns (deleted_at) where deleted_at is not null;

-- A trashed campaign is invisible to everyone through the table, the GM included (so no GM page's
-- campaign picker offers it); the GM sees it only through my_trashed_campaigns.
drop policy if exists "members read campaigns" on public.campaigns;
create policy "members read campaigns" on public.campaigns for select to authenticated
  using (deleted_at is null and (is_campaign_member(id) or gm_id = auth.uid()));

create or replace function public.is_campaign_member(p_campaign uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from memberships m
    where m.campaign_id = p_campaign and m.profile_id = auth.uid() and m.active
  ) and not exists (
    select 1 from campaigns c where c.id = p_campaign and c.deleted_at is not null
  );
$function$;

create or replace function public.tabletop_is_player(p_campaign uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.characters ch
    where ch.campaign_id = p_campaign and ch.profile_id = auth.uid() and ch.kind = 'pc'
  ) and not exists (
    select 1 from public.campaigns c where c.id = p_campaign and c.deleted_at is not null
  );
$function$;

create or replace function public.trash_campaign(p_campaign uuid)
 returns timestamptz
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_c public.campaigns;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if v_c.id is null or v_c.gm_id is distinct from auth.uid() then
    raise exception 'only the campaign''s GM can move it to the trash';
  end if;
  if v_c.deleted_at is not null then return v_c.deleted_at + interval '30 days'; end if;
  update public.campaigns
     set deleted_at = now(),
         trash_restore = jsonb_build_object(
           'share_code', v_c.share_code,
           'discord_channel_id', v_c.discord_channel_id,
           'public_published_at', v_c.public_published_at),
         share_code = null,
         discord_channel_id = null,
         public_published_at = null
   where id = p_campaign;
  return now() + interval '30 days';
end;
$function$;
revoke all on function public.trash_campaign(uuid) from public, anon;
grant execute on function public.trash_campaign(uuid) to authenticated;

create or replace function public.restore_campaign(p_campaign uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_c    public.campaigns;
  v_code text;
begin
  select * into v_c from public.campaigns where id = p_campaign for update;
  if v_c.id is null or v_c.gm_id is distinct from auth.uid() then
    raise exception 'only the campaign''s GM can restore it';
  end if;
  if v_c.deleted_at is null then return; end if;
  if v_c.deleted_at < now() - interval '30 days' then
    raise exception 'this campaign has been in the trash for more than 30 days and is being erased';
  end if;
  v_code := v_c.trash_restore ->> 'share_code';
  -- codes are random, but never hand back one another campaign has taken meanwhile
  if v_code is null or exists (select 1 from public.campaigns o where o.share_code = v_code and o.id <> p_campaign) then
    v_code := substr(md5(gen_random_uuid()::text), 1, 10);
  end if;
  update public.campaigns
     set deleted_at = null,
         share_code = v_code,
         discord_channel_id = coalesce(discord_channel_id, v_c.trash_restore ->> 'discord_channel_id'),
         public_published_at = coalesce(public_published_at, (v_c.trash_restore ->> 'public_published_at')::timestamptz),
         trash_restore = null
   where id = p_campaign;
end;
$function$;
revoke all on function public.restore_campaign(uuid) from public, anon;
grant execute on function public.restore_campaign(uuid) to authenticated;

create or replace function public.my_trashed_campaigns()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'deletedAt', c.deleted_at,
           'eraseAt', c.deleted_at + interval '30 days') order by c.deleted_at desc), '[]'::jsonb)
    from public.campaigns c
   where c.gm_id = auth.uid() and c.deleted_at is not null;
$function$;
revoke all on function public.my_trashed_campaigns() from public, anon;
grant execute on function public.my_trashed_campaigns() to authenticated;
