-- p95: the Cartographer Artificer subclass (Eberron: Forge of the Artificer, 2025).
--
-- Safe to re-run: the insert is skipped when the row already exists. class_capabilities has no
-- unique constraint, so the guard is a NOT EXISTS rather than ON CONFLICT.
--
-- Capabilities: support (Adventurer's Atlas, Ingenious Movement teleports), control (free Faerie
-- Fire, Banishment), utility (scrying, locate, Teleportation Circle).

insert into public.class_capabilities (system, class, subclass, capabilities, partnered, partner)
select '5e', 'Artificer', 'Cartographer', array['support','control','utility'], false, null
where not exists (
  select 1 from public.class_capabilities
  where system = '5e' and class = 'Artificer' and subclass = 'Cartographer'
);

-- After: expect five Artificer subclasses, Cartographer among them.
select class, subclass, capabilities
  from public.class_capabilities
 where system = '5e' and class = 'Artificer'
 order by subclass;
