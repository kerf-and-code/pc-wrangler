-- Re-tag the partnered subclasses to core density.
--
-- THE PROBLEM. Core subclasses average 2.69 capability tags. Partnered ones averaged
-- 1.42, and 68% carried exactly ONE, usually 'utility'. Nothing about third-party
-- design makes those subclasses half as capable: it is an artifact of how the seed was
-- written. Core got careful tagging, partnered got a token.
--
-- It matters because capabilities drive party coverage, which drives the GM's
-- composition panel and the encounter balancer's "what this party cannot do" check. A
-- player running a Kobold Press subclass was credited with fewer capabilities than one
-- running a PHB subclass, for reasons that had nothing to do with the subclass.
--
-- (To be clear, and because an earlier version of this comment got it wrong:
-- class_capabilities does NOT feed the disposition model. It is read by the GM
-- workspace and the encounter balancer, and by nothing else.)
--
-- THE METHOD. For each class, its CORE subclasses were counted and their tags ranked by
-- frequency. That ranking is the class profile: what that class characteristically does,
-- according to the tagging you already trusted. Each partnered subclass KEEPS whatever
-- tag it had, then takes the class's top-ranked tags it does not already have, until it
-- reaches three.
--
-- Nine classes are homebrew and have no core subclasses at all (Apothecary, Beastheart,
-- Blood Hunter, Captain, Illrigger, Mystic, Pugilist, The Talent, Warrior). For those,
-- the class's own BASE row leads (it is the designer's own statement of what the class
-- does), then its own subclasses are pooled.
--
-- Nothing was invented. Every added tag came from that class's existing data.
--
-- RESULT: mean 1.42 -> 2.99 tags. Zero rows left with a single tag. Core benchmark 2.69.
--
-- Idempotent: re-running sets the same values.

-- 142 rows updated.

update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Bard' and subclass = 'College of Masks' and partner = '1985 Games';
update public.class_capabilities set capabilities = array['melee','single_target','control'] where class = 'Monk' and subclass = 'Way of the Soaring Spirit' and partner = '1985 Games';
update public.class_capabilities set capabilities = array['utility','stealth','single_target'] where class = 'Rogue' and subclass = 'Phantom Thief' and partner = '1985 Games';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Sorcerer' and subclass = 'Corrupted Bloodline' and partner = '1985 Games';
update public.class_capabilities set capabilities = array['control','support','utility'] where class = 'Bard' and subclass = 'College of Whistles' and partner = 'Avantris Entertainment';
update public.class_capabilities set capabilities = array['melee','single_target','control'] where class = 'Monk' and subclass = 'Warrior of the Pestilent Haze' and partner = 'Avantris Entertainment';
update public.class_capabilities set capabilities = array['single_target','control','ranged'] where class = 'Ranger' and subclass = 'Grim Harbinger' and partner = 'Avantris Entertainment';
update public.class_capabilities set capabilities = array['support','stealth','utility'] where class = 'Rogue' and subclass = 'Sinner' and partner = 'Avantris Entertainment';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Sorcerer' and subclass = 'Crimson Sorcery' and partner = 'Avantris Entertainment';
update public.class_capabilities set capabilities = array['control','single_target','aoe'] where class = 'Warlock' and subclass = 'The Great Fool' and partner = 'Avantris Entertainment';
update public.class_capabilities set capabilities = array['utility','control','single_target'] where class = 'Warlock' and subclass = 'The Horned King' and partner = 'Avantris Entertainment';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Wizard' and subclass = 'Occultist' and partner = 'Avantris Entertainment';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Wizard' and subclass = 'Philosopher' and partner = 'Avantris Entertainment';
update public.class_capabilities set capabilities = array['tank','melee','control'] where class = 'Barbarian' and subclass = 'Path of the Juggernaut' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['control','melee','support'] where class = 'Bard' and subclass = 'College of Tragedy' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['single_target','melee','control'] where class = 'Blood Hunter' and subclass = 'Order of the Ghostslayer' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['control','melee','single_target'] where class = 'Blood Hunter' and subclass = 'Order of the Lycan' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['utility','single_target','melee'] where class = 'Blood Hunter' and subclass = 'Order of the Mutant' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['melee','single_target','control'] where class = 'Blood Hunter' and subclass = 'Order of the Profane Soul' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['healing','control','support'] where class = 'Cleric' and subclass = 'Blood Domain' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Cleric' and subclass = 'Moon Domain' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['utility','healing','aoe'] where class = 'Druid' and subclass = 'Circle of the Blighted' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['detect_magic','single_target','control'] where class = 'Monk' and subclass = 'Way of the Cobalt Soul' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Paladin' and subclass = 'Oath of the Open Sea' and partner = 'Critical Role';
update public.class_capabilities set capabilities = array['utility','control','melee'] where class = 'Apothecary' and subclass = 'Alienist' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['control','utility','melee'] where class = 'Apothecary' and subclass = 'Botanist' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['melee','utility','control'] where class = 'Apothecary' and subclass = 'Mutagenist' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['aoe','utility','control'] where class = 'Apothecary' and subclass = 'Pathogenist' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['control','utility','melee'] where class = 'Apothecary' and subclass = 'Reanimator' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['utility','tank','control'] where class = 'Barbarian' and subclass = 'Path of the Old Gods' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Bard' and subclass = 'College of Fables' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['stealth','support','control'] where class = 'Cleric' and subclass = 'Shadow Domain' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['utility','healing','aoe'] where class = 'Druid' and subclass = 'Circle of Contamination' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['control','support','single_target'] where class = 'Paladin' and subclass = 'Oath of Hexes' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['single_target','utility','control'] where class = 'Ranger' and subclass = 'Urban Tracker' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['utility','stealth','single_target'] where class = 'Rogue' and subclass = 'Smuggler' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['utility','control','single_target'] where class = 'Warlock' and subclass = 'Flesh Patron' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Wizard' and subclass = 'Malfeasant' and partner = 'Drakkenheim';
update public.class_capabilities set capabilities = array['single_target','melee','support'] where class = 'Captain' and subclass = 'Merchant' and partner = 'Free League';
update public.class_capabilities set capabilities = array['support','face','single_target'] where class = 'Captain' and subclass = 'Officer' and partner = 'Free League';
update public.class_capabilities set capabilities = array['utility','control'] where class = 'Mystic' and subclass = 'Artifact Crafter' and partner = 'Free League';
update public.class_capabilities set capabilities = array['control','utility'] where class = 'Mystic' and subclass = 'Witch' and partner = 'Free League';
update public.class_capabilities set capabilities = array['utility','melee'] where class = 'Warrior' and subclass = 'Templar' and partner = 'Free League';
update public.class_capabilities set capabilities = array['control','melee','tank'] where class = 'Barbarian' and subclass = 'Path of the Fractured' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['utility','melee','tank'] where class = 'Barbarian' and subclass = 'Path of the Primal Spirit' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Bard' and subclass = 'College of Adventurers' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['support','control','utility'] where class = 'Bard' and subclass = 'College of Dirge Singers' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Bard' and subclass = 'College of Requiems' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['detect_magic','support','control'] where class = 'Cleric' and subclass = 'Eldritch Domain' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['single_target','support','control'] where class = 'Cleric' and subclass = 'Inquisition Domain' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['support','utility','healing'] where class = 'Druid' and subclass = 'Circle of Blood' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['utility','healing','aoe'] where class = 'Druid' and subclass = 'Circle of Mutation' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['tank','melee','control'] where class = 'Fighter' and subclass = 'Bulwark Warrior' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['melee','single_target','control'] where class = 'Monk' and subclass = 'Way of the Leaden Crown' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['aoe','support','control'] where class = 'Paladin' and subclass = 'Oath of Pestilence' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Paladin' and subclass = 'Oath of Zeal' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['aoe','single_target','control'] where class = 'Ranger' and subclass = 'Green Reaper' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['aoe','melee','single_target'] where class = 'Ranger' and subclass = 'Vermin Lord' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['melee','stealth','utility'] where class = 'Rogue' and subclass = 'Highway Rider' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['healing','utility','stealth'] where class = 'Rogue' and subclass = 'Miscreant' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Sorcerer' and subclass = 'Haunted Bloodline' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['control','melee','aoe'] where class = 'Sorcerer' and subclass = 'Wretched Bloodline' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['utility','control','single_target'] where class = 'Warlock' and subclass = 'The First Vampire' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['melee','control','single_target'] where class = 'Warlock' and subclass = 'The Parasite' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['aoe','control','utility'] where class = 'Wizard' and subclass = 'Plague Doctor' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Wizard' and subclass = 'Sangromancy' and partner = 'Grim Hollow';
update public.class_capabilities set capabilities = array['single_target','utility','support'] where class = 'Bard' and subclass = 'College of the Road' and partner = 'Humblewood';
update public.class_capabilities set capabilities = array['support','tank','control'] where class = 'Cleric' and subclass = 'Community Domain' and partner = 'Humblewood';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Cleric' and subclass = 'Night Domain' and partner = 'Humblewood';
update public.class_capabilities set capabilities = array['melee','control','single_target'] where class = 'Fighter' and subclass = 'Scofflaw' and partner = 'Humblewood';
update public.class_capabilities set capabilities = array['melee','tank','control'] where class = 'Barbarian' and subclass = 'Path of the Boar' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['melee','tank','control'] where class = 'Barbarian' and subclass = 'Path of the Dragon' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Bard' and subclass = 'College of Echoes' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['stealth','support','control'] where class = 'Bard' and subclass = 'College of Shadows' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['stealth','support','control'] where class = 'Cleric' and subclass = 'Cat Domain' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['detect_magic','support','control'] where class = 'Cleric' and subclass = 'Justice Domain' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Cleric' and subclass = 'Labyrinth Domain' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Cleric' and subclass = 'Moon Domain' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['utility','healing','aoe'] where class = 'Druid' and subclass = 'Circle of Ash' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['aoe','tank','healing'] where class = 'Druid' and subclass = 'Circle of Bees' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['ranged','melee','control'] where class = 'Fighter' and subclass = 'Corsair' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['melee','control','single_target'] where class = 'Fighter' and subclass = 'Ghost Knight' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['melee','single_target','control'] where class = 'Monk' and subclass = 'Way of the Dragon' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Paladin' and subclass = 'Oath of Radiance' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['single_target','melee','support'] where class = 'Paladin' and subclass = 'Oath of Thunder' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['single_target','control','ranged'] where class = 'Ranger' and subclass = 'Vampire Slayer' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['single_target','melee','utility'] where class = 'Rogue' and subclass = 'Duelist' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['stealth','utility','single_target'] where class = 'Rogue' and subclass = 'Fixer' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Sorcerer' and subclass = 'Spores' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Sorcerer' and subclass = 'Wasteland' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['utility','control','single_target'] where class = 'Warlock' and subclass = 'Genie Lord' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['control','single_target','aoe'] where class = 'Warlock' and subclass = 'Sibyl' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Wizard' and subclass = 'Cantrip Adept' and partner = 'Kobold Press';
update public.class_capabilities set capabilities = array['healing','utility','support'] where class = 'Cleric' and subclass = 'Biomancy Domain' and partner = 'Loot Tavern';
update public.class_capabilities set capabilities = array['utility','melee','healing'] where class = 'Druid' and subclass = 'Circle of Mutation' and partner = 'Loot Tavern';
update public.class_capabilities set capabilities = array['tank','support','control'] where class = 'Paladin' and subclass = 'Oath of the Shield' and partner = 'Loot Tavern';
update public.class_capabilities set capabilities = array['single_target','control','aoe'] where class = 'Sorcerer' and subclass = 'Ooze Bloodline' and partner = 'Loot Tavern';
update public.class_capabilities set capabilities = array['support','control','utility'] where class = 'Wizard' and subclass = 'School of Biomancy' and partner = 'Loot Tavern';
update public.class_capabilities set capabilities = array['utility','melee','single_target'] where class = 'Beastheart' and subclass = 'Ferocious Bond' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['utility','melee','single_target'] where class = 'Beastheart' and subclass = 'Primordial Bond' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['single_target','tank','utility'] where class = 'Illrigger' and subclass = 'Painkiller' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['single_target','stealth','utility'] where class = 'Illrigger' and subclass = 'Shadowmaster' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['control','utility','melee'] where class = 'The Talent' and subclass = 'Chronopathy' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['melee','utility','control'] where class = 'The Talent' and subclass = 'Metamorphosis' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['utility','control','melee'] where class = 'The Talent' and subclass = 'Pyrokinesis' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['control','utility','melee'] where class = 'The Talent' and subclass = 'Resopathy' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['utility','control','melee'] where class = 'The Talent' and subclass = 'Telekinesis' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['utility','control','melee'] where class = 'The Talent' and subclass = 'Telepathy' and partner = 'MCDM';
update public.class_capabilities set capabilities = array['melee','tank','control'] where class = 'Barbarian' and subclass = 'Path of the Muscle Wizard' and partner = 'Mage Hand Press';
update public.class_capabilities set capabilities = array['tank','melee','control'] where class = 'Fighter' and subclass = 'Myrmidon' and partner = 'Mage Hand Press';
update public.class_capabilities set capabilities = array['stealth','utility','single_target'] where class = 'Rogue' and subclass = 'Enforcer' and partner = 'Mage Hand Press';
update public.class_capabilities set capabilities = array['utility','healing','aoe'] where class = 'Druid' and subclass = 'Circle of Cycles' and partner = 'Palaeo Games';
update public.class_capabilities set capabilities = array['single_target','control','ranged'] where class = 'Ranger' and subclass = 'Big Game Hunter' and partner = 'Palaeo Games';
update public.class_capabilities set capabilities = array['single_target','detect_magic','melee'] where class = 'Pugilist' and subclass = 'Bloodhound Bruiser' and partner = 'Sterling Vermin';
update public.class_capabilities set capabilities = array['melee','single_target','detect_magic'] where class = 'Pugilist' and subclass = 'Dog of War' and partner = 'Sterling Vermin';
update public.class_capabilities set capabilities = array['melee','single_target','detect_magic'] where class = 'Pugilist' and subclass = 'Squared Circle' and partner = 'Sterling Vermin';
update public.class_capabilities set capabilities = array['utility','single_target','melee'] where class = 'Pugilist' and subclass = 'Sweet Science' and partner = 'Sterling Vermin';
update public.class_capabilities set capabilities = array['tank','control','support'] where class = 'Barbarian' and subclass = 'Path of the Glacier' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['melee','tank','control'] where class = 'Barbarian' and subclass = 'Path of the Hellfire' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['support','control','utility'] where class = 'Bard' and subclass = 'College of Dance' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Cleric' and subclass = 'Astral Domain' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['utility','support','control'] where class = 'Cleric' and subclass = 'Winter Domain' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['control','utility','healing'] where class = 'Druid' and subclass = 'Circle of the Coral' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['single_target','control','melee'] where class = 'Fighter' and subclass = 'Blood Hunter' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['control','melee','single_target'] where class = 'Fighter' and subclass = 'Leviathan' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['single_target','melee','control'] where class = 'Monk' and subclass = 'Way of the Setting Sun' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['support','tank','control'] where class = 'Paladin' and subclass = 'Oath of the Hearth' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['tank','support','control'] where class = 'Paladin' and subclass = 'Oath of the Shield' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['single_target','control','ranged'] where class = 'Ranger' and subclass = 'Astral Watcher' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['single_target','utility','control'] where class = 'Ranger' and subclass = 'Monster Hunter' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['utility','stealth','single_target'] where class = 'Rogue' and subclass = 'Spellthief' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['utility','control','aoe'] where class = 'Sorcerer' and subclass = 'Frostblood' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['utility','control','single_target'] where class = 'Warlock' and subclass = 'The Dragon' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['utility','control','single_target'] where class = 'Warlock' and subclass = 'The Kraken' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['control','utility','aoe'] where class = 'Wizard' and subclass = 'School of Chronomancy' and partner = 'The Griffon’s Saddlebag';
update public.class_capabilities set capabilities = array['melee','support','aoe'] where class = 'Artificer' and subclass = 'Forge Adept' and partner = 'Visionary Production and Design';
update public.class_capabilities set capabilities = array['melee','support','aoe'] where class = 'Artificer' and subclass = 'Mastermaker' and partner = 'Visionary Production and Design';
update public.class_capabilities set capabilities = array['utility','support','aoe'] where class = 'Artificer' and subclass = 'Maverick' and partner = 'Visionary Production and Design';
update public.class_capabilities set capabilities = array['support','control','utility'] where class = 'Bard' and subclass = 'College of the Dirge Singer' and partner = 'Visionary Production and Design';
update public.class_capabilities set capabilities = array['tank','support','control'] where class = 'Cleric' and subclass = 'Mind Domain' and partner = 'Visionary Production and Design';
update public.class_capabilities set capabilities = array['utility','healing','aoe'] where class = 'Druid' and subclass = 'Circle of the Forged' and partner = 'Visionary Production and Design';
update public.class_capabilities set capabilities = array['melee','single_target','control'] where class = 'Monk' and subclass = 'Way of the Living Weapon' and partner = 'Visionary Production and Design';

-- Verify: partnered density should now sit at core density.
--   select
--     case when partner is null then 'core' else 'partnered' end as kind,
--     count(*) as rows,
--     round(avg(cardinality(capabilities)), 2) as mean_tags,
--     count(*) filter (where cardinality(capabilities) = 1) as single_tag_rows
--   from public.class_capabilities
--   where subclass is not null
--   group by 1;

