-- p97: two new subclasses from Ravenloft: The Horrors Within (2025).
--   Artificer Reanimator, Ranger Hollow Warden.
-- College of Spirits, Grave, Phantom, Shadow Magic (Shadow Sorcery) and Undead (Undead Patron)
-- already have rows; their 2024 versions only add features.
--
-- Safe to re-run: each insert is skipped when the row already exists. class_capabilities has no
-- unique constraint, so the guard is a NOT EXISTS rather than ON CONFLICT.

-- Before: neither row should exist yet.
select class, subclass from public.class_capabilities
 where system = '5e' and (class, subclass) in (('Artificer','Reanimator'),('Ranger','Hollow Warden'));

insert into public.class_capabilities (system, class, subclass, capabilities, partnered, partner)
select '5e', v.class, v.subclass, v.caps, false, null
from (values
  ('Artificer', 'Reanimator',    array['support','healing','melee']),
  ('Ranger',    'Hollow Warden', array['tank','melee','control'])
) as v(class, subclass, caps)
where not exists (
  select 1 from public.class_capabilities c
  where c.system = '5e' and c.class = v.class and c.subclass = v.subclass
);

-- After: expect exactly two rows.
select class, subclass, capabilities from public.class_capabilities
 where system = '5e' and (class, subclass) in (('Artificer','Reanimator'),('Ranger','Hollow Warden'))
 order by class;
