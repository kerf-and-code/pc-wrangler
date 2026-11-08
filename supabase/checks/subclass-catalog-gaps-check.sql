-- subclass-catalog-gaps-check.sql (2026-11-08)
--
-- Read-only. The D&D Beyond import reported twelve subclasses as "not in the catalog" although the
-- app holds features for all of them (lib/srd subclass data). The catalog table class_capabilities is
-- what the Forge's subclass picker lists, so a subclass missing there cannot be picked by hand.
-- This shows, for each of the twelve, whether class_capabilities has it, under what exact name and
-- class, and whether it is partnered (hidden until that partner is switched on).

with wanted(class, subclass) as (
  values ('Wizard', 'Necromancer'), ('Warlock', 'Vestige Patron'), ('Sorcerer', 'Aberrant Sorcery'),
         ('Monk', 'Warrior of Mercy'), ('Warlock', 'The Undead'), ('Bard', 'College of Valor'),
         ('Bard', 'College of Glamour'), ('Druid', 'Circle of the Moon'), ('Cleric', 'Twilight Domain'),
         ('Cleric', 'Light Domain'), ('Bard', 'College of Eloquence'), ('Sorcerer', 'Draconic Sorcery')
)
select w.class, w.subclass,
       c.subclass as catalog_name, c.class as catalog_class, c.partnered, c.partner,
       case when c.subclass is null then 'MISSING' else 'present' end as status
  from wanted w
  left join public.class_capabilities c
    on lower(c.class) = lower(w.class)
   and (lower(c.subclass) = lower(w.subclass) or lower(c.subclass) like '%' || lower(split_part(w.subclass, ' ', array_length(string_to_array(w.subclass, ' '), 1))) || '%')
 order by status desc, w.class, w.subclass;

-- Information: how many subclass rows each class has in the catalog.
select class, count(*) filter (where subclass is not null) as subclasses,
       count(*) filter (where subclass is not null and partnered) as partnered
  from public.class_capabilities
 group by class
 order by class;
