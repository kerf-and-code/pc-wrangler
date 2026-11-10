-- supabase/migrations/p141-tabletop-system.sql (2026-11-09)
--
-- Push 5 (audit G3, L-G2): the tabletop learns the campaign's game system, so its quick dice and roll
-- cards follow the system (Hope and Fear for Daggerheart, the 2d10 power roll for Draw Steel) and it stops
-- calling d20 hits against AC outside D&D. tabletop_state does not carry the system, and players reach the
-- table through their characters rather than always through a membership, so this small read is for
-- anyone at the table: the GM, or a player with a character there.
--
-- Idempotent. Run by hand after p140, then supabase/checks/p141-tabletop-system-check.sql.

create or replace function public.tabletop_system(p_campaign uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select c.system from public.campaigns c
   where c.id = p_campaign
     and (public.is_campaign_gm(p_campaign) or public.tabletop_is_player(p_campaign));
$function$;
revoke all on function public.tabletop_system(uuid) from public, anon;
grant execute on function public.tabletop_system(uuid) to authenticated;
