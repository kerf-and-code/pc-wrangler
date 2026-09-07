# Voice Compendium: Coverage, Gaps, and the Multi-System Plan

Reference for the offline voice compendium (`/gm/compendium`) as of 2026-09-07. Covers what the tool
holds today, the two data-model changes just made (aliases, and the settled homebrew design), and an
audit of which other game systems have data we could put behind a TTRPG dropdown, with the licensing
that governs each. Counts come from a clean run of `scripts/build-compendium-index.mjs` against the
current `lib/srd/`.

## What the compendium is

An offline, non-LLM rules lookup for a DM mid-game: on-device Vosk voice recognition plus a typed
search, fuzzy-matched against a prebuilt JSON index and rendered as a card. It deliberately reuses the
data the Forge already ships rather than duplicating a rules source. Everything runs in the browser and
nothing leaves it. The premise that makes it cheap to extend is exactly that reuse: any system whose
builder data we already hold can seed a compendium the same way `lib/srd/` seeds the D&D one.

## Current coverage (D&D 5e, both editions)

| Category | 2014 | 2024 | Source | Notes |
|---|---:|---:|---|---|
| Spells | 319 | 335 | lib/srd spells | SRD-clean |
| Magic items | 362 | 249 | lib/srd magic-items | SRD-clean |
| Equipment | 237 | 149 | lib/srd equipment | mundane gear/weapons/armor |
| Conditions | 15 | 15 | conditions-2014/2024 | 2024 has correct cumulative Exhaustion |
| Feats | 54 | 223 | feats-2014/2024 | SRD subset tagged "srd", rest "kc" (Terry's) |
| Class options + features | ~323 | ~386 | classes/subclasses structured | metamagic, invocations, fighting styles, general features |
| Monsters | 325 | 331 | monsters-2014/2024 | SRD-filtered (source_key starts "srd") |
| Species | 9 | 9 | species-2014/2024 | SRD-filtered |
| Backgrounds | 34 | 123 | backgrounds-2014/2024 | SRD whitelist: 2014 Acolyte only, 2024 Acolyte/Criminal/Sage/Soldier; rest "kc" |
| Rules glossary | 58 | 81 | rules-2014/2024 | verbatim SRD 5.1 / 5.2.1 |
| **Total entries** | **1,687** | **1,727** | | both-mode = 3,414 |

Attribution is per entry (`source: "srd" | "kc"`) and the footer names both SRD (CC-BY) and Kerf and
Code. The repo-wide provenance rule stands: anything not from the SRD is Terry's own authored content,
so it is his to publish, tagged "kc".

What the D&D compendium does not yet cover: a few 2024-only glossary granularity splits (obscurement and
light levels are one "Vision and Light" card in 2014), and full non-SRD monster/feat sets (deliberately
excluded on licensing).

## Change 1: aliases array (shipped this pass)

Entries now carry an optional `aliases: string[]`. Shorthand a DM says or types that the entry name
alone will not match ("oa", "aoo", "temp hp", "gwm", "wildshape") is stored on the entry and merged into
`spoken`, so both the fuzzy matcher and the Vosk grammar pick it up with no matcher change. The build
populates it from the existing ALIASES table plus any aliases an entry declares in its own source data,
which is the hook a homebrew or authored entry uses to ship its own shorthand. Alias-less entries carry
no `aliases` key, so the index stays lean (18 entries carry aliases today). Files: `lib/compendium/types.ts`,
`scripts/build-compendium-index.mjs`.

## Change 2: homebrew and editable entries (design settled, build next pass)

Decisions locked this pass:

Storage is account-wide with an optional per-entry campaign tag. Custom cards and edits are keyed on
`gm_id` and follow the GM across all their campaigns by default; each entry can optionally be pinned to a
single `campaign_id`. This mirrors how `/gm/compendium` is an account-level GM tool while still allowing
a campaign-specific ruling.

Editing built-in SRD entries is non-destructive. An edit is stored as an override that shadows the
shipped card at load time; the shipped data is never mutated and the GM can revert. Brand-new homebrew
cards are supported the same way.

Implementation shape for the next pass (not built yet): a `compendium_entries` table (gm_id, nullable
campaign_id, category, an `overrides_id` for SRD shadows or null for new cards, the display payload, and
an `aliases` array that flows through the same grammar path), owner-scoped RLS mirroring the existing
per-GM tables, plus a runtime merge in `compendium-tool.tsx` so the static index is layered with the
GM's overrides and additions after the fetch. The static prebuilt index stays the base; custom entries
are fetched per GM and merged client-side. This is the P3 "custom / homebrew entries" item from the gap
audit, now with its scoping and edit semantics decided.

## Multi-system audit: what could go behind a TTRPG dropdown

The platform is already modular. `lib/systems/` registers eight systems (dnd5e, pf2e, coc7e, daggerheart,
drawsteel, lancer, darkmatter, poold10) behind a `RulesModule` contract, the roller and workspace already
switch system via `listModules()` and the `active-campaign` signal, and `lib/systems/attribution.ts`
already carries per-system license lines. So a multi-system compendium reuses machinery that exists: the
compendium reads the active campaign's system (or a system `<select>`, same pattern as the roller) and
fetches `index-<system>-<edition>.json`. The build script grows a per-system data source the way it
already dispatches D&D data.

The gating question is not engineering, it is licensing and data. A rules-lookup tool is mostly text, so
"mechanics-only" licenses constrain it more than they constrain a character builder. Here is where each
system stands, using the data already in the repo.

| System | In-repo data (lib/) | Licensing for a paid lookup tool | Compendium fit |
|---|---|---|---|
| D&D 5e (2014/2024) | full (lib/srd) | SRD 5.1/5.2 CC-BY + Terry's originals | Shipped |
| Draw Steel | rich: abilities (163KB), ancestries, careers, kits, subclasses, deities, complications, titles, rules-data | Draw Steel Creator License, commercial OK, attribution line required, no logos | Strongest next candidate |
| Lancer | rich: frame-traits, loadout-data (41KB), core-bonuses, pilot-gear, rules-data | Verify first (memory flags it unverified); Lancer data is widely treated as open, but confirm before shipping | High if license confirms |
| Pathfinder 2e | thin: creature schema + 8 ancestries / 4 classes | Open via Archives of Nethys / ORC data (do not ship Paizo Community-Use packs) | Good, but needs a data import |
| Dark Matter | via the dnd5e module (5e-based) | OGL through the 5e engine | Reuses D&D pipeline |
| Daggerheart | rich: domain-cards (22KB), weapons (46KB), rules-data | DPCGL is mechanics-only: numbers yes, their descriptive card/feature text no | Constrained (stat lines, not prose) |
| Call of Cthulhu 7e | none (dice-only module) | Chaosium content is not open | Roller only, not a lookup |
| Vampire (poold10) | none (generic d10 pool) | V5 content blocked (Dark Pack is non-commercial) | Roller only, not a lookup |

### Reading of the audit

Draw Steel is the clear next system for the compendium: the license permits a commercial digital tool,
the attribution is a single line already noted in the module, and the Steel Compendium markdown Terry
already imported gives a large body of lookup-worthy content (class abilities, ancestries, kits, careers,
titles, complications) that the character module is already parsing. The build script can emit a
Draw Steel index from those same `lib/drawsteel/*` files, category-mapped (abilities, ancestries, kits,
careers, and so on) the way the D&D build maps spells/feats/features.

Lancer is the second-richest in-repo dataset and a natural crunch-system lookup (frames, systems, mods,
pilot gear), but its license must be confirmed before shipping content in the paid app.

Pathfinder 2e is high-value but light in the repo today; a real compendium there means importing the
open AoN/ORC data (spells, feats, bestiary), which is a data-sourcing task rather than a wiring task.

Daggerheart can ship a compendium of stat lines and numbers (weapons, the mechanical side of domain
cards) but not the descriptive prose that makes a rules lookup useful, so its value as a lookup is
capped until or unless the descriptive text is cleared under the DPCGL. Treat it as a partial.

CoC and Vampire are narrative systems with restrictive content licenses; they are well served by the
roller and the agnostic core, and are not lookup-tool candidates.

## Gaps and recommended sequence

1. Ship the homebrew/override feature (design is settled above). It benefits every system at once and is
   the productized version of the custom-entry request.
2. Add the TTRPG dropdown to the compendium, reusing `active-campaign` + `listModules()`. With only D&D
   live it is a one-option control, but wiring it now makes each new system a data-only add.
3. Draw Steel compendium: emit `index-drawsteel.json` from `lib/drawsteel/*`, category-mapped, with the
   Creator License attribution line surfaced in the tool. Licensing-clean and data is in hand.
4. Lancer compendium, once its license is confirmed. Data is in hand.
5. Pathfinder 2e compendium: import open AoN/ORC data, then emit `index-pf2e.json`.
6. Daggerheart: stat-line-only compendium, pending any DPCGL text clearance.

Notes on effort assume the established pipeline: author or generate a per-system source in `lib/`, extend
`scripts/build-compendium-index.mjs` to dispatch by system, add any needed card branch in
`components/compendium-tool.tsx`, regenerate the indexes. The TTRPG dropdown and the homebrew merge are
the two items that touch the tool's load path rather than just adding rows.
