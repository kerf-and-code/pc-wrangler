-- p98: partnered classes and their subclasses, used with permission (see /licenses).
--   52 catalog rows: Gunslinger 6, Illrigger 1, Investigator 8, Magus 6, Pugilist 6, Warden 7, Warmage 8, Witch 9, Fighter 1.
-- Illrigger Sanguine Knight is new; the older Fiendbound Marauder row is left as is.
-- Pugilist (Tome of Heroes) is a Fighter subclass, so it gets a Fighter row; the Monk row is untouched.
--
-- Capability tags use the 12-tag coverage vocabulary (lib/party/coverage.ts DND_TAGS).
--
-- Safe to re-run: each insert is skipped when the row already exists. class_capabilities has no
-- unique constraint, so the guard is a NOT EXISTS rather than ON CONFLICT.

-- Before: count of these rows that already exist (expect 0 on first run).
select count(*) as existing from public.class_capabilities
 where system = '5e' and (class, subclass) in (('Gunslinger','Deadeye'),('Gunslinger','High Roller'),('Gunslinger','Secret Agent'),('Gunslinger','Spellslinger'),('Gunslinger','Trick Shot'),('Gunslinger','White Hat'),('Illrigger','Sanguine Knight'),('Investigator','Antiquarian'),('Investigator','Archivist'),('Investigator','Detective'),('Investigator','Exterminator'),('Investigator','Inquisitor'),('Investigator','Medium'),('Investigator','Occultist'),('Investigator','Spy'),('Magus','Arcane Order'),('Magus','Heaven''s Guard'),('Magus','Knights Stygian'),('Magus','Shadow Court'),('Magus','Sidereal Cabal'),('Magus','Sylvan Circle'),('Pugilist','Dog and Hound'),('Pugilist','Hand of Dread'),('Pugilist','Piss and Vinegar'),('Pugilist','Street Saint'),('Pugilist','Squared Circle'),('Pugilist','Sweet Science'),('Warden','Bloodwrath Guardian'),('Warden','Grey Watchman'),('Warden','Nightgaunt'),('Warden','Soulblood Shaman'),('Warden','Stoneheart Defender'),('Warden','Storm Sentinel'),('Warden','Verdant Protector'),('Warmage','House of Bishops'),('Warmage','House of Cards'),('Warmage','House of Dice'),('Warmage','House of Kings'),('Warmage','House of Knights'),('Warmage','House of Lancers'),('Warmage','House of Pawns'),('Warmage','House of Rooks'),('Witch','Black Magic'),('Witch','Blood Magic'),('Witch','Green Magic'),('Witch','Purple Magic'),('Witch','Red Magic'),('Witch','Steel Magic'),('Witch','Tea Magic'),('Witch','Technicolor Magic'),('Witch','White Magic'),('Fighter','Pugilist'));

insert into public.class_capabilities (system, class, subclass, capabilities, partnered, partner)
select '5e', v.class, v.subclass, v.caps, true, v.partner
from (values
  ('Gunslinger', 'Deadeye', array['ranged','single_target','stealth'], 'Mage Hand Press'),
  ('Gunslinger', 'High Roller', array['ranged','single_target','face'], 'Mage Hand Press'),
  ('Gunslinger', 'Secret Agent', array['ranged','stealth','face','melee'], 'Mage Hand Press'),
  ('Gunslinger', 'Spellslinger', array['ranged','single_target','utility','control'], 'Mage Hand Press'),
  ('Gunslinger', 'Trick Shot', array['ranged','single_target','support'], 'Mage Hand Press'),
  ('Gunslinger', 'White Hat', array['ranged','support','control','tank'], 'Mage Hand Press'),
  ('Illrigger', 'Sanguine Knight', array['support','healing','melee'], 'MCDM'),
  ('Investigator', 'Antiquarian', array['utility','single_target','support'], 'Mage Hand Press'),
  ('Investigator', 'Archivist', array['utility','control'], 'Mage Hand Press'),
  ('Investigator', 'Detective', array['utility','face','melee'], 'Mage Hand Press'),
  ('Investigator', 'Exterminator', array['melee','single_target'], 'Mage Hand Press'),
  ('Investigator', 'Inquisitor', array['melee','control','healing'], 'Mage Hand Press'),
  ('Investigator', 'Medium', array['support','utility'], 'Mage Hand Press'),
  ('Investigator', 'Occultist', array['ranged','single_target','control'], 'Mage Hand Press'),
  ('Investigator', 'Spy', array['stealth','face','single_target'], 'Mage Hand Press'),
  ('Magus', 'Arcane Order', array['control','utility','melee','single_target'], 'Sterling Vermin'),
  ('Magus', 'Heaven''s Guard', array['tank','healing','support','melee'], 'Sterling Vermin'),
  ('Magus', 'Knights Stygian', array['single_target','control','melee'], 'Sterling Vermin'),
  ('Magus', 'Shadow Court', array['stealth','melee','utility'], 'Sterling Vermin'),
  ('Magus', 'Sidereal Cabal', array['support','control'], 'Sterling Vermin'),
  ('Magus', 'Sylvan Circle', array['support','healing','utility','melee'], 'Sterling Vermin'),
  ('Pugilist', 'Dog and Hound', array['melee','control','single_target'], 'Sterling Vermin'),
  ('Pugilist', 'Hand of Dread', array['melee','single_target','utility'], 'Sterling Vermin'),
  ('Pugilist', 'Piss and Vinegar', array['melee','tank','control','face'], 'Sterling Vermin'),
  ('Pugilist', 'Street Saint', array['melee','healing','support','tank'], 'Sterling Vermin'),
  ('Pugilist', 'Squared Circle', array['control','tank','melee'], 'Sterling Vermin'),
  ('Pugilist', 'Sweet Science', array['melee','single_target','tank'], 'Sterling Vermin'),
  ('Warden', 'Bloodwrath Guardian', array['melee','single_target','tank'], 'Mage Hand Press'),
  ('Warden', 'Grey Watchman', array['melee','tank','control'], 'Mage Hand Press'),
  ('Warden', 'Nightgaunt', array['melee','tank','single_target'], 'Mage Hand Press'),
  ('Warden', 'Soulblood Shaman', array['tank','utility','control'], 'Mage Hand Press'),
  ('Warden', 'Stoneheart Defender', array['tank','control','melee'], 'Mage Hand Press'),
  ('Warden', 'Storm Sentinel', array['tank','single_target','control'], 'Mage Hand Press'),
  ('Warden', 'Verdant Protector', array['tank','control','stealth'], 'Mage Hand Press'),
  ('Warmage', 'House of Bishops', array['single_target','ranged','utility','control'], 'Mage Hand Press'),
  ('Warmage', 'House of Cards', array['single_target','ranged','melee'], 'Mage Hand Press'),
  ('Warmage', 'House of Dice', array['single_target','utility','control'], 'Mage Hand Press'),
  ('Warmage', 'House of Kings', array['support','control'], 'Mage Hand Press'),
  ('Warmage', 'House of Knights', array['melee','tank','single_target'], 'Mage Hand Press'),
  ('Warmage', 'House of Lancers', array['melee','single_target'], 'Mage Hand Press'),
  ('Warmage', 'House of Pawns', array['ranged','single_target','utility'], 'Mage Hand Press'),
  ('Warmage', 'House of Rooks', array['stealth','melee','single_target'], 'Mage Hand Press'),
  ('Witch', 'Black Magic', array['control'], 'Mage Hand Press'),
  ('Witch', 'Blood Magic', array['control','single_target','utility'], 'Mage Hand Press'),
  ('Witch', 'Green Magic', array['control','support','utility'], 'Mage Hand Press'),
  ('Witch', 'Purple Magic', array['control','face'], 'Mage Hand Press'),
  ('Witch', 'Red Magic', array['single_target','ranged','control'], 'Mage Hand Press'),
  ('Witch', 'Steel Magic', array['melee','single_target','control'], 'Mage Hand Press'),
  ('Witch', 'Tea Magic', array['support','utility'], 'Mage Hand Press'),
  ('Witch', 'Technicolor Magic', array['support','face'], 'Mage Hand Press'),
  ('Witch', 'White Magic', array['healing','support'], 'Mage Hand Press'),
  ('Fighter', 'Pugilist', array['melee','tank','single_target'], 'Kobold Press')
) as v(class, subclass, caps, partner)
where not exists (
  -- any system value: the seed stores partnered rows under system 'partner', not '5e'
  select 1 from public.class_capabilities c
  where c.class = v.class and c.subclass = v.subclass
);

-- After: expect 52 rows.
select class, subclass, capabilities, partner from public.class_capabilities
 where system = '5e' and (class, subclass) in (('Gunslinger','Deadeye'),('Gunslinger','High Roller'),('Gunslinger','Secret Agent'),('Gunslinger','Spellslinger'),('Gunslinger','Trick Shot'),('Gunslinger','White Hat'),('Illrigger','Sanguine Knight'),('Investigator','Antiquarian'),('Investigator','Archivist'),('Investigator','Detective'),('Investigator','Exterminator'),('Investigator','Inquisitor'),('Investigator','Medium'),('Investigator','Occultist'),('Investigator','Spy'),('Magus','Arcane Order'),('Magus','Heaven''s Guard'),('Magus','Knights Stygian'),('Magus','Shadow Court'),('Magus','Sidereal Cabal'),('Magus','Sylvan Circle'),('Pugilist','Dog and Hound'),('Pugilist','Hand of Dread'),('Pugilist','Piss and Vinegar'),('Pugilist','Street Saint'),('Pugilist','Squared Circle'),('Pugilist','Sweet Science'),('Warden','Bloodwrath Guardian'),('Warden','Grey Watchman'),('Warden','Nightgaunt'),('Warden','Soulblood Shaman'),('Warden','Stoneheart Defender'),('Warden','Storm Sentinel'),('Warden','Verdant Protector'),('Warmage','House of Bishops'),('Warmage','House of Cards'),('Warmage','House of Dice'),('Warmage','House of Kings'),('Warmage','House of Knights'),('Warmage','House of Lancers'),('Warmage','House of Pawns'),('Warmage','House of Rooks'),('Witch','Black Magic'),('Witch','Blood Magic'),('Witch','Green Magic'),('Witch','Purple Magic'),('Witch','Red Magic'),('Witch','Steel Magic'),('Witch','Tea Magic'),('Witch','Technicolor Magic'),('Witch','White Magic'),('Fighter','Pugilist'))
 order by class, subclass;
