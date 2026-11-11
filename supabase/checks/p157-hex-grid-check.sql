-- p157-hex-grid-check.sql (2026-11-11, push 33). Read-only. Run after p157-hex-grid.sql.

-- 1. The ledger row, and tabletop_feet counting hexes (each line should read true).
select (select count(*) from public._migrations where name = 'p157-hex-grid') as ledger,
       public.tabletop_feet(1, 0, 'hexp', 5) = 5 as one_hex_east,
       public.tabletop_feet(0.5, (sqrt(3) / 2)::real, 'hexp', 5) = 5 as one_hex_down_right,
       public.tabletop_feet(3, 0, 'hexp', 5) = 15 as three_hexes,
       public.tabletop_feet(0, 2, 'hexf', 5) = 10 as flat_two_down,
       public.tabletop_feet(3, 4, 'five', 5) = 20 as squares_unchanged;

-- 2. Scenes played on hexes.
select c.name as campaign, s.name as scene, s.settings ->> 'grid' as grid, s.settings ->> 'diagonal' as rule
  from public.vtt_scenes s join public.campaigns c on c.id = s.campaign_id
 where s.settings ->> 'grid' in ('hex-pointy', 'hex-flat')
 order by c.name, s.name;
