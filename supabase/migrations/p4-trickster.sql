-- Add the Trickster (Warlock) and its publisher, Legendary Games.
--
-- El's subclass was flagged as "recorded, but unknown to the catalog". It is not a
-- typo. The Trickster is a real Warlock patron from Legendary Games, published in
-- The Dragon's Hoard #8 (2021), and it is on the same 5esrd database the rest of
-- the partnered catalog was built from:
--   https://www.5esrd.com/database/classoption/the-trickster-warlock-patron/
--
-- Legendary Games was not in the partner list at all, so the whole publisher was
-- missing, not just this one subclass. The fix is the SEED, not the character. This
-- is exactly the case the audit view was built to catch: correcting El's sheet to
-- satisfy an incomplete catalog would have destroyed real data.
--
-- CAPABILITY TAGS: control, face, aoe. Read from the actual features, not the name:
--
--   Expanded spells   hideous laughter, slow, stinking cloud, confusion, polymorph,
--                     insect plague, wall of force -> overwhelmingly CONTROL
--   Moment's Mischief bonus-action Dex save, drop item or fall prone -> CONTROL
--   Wake of Misfortune turn a creature's advantage into disadvantage -> CONTROL
--   Essence of Deception advantage on Deception contests, resists zone of truth -> FACE
--   Gift of Chaos     6d10 burst plus mass confusion -> AOE
--
-- Three tags, matching CORE density (mean 2.69), not the single-tag shrug the other
-- partnered rows were given. For reference its closest core cousin, the Archfey, is
-- tagged control + face.
--
-- Idempotent.

insert into public.class_capabilities (system, class, subclass, capabilities, partnered, partner)
values ('5e', 'Warlock', 'Trickster', array['control','face','aoe'], true, 'Legendary Games')
on conflict do nothing;

-- Also register Legendary Games as a class publisher so the partner toggle appears
-- in the GM workspace. (partnerList is derived from distinct class_capabilities
-- .partner values, so the insert above is what creates the toggle. Nothing further
-- is needed; this comment exists so the next reader does not go looking for a
-- partners table that does not exist.)
