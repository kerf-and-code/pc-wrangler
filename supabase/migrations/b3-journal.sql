-- B3 Campaign Journal: campaign_journals table + journal_for_share RPC.
-- RPC is an exact copy of the live function (verified via pg_get_functiondef).

create table if not exists public.campaign_journals (
  campaign_id  uuid primary key references public.campaigns(id) on delete cascade,
  content      jsonb not null,
  generated_at timestamptz not null default now()
);

alter table public.campaign_journals enable row level security;
drop policy if exists "gm reads journal" on public.campaign_journals;
create policy "gm reads journal" on public.campaign_journals
  for select using (is_campaign_gm(campaign_id));

create or replace function public.journal_for_share(p_share text)
returns jsonb language sql security definer set search_path to 'public'
as $function$
  select cj.content
  from public.campaign_journals cj
  join public.campaigns c on c.id = cj.campaign_id
  where c.share_code = p_share;
$function$;
grant execute on function public.journal_for_share(text) to anon, authenticated;
