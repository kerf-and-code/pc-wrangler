-- p116-party-inventory.sql
--
-- Phase 5h (2026-11-07): the party inventory, the one shared part of the character sheet.
--
-- Everything else on the sheet lives in the character's own build. The party's loot is shared by
-- the whole table, so it gets its own tables, read and written by the campaign's GM and by every
-- player with a character in the campaign (the same test the tabletop uses, tabletop_is_player).
--
-- party_items   one row per stack: name, how many, weight each, a note; mod and variant carry a +1
--               weapon or a chosen Belt of Giant Strength over from (and back to) a character's gear.
-- party_funds   one row per campaign: the party's coins.
--
-- Moving things between a character and the party goes through two functions, so two players can
-- never both take the last potion and coins can never go below zero:
--   party_take(p_item, p_qty)             takes p_qty of a stack (all of it when null) and returns
--                                         what was taken, for the sheet to add to the character
--   party_fund_change(p_campaign, p_delta) adds (or, negative, takes) coins: {"gp": -10, "sp": 5};
--                                         refuses to take more than the party has
-- Both tables are in the Realtime publication so every sheet's party tab can follow along.
--
-- Idempotent: create if not exists, guarded policies and publication adds, create or replace.
-- Run by hand in the Supabase SQL editor, then supabase/checks/p116-party-inventory-check.sql.

-- ---------------------------------------------------------------------------------------------------
create table if not exists public.party_items (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 80),
  qty         integer not null default 1 check (qty between 1 and 9999),
  weight      real check (weight is null or (weight >= 0 and weight <= 10000)),
  note        text check (note is null or char_length(note) <= 500),
  custom      boolean not null default false,
  mod         smallint check (mod is null or mod between 0 and 3),
  variant     text check (variant is null or char_length(variant) <= 80),
  added_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists party_items_campaign_idx on public.party_items (campaign_id, name);

create table if not exists public.party_funds (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  pp integer not null default 0 check (pp >= 0),
  gp integer not null default 0 check (gp >= 0),
  ep integer not null default 0 check (ep >= 0),
  sp integer not null default 0 check (sp >= 0),
  cp integer not null default 0 check (cp >= 0),
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.party_items enable row level security;
alter table public.party_funds enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'party_items' and policyname = 'party_items_table') then
    create policy party_items_table on public.party_items
      for all using (is_campaign_gm(campaign_id) or tabletop_is_player(campaign_id))
      with check (is_campaign_gm(campaign_id) or tabletop_is_player(campaign_id));
  end if;
  -- coins only change through party_fund_change, so the table is read-only to everyone directly
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'party_funds' and policyname = 'party_funds_read') then
    create policy party_funds_read on public.party_funds
      for select using (is_campaign_gm(campaign_id) or tabletop_is_player(campaign_id));
  end if;
end $$;

grant select, insert, update, delete on public.party_items to authenticated;
revoke insert, update, delete on public.party_funds from authenticated;
grant select on public.party_funds to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'party_items') then
    alter publication supabase_realtime add table public.party_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'party_funds') then
    alter publication supabase_realtime add table public.party_funds;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Take some (or all) of a stack. The row is locked, so a second player taking at the same moment
-- waits and then finds what is left.
create or replace function public.party_take(p_item uuid, p_qty integer default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.party_items%rowtype;
  n integer;
begin
  select * into r from public.party_items where id = p_item for update;
  if not found then raise exception 'That item is no longer in the party inventory.'; end if;
  if not (is_campaign_gm(r.campaign_id) or tabletop_is_player(r.campaign_id)) then
    raise exception 'not at this table';
  end if;
  n := coalesce(p_qty, r.qty);
  if n < 1 then raise exception 'Take at least one.'; end if;
  if n > r.qty then raise exception 'The party has only % of those.', r.qty; end if;
  if n = r.qty then
    delete from public.party_items where id = r.id;
  else
    update public.party_items set qty = qty - n, updated_at = now() where id = r.id;
  end if;
  return jsonb_build_object('name', r.name, 'qty', n, 'weight', r.weight, 'note', r.note, 'custom', r.custom,
    'mod', r.mod, 'variant', r.variant, 'left', r.qty - n);
end;
$function$;
revoke all on function public.party_take(uuid, integer) from public, anon;
grant execute on function public.party_take(uuid, integer) to authenticated;

-- Add or take coins. p_delta holds any of pp, gp, ep, sp, cp; a negative amount takes coins out.
create or replace function public.party_fund_change(p_campaign uuid, p_delta jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  f public.party_funds%rowtype;
  d record;
  k text;
begin
  if not (is_campaign_gm(p_campaign) or tabletop_is_player(p_campaign)) then raise exception 'not at this table'; end if;
  if p_delta is null or jsonb_typeof(p_delta) <> 'object' then raise exception 'Say which coins.'; end if;
  for k in select jsonb_object_keys(p_delta) loop
    if k not in ('pp', 'gp', 'ep', 'sp', 'cp') then raise exception 'Unknown coin: %', k; end if;
    if jsonb_typeof(p_delta -> k) <> 'number' or abs((p_delta ->> k)::numeric) > 10000000 then raise exception 'Bad amount for %', k; end if;
  end loop;
  insert into public.party_funds (campaign_id) values (p_campaign) on conflict (campaign_id) do nothing;
  select * into f from public.party_funds where campaign_id = p_campaign for update;
  select coalesce((p_delta ->> 'pp')::int, 0) as pp, coalesce((p_delta ->> 'gp')::int, 0) as gp, coalesce((p_delta ->> 'ep')::int, 0) as ep,
         coalesce((p_delta ->> 'sp')::int, 0) as sp, coalesce((p_delta ->> 'cp')::int, 0) as cp into d;
  if f.pp + d.pp < 0 or f.gp + d.gp < 0 or f.ep + d.ep < 0 or f.sp + d.sp < 0 or f.cp + d.cp < 0 then
    raise exception 'The party does not have that many coins.';
  end if;
  update public.party_funds
     set pp = pp + d.pp, gp = gp + d.gp, ep = ep + d.ep, sp = sp + d.sp, cp = cp + d.cp, updated_by = auth.uid(), updated_at = now()
   where campaign_id = p_campaign
   returning * into f;
  return jsonb_build_object('pp', f.pp, 'gp', f.gp, 'ep', f.ep, 'sp', f.sp, 'cp', f.cp);
end;
$function$;
revoke all on function public.party_fund_change(uuid, jsonb) from public, anon;
grant execute on function public.party_fund_change(uuid, jsonb) to authenticated;
