-- p100: remove the two duplicate Pugilist subclass rows p98 created.
--
-- p98's NOT EXISTS guard only looked at system '5e' rows, but the seed stores partnered rows under
-- system 'partner', so Pugilist "Squared Circle" and "Sweet Science" (Sterling Vermin) were inserted a
-- second time. This deletes the p98 copy (system '5e') ONLY where the seed copy (system 'partner') of the
-- same class and subclass still exists, so one row always remains. Nothing references
-- class_capabilities by key (characters store the subclass as text), so the surviving row serves them.
--
-- The four other same-name pairs the duplicate check listed are NOT duplicates: they are different
-- publishers' subclasses that share a name (Blood Domain: Grim Hollow and Critical Role; Moon Domain:
-- Critical Role and Kobold Press; Circle of Mutation: Loot Tavern and Grim Hollow; Oath of the Shield:
-- Loot Tavern and The Griffon's Saddlebag). They stay.
--
-- Safe to re-run: once the copies are gone the delete matches nothing.

-- Before: expect 2 rows per subclass (one '5e', one 'partner').
select class, subclass, system, partner, id from public.class_capabilities
 where class = 'Pugilist' and subclass in ('Squared Circle', 'Sweet Science')
 order by subclass, system;

delete from public.class_capabilities d
using public.class_capabilities k
where d.class = 'Pugilist'
  and d.subclass in ('Squared Circle', 'Sweet Science')
  and d.system = '5e'
  and k.system = 'partner'
  and k.class = d.class
  and k.subclass = d.subclass;

-- After: expect exactly 1 row per subclass, system 'partner'.
select class, subclass, system, partner, id from public.class_capabilities
 where class = 'Pugilist' and subclass in ('Squared Circle', 'Sweet Science')
 order by subclass, system;
