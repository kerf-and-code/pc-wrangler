-- Fix: recaps_for_share gated on status='completed', but the pipeline also
-- leaves finished sessions as 'processed', so players saw an empty Recaps tab
-- after session one. Gate on "has a recap" and accept every finished state.
-- (Deeper cleanup still open: normalize 'completed' vs 'processed' to one value.)

create or replace function public.recaps_for_share(code text)
returns table(session_id uuid, session_number integer, recap text)
language sql security definer set search_path to 'public'
as $function$
  select s.id, s.session_number::int, s.recap
  from public.campaigns c
  join public.sessions s on s.campaign_id = c.id
  where c.share_code = code
    and s.recap is not null
    and s.status in ('processed', 'completed', 'done')
  order by s.session_number desc nulls last;
$function$;
grant execute on function public.recaps_for_share(text) to anon, authenticated;
