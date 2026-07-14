-- Why are 12 of 52 PCs contributing nothing to party coverage?
--
-- Two very different causes hide behind that one number:
--
--   MISSING  - subclass is NULL. Nobody ever entered one. A data-entry gap. The
--              constrained picker prevents the NEXT one; only a human can fill the
--              existing ones (or you accept that a level-1 character has no subclass
--              yet, which is legitimate and NOT a bug).
--
--   MISMATCH - a subclass IS entered, but it matches nothing in class_capabilities.
--              A typo, an edition-name drift, or a subclass that was simply never
--              seeded. THIS is the silent one: the GM believes they recorded it, the
--              app shows it back to them, and the model quietly ignores it.
--
-- Read-only.

-- 1. The split.
select
  case
    when subclass is null then 'MISSING  (no subclass recorded)'
    else 'MISMATCH (recorded, but unknown to the catalog)'
  end as cause,
  count(*) as characters
from public.v_character_catalog_audit
where no_capabilities
group by 1
order by 2 desc;

-- 2. The mismatches, named. These are the ones to fix, and each is a one-line
--    correction. If a name here is real but simply unseeded, the fix is the seed,
--    not the character.
select
  name          as character_name,
  class,
  subclass      as recorded_subclass,
  species,
  species_unknown,
  class_unknown
from public.v_character_catalog_audit
where no_capabilities
  and subclass is not null
order by class, subclass;

-- 3. Near-misses: for each unknown subclass, what does the catalog actually have
--    for that class? Usually the fix is obvious from this alone.
select distinct
  a.subclass as recorded,
  a.class,
  (select string_agg(cc.subclass, ', ' order by cc.subclass)
     from public.class_capabilities cc
    where cc.class = a.class) as catalog_offers
from public.v_character_catalog_audit a
where a.no_capabilities
  and a.subclass is not null
order by a.class;

-- 4. Species and class dirt, separately. Species does not feed coverage at all, so it
--    lower stakes, but it is the same rot and the picker fixes it the same way.
select
  count(*) filter (where species_unknown)  as species_not_in_catalog,
  count(*) filter (where class_unknown)    as class_not_in_catalog,
  count(*) filter (where species_variant is not null) as already_has_a_variant,
  count(*)                                 as total_pcs
from public.v_character_catalog_audit;
