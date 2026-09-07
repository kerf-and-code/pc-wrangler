# Rules Compendium: Content Gap Audit

Audit of the offline voice compendium (`/gm/compendium`) as of this review. Purpose: identify the
information and rules a DM commonly needs mid-game that the compendium does not yet cover, grounded in
what data already exists in `lib/srd/` versus what would need sourcing. Counts below come from a clean
run of `scripts/build-compendium-index.mjs` against the current `lib/srd/`.

## Current inventory

| Category | 2014 | 2024 | Notes |
|---|---:|---:|---|
| Spells | 319 | 335 | SRD spell lists, edition-split |
| Magic items | 362 | 249 | SRD magic items |
| Equipment | 237 | 149 | mundane gear/weapons/armor (flat) |
| Conditions | 15 | 15 | 2024 now correct (cumulative Exhaustion, etc.) |
| Feats | 54 | 223 | mostly Kerf and Code originals; SRD subset tagged |
| Class options (features) | 49 | 3 | 2014 = metamagic/invocations/fighting styles; 2024 = umbrellas only |
| Rules glossary | 42 | 56 | verbatim SRD 5.1 / 5.2.1 |
| **Total** | **1078** | **1030** | both-mode = 2108 |

What the compendium does well already: spells, magic items, conditions, the disputed-rules glossary,
and feats are solid across both editions. The gaps below are the things a DM reaches for that are
either missing entirely or thin in one edition.

## Priority 1: high table value, data already in the repo

These are the biggest wins because the data is already sitting in `lib/srd/` and just needs wiring, the
same pattern as the rules glossary. No external sourcing required.

### Monsters and stat blocks

The single highest-value missing category. "What's this thing's AC, HP, what does its attack do" is
the most common mid-combat lookup, and the data is already here with full stat-block fields (ac, hp,
cr, speed, ability scores, senses, immunities, special_abilities, actions, bonus_actions, reactions,
legendary_actions).

- Data: `monsters-2024.json` (331 entries), `monsters-2014.json` (3,210 entries).
- Licensing watch: the 2024 count (331) tracks the SRD 5.2 bestiary and is almost certainly clean. The
  2014 file at 3,210 is far larger than SRD 5.1's ~325 monsters, so like the feats it is mostly
  non-SRD content. Confirm provenance and license before shipping the 2014 set, or filter/tag it the
  way feats were (SRD vs Kerf and Code), or ship only the 2024 set first.
- Effort: a new `monster` category and card renderer (AC/HP/speed/saves/senses block plus actions).
  Voice value is high (monster names are distinctive), index size is the main cost (the 2014 file is
  8.3 MB of source, so the built index and grammar grow; consider shipping monsters in a separate
  fetched-on-demand index rather than the main one).

### General class and subclass features

Right now only the *selectable options* (metamagic, invocations, fighting styles) are carded, and only
for 2014. The marquee always-on features a DM looks up (Rage, Sneak Attack, Divine Smite, Channel
Divinity, Wild Shape, Action Surge, Ki/Monk features, Bardic Inspiration) are not in the compendium.

- Data: `classes-2014-structured.json` and `classes-2024-structured.json` (12 classes each, full
  `features_by_level`), plus `subclasses-2014-structured.json` / `subclasses-2024-structured.json` (12
  SRD subclasses each, e.g. Champion, Life Domain, Berserker, Draconic Sorcery).
- These are SRD-clean (the structured files carry only the SRD sample subclasses).
- Effort: extend the class-options extractor to pull a curated whitelist of high-value feature names
  (not every level entry, which includes filler like Ability Score Improvement). Reuses the existing
  `feature` category.

### 2024 metamagic and invocations (per-option)

2024 currently shows only the umbrella entries because `classes-2024-structured.json` does not break
the options out per-entry the way 2014 does. So a DM on the 2024 toggle can't look up "Quickened Spell"
or "Agonizing Blast."

- Fix: parse the 2024 options out of the umbrella feature text, or source them from the 2024 SRD
  markdown (`playing-the-game.md` / class sections) the way the 2024 glossary was built.
- Effort: small, and it brings 2024 to parity with 2014's 49 class-option cards.

### Weapon properties and weapon mastery

Commonly disputed and looked up: what Finesse, Versatile, Heavy, Reach, Thrown, Two-Handed, Loading,
Light, and Ammunition actually do, and (2024) the weapon mastery properties (Nick, Vex, Sap, Topple,
etc.). This is also where 2024 "two-weapon fighting" lives, since it is no longer a standalone rule but
the Light property plus the Nick mastery.

- Data: `equipment-2024-structured.json` (203 items) already carries `properties` and `mastery` per
  weapon. The property and mastery *definitions* (the glossary text) would come from the SRD 2024
  `equipment.md` chapter, one more source download.
- Effort: a small "weapon property" card set (about a dozen properties plus the mastery list). Closes
  the two-weapon-fighting gap for 2024 as a side effect.

## Priority 2: useful, needs light sourcing or authoring

### Species and backgrounds

Players and DMs look up racial traits ("what does the Goliath's Powerful Build do") and background
features constantly, especially in session zero and character creation at the table.

- Data: `species-2024.json` / `species-2014.json` (+ structured), and `backgrounds-2024.json` (123),
  `backgrounds-2014.json`.
- Licensing watch: backgrounds at 123 is well beyond SRD's ~16, so same provenance question as feats
  and 2014 monsters. Species look closer to SRD scale.
- Effort: two new categories (`species`, `background`) or fold into a generic reference card. Moderate.

### Spell components glossary (2024)

The 2014 glossary has a Spell Components card (V/S/M, the free-hand rule); 2024 does not, because
components are defined in the 2024 spellcasting chapter rather than the rules glossary.

- Fix: source from the 2024 SRD `spells.md` chapter intro.
- Effort: tiny, one card, once the file is downloaded.

### Hazards and environment

The 2024 glossary defines several hazards not yet carded: Burning, Dehydration, Malnutrition, plus
Suffocation and Falling (already in). Mounted Combat and Underwater Combat rules are also not carded in
either edition. These are situational but real lookups.

- Data: 2024 in the glossary already staged; 2014 in `the-environment` / combat sections (dnd5eapi).
- Effort: small, additive glossary cards.

### Attunement, item identification, and magic-item usage rules

The compendium lists magic items but not the rules *around* them (how attunement works, how many items,
identifying an item). "Attunement" is a 2024 glossary term and a common table question.

- Effort: tiny, a few glossary cards.

## Priority 3: strategic and data-model gaps

### Voice aliases and abbreviations

Spoken matching currently derives only from the entry name (stripping possessives). DMs say
abbreviations and nicknames the recognizer will never map: "OA" or "AoO" for opportunity attack, "temp
HP", "crit", "GWM" (Great Weapon Master), "PAM", "AC", "sneak". Adding an optional `aliases` array to
the entry schema and grammar would materially raise the voice hit rate. This is a data-model
improvement that benefits every category at once.

### Multi-system coverage

The compendium is D&D-only. Six Axes supports Pathfinder 2e, Draw Steel, and Daggerheart, none of which
have rules in the compendium. This is a large, strategic effort (each system needs its own licensed
data and rules glossary), not a quick add, but worth naming since the rest of the platform is
multi-system.

### Custom / homebrew entries

There is no way for a DM to add their own cards (house rules, homebrew items, campaign-specific
rulings). Terry already authored the non-SRD feats by hand into the source JSON; a general
custom-entry mechanism (per-GM, stored) would be the productized version.

### Cross-edition parity

A few 2014 cards have no 2024 counterpart yet (two-weapon fighting, addressed under weapon properties
above; spell components, above). Worth a periodic parity pass so the 2014 and 2024 toggles feel equally
complete.

## Licensing watch-list

A recurring pattern: the 2014 datasets are comprehensive (non-SRD) while the 2024 datasets track the
SRD. Anything shipped under the "SRD (CC-BY)" banner must be either genuinely SRD or Kerf and Code
original content. Confirm provenance and set the `source` tag ("srd" vs "kc") before shipping:

- Feats: handled (2014 = 54, only Grappler is SRD; 2024 = 223, ~17 SRD).
- Monsters 2014: 3,210 entries, mostly non-SRD. Not yet wired, so no exposure yet.
- Backgrounds: 123 entries, mostly non-SRD. Not yet wired.

## Recommended sequence

1. 2024 metamagic/invocations per-option parity (small, closes an obvious hole).
2. Weapon properties and mastery (small, closes 2024 two-weapon fighting, high dispute value).
3. Class and subclass features whitelist (medium, SRD-clean, high value).
4. Monsters, 2024 set first (high value; settle 2014 licensing separately, and consider a
   fetched-on-demand index so the main payload stays small).
5. Voice aliases schema (data-model win that lifts everything).
6. Species and backgrounds, and the remaining glossary cards (attunement, hazards, mounted/underwater).

Notes on effort assume the established pipeline: author or generate a source JSON in `lib/srd/`, extend
`scripts/build-compendium-index.mjs`, add a card branch in `components/compendium-tool.tsx`, regenerate
the indexes. Monsters and the aliases schema are the two items that touch the data model rather than
just adding rows.
