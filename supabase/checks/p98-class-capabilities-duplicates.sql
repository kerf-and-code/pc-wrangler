-- READ ONLY. Subclass picker rows that appear more than once for the same class, subclass AND partner
-- (any system value). Same name from two different publishers is two real subclasses, not a duplicate.
-- p98's guard only looked at system '5e' rows, so the two Pugilist subclasses seeded under
-- system 'partner' (Squared Circle, Sweet Science) may now exist twice. Expect those two at most.
select class, subclass, count(*) as copies, array_agg(system order by system) as systems,
       array_agg(partner order by system) as partners, array_agg(id order by system) as ids
from public.class_capabilities
where subclass is not null
group by class, subclass, partner
having count(*) > 1
order by class, subclass;

-- Context for the 197: how the rows split by system value.
select system, partnered, count(*) from public.class_capabilities group by system, partnered order by 1, 2;

-- Homebrew overrides that point at a shipped card id this build renamed: 2014 cards that were wrongly
-- "-legacy" (a name clash with a different card type or a different book) now keep their own id. Any row
-- here needs its overrides_id updated, or the override stops shadowing its card. Expect zero.
select id, name, overrides_id, ruleset from public.compendium_entries
where overrides_id like '%-legacy' order by overrides_id;
