-- A4 Living Map: map_for_player RPC (player Map tab).
-- Exact copy of the live function (verified via pg_get_functiondef).
-- Returns one row per visible pin, with the linked entity's title resolved.

create or replace function public.map_for_player(p_share text)
returns table(map_id uuid, map_name text, image_path text, pin_id uuid,
              x double precision, y double precision, label text,
              linked_type text, linked_title text)
language sql security definer set search_path to 'public'
as $function$
  with camp as (
    select id from public.campaigns where share_code = p_share
  ),
  vis_maps as (
    select m.id, m.name, m.image_path
    from public.maps m, camp
    where m.campaign_id = camp.id and m.visibility in ('common', 'player')
  )
  select
    vm.id as map_id, vm.name as map_name, vm.image_path,
    p.id as pin_id, p.x, p.y, p.label, p.linked_type,
    case
      when p.linked_type = 'entry' then (select e.title from public.entries e where e.id = p.linked_id)
      when p.linked_type = 'character' then (select ch.name from public.characters ch where ch.id = p.linked_id)
      else null
    end as linked_title
  from vis_maps vm
  left join public.map_pins p
    on p.map_id = vm.id and p.visibility in ('common', 'player')
  order by vm.name;
$function$;
grant execute on function public.map_for_player(text) to anon, authenticated;
