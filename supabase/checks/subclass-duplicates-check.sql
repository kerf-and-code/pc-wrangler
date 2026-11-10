-- supabase/checks/subclass-duplicates-check.sql (2026-11-10, push 11, audit G8)
-- Read-only. The catalog's double spellings of one subclass. Since push 11 both spellings of each pair
-- below resolve to the same features (lib/subclass-names.ts), so nothing here is broken; this shows
-- whether the duplicate rows exist live, if you ever want to tidy the picker by removing one of each.

select class, subclass, partner, system
  from public.class_capabilities
 where lower(subclass) in ('chronurgy', 'chronurgy magic', 'graviturgy', 'graviturgy magic',
                           'sangromancy', 'sangromancer', 'wretched bloodline', 'wretched bloodline sorcery',
                           'college of dirge singers', 'college of the dirge singer')
 order by class, lower(subclass);
