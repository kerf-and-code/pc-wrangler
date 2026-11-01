-- p99: make every class, species and subclass Six Axes has mechanics for pickable in the GM
-- workspace and the player Forge (both read these catalog tables, not the JSON files).
--   1. classes            9 partnered classes with no catalog row
--   2. species            100 species with mechanics but no catalog row (4 core, 96 partnered)
--   3. class_capabilities 143 subclasses with no picker row (compared on the app's canonical
--                         name, so "Berserker" and "Path of the Berserker" count as the same row)
--   4. repairs the capability tags p98 used: striker, debuffer, buffer, skirmisher, summoner and
--      grappler are not among the 12 tags party coverage reads, so those rows counted for nothing.
--
-- Partner names follow the existing rows so the partner toggles recognize them: Griffon's Saddlebag
-- content uses "The Griffon’s Saddlebag", Humblewood "Humblewood", Obojima "1985 Games", Dr Dhrolin's
-- "Palaeo Games". Species are tagged edition 'both' because the builder carries both editions'
-- rules for them; classes carry the edition their authored data was written for.
--
-- Safe to re-run: classes and species use ON CONFLICT on their (system, name) keys;
-- class_capabilities has no unique key, so its insert is guarded by NOT EXISTS on the canonical name.

create or replace function pg_temp.sx_canon(n text) returns text language sql immutable as $f$
  select btrim(regexp_replace(regexp_replace(btrim(regexp_replace(regexp_replace(
    btrim(regexp_replace(lower(replace(coalesce(n, ''), '’', '''')), '\s+', ' ', 'g')),
    '^(oath of (the )?|circle of (the )?|college of (the )?|school of |way of (the )?|path of (the )?|warrior of (the )?|the )', ''),
    '( domain| patron| \(legacy\))$', '')),
    '^(oath of (the )?|circle of (the )?|college of (the )?|school of |way of (the )?|path of (the )?|warrior of (the )?|the )', ''),
    '( domain| patron| \(legacy\))$', ''))
$f$;

-- Before
select 'classes' as tbl, count(*) as existing from public.classes where system = '5e' and name in ('Gunslinger','Illrigger','Investigator','Magus','Monster Hunter','Pugilist','Warden','Warmage','Witch')
union all
select 'species', count(*) from public.species where system = '5e' and name in ('Chromatic Dragonborn','Gem Dragonborn','Kender','Metallic Dragonborn','Ashborn','Azureborn','Bogborn','Curseborn','Deepborn','Gnarlborn','Graveborn','Harvestborn','Plagueborn','Relicborn','Silkborn','Stoneborn','Threadborn','Accursed','Arisen','Disembodied','Downcast','Dreamer','Grudgel','Laneshi','Ogresh','Wechselkind','Wulven','Cervan','Corvum','Dara','Etherean','Feathren','Floral Dragonborn','Gallus','Geleton','Hedge','Jerbeen','Luma','Mapach','Nakudama','Obojiman Elf','Raptor','Strig','Vulpin','Dhakaani Ghaal''dar','Dhakaani Golin''dar','Dhakaani Guul''dar','Eberron Tiefling','Fernian Aasimar','Gargoyle','Gnoll','Harpy','Jhorgun''taal','Kalamer Landwalker','Mabaran Aasimar','Medusa','Ruinbound','Sahuagin','Worg','Baugsmidr Dwarf','Bearfolk','Beastkin','Darakhul','Fjord Dwarf','Giantkin','Lunar Elf','Northlands Elf','Quickstep','Ratatosk','Sable Elf','Shadow Fey','Shadow Goblin','Spiritfarer Erina','Stygian Shade','Sublime Ravenfolk','Trollkin','Umbral Human','Unbound Satarre','Werekin','Wyrd Gnome','Cnidaran','Cyclopian','Gobboc','Golynn','Lotol','Mycelian','Ombrask','Oozekin','Opteran','Rakin','Geppettin','Mandrake','Manikin','Scourgeborne','Ankylier','Children of Seth','Jeholrak','Limukin','Manyhorn','Pluvenn')
union all
select 'class_capabilities total', count(*) from public.class_capabilities where system = '5e'
union all
select 'rows with non-standard tags', count(*) from public.class_capabilities
 where capabilities && array['striker','debuffer','buffer','skirmisher','summoner','grappler']::text[];

-- 1. classes
insert into public.classes (system, name, source, partnered, partner, edition, sort)
values
  ('5e', 'Gunslinger', 'The Gunslinger Class: Valda''s Spire of Secrets', true, 'Mage Hand Press', '2024', 100),
  ('5e', 'Illrigger', 'The Illrigger', true, 'MCDM', '2014', 100),
  ('5e', 'Investigator', 'Valda''s Spire of Secrets', true, 'Mage Hand Press', '2014', 100),
  ('5e', 'Magus', 'The Magus Class', true, 'Sterling Vermin', '2024', 100),
  ('5e', 'Monster Hunter', 'Grim Hollow: Player''s Guide', true, 'Grim Hollow', '2024', 100),
  ('5e', 'Pugilist', 'The Pugilist Class', true, 'Sterling Vermin', '2024', 100),
  ('5e', 'Warden', 'Valda''s Spire of Secrets', true, 'Mage Hand Press', '2014', 100),
  ('5e', 'Warmage', 'Valda''s Spire of Secrets', true, 'Mage Hand Press', '2014', 100),
  ('5e', 'Witch', 'Valda''s Spire of Secrets', true, 'Mage Hand Press', '2014', 100)
on conflict (system, name) do nothing;

-- 2. species
insert into public.species (system, name, source, partnered, partner, edition, sort)
values
  ('5e', 'Chromatic Dragonborn', 'Fizban''s Treasury of Dragons', false, null, 'both', 100),
  ('5e', 'Gem Dragonborn', 'Fizban''s Treasury of Dragons', false, null, 'both', 100),
  ('5e', 'Kender', 'Dragonlance: Shadow of the Dragon Queen', false, null, 'both', 100),
  ('5e', 'Metallic Dragonborn', 'Fizban''s Treasury of Dragons', false, null, 'both', 100),
  ('5e', 'Ashborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Azureborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Bogborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Curseborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Deepborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Gnarlborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Graveborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Harvestborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Plagueborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Relicborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Silkborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Stoneborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Threadborn', 'The Crooked Moon Part One', true, 'Avantris Entertainment', 'both', 200),
  ('5e', 'Accursed', 'Grim Hollow: Player''s Guide', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Arisen', 'Grim Hollow: Player''s Guide', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Disembodied', 'Grim Hollow: Player Pack', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Downcast', 'Grim Hollow: Player''s Guide', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Dreamer', 'Grim Hollow: Player''s Guide', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Grudgel', 'Grim Hollow: Player''s Guide', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Laneshi', 'Grim Hollow: Player''s Guide', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Ogresh', 'Grim Hollow: Player''s Guide', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Wechselkind', 'Grim Hollow: Player Pack', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Wulven', 'Grim Hollow: Player''s Guide', true, 'Grim Hollow', 'both', 200),
  ('5e', 'Cervan', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Corvum', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Dara', 'Obojima: Tales from the Tall Grass', true, '1985 Games', 'both', 200),
  ('5e', 'Etherean', 'The Griffon''s Saddlebag: Book Two', true, 'The Griffon’s Saddlebag', 'both', 200),
  ('5e', 'Feathren', 'The Griffon''s Saddlebag: Book One', true, 'The Griffon’s Saddlebag', 'both', 200),
  ('5e', 'Floral Dragonborn', 'The Field Guide to Floral Dragons', true, 'Hit Point Press', 'both', 200),
  ('5e', 'Gallus', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Geleton', 'The Griffon''s Saddlebag: Book Two', true, 'The Griffon’s Saddlebag', 'both', 200),
  ('5e', 'Hedge', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Jerbeen', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Luma', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Mapach', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Nakudama', 'Obojima: Tales from the Tall Grass', true, '1985 Games', 'both', 200),
  ('5e', 'Obojiman Elf', 'Obojima: Tales from the Tall Grass', true, '1985 Games', 'both', 200),
  ('5e', 'Raptor', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Strig', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Vulpin', 'Humblewood Campaign Setting', true, 'Humblewood', 'both', 200),
  ('5e', 'Dhakaani Ghaal''dar', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Dhakaani Golin''dar', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Dhakaani Guul''dar', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Eberron Tiefling', 'Frontiers of Eberron: Quickstone', true, 'Keith Baker', 'both', 200),
  ('5e', 'Fernian Aasimar', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Gargoyle', 'Frontiers of Eberron: Quickstone', true, 'Keith Baker', 'both', 200),
  ('5e', 'Gnoll', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Harpy', 'Frontiers of Eberron: Quickstone', true, 'Keith Baker', 'both', 200),
  ('5e', 'Jhorgun''taal', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Kalamer Landwalker', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Mabaran Aasimar', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Medusa', 'Frontiers of Eberron: Quickstone', true, 'Keith Baker', 'both', 200),
  ('5e', 'Ruinbound', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Sahuagin', 'Exploring Eberron', true, 'Keith Baker', 'both', 200),
  ('5e', 'Worg', 'Frontiers of Eberron: Quickstone', true, 'Keith Baker', 'both', 200),
  ('5e', 'Baugsmidr Dwarf', 'Northlands Worldbook', true, 'Kobold Press', 'both', 200),
  ('5e', 'Bearfolk', 'Northlands Worldbook', true, 'Kobold Press', 'both', 200),
  ('5e', 'Beastkin', 'Northlands Worldbook', true, 'Kobold Press', 'both', 200),
  ('5e', 'Darakhul', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Fjord Dwarf', 'Northlands Worldbook', true, 'Kobold Press', 'both', 200),
  ('5e', 'Giantkin', 'Northlands Worldbook', true, 'Kobold Press', 'both', 200),
  ('5e', 'Lunar Elf', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Northlands Elf', 'Northlands Worldbook', true, 'Kobold Press', 'both', 200),
  ('5e', 'Quickstep', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Ratatosk', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Sable Elf', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Shadow Fey', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Shadow Goblin', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Spiritfarer Erina', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Stygian Shade', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Sublime Ravenfolk', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Trollkin', 'Northlands Worldbook', true, 'Kobold Press', 'both', 200),
  ('5e', 'Umbral Human', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Unbound Satarre', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Werekin', 'Northlands Worldbook', true, 'Kobold Press', 'both', 200),
  ('5e', 'Wyrd Gnome', 'Book of Ebon Tides', true, 'Kobold Press', 'both', 200),
  ('5e', 'Cnidaran', 'Heliana''s Guide to Monster Hunting: Part 1', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Cyclopian', 'Heliana''s Guide to Monster Hunting: Part 1', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Gobboc', 'Heliana''s Guide to Monster Hunting: Part 1', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Golynn', 'Heliana''s Guide to Monster Hunting: Part 1', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Lotol', 'Heliana''s Guide to Monster Hunting: Part 2', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Mycelian', 'Heliana''s Guide to Monster Hunting: Part 2', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Ombrask', 'Heliana''s Guide to Monster Hunting: Part 2', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Oozekin', 'Heliana''s Guide to Monster Hunting: Part 2', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Opteran', 'Heliana''s Guide to Monster Hunting: Part 2', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Rakin', 'Heliana''s Guide to Monster Hunting: Part 1', true, 'Loot Tavern', 'both', 200),
  ('5e', 'Geppettin', 'Valda''s Spire of Secrets: Player Pack', true, 'Mage Hand Press', 'both', 200),
  ('5e', 'Mandrake', 'Valda''s Spire of Secrets: Player Pack', true, 'Mage Hand Press', 'both', 200),
  ('5e', 'Manikin', 'Steinhardt''s Guide to the Eldritch Hunt Player Pack', true, 'MonkeyDM', 'both', 200),
  ('5e', 'Scourgeborne', 'Steinhardt''s Guide to the Eldritch Hunt Player Pack', true, 'MonkeyDM', 'both', 200),
  ('5e', 'Ankylier', 'Dr Dhrolin''s Dictionary of Dinosaurs', true, 'Palaeo Games', 'both', 200),
  ('5e', 'Children of Seth', 'Dr Dhrolin''s Dictionary of Dinosaurs', true, 'Palaeo Games', 'both', 200),
  ('5e', 'Jeholrak', 'Dr Dhrolin''s Dictionary of Dinosaurs', true, 'Palaeo Games', 'both', 200),
  ('5e', 'Limukin', 'Dr Dhrolin''s Dictionary of Dinosaurs', true, 'Palaeo Games', 'both', 200),
  ('5e', 'Manyhorn', 'Dr Dhrolin''s Dictionary of Dinosaurs', true, 'Palaeo Games', 'both', 200),
  ('5e', 'Pluvenn', 'Dr Dhrolin''s Dictionary of Dinosaurs', true, 'Palaeo Games', 'both', 200)
on conflict (system, name) do nothing;

-- 3. subclasses
insert into public.class_capabilities (system, class, subclass, capabilities, partnered, partner)
select '5e', v.class, v.subclass, v.caps, v.partner is not null, v.partner
from (values
  ('Apothecary', 'Chemist', array['aoe']::text[], 'Drakkenheim'),
  ('Apothecary', 'Exorcist', array['single_target','support']::text[], 'Drakkenheim'),
  ('Barbarian', 'Path of Booming Magnificence', array['single_target','control']::text[], 'Kobold Press'),
  ('Barbarian', 'Path of the Haze Rager', array['tank','single_target']::text[], 'Drakkenheim'),
  ('Barbarian', 'Path of the Wrathful Dead', array['tank','single_target']::text[], 'Grim Hollow'),
  ('Barbarian', 'Path of the Carrion Raven', array['single_target','melee']::text[], 'Grim Hollow'),
  ('Barbarian', 'Path of the Infernal', array['single_target','control']::text[], 'The Griffon’s Saddlebag'),
  ('Barbarian', 'Path of the Experiment', array['single_target','tank']::text[], 'Avantris Entertainment'),
  ('Barbarian', 'Shadow Gnawer', array['single_target','tank']::text[], 'Kobold Press'),
  ('Barbarian', 'Path of the Titan', array['single_target','tank']::text[], 'Kobold Press'),
  ('Barbarian', 'Path of the Belly Brewer', array['tank','utility']::text[], '1985 Games'),
  ('Barbarian', 'Path of the Lightning Vessel', array['single_target','control']::text[], 'MonkeyDM'),
  ('Barbarian', 'Path of the Spell Scorned', array['single_target','control']::text[], 'Chaosium'),
  ('Barbarian', 'Path of the Demonshard', array[]::text[], 'Keith Baker'),
  ('Bard', 'College of Doomspeakers', array['control','face']::text[], 'Drakkenheim'),
  ('Bard', 'College of Fools', array['control']::text[], 'Grim Hollow'),
  ('Bard', 'College of Choreography', array['support','melee']::text[], 'The Griffon’s Saddlebag'),
  ('Bard', 'College of Mercantile', array['support','face']::text[], 'The Griffon’s Saddlebag'),
  ('Bard', 'College of Shadow', array['support','control']::text[], 'Kobold Press'),
  ('Bard', 'College of Fleshweaving', array['support','control']::text[], 'Loot Tavern'),
  ('Bard', 'College of Cuisine', array['support']::text[], 'Loot Tavern'),
  ('Bard', 'Skald', array['support','melee']::text[], 'Kobold Press'),
  ('Bard', 'College of Masks (Obojima)', array['utility','face']::text[], '1985 Games'),
  ('Bard', 'College of Drama', array['support','face']::text[], 'Chaosium'),
  ('Bard', 'College of Wands', array[]::text[], 'Keith Baker'),
  ('Cleric', 'Black Powder Domain', array['aoe','support']::text[], 'Kobold Press'),
  ('Cleric', 'Purification Domain', array['healing','single_target']::text[], 'Grim Hollow'),
  ('Cleric', 'Dragon Domain', array['aoe','control']::text[], 'Mage Hand Press'),
  ('Cleric', 'Festus Domain', array['support','healing']::text[], 'The Griffon’s Saddlebag'),
  ('Cleric', 'Harvest Domain', array['support','healing']::text[], 'Avantris Entertainment'),
  ('Cleric', 'Keeper Domain', array['support','tank']::text[], 'Kobold Press'),
  ('Cleric', 'Hunt Domain', array['single_target','support']::text[], 'Loot Tavern'),
  ('Cleric', 'Nornbound', array['support','control']::text[], 'Kobold Press'),
  ('Cleric', 'Apocalypse Domain', array['support','control']::text[], 'Chaosium'),
  ('Cleric', 'Commerce Domain', array[]::text[], 'Keith Baker'),
  ('Druid', 'Circle of Entropy', array['single_target','tank']::text[], 'Grim Hollow'),
  ('Druid', 'Circle of the City', array['control','melee']::text[], 'Mage Hand Press'),
  ('Druid', 'The Unbroken Circle', array['melee','single_target']::text[], 'The Griffon’s Saddlebag'),
  ('Druid', 'Circle of Dragons', array['melee','single_target']::text[], 'The Griffon’s Saddlebag'),
  ('Druid', 'Circle of the Old Ways', array['tank','melee']::text[], 'Avantris Entertainment'),
  ('Druid', 'Circle of Wicker', array['support','control']::text[], 'Avantris Entertainment'),
  ('Druid', 'Circle of Shadows', array['control','melee']::text[], 'Kobold Press'),
  ('Druid', 'Circle of the Hive', array['tank','support']::text[], 'Loot Tavern'),
  ('Druid', 'Circle of Fenris', array['single_target','melee']::text[], 'Kobold Press'),
  ('Druid', 'Circle of the Petal', array['support','control']::text[], '1985 Games'),
  ('Druid', 'Circle of Symbiosis', array['tank','single_target']::text[], 'MonkeyDM'),
  ('Druid', 'Circle of the Symbiote', array['tank','support']::text[], 'Chaosium'),
  ('Fighter', 'Dungeoneer', array['utility','melee']::text[], 'Mage Hand Press'),
  ('Fighter', 'Purple Dragon Knight (Banneret)', array['support']::text[], null),
  ('Fighter', 'Sorrow Knight', array['single_target','control']::text[], null),
  ('Fighter', 'Nightwatcher', array['tank','stealth']::text[], 'Grim Hollow'),
  ('Fighter', 'Blade Breaker', array['single_target','control']::text[], 'Grim Hollow'),
  ('Fighter', 'Couatl Herald', array['support','single_target']::text[], 'The Griffon’s Saddlebag'),
  ('Fighter', 'Steel Hawk', array['single_target','melee']::text[], 'The Griffon’s Saddlebag'),
  ('Fighter', 'Barrow Guard', array['tank','control']::text[], 'Avantris Entertainment'),
  ('Fighter', 'Viking', array['single_target','melee']::text[], 'Kobold Press'),
  ('Fighter', 'Neko Duelist', array['single_target','melee']::text[], '1985 Games'),
  ('Fighter', 'The Spirit-Fused', array['single_target','utility']::text[], '1985 Games'),
  ('Fighter', 'Blood Hound', array['single_target','control']::text[], 'MonkeyDM'),
  ('Fighter', 'Hero', array['support','single_target']::text[], 'Chaosium'),
  ('Illrigger', 'Hellspeaker', array['control','face']::text[], 'MCDM'),
  ('Monk', 'Warrior of the Mystic Arts', array['single_target','aoe']::text[], null),
  ('Monk', 'Way of the Arcane Hand', array['melee','single_target']::text[], 'Drakkenheim'),
  ('Monk', 'Way of the Long Death', array['tank','single_target']::text[], null),
  ('Monk', 'Way of the Unerring Arrow', array['single_target']::text[], 'Kobold Press'),
  ('Monk', 'Warrior of Regret', array['single_target','support']::text[], 'Grim Hollow'),
  ('Monk', 'Warrior of the Street', array['single_target']::text[], 'Mage Hand Press'),
  ('Monk', 'Warrior of the Celestial', array['support','single_target']::text[], 'The Griffon’s Saddlebag'),
  ('Monk', 'Way of the Aether', array['single_target','ranged']::text[], 'The Griffon’s Saddlebag'),
  ('Monk', 'Way of the Prophet', array['support','melee']::text[], 'Kobold Press'),
  ('Monk', 'Sheep Dragon Shepherd', array['support','melee']::text[], '1985 Games'),
  ('Monk', 'Warrior of Cosmic Balance', array['control','support']::text[], 'Chaosium'),
  ('Monster Hunter', 'Carver Guild', array['tank','single_target']::text[], 'Grim Hollow'),
  ('Monster Hunter', 'Devourer Guild', array['single_target']::text[], 'Grim Hollow'),
  ('Monster Hunter', 'Occultist Guild', array['aoe','control']::text[], 'Grim Hollow'),
  ('Monster Hunter', 'Trapper Guild', array['control','utility']::text[], 'Grim Hollow'),
  ('Paladin', 'Oath of Slaughter', array['single_target']::text[], 'Grim Hollow'),
  ('Paladin', 'Oath of Revelry', array['support']::text[], 'Mage Hand Press'),
  ('Paladin', 'Oath of the Spelldrinker', array['control','support']::text[], 'The Griffon’s Saddlebag'),
  ('Paladin', 'Oath of Castigation', array['control','single_target']::text[], 'Avantris Entertainment'),
  ('Paladin', 'Oath of the Harvest', array['healing','support']::text[], 'Loot Tavern'),
  ('Paladin', 'Oath of Valhalla', array['support','single_target']::text[], 'Kobold Press'),
  ('Paladin', 'Oath of the River', array['support','control']::text[], '1985 Games'),
  ('Paladin', 'Oath of the Eldritch Hunt', array['single_target','melee']::text[], 'MonkeyDM'),
  ('Paladin', 'Oath of the Guardian', array['tank']::text[], 'Chaosium'),
  ('Ranger', 'Primordial Archer', array['single_target','control']::text[], 'Grim Hollow'),
  ('Ranger', 'Beastborne', array['single_target']::text[], 'Mage Hand Press'),
  ('Ranger', 'Winter Trapper', array['control','single_target']::text[], 'The Griffon’s Saddlebag'),
  ('Ranger', 'Rocborne', array['single_target','utility']::text[], 'The Griffon’s Saddlebag'),
  ('Ranger', 'Trapper', array['control','single_target']::text[], 'Loot Tavern'),
  ('Ranger', 'Corrupted Ranger', array['single_target']::text[], '1985 Games'),
  ('Ranger', 'Torturer Conclave', array['single_target','control']::text[], 'MonkeyDM'),
  ('Ranger', 'Trail Warden', array['support']::text[], 'Chaosium'),
  ('Ranger', 'Bloodhound', array[]::text[], 'Keith Baker'),
  ('Rogue', 'Misfortune Bringer', array['single_target','control']::text[], 'Grim Hollow'),
  ('Rogue', 'Sanguine Thief', array['single_target','utility']::text[], 'Grim Hollow'),
  ('Rogue', 'Arachnoid Stalker', array['single_target','control']::text[], 'Mage Hand Press'),
  ('Rogue', 'Runetagger', array['single_target','control']::text[], 'The Griffon’s Saddlebag'),
  ('Rogue', 'Grim Surgeon', array['single_target','healing']::text[], 'The Griffon’s Saddlebag'),
  ('Rogue', 'Umbral Binder', array['single_target','control']::text[], 'Kobold Press'),
  ('Rogue', 'Fortune Rogue', array['utility','single_target']::text[], '1985 Games'),
  ('Rogue', 'Waxwork Rogue', array['utility','control']::text[], '1985 Games'),
  ('Rogue', 'Blade of Radiance', array['single_target','tank']::text[], 'MonkeyDM'),
  ('Rogue', 'Shadow Stalker', array['single_target','utility']::text[], 'Chaosium'),
  ('Sorcerer', 'Delerium Soul', array['aoe','control']::text[], 'Drakkenheim'),
  ('Sorcerer', 'Runechild', array['support','aoe']::text[], 'Critical Role'),
  ('Sorcerer', 'Apocalypse Sorcery', array['aoe','utility']::text[], 'Grim Hollow'),
  ('Sorcerer', 'Haunted Sorcery', array['utility','control']::text[], 'Grim Hollow'),
  ('Sorcerer', 'Wretched Bloodline Sorcery', array['control']::text[], 'Grim Hollow'),
  ('Sorcerer', 'Heroic Sorcery', array['melee','single_target']::text[], 'Mage Hand Press'),
  ('Sorcerer', 'Frost Sorcery', array['control']::text[], 'The Griffon’s Saddlebag'),
  ('Sorcerer', 'Desert Soul', array['control','aoe']::text[], 'The Griffon’s Saddlebag'),
  ('Sorcerer', 'Light Weaver', array['aoe','support']::text[], 'Kobold Press'),
  ('Sorcerer', 'Skinshifter', array['melee']::text[], 'Loot Tavern'),
  ('Sorcerer', 'Spirit Caller', array['support','utility']::text[], 'Kobold Press'),
  ('Sorcerer', 'Oni Bloodline', array['aoe','melee']::text[], '1985 Games'),
  ('Sorcerer', 'Hungering Dark', array['control']::text[], 'Chaosium'),
  ('Sorcerer', 'Nemesis Sorcery', array[]::text[], 'Keith Baker'),
  ('Warlock', 'Vestige Patron', array['single_target','support']::text[], null),
  ('Warlock', 'The Coven', array['control']::text[], 'Grim Hollow'),
  ('Warlock', 'Future You Patron', array['support','control']::text[], 'Mage Hand Press'),
  ('Warlock', 'The Astral Griffon', array['utility','aoe']::text[], 'The Griffon’s Saddlebag'),
  ('Warlock', 'The Many', array['single_target','tank']::text[], 'The Griffon’s Saddlebag'),
  ('Warlock', 'Mother of Sorrows', array['control']::text[], 'Kobold Press'),
  ('Warlock', 'The Parasite (Heliana''s)', array['single_target','tank']::text[], 'Loot Tavern'),
  ('Warlock', 'Trickster', array['control','melee']::text[], 'Kobold Press'),
  ('Warlock', 'Coven Patron (Obojima)', array['support','utility']::text[], '1985 Games'),
  ('Warlock', 'The Lantern', array['support','control']::text[], '1985 Games'),
  ('Warlock', 'Exalted Assembly of the Feline Court', array['utility','control']::text[], 'Chaosium'),
  ('Warlock', 'Stone Sovereign Patron', array[]::text[], 'Keith Baker'),
  ('Wizard', 'Chronurgy Magic', array['control','support']::text[], null),
  ('Wizard', 'Graviturgy Magic', array['control']::text[], null),
  ('Wizard', 'School of Black Powder', array['aoe']::text[], 'Kobold Press'),
  ('Wizard', 'School of Blood Magic', array['control','single_target']::text[], 'Critical Role'),
  ('Wizard', 'Daemonologist', array['utility','support']::text[], 'Grim Hollow'),
  ('Wizard', 'Sangromancer', array['aoe']::text[], 'Grim Hollow'),
  ('Wizard', 'Magic Missile Mage', array['aoe']::text[], 'Mage Hand Press'),
  ('Wizard', 'Materializer', array['utility','control']::text[], 'The Griffon’s Saddlebag'),
  ('Wizard', 'Wand Lore', array['utility']::text[], 'The Griffon’s Saddlebag'),
  ('Wizard', 'Shadow Arcane Tradition', array['control','utility']::text[], 'Kobold Press'),
  ('Wizard', 'Origami Mage', array['utility','support']::text[], '1985 Games'),
  ('Wizard', 'Osteomancer', array['control','tank']::text[], 'MonkeyDM'),
  ('Wizard', 'Bibliomancy', array['aoe','utility']::text[], 'Chaosium')
) as v(class, subclass, caps, partner)
where not exists (
  select 1 from public.class_capabilities c
  where c.system = '5e' and c.class = v.class and pg_temp.sx_canon(c.subclass) = pg_temp.sx_canon(v.subclass)
);

-- 4. tag repair (map each non-standard tag onto the coverage vocabulary, then drop duplicates)
update public.class_capabilities c
set capabilities = (
  select array_agg(t order by min_ord) from (
    select t, min(ord) as min_ord from unnest(
      array_replace(array_replace(array_replace(array_replace(array_replace(array_replace(
        c.capabilities, 'striker', 'single_target'), 'debuffer', 'control'), 'buffer', 'support'),
        'skirmisher', 'melee'), 'summoner', 'control'), 'grappler', 'control')
    ) with ordinality as u(t, ord) group by t
  ) x
)
where c.capabilities && array['striker','debuffer','buffer','skirmisher','summoner','grappler']::text[];

-- After: expect classes 9, species 100, class_capabilities total up by at most 143, non-standard 0.
select 'classes' as tbl, count(*) as existing from public.classes where system = '5e' and name in ('Gunslinger','Illrigger','Investigator','Magus','Monster Hunter','Pugilist','Warden','Warmage','Witch')
union all
select 'species', count(*) from public.species where system = '5e' and name in ('Chromatic Dragonborn','Gem Dragonborn','Kender','Metallic Dragonborn','Ashborn','Azureborn','Bogborn','Curseborn','Deepborn','Gnarlborn','Graveborn','Harvestborn','Plagueborn','Relicborn','Silkborn','Stoneborn','Threadborn','Accursed','Arisen','Disembodied','Downcast','Dreamer','Grudgel','Laneshi','Ogresh','Wechselkind','Wulven','Cervan','Corvum','Dara','Etherean','Feathren','Floral Dragonborn','Gallus','Geleton','Hedge','Jerbeen','Luma','Mapach','Nakudama','Obojiman Elf','Raptor','Strig','Vulpin','Dhakaani Ghaal''dar','Dhakaani Golin''dar','Dhakaani Guul''dar','Eberron Tiefling','Fernian Aasimar','Gargoyle','Gnoll','Harpy','Jhorgun''taal','Kalamer Landwalker','Mabaran Aasimar','Medusa','Ruinbound','Sahuagin','Worg','Baugsmidr Dwarf','Bearfolk','Beastkin','Darakhul','Fjord Dwarf','Giantkin','Lunar Elf','Northlands Elf','Quickstep','Ratatosk','Sable Elf','Shadow Fey','Shadow Goblin','Spiritfarer Erina','Stygian Shade','Sublime Ravenfolk','Trollkin','Umbral Human','Unbound Satarre','Werekin','Wyrd Gnome','Cnidaran','Cyclopian','Gobboc','Golynn','Lotol','Mycelian','Ombrask','Oozekin','Opteran','Rakin','Geppettin','Mandrake','Manikin','Scourgeborne','Ankylier','Children of Seth','Jeholrak','Limukin','Manyhorn','Pluvenn')
union all
select 'class_capabilities total', count(*) from public.class_capabilities where system = '5e'
union all
select 'rows with non-standard tags', count(*) from public.class_capabilities
 where capabilities && array['striker','debuffer','buffer','skirmisher','summoner','grappler']::text[];
