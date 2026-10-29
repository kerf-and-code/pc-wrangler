-- p96: five new subclasses from Forgotten Realms: Heroes of Faerun (2025).
--   Bard Moon (College of the Moon), Paladin Noble Genies (Oath of the Noble Genies),
--   Ranger Winter Walker, Rogue Scion of the Three, Sorcerer Spellfire (Spellfire Sorcery).
-- Knowledge Domain, Banneret and Bladesinging already have rows; their 2024 versions only add features.
--
-- Safe to re-run: each insert is skipped when the row already exists. class_capabilities has no
-- unique constraint, so the guard is a NOT EXISTS rather than ON CONFLICT.

-- Before: none of these five should exist yet.
select class, subclass from public.class_capabilities
 where system = '5e' and (class, subclass) in
   (('Bard','Moon'),('Paladin','Noble Genies'),('Ranger','Winter Walker'),('Rogue','Scion of the Three'),('Sorcerer','Spellfire'));

insert into public.class_capabilities (system, class, subclass, capabilities, partnered, partner)
select '5e', v.class, v.subclass, v.caps, false, null
from (values
  ('Bard',     'Moon',               array['support','healing','utility']),
  ('Paladin',  'Noble Genies',       array['melee','aoe','tank','control']),
  ('Ranger',   'Winter Walker',      array['ranged','control','single_target']),
  ('Rogue',    'Scion of the Three', array['melee','single_target','stealth','control']),
  ('Sorcerer', 'Spellfire',          array['healing','support','single_target','ranged'])
) as v(class, subclass, caps)
where not exists (
  select 1 from public.class_capabilities c
  where c.system = '5e' and c.class = v.class and c.subclass = v.subclass
);

-- After: expect exactly five rows.
select class, subclass, capabilities from public.class_capabilities
 where system = '5e' and (class, subclass) in
   (('Bard','Moon'),('Paladin','Noble Genies'),('Ranger','Winter Walker'),('Rogue','Scion of the Three'),('Sorcerer','Spellfire'))
 order by class;
