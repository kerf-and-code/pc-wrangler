-- p101: saved encounters and live combats (the combat runner).
--
-- encounters  A fight the GM built on the Encounters page and saved: its name, the rules it was
--             balanced under, and its foes. Each foe keeps a reference to where its stat block came
--             from (the GM's own stat block, or a monster from the SRD/book library by name + source
--             key) so a saved fight can be run later, not just its name and CR.
-- combats     A fight being run on the Combat page: round, whose turn, and every combatant (PCs and
--             monsters) with initiative, HP, AC, conditions, and a snapshot of the monster's stat
--             block taken when the fight started, so the runner never depends on reloading the
--             library and editing a stat block later does not change a fight in progress.
--             `combatants` is stored IN TURN ORDER and `turn` indexes into it.
--
-- Both are GM-only through RLS (is_campaign_gm, the same gate as session_plan_items). Players see a
-- fight only through combat_for_player(share), which returns the turn order WITHOUT monster HP, AC
-- or stat blocks, and leaves out combatants the GM has hidden (an ambush not yet sprung).
--
-- Safe to re-run: create if not exists, drop/create policies, create or replace function.

create table if not exists public.encounters (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name        text not null,
  rules       text not null default '2024',
  foes        jsonb not null default '[]'::jsonb,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists encounters_campaign_idx on public.encounters (campaign_id, updated_at desc);

alter table public.encounters enable row level security;
drop policy if exists "gm all encounters" on public.encounters;
create policy "gm all encounters" on public.encounters
  for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

create table if not exists public.combats (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  encounter_id uuid references public.encounters(id) on delete set null,
  session_id   uuid references public.sessions(id) on delete set null,
  name         text not null default 'Combat',
  rules        text not null default '2024',
  status       text not null default 'active',
  round        integer not null default 1,
  turn         integer not null default 0,
  combatants   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  ended_at     timestamptz,
  constraint combats_status_ck check (status in ('active', 'ended'))
);
create index if not exists combats_campaign_status_idx on public.combats (campaign_id, status, updated_at desc);

alter table public.combats enable row level security;
drop policy if exists "gm all combats" on public.combats;
create policy "gm all combats" on public.combats
  for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

-- The player view: the campaign's most recently updated ACTIVE combat, by share code (the access
-- token every *_for_player / *_for_share function uses). Per visible combatant: id, name, kind,
-- initiative, defeated, whether it is their turn, and conditions for PCs only. Never monster HP, AC
-- or stat blocks; hidden combatants are left out entirely. Returns null when there is no fight.
create or replace function public.combat_for_player(p_share text)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with camp as (
    select id from public.campaigns where share_code = p_share limit 1
  ),
  cb as (
    select * from public.combats
    where campaign_id = (select id from camp) and status = 'active'
    order by updated_at desc
    limit 1
  )
  select case
    when (select id from cb) is null then null::jsonb
    else jsonb_build_object(
      'name',  (select name from cb),
      'round', (select round from cb),
      'order', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id',         e.c->>'id',
                 'name',       e.c->>'name',
                 'kind',       e.c->>'kind',
                 'initiative', e.c->'initiative',
                 'defeated',   coalesce((e.c->>'defeated')::boolean, false),
                 'is_turn',    (e.ord - 1) = (select turn from cb),
                 'conditions', case when e.c->>'kind' = 'pc' then coalesce(e.c->'conditions', '[]'::jsonb) else '[]'::jsonb end
               ) order by e.ord), '[]'::jsonb)
        from cb, jsonb_array_elements(cb.combatants) with ordinality as e(c, ord)
        where not coalesce((e.c->>'hidden')::boolean, false)
      )
    )
  end;
$function$;

grant execute on function public.combat_for_player(text) to anon, authenticated;

-- After: both tables exist with RLS on, and the function is callable.
select c.relname as table_name, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('encounters', 'combats')
order by 1;
