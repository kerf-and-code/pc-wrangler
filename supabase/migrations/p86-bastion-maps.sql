-- p86: persist bastion maps. One bastion workspace per campaign, holding the whole layout plan
-- (kind traditional/ship, active deck count, grid size, per-deck cell grids, placed facilities, doors,
-- and meta: level/class/allowed sources/flavor/defensive walls) as a single jsonb object, exactly the
-- way building_maps (p73) stores its plan. The GM of the campaign owns it. Idempotent; run by hand in
-- the Supabase SQL editor BEFORE deploying the code that writes it.

create table if not exists public.bastion_maps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.campaigns(id) on delete cascade,
  plan jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bastion_maps enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'bastion_maps' and policyname = 'bastion_maps_gm') then
    create policy bastion_maps_gm on public.bastion_maps
      using (exists (select 1 from public.campaigns c where c.id = bastion_maps.campaign_id and c.gm_id = auth.uid()))
      with check (exists (select 1 from public.campaigns c where c.id = bastion_maps.campaign_id and c.gm_id = auth.uid()));
  end if;
end $$;

-- Verify:
--   select campaign_id, plan->>'kind' as kind, plan->>'gridN' as grid, updated_at from public.bastion_maps;
