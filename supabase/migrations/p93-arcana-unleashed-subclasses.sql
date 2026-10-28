-- p93: Arcana Unleashed (2026) subclasses in the class catalog.
--
-- WHAT THIS DOES
--   1. Adds the two subclasses that are new in Arcana Unleashed:
--        Monk    "Mystic Arts" (Warrior of the Mystic Arts)
--        Warlock "Vestige"     (Vestige Patron)
--      Names follow the catalog's short-name convention ("Open Hand", "Fiend"), not the book title.
--   2. Re-tags the two revised subclasses whose play pattern actually changed:
--        Cleric  "Arcana"        detect_magic, control, utility -> support, control, detect_magic
--        Fighter "Arcane Archer" ranged, control                -> ranged, control, utility
--
-- WHY THE OTHER FOUR REVISIONS ARE NOT TOUCHED
--   Conjuration, Enchantment, Necromancy, and Transmutation are revised in the book too, but their
--   existing tags still describe how they play (summoner/teleporter, charm/face, undead/necrotic,
--   buffs/utility). Re-tagging for the sake of it would move the encounter balancer for no reason.
--
-- WHY NO RENAMES
--   Characters store the subclass by catalog NAME, and the p4 audit view flags any character whose
--   subclass is missing from the catalog. Renaming "Arcana" to "Arcana Domain" (or "Conjuration" to
--   "Conjurer") would orphan every existing character with that subclass. The revision replaces the
--   content, so the row keeps its name.
--
-- CAPABILITY TAGS, read from the features (not the names):
--   Mystic Arts  melee    Unarmed Strikes stay the core attack
--                ranged   Mystic Fighting Style swaps a strike for a Sorcerer cantrip
--                control  Focused Strike: Stunning Strike targets get Disadvantage vs your spells
--   Vestige      ranged   Vestige's Strike (60 ft) plus Warlock casting
--                support  Celestial Healing Touch, borrowed Life/Light/War domain spells
--                single_target  the companion is a second single-target damage source
--   Arcana       support  Modify Magic: Fortifying Spell hands out 2d8 + level temp HP
--                control  Tenacious Spell save penalty; Counterspell/Dispel Magic always prepared
--                detect_magic  Detect Magic always prepared (kept)
--                (utility dropped: the revision trades general utility for the spell buffs)
--   Arcane Archer ranged, control (kept) + utility: Magical Ammunition (unlock, vine, darkness)
--
-- Idempotent: the inserts skip existing rows; the updates set absolute values.

-- Before: what is there now (read-only, run first if you want to see the change)
-- select class, subclass, capabilities from public.class_capabilities
--  where system = '5e' and (class, subclass) in
--   (('Cleric','Arcana'), ('Fighter','Arcane Archer'), ('Monk','Mystic Arts'), ('Warlock','Vestige'));

insert into public.class_capabilities (system, class, subclass, capabilities, partnered, partner)
select '5e', 'Monk', 'Mystic Arts', array['melee','ranged','control'], false, null
where not exists (
  select 1 from public.class_capabilities
  where system = '5e' and class = 'Monk' and subclass = 'Mystic Arts'
);

insert into public.class_capabilities (system, class, subclass, capabilities, partnered, partner)
select '5e', 'Warlock', 'Vestige', array['ranged','support','single_target'], false, null
where not exists (
  select 1 from public.class_capabilities
  where system = '5e' and class = 'Warlock' and subclass = 'Vestige'
);

update public.class_capabilities
   set capabilities = array['support','control','detect_magic']
 where system = '5e' and class = 'Cleric' and subclass = 'Arcana';

update public.class_capabilities
   set capabilities = array['ranged','control','utility']
 where system = '5e' and class = 'Fighter' and subclass = 'Arcane Archer';

-- After: expect exactly 4 rows, one each
select class, subclass, capabilities, partnered, partner
  from public.class_capabilities
 where system = '5e' and (class, subclass) in
  (('Cleric','Arcana'), ('Fighter','Arcane Archer'), ('Monk','Mystic Arts'), ('Warlock','Vestige'))
 order by class;
