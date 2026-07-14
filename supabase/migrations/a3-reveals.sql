-- A3 Player reveals: entry_reveals + codex_for_player RPC.
-- entry_reveals table and codex_for_player both live here (they must ship together;
-- shipping the code without this file is what caused the "function does not exist" gap).

create table if not exists public.entry_reveals (
  id                       uuid primary key default gen_random_uuid(),
  campaign_id              uuid not null references public.campaigns(id) on delete cascade,
  target_type              text not null,
  target_id                uuid not null,
  revealed_to_character_id uuid not null references public.characters(id) on delete cascade,
  created_at               timestamptz not null default now(),
  unique (target_type, target_id, revealed_to_character_id)
);
create index if not exists entry_reveals_campaign_idx on public.entry_reveals(campaign_id);
create index if not exists entry_reveals_target_idx   on public.entry_reveals(target_type, target_id);

alter table public.entry_reveals enable row level security;
drop policy if exists "gm all reveals" on public.entry_reveals;
create policy "gm all reveals" on public.entry_reveals
  for all using (is_campaign_gm(campaign_id)) with check (is_campaign_gm(campaign_id));

-- Player Codex read: party-visible entries + NPCs, plus anything revealed to the caller.
create or replace function public.codex_for_player(p_share text)
returns table(item_kind text, item_type text, id uuid, title text, body text)
language sql security definer set search_path to 'public' as $function$
  with camp as (select id from public.campaigns where share_code = p_share),
  me as (
    select ch.id from public.characters ch, camp
    where ch.campaign_id = camp.id and ch.kind = 'pc' and ch.profile_id = auth.uid()
    limit 1
  ),
  revealed as (
    select er.target_type, er.target_id from public.entry_reveals er, me
    where er.revealed_to_character_id = me.id
  )
  select 'entry'::text, e.type, e.id, e.title, e.body
  from public.entries e, camp
  where e.campaign_id = camp.id
    and (e.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type='entry' and r.target_id=e.id))
  union all
  select 'npc'::text, 'npc'::text, ch.id, ch.name, ch.description
  from public.characters ch, camp
  where ch.campaign_id = camp.id and ch.kind = 'npc'
    and (ch.visibility in ('common','player')
         or exists (select 1 from revealed r where r.target_type='character' and r.target_id=ch.id));
$function$;
grant execute on function public.codex_for_player(text) to anon, authenticated;
