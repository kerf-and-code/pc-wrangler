-- supabase/migrations/p123-roll-tables.sql (2026-11-08)
--
-- Phase 5r: rollable tables (gap 2 in the tabletop audit doc). A campaign's random tables: loot,
-- encounters, names, weather, wild magic. The GM writes them at the table (Tables tab); each is plain
-- text, one entry per line, read by lib/tabletop/roll-tables.ts (numbered book tables like "01-05
-- Goblins" on a d100, or weighted lists like "3x Bandits").
--
-- Rolling happens on the server (app/api/tabletop/table-roll, lib/dice, crypto), which posts the result
-- to the table's chat as a roll card (vtt_messages kind 'roll', which p105 already allows), so the
-- number and the entry are one fact everyone sees.
--
-- Who may: the GM reads and writes every table of their campaign. A player at the table reads (and so
-- may roll) only the tables the GM marked players_can_roll, such as a wild magic table. results_gm_only
-- keeps the result card between the GM and whoever rolled.
--
-- Idempotent. Run by hand after p122, then supabase/checks/p123-roll-tables-check.sql.

create table if not exists public.roll_tables (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  name             text not null check (char_length(trim(name)) between 1 and 80),
  body             text not null default '' check (char_length(body) <= 20000),
  players_can_roll boolean not null default false,
  results_gm_only  boolean not null default false,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists roll_tables_campaign_idx on public.roll_tables (campaign_id, name);

alter table public.roll_tables enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roll_tables' and policyname = 'roll_tables_gm') then
    create policy roll_tables_gm on public.roll_tables
      for all using (public.is_campaign_gm(campaign_id)) with check (public.is_campaign_gm(campaign_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'roll_tables' and policyname = 'roll_tables_player_read') then
    create policy roll_tables_player_read on public.roll_tables
      for select using (players_can_roll and public.tabletop_is_player(campaign_id));
  end if;
end;
$$;

revoke all on public.roll_tables from anon;
grant select, insert, update, delete on public.roll_tables to authenticated;
