-- supabase/migrations/p131-tabletop-addons.sql (2026-11-09)
--
-- Phase 6b: the add-on API (gap 12 in the tabletop audit doc). Two halves.
--
--   addon_keys    keys the GM makes so an outside program (a Discord bot, a stream overlay, a script)
--                 can use /api/addon/v1 for one campaign: read (chat and the turn order), chat (post a
--                 line), roll (the server rolls). Only the SHA-256 of a key is stored; the key itself is
--                 shown once. A key acts for the GM who made it and stops working if they stop being
--                 the campaign's GM or revoke it. 60 calls a minute per key.
--   addon_hooks   webhooks: an https address the server POSTs table events to (rolls, chat, turns,
--                 combat starting and ending), each signed with the hook's secret (HMAC-SHA256). Whispers
--                 are never sent; secret GM rolls only to a hook that asks for them.
--   addon_outbox  what is waiting to be sent. Triggers on vtt_messages and combats fill it; the server
--                 drains it (lib/addons/deliver.ts) when the acting browser nudges /api/addon/kick and
--                 every minute from cron. Retries back off (30 s doubling, 6 tries); a hook that fails
--                 25 times in a row switches itself off. Nobody but the server reads it.
--
-- The triggers never stop the table: if queuing a delivery fails, the message or turn still happens.
-- Needs p130 (tabletop_seat_name). Idempotent. Run by hand after p130, then
-- supabase/checks/p131-tabletop-addons-check.sql.

do $$
begin
  if to_regprocedure('public.tabletop_seat_name(uuid, uuid)') is null then
    raise exception 'run p130-tabletop-card-decks.sql first (p131 uses tabletop_seat_name)';
  end if;
end;
$$;

create table if not exists public.addon_keys (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 40),
  prefix        text not null check (char_length(prefix) between 4 and 16),
  key_hash      text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes        text[] not null default '{read}' check (cardinality(scopes) >= 1 and scopes <@ array['read', 'chat', 'roll']::text[]),
  created_by    uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  window_start  timestamptz not null default now(),
  window_count  integer not null default 0
);
create index if not exists addon_keys_campaign_idx on public.addon_keys (campaign_id);

create table if not exists public.addon_hooks (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  name             text not null check (char_length(trim(name)) between 1 and 40),
  url              text not null check (char_length(url) <= 500 and url ~ '^https://[^[:space:]]+$'),
  secret           text not null check (char_length(secret) >= 32),
  events           text[] not null default '{roll}' check (cardinality(events) >= 1 and events <@ array['roll', 'chat', 'turn', 'combat']::text[]),
  include_secret   boolean not null default false,
  enabled          boolean not null default true,
  fail_count       integer not null default 0,
  last_status      integer,
  last_error       text,
  last_attempt_at  timestamptz,
  last_ok_at       timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists addon_hooks_campaign_idx on public.addon_hooks (campaign_id) where enabled;

create table if not exists public.addon_outbox (
  id             bigint generated always as identity primary key,
  hook_id        uuid not null references public.addon_hooks(id) on delete cascade,
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  event          text not null,
  payload        jsonb not null,
  created_at     timestamptz not null default now(),
  attempts       integer not null default 0,
  next_at        timestamptz not null default now(),
  claimed_until  timestamptz,
  delivered_at   timestamptz,
  dropped_at     timestamptz
);
create index if not exists addon_outbox_due_idx on public.addon_outbox (next_at) where delivered_at is null and dropped_at is null;
create index if not exists addon_outbox_campaign_idx on public.addon_outbox (campaign_id) where delivered_at is null and dropped_at is null;

-- The GM manages keys and hooks (keys are made by /api/addon/keys, which stores only the hash; a GM's
-- own key always acts as that GM). The outbox has no policies at all: only the service role touches it.
alter table public.addon_keys enable row level security;
alter table public.addon_hooks enable row level security;
alter table public.addon_outbox enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'addon_keys' and policyname = 'addon_keys_gm') then
    create policy addon_keys_gm on public.addon_keys
      for all using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id) and created_by = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'addon_hooks' and policyname = 'addon_hooks_gm') then
    create policy addon_hooks_gm on public.addon_hooks
      for all using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
  end if;
end;
$$;
revoke all on public.addon_keys from anon;
revoke all on public.addon_hooks from anon;
revoke all on public.addon_outbox from anon, authenticated;
grant select, update, delete on public.addon_keys to authenticated;
grant select, insert, update, delete on public.addon_hooks to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Filling the outbox

create or replace function public.addon_on_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ev      text;
  v_payload jsonb;
begin
  if new.whisper_to is not null then return new; end if;
  v_ev := case when new.kind = 'roll' then 'roll' when new.kind in ('say', 'emote') then 'chat' end;
  if v_ev is null then return new; end if;
  if not exists (select 1 from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and v_ev = any (h.events)) then
    return new;
  end if;
  v_payload := jsonb_build_object(
      'messageId', new.id,
      'who', coalesce(new.as_name, (select c.name from public.characters c where c.id = new.character_id),
                      public.tabletop_seat_name(new.campaign_id, new.author_profile)),
      'kind', new.kind,
      'text', new.body,
      'secret', new.gm_only,
      -- set when an add-on posted it, so a bot can skip its own lines
      'addon', new.roll ->> 'addon',
      'at', new.created_at)
    || case when v_ev = 'roll' and new.roll is not null then jsonb_build_object('roll', jsonb_strip_nulls(jsonb_build_object(
         'label', new.roll -> 'label', 'notation', new.roll -> 'notation', 'total', new.roll -> 'total',
         'natural', new.roll -> 'natural', 'dice', new.roll -> 'dice', 'table', new.roll -> 'table')))
       else '{}'::jsonb end;
  insert into public.addon_outbox (hook_id, campaign_id, event, payload)
  select h.id, new.campaign_id, v_ev, v_payload
    from public.addon_hooks h
   where h.campaign_id = new.campaign_id and h.enabled and v_ev = any (h.events) and (not new.gm_only or h.include_secret);
  return new;
exception when others then
  raise warning 'addon_on_message: %', sqlerrm;
  return new;
end;
$function$;
revoke all on function public.addon_on_message() from public, anon, authenticated;

drop trigger if exists addon_on_message on public.vtt_messages;
create trigger addon_on_message after insert on public.vtt_messages
  for each row execute function public.addon_on_message();

create or replace function public.addon_on_combat()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_started boolean := new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active');
  v_ended   boolean := tg_op = 'UPDATE' and new.status is distinct from 'active' and old.status = 'active';
  v_turned  boolean := tg_op = 'UPDATE' and new.status = 'active' and old.status = 'active'
                       and (new.round is distinct from old.round or new.turn is distinct from old.turn);
  v_cur     jsonb;
begin
  if not (v_started or v_ended or v_turned) then return new; end if;
  if not exists (select 1 from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and h.events && array['turn', 'combat']) then
    return new;
  end if;
  if v_started or v_ended then
    insert into public.addon_outbox (hook_id, campaign_id, event, payload)
    select h.id, new.campaign_id, 'combat',
           jsonb_build_object('combatId', new.id, 'state', case when v_started then 'started' else 'ended' end, 'name', new.name, 'round', new.round, 'at', now())
      from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and 'combat' = any (h.events);
  end if;
  if v_turned or v_started then
    -- whose turn it is; a combatant the GM hides from the tracker stays hidden here too
    v_cur := new.combatants -> coalesce(new.turn, 0);
    insert into public.addon_outbox (hook_id, campaign_id, event, payload)
    select h.id, new.campaign_id, 'turn',
           jsonb_build_object('combatId', new.id, 'round', new.round,
             'current', case when v_cur is null or coalesce((v_cur ->> 'hidden')::boolean, false) then null
                             else jsonb_build_object('name', v_cur ->> 'name', 'kind', v_cur ->> 'kind') end,
             'at', now())
      from public.addon_hooks h where h.campaign_id = new.campaign_id and h.enabled and 'turn' = any (h.events);
  end if;
  return new;
exception when others then
  raise warning 'addon_on_combat: %', sqlerrm;
  return new;
end;
$function$;
revoke all on function public.addon_on_combat() from public, anon, authenticated;

drop trigger if exists addon_on_combat on public.combats;
create trigger addon_on_combat after insert or update on public.combats
  for each row execute function public.addon_on_combat();

-- ---------------------------------------------------------------------------------------------------
-- For the server only (service role): checking a key, and sending what is waiting

-- The key with this hash, counted against its minute; null when unknown, revoked, or its maker is no
-- longer the campaign's GM.
create or replace function public.addon_auth(p_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_k public.addon_keys;
  v_c public.campaigns;
begin
  select * into v_k from public.addon_keys where key_hash = p_hash for update;
  if v_k.id is null or v_k.revoked_at is not null then return null; end if;
  select * into v_c from public.campaigns where id = v_k.campaign_id;
  if v_c.id is null or v_c.gm_id is distinct from v_k.created_by then return null; end if;
  if now() - v_k.window_start > interval '1 minute' then
    update public.addon_keys set window_start = now(), window_count = 1, last_used_at = now() where id = v_k.id;
    v_k.window_count := 1;
  else
    update public.addon_keys set window_count = window_count + 1, last_used_at = now() where id = v_k.id;
    v_k.window_count := v_k.window_count + 1;
  end if;
  return jsonb_build_object('id', v_k.id, 'campaignId', v_k.campaign_id, 'campaignName', v_c.name, 'name', v_k.name,
                            'scopes', to_jsonb(v_k.scopes), 'owner', v_k.created_by, 'limited', v_k.window_count > 60);
end;
$function$;
revoke all on function public.addon_auth(text) from public, anon, authenticated;
grant execute on function public.addon_auth(text) to service_role;

-- Claims up to p_limit deliveries that are due (one campaign, or all), so two senders never send the
-- same one; the claim lapses after 45 s if the sender dies.
create or replace function public.addon_claim(p_campaign uuid default null, p_limit integer default 25)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_out jsonb;
begin
  with c as (
    select o.id from public.addon_outbox o join public.addon_hooks h on h.id = o.hook_id
     where o.delivered_at is null and o.dropped_at is null and o.next_at <= now()
       and (o.claimed_until is null or o.claimed_until < now())
       and h.enabled and (p_campaign is null or o.campaign_id = p_campaign)
     order by o.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update of o skip locked
  ), u as (
    update public.addon_outbox o set claimed_until = now() + interval '45 seconds'
      from c where o.id = c.id
    returning o.id, o.hook_id, o.campaign_id, o.event, o.payload, o.created_at, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'hookId', u.hook_id, 'event', u.event, 'payload', u.payload, 'createdAt', u.created_at, 'attempts', u.attempts,
           'url', h.url, 'secret', h.secret, 'campaignId', u.campaign_id, 'campaignName', cp.name) order by u.id), '[]'::jsonb)
    into v_out
    from u join public.addon_hooks h on h.id = u.hook_id join public.campaigns cp on cp.id = u.campaign_id;
  return v_out;
end;
$function$;
revoke all on function public.addon_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.addon_claim(uuid, integer) to service_role;

-- Records how a delivery went, on the delivery and on its hook.
create or replace function public.addon_settle(p_id bigint, p_ok boolean, p_status integer, p_error text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_o public.addon_outbox;
begin
  select * into v_o from public.addon_outbox where id = p_id for update;
  if v_o.id is null then return; end if;
  if p_ok then
    update public.addon_outbox set delivered_at = now(), claimed_until = null, attempts = attempts + 1 where id = p_id;
    update public.addon_hooks set fail_count = 0, last_status = p_status, last_error = null, last_attempt_at = now(), last_ok_at = now()
     where id = v_o.hook_id;
  else
    update public.addon_outbox
       set attempts = attempts + 1, claimed_until = null,
           dropped_at = case when attempts + 1 >= 6 then now() end,
           next_at = now() + make_interval(secs => 30 * power(2, least(attempts, 8)))
     where id = p_id;
    update public.addon_hooks
       set fail_count = fail_count + 1, last_status = p_status, last_error = left(coalesce(p_error, 'failed'), 300), last_attempt_at = now(),
           enabled = case when fail_count + 1 >= 25 then false else enabled end
     where id = v_o.hook_id;
  end if;
end;
$function$;
revoke all on function public.addon_settle(bigint, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.addon_settle(bigint, boolean, integer, text) to service_role;

-- Clears out old deliveries: sent or given up more than a week ago, or never sent after two days.
create or replace function public.addon_prune()
 returns integer
 language sql
 security definer
 set search_path to 'public'
as $function$
  with d as (
    delete from public.addon_outbox
     where (coalesce(delivered_at, dropped_at) < now() - interval '7 days')
        or (delivered_at is null and created_at < now() - interval '2 days')
    returning 1)
  select count(*)::integer from d;
$function$;
revoke all on function public.addon_prune() from public, anon, authenticated;
grant execute on function public.addon_prune() to service_role;

-- A test delivery to one hook (the GM's "Send a test"); the route checks the caller is its GM.
create or replace function public.addon_ping(p_hook uuid)
 returns bigint
 language sql
 security definer
 set search_path to 'public'
as $function$
  insert into public.addon_outbox (hook_id, campaign_id, event, payload)
  select h.id, h.campaign_id, 'ping', jsonb_build_object('message', 'A test from Six Axes. Your webhook works.', 'at', now())
    from public.addon_hooks h where h.id = p_hook
  returning id;
$function$;
revoke all on function public.addon_ping(uuid) from public, anon, authenticated;
grant execute on function public.addon_ping(uuid) to service_role;

-- Whether this table has a webhook switched on, so browsers only nudge delivery when there is
-- somewhere to deliver to. Anyone at the table may ask; it says nothing about the hooks themselves.
create or replace function public.tabletop_has_hooks(p_campaign uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select (public.is_campaign_gm(p_campaign) or public.tabletop_is_player(p_campaign))
     and exists (select 1 from public.addon_hooks h where h.campaign_id = p_campaign and h.enabled);
$function$;
revoke all on function public.tabletop_has_hooks(uuid) from public, anon;
grant execute on function public.tabletop_has_hooks(uuid) to authenticated;
