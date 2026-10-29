-- p94: catalog rows for the 2024-era species added to rules-data.json SPECIES.
--
-- Safe to re-run: every insert is ON CONFLICT DO NOTHING against the existing unique keys
-- (species: system + name; species_variants: species_id + name + variant_kind).
--
-- WHY: a species with mechanics but no catalog row cannot be picked. These five were in the
-- library audit as missing; the Elf lineages come from Lorwyn: First Light's Adapting Species.
--   Khoravar           Eberron: Forge of the Artificer
--   Lupin              Ravenloft: The Horrors Within
--   Lorwyn Changeling  Lorwyn: First Light
--   Rimekin            Lorwyn: First Light
--   Duskling           D&D Beyond Drops
--   Elf lineages       Lorwyn Elf, Shadowmoor Elf (2024 lineage rows)

insert into public.species (system, name, source, partnered, partner, edition, sort)
values
  ('5e', 'Khoravar', 'Forge of the Artificer', false, null, '2024', 52),
  ('5e', 'Lupin', 'Ravenloft: The Horrors Within', false, null, '2024', 58),
  ('5e', 'Lorwyn Changeling', 'Lorwyn: First Light', false, null, '2024', 66),
  ('5e', 'Rimekin', 'Lorwyn: First Light', false, null, '2024', 67),
  ('5e', 'Duskling', 'D&D Beyond Drops', false, null, '2024', 68)
on conflict (system, name) do nothing;

insert into public.species_variants (species_id, name, variant_kind, source, partnered, partner, edition, sort)
values
  ((select id from public.species where system = '5e' and name = 'Elf'), 'Lorwyn Elf', 'lineage', 'Lorwyn: First Light', false, null, '2024', 11),
  ((select id from public.species where system = '5e' and name = 'Elf'), 'Shadowmoor Elf', 'lineage', 'Lorwyn: First Light', false, null, '2024', 12)
on conflict (species_id, name, variant_kind) do nothing;

-- After: expect 5 species rows and 2 Elf lineage rows.
select name, source, edition, sort
  from public.species
 where system = '5e' and name in ('Khoravar', 'Lupin', 'Lorwyn Changeling', 'Rimekin', 'Duskling')
 order by sort;

select v.name, v.variant_kind, v.source, v.edition
  from public.species_variants v
  join public.species s on s.id = v.species_id
 where s.system = '5e' and s.name = 'Elf' and v.name in ('Lorwyn Elf', 'Shadowmoor Elf');
