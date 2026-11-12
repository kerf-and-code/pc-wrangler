"use client";

// components/forge/forge-app.tsx
//
// The Forge: the player-side PC character-sheet creator. Identity (catalog-driven pickers),
// ability scores, gear, and a live sheet computed by deriveSheet on every edit.
//
// TWO PAGES, ONE COMPONENT (phase 5d). This was app/me/forge/page.tsx. It moved here so a second
// page can render it: /me/forge renders view="forge" (building), /me/sheet renders view="play" (the
// character sheet a player plays from, laid out like a D&D Beyond sheet). Both views load, derive
// and autosave the character through the same code, so the sheet can never disagree with the Forge
// about a number. The play view shows none of the builder.
//
// THREE MODES, ONE FORGE:
//   ?c=<character_id>   a campaign character, backed by a `characters` row.
//   ?lib=<library_id>   a saved/sandbox build, backed by a `pc_library` row.
//   (neither)           a NEW build, backed by nothing yet; the first save creates a pc_library
//                         row and the page switches itself into ?lib mode so autosave has a target.
//
// SAVE MODEL (both modes behave the same):
//   - Autosave: ~1s after the last edit, the current build is written to whichever row backs the
//     mode (characters update for ?c, pc_library update for ?lib). A brand-new build's first
//     autosave INSERTS a pc_library row, captures its id, and flips the URL to ?lib=<id> so the
//     next autosave updates instead of duplicating (guarded by a creating flag against races).
//   - Save & Continue: force an immediate write, stay on the page.
//   - Save & Exit: force a write, then go to /me/library.
//   A small status line ("Saved" / "Saving…" / "Unsaved") keeps autosave visible.
//
// CONTENT SOURCE. Species / variant / class / subclass come from the Supabase CATALOG via
// lib/catalog (scoped by a 2024/2014/both toggle + player partner chips); backgrounds + gear stay
// on the SRD JSON, which is also the mechanics source the engine reads.
//
// AESTHETIC. The locked dungeon design language from lib/forge-theme.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SAX } from "@/lib/theme";
import PageShell from "@/components/page-shell";
import { C, STONE, FORGE_FONTS, stonePanel, stoneButton, FORGE_BUTTON_CSS, statTile, stoneField, stoneChip, forgeHeading, forgePanelTitle, forgeLabel, forgeRuleLine, forgeBoss } from "@/lib/forge-theme";
import { loadSrd } from "@/lib/srd/srd";
import { traitOptions, traitAsksAChoice, lineageSpells } from "@/lib/species-choices";
import { choicesFor, resolveChoice, choiceKey, costedPicks, actionsFor, type ClassChoice } from "@/lib/class-choices";
import { classTable, classTableColumns } from "@/lib/class-table";
import { remaining, afterShortRest, speciesResources, type Resource } from "@/lib/resources";
import { getActiveCampaign, setActiveCampaign } from "@/lib/active-campaign";
import { derivePf2eSheet, emptyPf2eBuild, type Pf2eBuild } from "@/lib/pf2e/character";
import { PF2_RULES } from "@/lib/pf2e/rules-data";
import Pf2eForge from "@/components/pf2e-forge";
import { deriveDaggerheartSheet, emptyDHBuild, type DHBuild } from "@/lib/daggerheart/character";
import { DH_RULES } from "@/lib/daggerheart/rules-data";
import DaggerheartForge from "@/components/daggerheart-forge";
import { deriveDrawSteelSheet, emptyDSBuild, type DSBuild } from "@/lib/drawsteel/character";
import { DS_RULES } from "@/lib/drawsteel/rules-data";
import DrawSteelForge from "@/components/drawsteel-forge";
import { deriveLancerSheet, emptyLancerBuild, type LancerBuild } from "@/lib/lancer/character";
import { LANCER_RULES } from "@/lib/lancer/rules-data";
import LancerForge from "@/components/lancer-forge";
import SystemAttribution from "@/components/system-attribution";
import FightCard from "@/components/fight-card";
import PlaySheet, { type PlayState, type SheetOverrides, type CustomDefenses } from "@/components/play-sheet";
import PlayActions, { type KnownSpell, type FeatureAction } from "@/components/play-actions";
import { featureCost, costSentence } from "@/lib/play/features";
import PlayInventory, { attunementLimit, type Coins, type CharNotes } from "@/components/play-inventory";
import FloatingPanel from "@/components/floating-panel";
import PlayCompanions, { type Companion, type MonsterRec } from "@/components/play-companions";
import PlayParty from "@/components/play-party";
import PartyStash from "@/components/party-stash";
import SystemPlay, { type PlaySheet as SystemPlaySheet, type SystemPlayState } from "@/components/system-play";
import { combatAct, type FightEntry, type FightView } from "@/components/fight-controls";
import { trackedResources, type TrackInputs } from "@/lib/play/tracks";
import { isWeapon, unarmedAttack, weaponAttack, weaponProfText, applyAttackFeatures, baseWeaponFor, applyImportAdjust, importedAttackRows, type AttackRow, type WeaponRecord } from "@/lib/play/attacks";
import type { SpellRecord as PlaySpell } from "@/lib/play/spells";
import { attacksPerAction } from "@/lib/combat-effects";
import { menusFor, type ClassMenu } from "@/lib/class-menus";
import { casterLevel, multiclassSlots, isMulticlassCaster, type CasterType } from "@/lib/multiclass-slots";
import { subclassCasterType, subclassSpellList, subclassCasting, thirdCasterSlots } from "@/lib/subclass-casters";
import { subclassSpellsFor } from "@/lib/subclass-spells";
import { withSubclass } from "@/lib/subclass-features";
import {
  resolveSpecies, speciesMechanics, structuredChoiceOptions, matchOption,
  SPECIES_ABILITY_KEY, SPECIES_ABILITY_OPTIONS, speciesSkillKey, speciesToolKey, isSpeciesProfKey,
  speciesAsiKey, SPECIES_ASI_PATTERN_KEY, ASI_PATTERNS, asiAmounts, speciesAsiMods,
} from "@/lib/srd/species-effects";
import { choiceEffects, applyToBuild, type ChoiceEffects } from "@/lib/apply-choices";
import { parseCoreTraits } from "@/lib/core-traits";
import {
  STANDARD_ARRAY, POINT_BUDGET, POINT_MIN, POINT_MAX, pointsSpent, canRaise, canLower,
  pointBuyReset, makePool, assign as poolAssign, unassign as poolUnassign, poolScores, poolComplete,
  type PoolEntry, type GenMode, type AbilityKey,
} from "@/lib/ability-gen";
import { roll as rollDice } from "@/lib/dice";
import { parseGranted, matchGranted, resolveCrossRefs } from "@/lib/granted-equipment";
import { ABILITY_NAMES, backgroundAbilities, featAbilities, normalizeRarity, RARITY_ORDER, matches as textMatches } from "@/lib/picker-filters";
import { buildRulesContext } from "@/lib/srd/rules-context";
import {
  loadCatalog, partnerList, speciesOptions, classOptions, variantOptions, subclassOptions,
  subclassRoles, type Catalog, type Edition,
} from "@/lib/catalog";
import {
  saveToLibrary, updateLibrary, saveCharacterToLibrary, type LibraryDenorm,
} from "@/lib/pc-library";
import {
  describeItem, describeBackground, describeSpecies, describeSkill, describeFeat,
  traitList, shownSpeciesTraits, type TraitEntry, type Described, type OwnTrait, type OwnSpeciesMech,
  type ItemRecord, type BackgroundRecord, type SpeciesMechRecord,
} from "@/lib/descriptions";
import { CharacterSheetPrint, type PrintTrait, type PrintFeature } from "@/components/character-sheet-print";
import { PortraitUploader } from "@/components/portrait-uploader";
import {
  classProgression, asiLevelsUpTo, epicProgression,
  type ClassRecord, type LevelGroup,
} from "@/lib/class-progression";
import {
  deriveSheet, epicAdvancement, ABILITIES, SKILLS, DEFAULT_EPIC, gearEquipped, classLevelOf,
  type Ability, type Build, type EpicChoice, type GearEntry, type ImportAdjust,
} from "@/lib/srd/derive-sheet";
import { hasPrintedAbilities, suppressItemEffects, reconcileImport, RECONCILE_VERSION, type DdbSheet } from "@/lib/ddb-import";
import { fmtTime } from "@/lib/format";
import Button from "@/components/ui-forge/Button";

// ---------------------------------------------------------------------------
// Build defaults + normalization
// ---------------------------------------------------------------------------

function emptyBuild(): Build {
  return {
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    meta: { species: "", className: "", subclass: "", background: "" },
    armorBase: 10, armorMisc: 0,
    saveProf: [], skillProf: [], skillExpert: [],
    gear: { items: [] },
    effects: [], epicChoices: {},
    spells: { cantrips: [], known: [] },
  };
}

// The stored build may be partial or from an older shape; fill any gaps so deriveSheet never reads
// undefined. This is the one place that reconciles a stored build with the engine's Build.
function normalizeBuild(raw: unknown): Build {
  const b = (raw && typeof raw === "object" ? raw : {}) as Partial<Build>;
  const e = emptyBuild();
  return {
    ...e, ...b,
    abilities: { ...e.abilities, ...(b.abilities || {}) },
    meta: { ...e.meta, ...(b.meta || {}) },
    gear: { items: [], ...(b.gear || {}) },
    spells: { cantrips: [], known: [], ...(b.spells || {}) },
    epicChoices: b.epicChoices || {},
    saveProf: b.saveProf || [], skillProf: b.skillProf || [], skillExpert: b.skillExpert || [],
    effects: b.effects || [],
  };
}

type CharRow = {
  id: string; name: string; build: unknown;
  species: string | null; class: string | null; subclass: string | null;
  species_variant: string | null; level: number | null; alignment: string | null; campaign_id: string;
  portrait_url: string | null;
};

type LibRow = {
  id: string; name: string; build: unknown;
  species: string | null; class: string | null; subclass: string | null;
  species_variant: string | null; level: number | null; portrait_url: string | null;
};

type StableRow = {
  character_id: string; name: string; campaign_id: string; campaign_name: string;
  species: string | null; class: string | null; level: number | null; kind: string;
};

type Mode = "character" | "library" | "new";

// Map an ability abbreviation from the SRD ("STR", "CON") to the engine's lowercase key.
/**
 * A spell as it sits in lib/srd/spells-*.json.
 *
 * TWO FIELDS LIE ABOUT THEIR TYPE, and both bite quietly:
 *   `classes`       is a PYTHON REPR STRING - "['Sorcerer', 'Wizard']" - not a JSON array, so
 *                   JSON.parse fails on the single quotes and `.includes("Wizard")` succeeds on
 *                   "Wizardry" too.
 *   `concentration` and `ritual` are the STRINGS "True"/"False". `if (spell.concentration)` is
 *                   therefore always true, which is the kind of bug that shows up as a wrong icon
 *                   on half the list and gets blamed on the data.
 */
type SpellRecord = {
  name: string; level: string; school?: string; classes?: string;
  casting_time?: string; range?: string; components?: string; duration?: string;
  concentration?: string; ritual?: string; description?: string;
};

const spellClasses = (s: SpellRecord): string[] =>
  String(s.classes || "").replace(/[[\]'"]/g, "").split(",").map((t) => t.trim()).filter(Boolean);

const truthy = (v: unknown) => String(v ?? "").trim().toLowerCase() === "true";

const spellLevel = (s: SpellRecord): number => {
  const n = parseInt(String(s.level ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
};

const ABBR_TO_KEY: Record<string, Ability> = {
  STR: "str", DEX: "dex", CON: "con", INT: "int", WIS: "wis", CHA: "cha",
};

// Parse a 2014 species ability_bonuses string ("STR +2, CHA +1") into { str: 2, cha: 1 }.
// Returns {} for 2024 species (which carry none) or an unrecognized shape.
function parseAbilityBonuses(s: string | undefined | null): Partial<Record<Ability, number>> {
  const out: Partial<Record<Ability, number>> = {};
  if (!s) return out;
  for (const part of s.split(",")) {
    const m = part.trim().match(/^([A-Za-z]{3})\s*\+?(-?\d+)$/);
    if (!m) continue;
    const key = ABBR_TO_KEY[m[1].toUpperCase()];
    if (key) out[key] = (out[key] || 0) + parseInt(m[2], 10);
  }
  return out;
}

// The denorm columns both characters and pc_library carry, pulled off the current build + name.
function denormOf(build: Build, speciesVariant: string): LibraryDenorm {
  return {
    species: build.meta.species || null,
    class: build.meta.className || null,
    subclass: build.meta.subclass || null,
    species_variant: speciesVariant || null,
    level: build.level,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// ForgeApp calls useSearchParams(), which Next.js requires be inside <Suspense> so the route can
// prerender: each page that renders it (app/me/forge, app/me/sheet) wraps it in one.
/**
 * The tabs, and the order a character is actually built in.
 *
 * WHY TABS AND NOT A WIZARD
 *   Nothing here gates on order. A wizard that makes you walk six steps to change one ability score
 *   is worse than the single stacked page this replaces - the stacking was never the problem, the
 *   LENGTH was. Every tab is reachable at any time and the sheet updates live underneath all of
 *   them, so this is a filing system, not a sequence.
 *
 * The `ready` predicate is not a gate either. It drives the mark beside each tab name and the list
 * on Finish, so "what have I not done" is answerable without reading the whole sheet.
 */
type TabKey = "identity" | "class" | "species" | "background" | "spells" | "abilities" | "equipment" | "roll" | "features" | "finish";

const bgAsiTotal = (b: Build) =>
  Object.values(b.bgAsi || {}).reduce((a, v) => a + Number(v || 0), 0);

const TABS: { key: TabKey; label: string; ready: (b: Build) => boolean }[] = [
  { key: "identity",  label: "Identity",  ready: (b) => Boolean(b.meta.species && b.meta.className && b.meta.background) },
  { key: "class",     label: "Class",     ready: (b) => Boolean(b.meta.className) },
  { key: "species",   label: "Species",   ready: (b) => Boolean(b.meta.species) },
  // Push 11 (audit G9): a 2014 background raises no ability (the species did), so it is done once picked.
  { key: "background", label: "Background", ready: (b) => Boolean(b.meta.background)
    && ((b as Build & { edition?: string }).edition === "2014" || bgAsiTotal(b) > 0) },
  { key: "spells", label: "Spells", ready: (b) => Boolean((b.spells?.cantrips?.length || 0) + (b.spells?.known?.length || 0)) },
  { key: "abilities", label: "Abilities", ready: (b) => Object.values(b.abilities || {}).some((v) => Number(v) > 0) },
  { key: "equipment", label: "Equipment", ready: (b) => Boolean((b.gear?.items || []).length) },
  { key: "roll",      label: "Play",      ready: () => true },
  { key: "features",  label: "Features",  ready: (b) => Boolean(b.meta.species) },
  { key: "finish",    label: "Finish",    ready: () => true },
];

// The systems the Forge can build a character in (the render dispatches on `system`). The picker at the
// top of the Forge offers all of them for a NEW build - a free workshop, per Terry's call - while an
// existing character's system is fixed by its saved row. Add a system here when its forge is wired.
const FORGE_SYSTEMS: [string, string][] = [
  ["dnd5e", "D&D 5e"],
  ["pf2e", "Pathfinder 2e"],
  ["daggerheart", "Daggerheart"],
  ["drawsteel", "Draw Steel"],
  ["lancer", "Lancer"],
  ["darkmatter", "Dark Matter"], // built on 5e: the D&D forge, under its own label (audit G2)
];

export default function ForgeApp({ view = "forge" }: { view?: "forge" | "play" }) {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const charId = params.get("c");
  const libIdParam = params.get("lib");
  // Push 30 (audit P12): a character fresh from the quick build (app/me/quick-build) opens with a note
  // on what is still the player's to pick.
  const [quickNote, setQuickNote] = useState(params.get("quick") === "1");

  // Which backing store the current session edits. Derived from the URL on load; a NEW build flips
  // to library once its first save creates a pc_library row.
  const [mode, setMode] = useState<Mode>(charId ? "character" : libIdParam ? "library" : "new");
  const [libId, setLibId] = useState<string | null>(libIdParam);

  // The open tab lives in the URL so a half-built character survives a refresh and a tab can be
  // linked to directly. replaceState rather than router.replace: this is a view change, not a
  // navigation, and pushing it through the router would re-run the page's data effects on every
  // tab click.
  const tabParam = params.get("tab") as TabKey | null;
  // Which class sub-tab is open. Not in the URL: it is a view inside a view, and a character with
  // one class has no sub-tabs at all, so a stale value would point at nothing.
  const [classTab, setClassTab] = useState("");

  const [tab, setTabState] = useState<TabKey>(
    TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "identity",
  );
  const setTab = useCallback((next: TabKey) => {
    setTabState(next);
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    u.searchParams.set("tab", next);
    window.history.replaceState(null, "", u.toString());
  }, []);

  const [stable, setStable] = useState<StableRow[]>([]);
  const [row, setRow] = useState<CharRow | null>(null);
  const [build, setBuild] = useState<Build>(emptyBuild());
  const [system, setSystem] = useState<string>("dnd5e");
  const [pbuild, setPbuild] = useState<Pf2eBuild>(emptyPf2eBuild);
  const [dbuild, setDbuild] = useState<DHBuild>(emptyDHBuild);
  const [steelBuild, setSteelBuild] = useState<DSBuild>(emptyDSBuild);
  const [lancerBuild, setLancerBuild] = useState<LancerBuild>(emptyLancerBuild);
  const [name, setName] = useState<string>("");
  const [speciesVariant, setSpeciesVariant] = useState<string>("");
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "picking" | "error" | "signedout">("loading");
  // Push 40 (p162 forge_access): why a character or library build would not open, said plainly instead of
  // one "could not be loaded" for every cause.
  const [loadWhy, setLoadWhy] = useState<string | null>(null);
  const explainFailure = useCallback(async (kind: "character" | "library", id: string, err: { message?: string; code?: string } | null) => {
    let why: string | null = null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) why = "That link is incomplete. Open the character again from your list.";
    else {
      const { data, error: e2 } = await supabase.rpc("forge_access", { p_kind: kind, p_id: id });
      const r = e2 ? null : (data as string | null);
      why = r === "missing" ? (kind === "library" ? "That build no longer exists. It may have been deleted." : "That character no longer exists. It may have been deleted or retired.")
        : r === "not_yours" ? "That character belongs to another account. If it is yours, you may be signed in with a different account (Discord, Google or email)."
        : r === "trashed" ? "That character's campaign is in the GM's trash. It comes back if the GM restores the campaign."
        : r === "signed_out" ? "You were signed out. Sign in again, then open the character."
        : err?.message ? `Six Axes could not open it: ${err.message}` : null;
    }
    setLoadWhy(why);
    setStatus("error");
  }, [supabase]);
  // Starts "saved", NOT "idle". A brand-new build must not auto-persist on load: the first autosave
  // creates the pc_library row and flips mode 'new' -> 'library', which LOCKS the system picker. When
  // this started "idle" the flip fired ~1s after the page opened, so the system dropdown was editable
  // for barely a second and a new build was stuck on its default system. Starting "saved" leaves an
  // untouched build unsaved until a real edit sets it "idle" (the system picker, a field, anything), so
  // the picker stays usable until the player actually starts the build. Existing builds also skip a
  // redundant post-load save this way.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("saved");
  // phase 5a: this character's entry in a running fight (from the fight card)
  const [fightMine, setFightMine] = useState<{ id: string; me: FightEntry } | null>(null);
  const [fightView, setFightView] = useState<FightView | null>(null);
  // phase 5d: the character sheet's open tab, and whether its floating turn tracker is showing
  const [sheetTab, setSheetTab] = useState<SheetTab>("actions");
  const [initOpen, setInitOpen] = useState(false);

  // Catalog + its scoping controls.
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  // Phase 5o: the rules edition is stored on the character (build.edition), so a 2014 character reloads
  // as 2014. A character saved before this has none and stays on 2024, as it always derived.
  const storedEdition = (build as Build & { edition?: Edition }).edition;
  const edition: Edition = storedEdition === "2014" || storedEdition === "both" ? storedEdition : "2024";
  const setEdition = useCallback((e: Edition) => {
    setBuild((prev) => ({ ...prev, edition: e } as Build));
    setSaveState("idle");
  }, []);
  const [enabledPartners, setEnabledPartners] = useState<Set<string>>(new Set());

  // A brand-new build has no ?c and no ?lib: it's immediately editable (no fetch needed). A ?c or
  // ?lib load fetches that row. Either way the catalog loads up front.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setStatus("signedout"); return; }

      loadCatalog(supabase).then((c) => { if (active) setCatalog(c); }).catch(() => { /* pickers degrade to empty */ });

      // NEW build: nothing to fetch, start from a fresh sheet. The character sheet has nothing to show
      // for a build that does not exist yet, so it falls through to picking a character instead.
      if (mode === "new" && view !== "play") {
        if (!active) return;
        setName("New character");
        const newSys = getActiveCampaign()?.system;
        setSystem(newSys === "pf2e" || newSys === "daggerheart" || newSys === "drawsteel" || newSys === "lancer" || newSys === "darkmatter" ? newSys : "dnd5e");
        setStatus("ready");
        return;
      }

      // LIBRARY build.
      if (mode === "library" && libIdParam) {
        const { data, error } = await supabase
          .from("pc_library")
          .select("id, name, system, build, species, class, subclass, species_variant, level, portrait_url")
          .eq("id", libIdParam)
          .single();
        if (!active) return;
        if (error || !data) { await explainFailure("library", libIdParam, error); return; }
        const r = data as LibRow;
        const sys = (r as { system?: string }).system || "dnd5e";
        setSystem(sys);
        if (sys === "pf2e") setPbuild({ ...emptyPf2eBuild(), ...(r.build as Partial<Pf2eBuild>) });
        else if (sys === "daggerheart") setDbuild({ ...emptyDHBuild(), ...(r.build as Partial<DHBuild>) });
        else if (sys === "drawsteel") setSteelBuild({ ...emptyDSBuild(), ...(r.build as Partial<DSBuild>) });
        else if (sys === "lancer") setLancerBuild({ ...emptyLancerBuild(), ...(r.build as Partial<LancerBuild>) });
        else setBuild(seedFromDenorm(normalizeBuild(r.build), r));
        setName(r.name || "");
        setSpeciesVariant(r.species_variant || "");
        setStatus("ready");
        return;
      }

      // No ?c means we're picking from the stable.
      if (!charId) {
        const { data, error } = await supabase.rpc("my_characters");
        if (!active) return;
        if (error) { setStatus("error"); return; }
        setStable(((data as StableRow[]) || []).filter((c) => c.kind === "pc"));
        setStatus("picking");
        return;
      }

      // CAMPAIGN character.
      const { data, error } = await supabase
        .from("characters")
        .select("id, name, system, build, species, class, subclass, species_variant, level, alignment, campaign_id, portrait_url")
        .eq("id", charId)
        .single();
      if (!active) return;
      if (error || !data) { await explainFailure("character", charId, error); return; }
      const r = data as CharRow;
      setRow(r);
      const sys = (r as { system?: string }).system || "dnd5e";
      setSystem(sys);
      // Opening a campaign character sets it as the active campaign, so the Forge (and the rest of the
      // app) theme to that campaign's system and build for it. A Lancer character opens with the Lancer
      // look and the Lancer builder even when reached straight from the stable.
      const cid = (r as { campaign_id?: string }).campaign_id;
      if (cid) setActiveCampaign({ id: cid, system: sys });
      if (sys === "pf2e") setPbuild({ ...emptyPf2eBuild(), ...(r.build as Partial<Pf2eBuild>) });
      else if (sys === "daggerheart") setDbuild({ ...emptyDHBuild(), ...(r.build as Partial<DHBuild>) });
      else if (sys === "drawsteel") setSteelBuild({ ...emptyDSBuild(), ...(r.build as Partial<DSBuild>) });
      else setBuild(seedFromDenorm(normalizeBuild(r.build), r));
      setName(r.name || "");
      setSpeciesVariant(r.species_variant || "");
      if (r.portrait_url) {
        const { data: pu } = supabase.storage.from("campaign-maps").getPublicUrl(r.portrait_url);
        setPortraitUrl(pu.publicUrl);
      }
      setStatus("ready");
    })();
    return () => { active = false; };
  }, [supabase, charId, libIdParam, mode, view, explainFailure]);

  // Seed build.meta / level from the denormalized columns when the stored jsonb is empty (a
  // character claimed at the table has species/class set but may never have been opened here).
  function seedFromDenorm(
    b: Build,
    r: { species: string | null; class: string | null; subclass: string | null; level: number | null },
  ): Build {
    return {
      ...b,
      level: b.level || r.level || 1,
      meta: {
        species: b.meta.species || r.species || "",
        className: b.meta.className || r.class || "",
        subclass: b.meta.subclass || r.subclass || "",
        background: b.meta.background || "",
      },
    };
  }

  // --- SRD lists still needed: gear + backgrounds (no catalog table) + rules context. Full records
  // (not just names) so descriptions can be composed. ---
  const srdMode = edition;
  const srd = useMemo(() => {
    const backgrounds = loadSrd("backgrounds", srdMode) as unknown as BackgroundRecord[];
    const equipment = loadSrd("equipment", srdMode) as unknown as ItemRecord[];
    const magic = loadSrd("magic-items", srdMode) as unknown as ItemRecord[];
    const speciesData = loadSrd("species", srdMode) as unknown as { species: SpeciesMechRecord[]; variants: SpeciesVariantRec[] };
    // loadSrd may hand back a bare array or a wrapped shape depending on the domain; normalize to
    // an array so an unexpected wrapper doesn't silently yield no progression.
    const rawClasses = loadSrd("classes", srdMode) as unknown;
    const classes: ClassRecord[] = Array.isArray(rawClasses)
      ? (rawClasses as ClassRecord[])
      : (((rawClasses as { classes?: ClassRecord[]; default?: ClassRecord[] })?.classes
          || (rawClasses as { default?: ClassRecord[] })?.default || []) as ClassRecord[]);
    if (typeof window !== "undefined") {
      // TEMP diagnostic: confirm the loader is serving classes with features_by_level.
      console.log("[forge] classes loaded:", classes.length,
        "sample:", classes[0]?.name, "features:", classes[0]?.features_by_level?.length);
    }
    const speciesByName: Record<string, SpeciesMechRecord> = {};
    (speciesData.species || []).forEach((s) => { speciesByName[s.name] = s; });
    // Variant/lineage records that carry trait data (only the SRD subraces do; catalog variants are
    // name-only). Keyed by variant name for the features section.
    const variantByName: Record<string, SpeciesVariantRec> = {};
    (speciesData.variants || []).forEach((v) => { if (v?.name) variantByName[v.name] = v; });
    const bgByName: Record<string, BackgroundRecord> = {};
    backgrounds.forEach((b) => { bgByName[b.name] = b; });
    const classByName: Record<string, ClassRecord> = {};
    classes.forEach((c) => { if (c?.name && !classByName[c.name]) classByName[c.name] = c; });
    // Feats for the ASI/feat picker: a name-sorted list plus a by-name lookup for descriptions.
    const feats = loadSrd("feats", srdMode) as unknown as FeatOption[];
    const spells = loadSrd("spells", srdMode) as unknown as SpellRecord[];
    // The fetched progression data. Keyed by name so it can be looked up beside the catalog record;
    // a class the fetch did not cover simply has no entry and the panel falls back to what it drew
    // before, which is why this is additive rather than a replacement.
    const structured = loadSrd("classes-structured", srdMode) as unknown as { name: string }[];
    const structuredByName: Record<string, unknown> = {};
    structured.forEach((c) => { structuredByName[c.name] = c; });
    const featList = [...(feats || [])].sort((a, b) => a.name.localeCompare(b.name));
    const featByName: Record<string, FeatOption> = {};
    featList.forEach((f) => { if (!featByName[f.name]) featByName[f.name] = f; });
    // One item lookup for descriptions (mundane + magic, first wins on a both-mode name collision).
    const itemByName: Record<string, ItemRecord> = {};
    equipment.forEach((e) => { if (!itemByName[e.name]) itemByName[e.name] = e; });
    magic.forEach((m) => { if (!itemByName[m.name]) itemByName[m.name] = m; });
    return { backgrounds, equipment, magic, speciesByName, variantByName, bgByName, classByName, itemByName, featList, featByName, spells, structuredByName };
  }, [srdMode]);
  // the creatures a companion or a Wild Shape form can be picked from (phase 5g)
  const monsterList = useMemo(() => loadSrd("monsters", srdMode) as unknown as MonsterRec[], [srdMode]);

  // Description of the currently selected species / background, for the Identity panel.
  const speciesDesc = useMemo<Described | null>(
    () => describeSpecies(srd.speciesByName[build.meta.species]),
    [srd.speciesByName, build.meta.species],
  );
  const backgroundDesc = useMemo<Described | null>(
    () => describeBackground(srd.bgByName[build.meta.background]),
    [srd.bgByName, build.meta.background],
  );
  // Push 11 (audit G9): a background from an older book lists no ability scores and no origin feat. Under
  // the 2024 rules the player picks both (three abilities on the Background tab, and an Origin feat
  // stored as build.bgOriginFeat). Everything that reads the background's feat reads this record, so the
  // chosen feat applies exactly as a listed one would.
  const bgOriginFeat = (build as Build & { bgOriginFeat?: string }).bgOriginFeat || "";
  const bgEff = useMemo(() => {
    const r = srd.bgByName[build.meta.background];
    return r && !r.feat && edition !== "2014" && bgOriginFeat ? { ...r, feat: bgOriginFeat } : r;
  }, [srd.bgByName, build.meta.background, edition, bgOriginFeat]);

  // The class record with the character's OWN subclass in its feature list. The raw class JSON
  // carries the SRD subclass's features for every character (lib/subclass-features.ts), so every
  // place that lists class features reads this instead of srd.classByName directly.
  const subclassOfClass = useCallback((cn: string): string => {
    if (cn === build.meta.className) return build.meta.subclass || "";
    const mc = ((build as Build & { multiclass?: { className: string; subclass?: string }[] }).multiclass || [])
      .find((c) => c.className === cn);
    return mc?.subclass || "";
  }, [build]);
  const classRecWithSub = useCallback(
    (cn: string) => withSubclass(srd.classByName[cn], cn, subclassOfClass(cn), edition),
    [srd.classByName, subclassOfClass, edition],
  );

  // Per-level class progression up to the character's current level, for the progression panel.
  const progression = useMemo<LevelGroup[]>(
    () => classProgression(classRecWithSub(build.meta.className), build.level),
    [classRecWithSub, build.meta.className, build.level],
  );

  // Epic-tier (21-30) progression rows, from the real epic table. Empty at level 20 or below.
  const epicRows = useMemo<LevelGroup[]>(
    () => epicProgression(DEFAULT_EPIC, build.level),
    [build.level],
  );

  // The feats and epic boons the character has actually chosen, resolved from epicChoices into
  // display entries (name + level + description) for the Features section. Skips pure ability-score
  // improvements (those aren't feats); keeps anything flagged isFeat with a name.
  const chosenFeats = useMemo(() => {
    const out: { level: number; name: string; desc?: string; category?: string }[] = [];
    const ec = build.epicChoices || {};
    for (const key of Object.keys(ec).map(Number).sort((a, b) => a - b)) {
      for (const ch of ec[key] || []) {
        if (!ch?.isFeat || !ch.name) continue;
        const f = srd.featByName[ch.name];
        // Level key 1000+ is an epic-boon slot; recover the real level for display.
        const level = key >= 1000 ? key - 1000 : key;
        out.push({ level, name: ch.name, desc: f?.description || ch.desc, category: f?.category });
      }
    }
    return out;
  }, [build.epicChoices, srd.featByName]);

  // Phase 5i.1: the feats a D&D Beyond sheet lists (Resilient, Skilled, a Fighting Style), shown with
  // the chosen ones. D&D Beyond does not say at which level each was taken, so they show as level 0.
  const importedFeats = useMemo(() => {
    const list = (build as Build & { imported?: { sheet?: { features?: { name: string }[] } } }).imported?.sheet?.features || [];
    const seen = new Set(chosenFeats.map((f) => f.name));
    const out: { level: number; name: string; desc?: string; category?: string }[] = [];
    for (const f of list) {
      const rec = srd.featByName[f.name.trim()];
      if (!rec || rec.name === "Ability Score Improvement" || seen.has(rec.name)) continue;
      seen.add(rec.name);
      out.push({ level: 0, name: rec.name, desc: rec.description, category: rec.category });
    }
    return out;
  }, [build, chosenFeats, srd.featByName]);

  // Class features gained, grouped by level, for the printable sheet's compact roster.
  const classFeatureGroups = useMemo(() => {
    const rec = classRecWithSub(build.meta.className);
    const byLevel: Record<number, string[]> = {};
    (rec?.features_by_level || []).forEach((f) => {
      if (f.level <= build.level) (byLevel[f.level] = byLevel[f.level] || []).push(f.name);
    });
    return Object.keys(byLevel).map(Number).sort((a, b) => a - b).map((lv) => ({ level: lv, names: byLevel[lv] }));
  }, [classRecWithSub, build.meta.className, build.level]);

  // Trigger the browser's print dialog (user chooses "Save as PDF"). The print stylesheet in the
  // sheet component hides the editor and reveals the clean sheet.
  const downloadPdf = useCallback(() => {
    if (typeof window !== "undefined") window.print();
  }, []);

  // The ASI levels the character has reached, each of which grants an ability-score increase or a
  // feat. Standard 4/8/12/16/19 plus any class-specific extras (e.g. Fighter 6/14) plus epic ASIs
  // (21/23/25/27/29, from the Epic Legacy table baked into the engine's DEFAULT_EPIC).
  const EPIC_ASI_LEVELS = [21, 23, 25, 27, 29];
  const asiLevels = useMemo<number[]>(() => {
    const base = asiLevelsUpTo(srd.classByName[build.meta.className], build.level);
    const epicAsi = EPIC_ASI_LEVELS.filter((l) => l <= build.level);
    return [...new Set([...base, ...epicAsi])].sort((a, b) => a - b);
  }, [srd.classByName, build.meta.className, build.level]);

  const ruleset: "2014" | "2024" = edition === "2014" ? "2014" : "2024";
  const ctx = useMemo(() => buildRulesContext(ruleset), [ruleset]);
  // The species with the player's lineage / ancestry / legacy pick layered on. Null for a species
  // that has no structured entry yet (most catalog species); those keep the trait-text route.
  const speciesPicks = (build as Build & { speciesChoices?: Record<string, string> }).speciesChoices;
  const resolvedSpecies = useMemo(
    () => (build.meta.species
      ? resolveSpecies(build.meta.species, ruleset, speciesPicks || {}, speciesVariant) : null),
    [build.meta.species, ruleset, speciesPicks, speciesVariant],
  );

  // A character imported from a D&D Beyond sheet carries the scores D&D Beyond PRINTS, which
  // already include every item bonus. Build.abilities is otherwise "base before gear" and the engine
  // adds ITEM_EFFECTS on top, so deriving an import through the plain context applies those items
  // TWICE (the Rogue test sheet carries Manual of Bodily Health AND Manual of Quickness of Action,
  // both in that table).
  //
  // Suppression is a DERIVATION concern only, so it gets its own context rather than replacing
  // `ctx`: GearPanel reads ctx.items / ctx.itemVariants to render item metadata and the variant
  // picker, and must keep seeing the full tables or imported characters would lose their variant
  // dropdowns. Everything else about an import derives normally.
  const printedAbilities = hasPrintedAbilities(build);
  // Everything the player has chosen, turned into things the engine can read. Computed here rather
  // than inside deriveSheet so the derivation stays one function with one input, and so a wrong
  // rule in the mapping can only feed the engine badly, never corrupt it.
  /**
   * Spells a species lineage grants: Elven Lineage, Fiendish Legacy and the like.
   *
   * These are NOT class spells. The rules say you always have them prepared and can cast each once
   * per Long Rest without a slot, which means two things the Spells tab has to respect: they arrive
   * without being chosen, and they do NOT count against the prepared limit. Folding them into
   * build.spells.known would break both - the player could delete them, and they would eat a slot
   * in a cap that is not theirs to fill.
   */
  const grantedSpells = useMemo(() => {
    const traits = traitList(srd.speciesByName[build.meta.species]?.traits)
      .concat(traitList(srd.variantByName[speciesVariant]?.traits));
    const picks = (build as Build & { speciesChoices?: Record<string, string> }).speciesChoices || {};
    // free: a species grant, cast once per long rest without a slot (phase 5f); subclass spells are not
    const out: { spell: string; from: string; level: number; free?: boolean }[] = [];
    // A species with a structured entry grants its spells from there: the base species' (Light,
    // Thaumaturgy) and the picked option's. The trait-text route below misses the level 1 cantrip,
    // because that table cell is a sentence rather than a spell name.
    if (resolvedSpecies) {
      for (const g of resolvedSpecies.effects.spells || []) {
        if (g.level <= (build.level || 1) && !out.some((o) => o.spell === g.spell)) {
          // the species data marks the once-per-long-rest casts ("free": "1/LR"); cantrips need no slot anyway
          out.push({ spell: g.spell, from: resolvedSpecies.option || build.meta.species, level: g.level, free: !!(g as { free?: string }).free });
        }
      }
    }
    for (const t of resolvedSpecies ? [] : traits) {
      const chosen = picks[t.name];
      if (!chosen) continue;
      const opt = traitOptions(t.desc).find((o) => o.name === chosen);
      for (const g of lineageSpells(opt)) {
        // Only what the character has actually reached. A level 1 elf does not have Misty Step
        // pending; they have nothing, and listing it as theirs would be wrong rather than early.
        if (g.level <= (build.level || 1)) out.push({ spell: g.spell, from: `${chosen} ${t.name}`, level: g.level, free: true });
      }
    }
    // A subclass that grants spells does so on exactly the same terms as a lineage - always
    // prepared, free of the limit - so they land in one list rather than as two features the
    // player has to learn are the same thing.
    const classPicks = (build as Build & { classChoices?: Record<string, string[]> }).classChoices || {};
    for (const g of subclassSpellsFor(build.meta.subclass || "", build.level || 1, classPicks, edition, build.meta.className || "")) {
      out.push({ spell: g.spell, from: build.meta.subclass || "your subclass", level: g.level });
    }
    // Phase 5i.1: spells a CLASS feature keeps prepared (2024 rules). The paladin's Divine Smite
    // (Paladin's Smite, level 2) and Find Steed (Faithful Steed, level 5) are each cast once per Long
    // Rest without a slot; the ranger's Hunter's Mark (Favored Enemy, level 1) is always prepared.
    if (edition !== "2014") {
      const CLASS_FEATURE_SPELLS: { cls: string; at: number; spell: string; from: string; free: boolean }[] = [
        { cls: "Paladin", at: 2, spell: "Divine Smite", from: "Paladin's Smite", free: true },
        { cls: "Paladin", at: 5, spell: "Find Steed", from: "Faithful Steed", free: true },
        { cls: "Ranger", at: 1, spell: "Hunter's Mark", from: "Favored Enemy", free: false },
      ];
      for (const g of CLASS_FEATURE_SPELLS) {
        if (classLevelOf(build, g.cls) >= g.at && !out.some((o) => o.spell === g.spell)) out.push({ spell: g.spell, from: g.from, level: g.at, free: g.free });
      }
    }
    return out;
  }, [build, speciesVariant, srd.speciesByName, srd.variantByName, resolvedSpecies, edition]);

  const effects: ChoiceEffects = useMemo(() => {
    const traits = traitList(srd.speciesByName[build.meta.species]?.traits)
      .concat(traitList(srd.variantByName[speciesVariant]?.traits));
    const options: Record<string, { name: string; detail?: string }[]> = {};
    for (const t of traits) options[t.name] = traitOptions(t.desc);
    // A pick a structured species choice owns is applied through resolvedSpecies (deriveCtx), so it
    // is kept out of the trait-text route, which would otherwise list it as "recorded, not applied".
    const allPicks = (build as Build & { speciesChoices?: Record<string, string> }).speciesChoices || {};
    const mechNow = resolvedSpecies?.mech;
    const textPicks = Object.fromEntries(Object.entries(allPicks).filter(([k]) =>
      k !== SPECIES_ABILITY_KEY && !isSpeciesProfKey(k) && !structuredChoiceOptions(mechNow, k)));

    const cls = build.meta.className || "";
    const expertiseKeys = choicesFor(cls, build.meta.subclass || "", build.level || 1, edition)
      .filter((c) => c.feature.toLowerCase().includes("expertise"))
      .map(choiceKey);

    // The level 1 skill grant is built here from the same shape ClassChoicesPanel uses, so both
    // agree on the key. Deriving the key twice is unfortunate; deriving it two DIFFERENT ways would
    // mean picks that save under one name and are read under another, which fails silently.
    const skillProfKeys = cls
      ? [choiceKey({ className: cls, level: 1, feature: "Skill Proficiencies", choose: 0, kind: "skill" })]
      : [];

    const bgRec = bgEff;
    const fx = choiceEffects({
      background: bgRec,
      grantedFeat: bgRec?.feat ? srd.featByName[bgRec.feat] : undefined,
      grantedFeatAbility: (build as Build & { bgFeatAbility?: string }).bgFeatAbility,
      speciesTraits: traits,
      speciesChoices: textPicks,
      speciesOptions: options,
      classChoices: (build as Build & { classChoices?: Record<string, string[]> }).classChoices || {},
      expertiseKeys,
      skillProfKeys,
    });
    if (resolvedSpecies?.option && mechNow?.choice) {
      fx.applied.push(`${resolvedSpecies.option} from ${mechNow.choice.label}`);
    }
    // Fixed species skills (2014 Elf Keen Senses: Perception; Half-Orc Menacing: Intimidation).
    for (const key of resolvedSpecies?.effects.skillProf || []) {
      const label = SKILLS.find(([k]) => k === key)?.[1];
      if (!label) continue;
      if (!fx.skillProf.includes(key)) fx.skillProf.push(key);
      fx.applied.push(`${label} proficiency from ${build.meta.species}`);
    }
    // Weapon, armor, tool and language grants have no numbers to move on this sheet; they are
    // listed so Finish shows everything the species gave.
    {
      const e = resolvedSpecies?.effects;
      const list = (xs: string[] | undefined, what: string) => {
        if (xs?.length) fx.applied.push(`${what}: ${xs.join(", ")} (from ${build.meta.species})`);
      };
      list(e?.weaponProf, "Weapon proficiency");
      list(e?.armorProf, "Armor training");
      list(e?.toolProf, "Tool proficiency");
      list(e?.languages, "Languages");
      if (e?.languagePick) fx.unapplied.push(`${e.languagePick.n} extra language${e.languagePick.n > 1 ? "s" : ""} of your choice (note it on your sheet)`);
    }
    {
      const asi = speciesAsiMods(resolvedSpecies?.effects.asiPick, allPicks);
      for (const [a, v] of Object.entries(asi)) fx.applied.push(`+${v} ${a.toUpperCase()} from ${build.meta.species}`);
      const need = asiAmounts(resolvedSpecies?.effects.asiPick, allPicks).length;
      if (resolvedSpecies?.effects.asiPick && Object.keys(asi).length < (need || 1)) {
        fx.unapplied.push(`${build.meta.species}: choose your ability score increases on the Species tab`);
      }
    }
    // Species skill picks are real proficiencies and go where background and class skills go.
    // Tool picks are recorded and listed; the engine has no tool-check numbers to move.
    const spName = build.meta.species || "your species";
    const sk = resolvedSpecies?.effects.skillPick;
    for (let i = 0; sk && i < sk.n; i++) {
      const key = allPicks[speciesSkillKey(i)];
      const label = SKILLS.find(([k]) => k === key)?.[1];
      if (!key || !label) continue;
      if (!fx.skillProf.includes(key)) fx.skillProf.push(key);
      fx.applied.push(`${label} proficiency from ${spName}`);
    }
    const tp = resolvedSpecies?.effects.toolPick;
    for (let i = 0; tp && i < tp.n; i++) {
      const tool = allPicks[speciesToolKey(i)];
      if (tool) fx.applied.push(`${tool} proficiency from ${spName}`);
    }
    return fx;
  }, [build, speciesVariant, srd.speciesByName, srd.variantByName, srd.bgByName, srd.featByName, resolvedSpecies, edition, bgEff]);

  // Every species trait the sheets show: SRD text, else the bundled summary (rules-data), plus the
  // player's own (a same-name own trait replaces the built-in one). One list, so the Species tab, the
  // Features tab, the play sheet and the print agree.
  const speciesTraitsShown = useMemo(() => shownSpeciesTraits(
    traitList(srd.speciesByName[build.meta.species]?.traits),
    speciesMechanics(build.meta.species, ruleset)?.traits,
    build.speciesTraits,
  ), [srd.speciesByName, build.meta.species, build.speciesTraits, ruleset]);

  const deriveCtx = useMemo(() => {
    const raw0 = printedAbilities ? suppressItemEffects(ctx) : ctx;
    // A species the rules data does not know gets the player's own speed, darkvision and resistances.
    const own = build.speciesMech;
    const base0 = own && build.meta.species && !raw0.species?.[build.meta.species]
      ? { ...raw0, species: { ...raw0.species, [build.meta.species]: { speed: own.speed, darkvision: own.darkvision, resist: own.resist } } }
      : raw0;
    // The picked lineage / ancestry / legacy changes the species entry itself (Wood Elf speed 35,
    // Drow darkvision 120, a legacy's resistance), so it is laid over a COPY of that entry.
    const re = resolvedSpecies?.option ? resolvedSpecies.effects : null;
    const base = re && build.meta.species ? {
      ...base0,
      species: {
        ...base0.species,
        [build.meta.species]: {
          ...(base0.species?.[build.meta.species] || {}),
          speed: re.speed, darkvision: re.darkvision, senses: re.senses, speeds: re.speeds,
          resist: re.resist, immune: re.immune, advAgainst: re.advAgainst, acBonus: re.acBonus,
          advSaves: re.advSaves, advSavesVs: re.advSavesVs, naturalArmor: re.naturalArmor,
          // A 2014 subrace's ability increase (Hill Dwarf +1 WIS) and HP per level ride on the
          // species mods, which the engine already adds to base scores and hit points.
          mods: re.mods as Record<string, number> | undefined,
        },
      },
    } : base0;
    if (!effects.resist.length || !build.meta.species) return base;
    // Resistances reach the sheet through the species entry in the rules context, so a chosen
    // ancestry is patched onto a COPY of that entry rather than into the build. Copying matters:
    // ctx is shared and long-lived, and mutating it would leak one character's dragon into the next.
    const prev = base.species?.[build.meta.species] || {};
    return {
      ...base,
      species: {
        ...base.species,
        [build.meta.species]: {
          ...prev,
          resist: [...(prev.resist || []), ...effects.resist.filter((r) => !(prev.resist || []).includes(r))],
        },
      },
    };
  }, [ctx, printedAbilities, effects.resist, build.meta.species, build.speciesMech, resolvedSpecies]);

  // Apply the chosen species' ability bonuses (2014 carry "CON +2"; 2024 carry none) into
  // build.featMods, which the engine adds to the base scores.
  // Phase 5o: the feats the engine models (Alert, Tough) by name: chosen at ASI levels, listed on an
  // imported D&D Beyond sheet, or granted by the background (its origin feat).
  const featNames = useMemo(() => {
    const listed = ((build as Build & { imported?: { sheet?: { features?: { name: string }[] } } }).imported?.sheet?.features || []).map((f) => f.name.trim());
    const origin = bgEff?.feat;
    return [...new Set([...chosenFeats.map((f) => f.name), ...listed, ...(origin ? [origin] : [])])];
  }, [build, chosenFeats, bgEff]);

  const buildForDerive = useMemo<Build>(() => {
    const mech = srd.speciesByName[build.meta.species];
    const bonus = parseAbilityBonuses(mech?.ability_bonuses);
    // ADDITIVE, not spread. The old version overwrote, so a species +2 CON and a background +1 CON
    // came out as +2. Nothing wrote a background bonus before, so the bug had never fired.
    // The player's own 2014 species increases (Half-Elf two +1s, Monsters of the Multiverse +2/+1),
    // stored as Species ASI picks and only offered when the 2014 entry carries an asiPick.
    const spAsi = speciesAsiMods(resolvedSpecies?.effects.asiPick,
      (build as Build & { speciesChoices?: Record<string, string> }).speciesChoices || {});
    const merged: Record<string, number> = {};
    // An imported character's scores are D&D Beyond's FINAL ones (phase 5i.1): species, background
    // and feat increases are already in them, so only what the player adds here afterwards applies.
    const sources = printedAbilities ? [build.featMods || {}] : [build.featMods || {}, build.bgAsi || {}, effects.featMods, bonus, spAsi];
    for (const src of sources) {
      for (const [k, v] of Object.entries(src)) merged[k] = (merged[k] || 0) + Number(v || 0);
    }
    // Granted skills and expertise fold in here, so the engine sees them as though the player had
    // ticked them by hand - which is the point: a proficiency from a background is not a lesser
    // proficiency.
    // where those points came from, for the character sheet's ability breakdown (labels only)
    const featModSources = [
      { label: "Background", mods: build.bgAsi || {} },
      { label: "Species", mods: bonus },
      { label: "Species choice", mods: spAsi },
      { label: "Class and species choices", mods: effects.featMods },
      { label: "Other bonuses", mods: build.featMods || {} },
    ] as { label: string; mods: Record<string, number> }[];
    return applyToBuild({ ...build, featMods: merged, featModSources, feats: featNames }, effects);
  }, [build, srd.speciesByName, effects, resolvedSpecies, printedAbilities, featNames]);

  const sheet = useMemo(() => {
    try { return deriveSheet(buildForDerive, deriveCtx); } catch { return null; }
  }, [buildForDerive, deriveCtx]);

  const epic = useMemo(() => epicAdvancement(build.level), [build.level]);

  // Hit dice: one per level of each class, of that class's size.
  const hitDice = useMemo(() => [
    { cn: build.meta.className || "", lv: build.level || 1 },
    ...((build as Build & { multiclass?: { className: string; level: number }[] }).multiclass || []).map((c) => ({ cn: c.className, lv: c.level || 1 })),
  ].map(({ cn, lv }) => ({ die: deriveCtx.classes?.[cn]?.hitDie ?? 0, count: lv })).filter((d) => d.die > 0), [build, deriveCtx]);

  // Phase 5b: what the resource tracker and the play sheet's actions and spells share. Lifted out of
  // the tracker's props so both read one set of numbers (lib/play/tracks.ts).
  const resInputs = useMemo<TrackInputs>(() => {
    const multi = (build as Build & { multiclass?: { className: string; level: number }[] }).multiclass || [];
    const casterOf = (n: string): CasterType =>
      ((srd.structuredByName[n] as { caster_type?: string } | undefined)?.caster_type || "NONE") as CasterType;
    // A subclass caster (Eldritch Knight, Arcane Trickster, Warrior of the Mystic Arts) makes a
    // non-casting class a THIRD caster; the class data alone says NONE.
    const primaryType = subclassCasterType(build.meta.className || "", build.meta.subclass) || casterOf(build.meta.className || "");
    const all = [{ casterType: primaryType, level: build.level || 1 }, ...multi.map((c) => ({ casterType: casterOf(c.className), level: c.level || 1 }))];
    // Slots for a multiclassed caster come from ONE combined table, not from each class's own row;
    // a single-class subclass caster's own third-caster table replaces its (empty) class row.
    // Push 11 (audit B13): 2024 rounds Paladin and Ranger levels up, 2014 down.
    const mcSlots = isMulticlassCaster(all) ? multiclassSlots(casterLevel(all, ruleset))
      : primaryType === "THIRD" && all.length === 1 ? thirdCasterSlots(build.level || 1) : [];
    return {
      structuredRec: srd.structuredByName[build.meta.className],
      level: build.level || 1,
      // Each additional class brings its own pools at ITS level.
      extraClasses: multi.map((c) => ({ rec: srd.structuredByName[c.className], level: c.level || 1 })),
      extraPools: [
        ...speciesResources(traitList(srd.speciesByName[build.meta.species]?.traits).map((t) => t.name), sheet?.proficiencyBonus || 0),
        // Lay on Hands (both editions): a pool of 5 hit points per paladin level, back on a Long Rest
        ...(classLevelOf(build, "Paladin") > 0 ? [{ key: "lay-on-hands", label: "Lay on Hands (HP)", max: 5 * classLevelOf(build, "Paladin"), shortRest: "none" as const }] : []),
      ],
      mcSlots,
    };
  }, [build, srd, sheet?.proficiencyBonus, ruleset]);
  const costedList = useMemo(() => [
    // Automatic first: a monk's Flurry is not a decision they made, and burying it under the options
    // they picked would read as though it were.
    ...[
      { cn: build.meta.className || "", sc: build.meta.subclass || "", lv: build.level || 1 },
      ...((build as Build & { multiclass?: { className: string; subclass?: string; level: number }[] }).multiclass || [])
        .map((c) => ({ cn: c.className, sc: c.subclass || "", lv: c.level || 1 })),
    ].flatMap(({ cn, sc, lv }) => actionsFor(cn, sc, lv))
      .map((a) => ({ name: a.name, summary: a.summary, resource: a.cost.resource, amount: a.cost.amount })),
    ...costedPicks(build.meta.className || "", build.meta.subclass || "", build.level || 1,
      (build as Build & { classChoices?: Record<string, string[]> }).classChoices || {}, edition),
  ], [build, edition]);
  const tracks = useMemo(() => trackedResources(resInputs), [resInputs]);
  // attack rows: every weapon the character has equipped (phase 5c), and an unarmed strike
  // attacksBase: what the engine works out; playAttacks adds an imported character's adjustments
  // (phase 5i.2), and the attacks D&D Beyond lists that the sheet has no weapon for
  const attacksBase = useMemo<AttackRow[]>(() => {
    if (!sheet) return [];
    const profText = weaponProfText((srd.structuredByName[build.meta.className] as { core_traits?: string } | undefined)?.core_traits);
    const rows: AttackRow[] = [];
    const picks = (build as Build & { classChoices?: Record<string, string[]> }).classChoices || {};
    // the weapons whose mastery the character can use: the Weapon Mastery picks, when there are any
    const mastered = new Set(Object.entries(picks).filter(([k]) => /Weapon Mastery/i.test(k)).flatMap(([, v]) => v).map((x) => x.toLowerCase()));
    (build.gear?.items || []).forEach((g, i) => {
      if (!gearEquipped(g)) return;
      const raw = srd.itemByName[g.n] as unknown as WeaponRecord | undefined;
      // a magic weapon with no damage of its own (Cinnabar Rapier) attacks as its base weapon: the one
      // its import named ("Holy Avenger Rapier" keeps base Rapier), else the one its record names
      const named = g.base ? srd.itemByName[g.base] as unknown as WeaponRecord | undefined : undefined;
      const rec = isWeapon(raw) ? raw : isWeapon(named) ? { ...named, name: g.n } : baseWeaponFor(raw as never, srd.equipment as unknown as WeaponRecord[]);
      if (!isWeapon(rec)) return;
      const row = weaponAttack(rec, sheet.mods, sheet.proficiencyBonus, profText, Number(g.mod) || 0, `${g.n}-${i}`);
      const baseName = (rec === raw ? rec.name : (raw as { attunement_note?: string } | undefined)?.attunement_note || rec.name).toLowerCase();
      if (mastered.size && !mastered.has(rec.name.toLowerCase()) && !mastered.has(baseName)) row.mastery = null;
      rows.push(row);
    });
    rows.push(unarmedAttack(sheet.mods, sheet.proficiencyBonus, sheet.martialArts || 0));
    return applyAttackFeatures(rows, {
      fightingStyles: Object.entries(picks).filter(([k]) => /Fighting Style/i.test(k)).flatMap(([, v]) => v),
      paladinLevel: classLevelOf(build, "Paladin"),
      ruleset: edition === "2014" ? "2014" : "2024",
    });
  }, [sheet, build, srd, edition]);
  const importedSheet = (build as Build & { imported?: { sheet?: DdbSheet } }).imported?.sheet;

  // Phase 5o: numbers other screens read off the saved character without running the engine, saved
  // with it as build.sheetSnapshot: darkvision, for the tabletop's line of sight. The longest of what
  // the sheet works out (species) and what an imported D&D Beyond sheet lists (Eyes of Night, an item).
  // Push 28 (V3): also AC, maximum HP, initiative, speed and attacks per Attack action, so a PC joins
  // a fight the GM starts with their numbers already in (lib/combat.ts pcCombatant).
  const sheetSnapshot = useMemo(() => {
    const dv = (t: string | null | undefined) => { const m = /darkvision\D{0,12}(\d+)/i.exec(t || ""); return m ? Number(m[1]) : 0; };
    const darkvision = Math.max(0, ...(sheet?.senses || []).map(dv), dv(importedSheet?.defenses?.senses));
    if (!sheet) return { darkvision };
    const multi = (build as Build & { multiclass?: { className: string; level: number }[] }).multiclass || [];
    return {
      darkvision, ac: sheet.ac, hpMax: sheet.hpMax, init: sheet.initiative, speed: sheet.speed,
      attacks: attacksPerAction([{ className: build.meta.className, subclass: build.meta.subclass, level: build.level }, ...multi]),
    };
  }, [sheet, importedSheet, build]);
  const playAttacks = useMemo<AttackRow[]>(() => {
    const rows = applyImportAdjust(attacksBase, build.importAdjust?.attacks);
    if (!importedSheet) return rows;
    const spellNames = new Set([...(srd.spells as unknown as { name: string }[]).map((x) => x.name.toLowerCase()),
      ...(build.spells?.cantrips || []).map((x) => x.toLowerCase()), ...(build.spells?.known || []).map((x) => x.toLowerCase())]);
    return [...rows, ...importedAttackRows(importedSheet.attacks, rows, spellNames)];
  }, [attacksBase, build.importAdjust, importedSheet, srd.spells, build.spells]);

  // known spells: cantrips, known or prepared, and those always prepared from species and subclass
  const playSpells = useMemo<KnownSpell[]>(() => {
    const byName = new Map((srd.spells as unknown as PlaySpell[]).map((sp) => [sp.name, sp]));
    const out: KnownSpell[] = [];
    const add = (n: string, always: string | null, free = false) => { const rec = byName.get(n); if (rec && !out.some((o) => o.rec.name === n)) out.push({ rec, always, free }); };
    for (const g of grantedSpells) add(g.spell, g.from, !!g.free);
    for (const n of [...(build.spells?.cantrips || []), ...(build.spells?.known || [])]) add(n, null);
    // Phase 5i.1: a spell the rules data does not have (one from a book outside the SRD, brought in from
    // D&D Beyond) is still listed, by name and level, so the sheet shows every spell the player has.
    const importedList = ((build as Build & { imported?: { sheet?: { spells?: { list?: { name: string; level: number | null; casting_time?: string; range?: string; duration?: string }[] } } } }).imported?.sheet?.spells?.list) || [];
    for (const n of [...(build.spells?.cantrips || []), ...(build.spells?.known || [])]) {
      if (byName.has(n) || out.some((o) => o.rec.name === n)) continue;
      const from = importedList.find((x) => x.name === n);
      const ct = (from?.casting_time ?? "").replace(/^1A$/, "Action").replace(/^1BA$/, "Bonus Action").replace(/^1R$/, "Reaction");
      out.push({ rec: { name: n, level: from?.level ?? 1, casting_time: ct || undefined, range: from?.range, duration: from?.duration,
        description: "This spell is not in Six Axes' rules data. Its full text is on your D&D Beyond sheet." }, always: null });
    }
    return out;
  }, [srd.spells, grantedSpells, build]);
  // healing yourself from a spell: through the fight when one is running, and into the play state
  const healSelf = (n: number) => {
    if (!sheet || !(n > 0)) return;
    const cur = (build as Build & { play?: PlayState }).play || {};
    const max = sheet.hpMax, now = fightMine?.me.hp ?? cur.hp ?? max;
    if (fightMine) void combatAct(supabase as never, fightMine.id, fightMine.me.id, "heal", { value: n });
    setPlay((p) => ({ ...p, hp: Math.min(max, now + n), death: { s: 0, f: 0 } }));
  };

  // While the character is in a fight, the fight's HP and conditions are the truth; copy them into
  // the play state so the sheet still shows them after the fight ends.
  const onFightSeen = useCallback((f: FightView | null, me: FightEntry | null) => {
    setFightMine(f && me && me.mine ? { id: f.id, me } : null);
    setFightView(f && me && me.mine ? f : null);
    if (!f || !me || !me.mine || me.hp == null) return;
    const cur = (build as Build & { play?: PlayState }).play || {};
    const conds = (me.conditions ?? []).filter((c) => c !== "Exhaustion");
    if (cur.hp === me.hp && (cur.temp ?? 0) === (me.tempHp ?? 0) && JSON.stringify(cur.conds ?? []) === JSON.stringify(conds)) return;
    setPlay((p) => ({ ...p, hp: me.hp, temp: me.tempHp ?? 0, conds }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build]);

  // --- catalog-derived option lists ---
  const partners = useMemo(() => (catalog ? partnerList(catalog) : []), [catalog]);
  const speciesOpts = useMemo(
    () => (catalog ? speciesOptions(catalog, enabledPartners, edition) : []),
    [catalog, enabledPartners, edition],
  );
  const classOpts = useMemo(
    () => (catalog ? classOptions(catalog, enabledPartners, edition) : []),
    [catalog, enabledPartners, edition],
  );
  const variantOpts = useMemo(
    () => (catalog ? variantOptions(catalog, build.meta.species, enabledPartners, edition) : []),
    [catalog, build.meta.species, enabledPartners, edition],
  );
  const subclassOpts = useMemo(
    () => (catalog ? subclassOptions(catalog, build.meta.className, enabledPartners) : []),
    [catalog, build.meta.className, enabledPartners],
  );
  // Tactical role tags for the chosen subclass (from the catalog; these describe how it PLAYS, not
  // its rules, the catalog has no prose). Shown as role chips, labeled as such.
  const subclassRoleTags = useMemo(
    () => (catalog ? subclassRoles(catalog, build.meta.className, build.meta.subclass) : []),
    [catalog, build.meta.className, build.meta.subclass],
  );

  // --- gear catalog (mundane + magic) with type + search ---
  const gearIndex = useMemo(() => {
    const rows: GearOption[] = [];
    // Mundane gear has no rarity in the data and is not "Common" by omission - Common is a real
    // magic-item rarity with two entries. Left undefined so the filter can tell "not magical" from
    // "magical and common".
    srd.equipment.forEach((e) => rows.push({ name: e.name, type: e.category || "Gear", magic: false }));
    srd.magic.forEach((m) => rows.push({
      name: m.name, type: m.category || "Wondrous", magic: true,
      rarity: normalizeRarity((m as { rarity?: string }).rarity),
    }));
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [srd.equipment, srd.magic]);
  const gearTypes = useMemo(
    () => Array.from(new Set(gearIndex.map((g) => g.type))).sort(),
    [gearIndex],
  );

  // --- mutations (all go through setBuild so the sheet re-derives, and mark unsaved) ---
  const patch = useCallback((fn: (b: Build) => Build) => {
    setBuild((prev) => fn(structuredCloneSafe(prev)));
    setSaveState("idle");
  }, []);

  // Phase 5i.2: an imported character is matched to its D&D Beyond sheet ONCE, right after it comes in
  // (the import leaves no importAdjust): whatever the engine works out differently from the printed
  // numbers is stored as importAdjust and added on top from then on. It waits until the character and
  // the catalog have loaded, so the comparison is against the sheet as it will be shown.
  // Phase 5o: an adjustment worked out against an older engine (before it modelled Alert, Tough and the
  // rest) is worked out again, once, against the engine as it is now, so a feat is not counted twice.
  // An adjustment the player cleared ("Use Six Axes' own numbers") is left cleared.
  const reconciledFor = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "ready" || !catalog || !sheet || !importedSheet) return;
    const adj = build.importAdjust;
    const cleared = !!adj && Object.keys(adj).every((k) => k === "at" || k === "v");
    if (adj && (cleared || (adj.v ?? 1) >= RECONCILE_VERSION)) return;
    const key = `${row?.id ?? "lib"}:${JSON.stringify(importedSheet.identity ?? {})}:${importedSheet.combat?.max_hp ?? ""}`;
    if (reconciledFor.current === key) return;
    reconciledFor.current = key;
    let fresh = sheet;
    if (adj) { try { fresh = deriveSheet({ ...buildForDerive, importAdjust: undefined }, deriveCtx); } catch { return; } }
    const adjust = reconcileImport(importedSheet, fresh, attacksBase);
    patch((b) => ({ ...b, importAdjust: adjust }));
  }, [status, catalog, sheet, importedSheet, build.importAdjust, attacksBase, row, patch, buildForDerive, deriveCtx]);

  const setSpecies = (v: string) => patch((b) => {
    // A new species asks different questions, so the old answers (an elf's lineage, its Keen Senses
    // skill) are cleared rather than left to apply to a species that never offered them. Same rule
    // as a background change clearing its ability assignment.
    if (b.meta.species !== v) (b as Build & { speciesChoices?: Record<string, string> }).speciesChoices = {};
    b.meta.species = v;
    return b;
  });
  const setVariant = (v: string) => { setSpeciesVariant(v); setSaveState("idle"); };
  const setBackground = (v: string) => patch((b) => {
    b.meta.background = v;
    // A new background offers different abilities, so the old assignment is meaningless rather than
    // merely stale. Clearing it is honest; carrying it over would silently apply a bonus the new
    // background does not grant. The same goes for an origin feat picked for a background without one.
    b.bgAsi = {};
    (b as Build & { bgOriginFeat?: string }).bgOriginFeat = undefined;
    return b;
  });
  const setBgAsi = (mods: Record<string, number>) => patch((b) => { b.bgAsi = mods; return b; });
  // Spent counts, not remaining. See lib/resources: the maximum moves with level and a stored
  // "remaining" silently becomes wrong the moment a character levels.
  const setSpent = (key: string, n: number) => patch((b) => {
    const t = b as Build & { spent?: Record<string, number> };
    const next = { ...(t.spent || {}) };
    if (n <= 0) delete next[key]; else next[key] = n;
    t.spent = next;
    return b;
  });
  const setSpentMap = (next: Record<string, number>) => patch((b) => {
    (b as Build & { spent?: Record<string, number> }).spent = next;
    return b;
  });
  const clearSpent = () => patch((b) => {
    (b as Build & { spent?: Record<string, number> }).spent = {};
    return b;
  });
  // The play state (phase 5a): current and temporary HP, hit dice spent, death saves, inspiration,
  // exhaustion and conditions, kept in the build beside the spent resources and saved the same way.
  const setPlay = (fn: (p: PlayState) => PlayState) => patch((b) => {
    const t = b as Build & { play?: PlayState };
    t.play = fn({ ...(t.play || {}) });
    return b;
  });
  // The inventory (phase 5c): the gear list with its equipped and attuned flags and the attuned
  // names beside it, the coins, and the character notes, all kept in the build.
  const setGear = (items: GearEntry[], attuned: string[]) => patch((b) => {
    b.gear = { ...b.gear, items, attuned };
    return b;
  });
  // The character sheet's overrides (phase 5e): ability scores and maximum HP, applied by the derivation.
  const setOverrides = (fn: (o: SheetOverrides) => SheetOverrides) => patch((b) => {
    const next = fn({ ability: { ...(b.abilityOverride || {}) }, hpMaxMod: b.hpMaxMod || 0, hpMaxOverride: b.hpMaxOverride ?? null });
    b.abilityOverride = Object.keys(next.ability).length ? next.ability : undefined;
    b.hpMaxMod = next.hpMaxMod || undefined;
    b.hpMaxOverride = next.hpMaxOverride ?? undefined;
    return b;
  });
  // Languages the player chose (phase 5e). The ones a species or class grants are worked out, not stored.
  const setCompanions = (list: Companion[]) => patch((b) => { (b as Build & { companions?: Companion[] }).companions = list; return b; });
  const setCustomDefenses = (d: CustomDefenses) => patch((b) => { b.customDefenses = d; return b; });
  const setLanguages = (list: string[]) => patch((b) => { (b as Build & { languages?: string[] }).languages = list; return b; });
  const setCoins = (c: Coins) => patch((b) => { (b as Build & { coins?: Coins }).coins = c; return b; });
  const setNotes = (n: CharNotes) => patch((b) => { (b as Build & { notes?: CharNotes }).notes = n; return b; });

  type MC = { className: string; subclass?: string; level: number };
  const addClass = (className: string) => patch((b) => {
    const t = b as Build & { multiclass?: MC[] };
    // The primary class lives in meta and must not be duplicated here, or its level would be
    // counted twice in every total.
    if (!className || className === b.meta.className) return b;
    if ((t.multiclass || []).some((c) => c.className === className)) return b;
    t.multiclass = [...(t.multiclass || []), { className, level: 1 }];
    return b;
  });
  // The sub-tabs treat every class the same, so these route by NAME rather than by whether a class
  // happens to be the primary. Without this the first tab would need its own handlers and would
  // behave subtly differently - which is exactly the seam the sub-tabs exist to remove.
  const setAnyClassLevel = (className: string, level: number) => {
    const capped = Math.max(1, Math.min(30, level));
    if (className === build.meta.className) return setLevel(capped);
    return setClassLevel(className, capped);
  };
  const setAnyClassSubclass = (className: string, subclass: string) => {
    if (className === build.meta.className) return setSubclass(subclass);
    return setClassSubclass(className, subclass);
  };

  const setClassLevel = (className: string, level: number) => patch((b) => {
    const t = b as Build & { multiclass?: MC[] };
    t.multiclass = (t.multiclass || []).map((c) =>
      c.className === className ? { ...c, level: Math.max(1, Math.min(20, level)) } : c);
    return b;
  });
  const setClassSubclass = (className: string, subclass: string) => patch((b) => {
    const t = b as Build & { multiclass?: MC[] };
    t.multiclass = (t.multiclass || []).map((c) =>
      c.className === className ? { ...c, subclass } : c);
    return b;
  });
  const removeClass = (className: string) => patch((b) => {
    const t = b as Build & { multiclass?: MC[] };
    t.multiclass = (t.multiclass || []).filter((c) => c.className !== className);
    return b;
  });

  const setBgOriginFeat = (f: string) => patch((b) => {
    (b as Build & { bgOriginFeat?: string }).bgOriginFeat = f || undefined;
    // the feat's own ability choice belonged to the previous feat
    (b as Build & { bgFeatAbility?: string }).bgFeatAbility = undefined;
    return b;
  });

  const setBgFeatAbility = (a: string) => patch((b) => {
    (b as Build & { bgFeatAbility?: string }).bgFeatAbility = a;
    return b;
  });

  // Several scores in one patch. Assigning an array touches up to six abilities at once, and six
  // separate calls would fire six autosaves with each reading the build before the last one landed.
  const setAbilities = (scores: Partial<Record<AbilityKey, number>>) => patch((b) => {
    b.abilities = { ...b.abilities, ...scores } as Build["abilities"];
    return b;
  });

  const setClassChoice = (key: string, values: string[]) => patch((b) => {
    const t = b as Build & { classChoices?: Record<string, string[]> };
    t.classChoices = { ...(t.classChoices || {}), [key]: values };
    return b;
  });

  const setSpeciesChoice = (trait: string, value: string) => patch((b) => {
    const t = b as Build & { speciesChoices?: Record<string, string> };
    t.speciesChoices = { ...(t.speciesChoices || {}), [trait]: value };
    return b;
  });
  // The player's own species traits and, for a species the rules data does not know, its numbers.
  const setOwnTraits = (list: OwnTrait[]) => patch((b) => ({ ...b, speciesTraits: list }));
  const setOwnMech = (m: OwnSpeciesMech) => patch((b) => ({ ...b, speciesMech: m }));

  const toggleSpell = (name: string, cantrip: boolean) => patch((b) => {
    const key = cantrip ? "cantrips" : "known";
    const list = [...(b.spells?.[key] || [])];
    const at = list.indexOf(name);
    if (at >= 0) list.splice(at, 1); else list.push(name);
    b.spells = { cantrips: b.spells?.cantrips || [], known: b.spells?.known || [], [key]: list };
    return b;
  });

  // Loadouts are SNAPSHOTS, not a live link. Applying one copies its lists into the working set, so
  // editing spells afterwards does not silently rewrite the saved loadout - which is what a player
  // means by "swap in and out" rather than "rename my only list".
  const saveLoadout = (label: string) => patch((b) => {
    const outs = [...((b as Build & { loadouts?: SpellLoadout[] }).loadouts || [])];
    const snap: SpellLoadout = {
      name: label,
      cantrips: [...(b.spells?.cantrips || [])],
      known: [...(b.spells?.known || [])],
    };
    const at = outs.findIndex((o) => o.name === label);
    if (at >= 0) outs[at] = snap; else outs.push(snap);
    (b as Build & { loadouts?: SpellLoadout[] }).loadouts = outs;
    return b;
  });
  const applyLoadout = (label: string) => patch((b) => {
    const outs = (b as Build & { loadouts?: SpellLoadout[] }).loadouts || [];
    const found = outs.find((o) => o.name === label);
    if (found) b.spells = { cantrips: [...found.cantrips], known: [...found.known] };
    return b;
  });
  const deleteLoadout = (label: string) => patch((b) => {
    const t = b as Build & { loadouts?: SpellLoadout[] };
    t.loadouts = (t.loadouts || []).filter((o) => o.name !== label);
    return b;
  });
  const setClassName = (v: string) => patch((b) => { b.meta.className = v; b.meta.subclass = ""; return b; });
  const setSubclass = (v: string) => patch((b) => { b.meta.subclass = v; return b; });
  const setLevel = (v: number) => patch((b) => { b.level = Math.max(1, Math.min(30, v || 1)); return b; });
  const setAbility = (a: Ability, v: number) =>
    patch((b) => { b.abilities[a] = Math.max(1, Math.min(epic.abilityCap, v || 10)); return b; });
  const addItem = (nm: string) =>
    patch((b) => { if (nm) b.gear.items = [...b.gear.items, { n: nm }]; return b; });

  // A granted bundle is one decision, so it is one patch. Adding seven items with seven calls to
  // addItem would fire seven autosaves and, worse, each would read the build as it was before the
  // previous one landed.
  const addItems = (names: string[]) =>
    patch((b) => {
      const add = names.filter(Boolean);
      if (add.length) b.gear.items = [...b.gear.items, ...add.map((n) => ({ n }))];
      return b;
    });
  const removeItem = (i: number) =>
    patch((b) => { b.gear.items = b.gear.items.filter((_, idx) => idx !== i); return b; });
  const setItemMod = (i: number, mod: number) =>
    patch((b) => { b.gear.items = b.gear.items.map((e, idx) => idx === i ? { ...e, mod } : e); return b; });
  const setItemVariant = (i: number, variant: string) =>
    patch((b) => { b.gear.items = b.gear.items.map((e, idx) => idx === i ? { ...e, variant } : e); return b; });
  const editName = (v: string) => { setName(v); setSaveState("idle"); };

  // Record the choice made at an ASI level into build.epicChoices[level]. An ASI writes ability
  // mods the engine applies to the scores; a feat writes its name/desc (plus structured mods if the
  // feat carries any). One choice per level, so this replaces whatever was there.
  const setLevelChoice = (level: number, choice: EpicChoiceInput | null) =>
    patch((b) => {
      const next = { ...(b.epicChoices || {}) };
      if (choice === null) delete next[level];
      else next[level] = [choice];
      b.epicChoices = next;
      return b;
    });

  useEffect(() => {
    if (!speciesVariant) return;
    if (!variantOpts.some((v) => v.name === speciesVariant)) setSpeciesVariant("");
  }, [variantOpts, speciesVariant]);

  const togglePartner = (p: string) => {
    setEnabledPartners((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
    setSaveState("idle");
  };

  // --- the write. One function for both stores; used by autosave and the explicit buttons. Returns
  // the id it wrote (needed when a NEW build's first save creates the pc_library row). A creating
  // ref guards against a double-insert when autosave and a button race on a brand-new build. ---
  // --- alter ego ----------------------------------------------------------------------------
  //
  // The primary and its alter are two `characters` rows linked by alter_ego_of. The Forge already
  // loads a character by id, so switching between them is a navigation rather than a mode: the
  // sheet, the derivation and the autosave all work unchanged on whichever id is open.
  const [kin, setKin] = useState<{ id: string; name: string; primary: boolean }[]>([]);
  useEffect(() => {
    if (mode !== "character" || !row) { setKin([]); return; }
    let live = true;
    (async () => {
      const rowAny = row as unknown as { id: string; name: string; alter_ego_of?: string | null };
      const primaryId = rowAny.alter_ego_of || rowAny.id;
      const { data } = await supabase
        .from("characters")
        .select("id, name, alter_ego_of")
        .or(`id.eq.${primaryId},alter_ego_of.eq.${primaryId}`);
      if (!live) return;
      const all = ((data as { id: string; name: string; alter_ego_of: string | null }[]) || [])
        .map((c) => ({ id: c.id, name: c.name, primary: !c.alter_ego_of }))
        // Primary first, then alters by name, so the order does not shuffle between loads.
        .sort((a, b) => (a.primary === b.primary ? a.name.localeCompare(b.name) : a.primary ? -1 : 1));
      setKin(all.length > 1 ? all : []);
    })();
    return () => { live = false; };
  }, [mode, row, supabase]);

  // The primary's name is the stem even when adding from an alter's sheet, so the family reads as
  // one character rather than a chain of nicknames.
  const alterName = (family: { name: string; primary: boolean }[], fallback: string) => {
    const stem = family.find((k) => k.primary)?.name || fallback;
    const n = Math.max(0, family.filter((k) => !k.primary).length) + 1;
    return `${stem} (alter ego ${n})`;
  };

  // Matches the database trigger in p31. The button stopping first is a courtesy; the trigger is
  // the actual limit, because an insert that skips this page skips this number too.
  const MAX_ALTERS = 10;

  const [makingAlter, setMakingAlter] = useState(false);

  // Library builds get alter egos too. A build is a TEMPLATE, and for a changeling or a Jekyll the
  // second face is part of what the character is - building both and being able to launch only one
  // would mean rebuilding the alter by hand in every campaign the character is taken to.
  const [libKin, setLibKin] = useState<{ id: string; name: string; primary: boolean }[]>([]);
  useEffect(() => {
    if (mode !== "library" || !libId) { setLibKin([]); return; }
    let live = true;
    (async () => {
      const { data: me } = await supabase
        .from("pc_library").select("id, name, alter_ego_of").eq("id", libId).maybeSingle();
      const meRow = me as { id: string; name: string; alter_ego_of: string | null } | null;
      if (!meRow) return;
      const primaryId = meRow.alter_ego_of || meRow.id;
      const { data } = await supabase
        .from("pc_library").select("id, name, alter_ego_of")
        .or(`id.eq.${primaryId},alter_ego_of.eq.${primaryId}`);
      if (!live) return;
      const all = ((data as { id: string; name: string; alter_ego_of: string | null }[]) || [])
        .map((c) => ({ id: c.id, name: c.name, primary: !c.alter_ego_of }))
        .sort((a, b) => (a.primary === b.primary ? a.name.localeCompare(b.name) : a.primary ? -1 : 1));
      setLibKin(all.length > 1 ? all : []);
    })();
    return () => { live = false; };
  }, [mode, libId, supabase]);

  const addLibraryAlter = useCallback(async () => {
    if (mode !== "library" || !libId || makingAlter) return;
    setMakingAlter(true);
    try {
      const { data: me } = await supabase
        .from("pc_library").select("id, name, alter_ego_of").eq("id", libId).maybeSingle();
      const meRow = me as { id: string; name: string; alter_ego_of: string | null } | null;
      if (!meRow) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("pc_library")
        .insert({
          profile_id: user.id,
          name: alterName(libKin, meRow.name),
          alter_ego_of: meRow.alter_ego_of || meRow.id,
          build: null,
        })
        .select("id")
        .maybeSingle();
      if (error || !data) return;
      window.location.href = `/me/forge?lib=${(data as { id: string }).id}`;
    } finally { setMakingAlter(false); }
  }, [mode, libId, supabase, makingAlter]);

  const addAlterEgo = useCallback(async () => {
    if (mode !== "character" || !row || makingAlter) return;
    setMakingAlter(true);
    try {
      const rowAny = row as unknown as {
        id: string; name: string; campaign_id: string; profile_id: string | null;
        alter_ego_of?: string | null;
      };
      // Always link to the PRIMARY, never to another alter. The database enforces this too, but
      // failing the insert would be a worse way to say it than simply doing the right thing.
      const primaryId = rowAny.alter_ego_of || rowAny.id;
      const { data, error } = await supabase
        .from("characters")
        .insert({
          campaign_id: rowAny.campaign_id,
          profile_id: rowAny.profile_id,
          kind: "pc",
          // Numbered from the existing count so six personas are distinguishable at a glance.
          // The player renames them anyway; what matters is that the switcher never shows six
          // buttons with identical labels.
          name: alterName(kin, rowAny.name),
          alter_ego_of: primaryId,
          active: true,
          // A blank sheet on purpose. An alter ego that started as a copy would be a character the
          // player has to dismantle before they can build it, and the cases this exists for - a
          // beast form, a curse, a second personality - rarely share a class.
          build: null,
        })
        .select("id")
        .maybeSingle();
      if (error || !data) return;
      window.location.href = `/me/forge?c=${(data as { id: string }).id}`;
    } finally {
      setMakingAlter(false);
    }
  }, [mode, row, supabase, makingAlter]);

  const creating = useRef(false);
  const persist = useCallback(async (): Promise<boolean> => {
    setSaveState("saving");
    try {
      if (system === "pf2e") {
        const pdenorm = {
          species: pbuild.ancestryId || null, class: pbuild.classId || null,
          subclass: pbuild.heritageId || null, species_variant: null, level: pbuild.level,
        };
        if (mode === "character") {
          if (!row) return false;
          const { error } = await supabase.from("characters").update({
            build: pbuild as unknown as Record<string, unknown>, system: "pf2e",
            name: name || row.name, species: pbuild.ancestryId || null, class: pbuild.classId || null,
            subclass: pbuild.heritageId || null, level: pbuild.level,
          }).eq("id", row.id);
          if (error) throw error;
          setSaveState("saved"); return true;
        }
        if (mode === "new" && !libId) {
          if (creating.current) return false;
          creating.current = true;
          const newId = await saveToLibrary(supabase, name || "New character", pbuild, pdenorm, "pf2e");
          creating.current = false;
          setLibId(newId); setMode("library"); router.replace(`/me/forge?lib=${newId}`);
          setSaveState("saved"); return true;
        }
        if (libId) {
          await updateLibrary(supabase, libId, name || "New character", pbuild, pdenorm, "pf2e");
          setSaveState("saved"); return true;
        }
        return false;
      }

      if (system === "daggerheart") {
        const ddenorm = {
          species: dbuild.ancestryId || null, class: dbuild.classId || null,
          subclass: dbuild.subclassId || null, species_variant: null, level: dbuild.level,
        };
        if (mode === "character") {
          if (!row) return false;
          const { error } = await supabase.from("characters").update({
            build: dbuild as unknown as Record<string, unknown>, system: "daggerheart",
            name: name || row.name, species: dbuild.ancestryId || null, class: dbuild.classId || null,
            subclass: dbuild.subclassId || null, level: dbuild.level,
          }).eq("id", row.id);
          if (error) throw error;
          setSaveState("saved"); return true;
        }
        if (mode === "new" && !libId) {
          if (creating.current) return false;
          creating.current = true;
          const newId = await saveToLibrary(supabase, name || "New character", dbuild, ddenorm, "daggerheart");
          creating.current = false;
          setLibId(newId); setMode("library"); router.replace(`/me/forge?lib=${newId}`);
          setSaveState("saved"); return true;
        }
        if (libId) {
          await updateLibrary(supabase, libId, name || "New character", dbuild, ddenorm, "daggerheart");
          setSaveState("saved"); return true;
        }
        return false;
      }

      if (system === "drawsteel") {
        const sdenorm = {
          species: steelBuild.ancestryId || null, class: steelBuild.classId || null,
          subclass: steelBuild.kitId || null, species_variant: null, level: steelBuild.level,
        };
        if (mode === "character") {
          if (!row) return false;
          const { error } = await supabase.from("characters").update({
            build: steelBuild as unknown as Record<string, unknown>, system: "drawsteel",
            name: name || row.name, species: steelBuild.ancestryId || null, class: steelBuild.classId || null,
            subclass: steelBuild.kitId || null, level: steelBuild.level,
          }).eq("id", row.id);
          if (error) throw error;
          setSaveState("saved"); return true;
        }
        if (mode === "new" && !libId) {
          if (creating.current) return false;
          creating.current = true;
          const newId = await saveToLibrary(supabase, name || "New character", steelBuild, sdenorm, "drawsteel");
          creating.current = false;
          setLibId(newId); setMode("library"); router.replace(`/me/forge?lib=${newId}`);
          setSaveState("saved"); return true;
        }
        if (libId) {
          await updateLibrary(supabase, libId, name || "New character", steelBuild, sdenorm, "drawsteel");
          setSaveState("saved"); return true;
        }
        return false;
      }

      if (system === "lancer") {
        // Lancer has no species/class/subclass; the frame stands in for "class" in the denorm so the
        // library list shows it, and license level maps to level.
        const ldenorm = {
          species: null, class: lancerBuild.frameId || null,
          subclass: null, species_variant: null, level: lancerBuild.level,
        };
        if (mode === "character") {
          if (!row) return false;
          const { error } = await supabase.from("characters").update({
            build: lancerBuild as unknown as Record<string, unknown>, system: "lancer",
            name: name || row.name, species: null, class: lancerBuild.frameId || null,
            subclass: null, level: lancerBuild.level,
          }).eq("id", row.id);
          if (error) throw error;
          setSaveState("saved"); return true;
        }
        if (mode === "new" && !libId) {
          if (creating.current) return false;
          creating.current = true;
          const newId = await saveToLibrary(supabase, name || "New character", lancerBuild, ldenorm, "lancer");
          creating.current = false;
          setLibId(newId); setMode("library"); router.replace(`/me/forge?lib=${newId}`);
          setSaveState("saved"); return true;
        }
        if (libId) {
          await updateLibrary(supabase, libId, name || "New character", lancerBuild, ldenorm, "lancer");
          setSaveState("saved"); return true;
        }
        return false;
      }

      if (mode === "character") {
        if (!row) return false;
        const { error } = await supabase
          .from("characters")
          .update({
            build: { ...build, sheetSnapshot } as unknown as Record<string, unknown>,
            name: name || row.name,
            species: build.meta.species || null,
            class: build.meta.className || null,
            subclass: build.meta.subclass || null,
            species_variant: speciesVariant || null,
            level: build.level,
          })
          .eq("id", row.id);
        if (error) throw error;
        setSaveState("saved");
        return true;
      }

      // library or new -> pc_library
      const denorm = denormOf(build, speciesVariant);
      if (mode === "new" && !libId) {
        if (creating.current) return false;    // an insert is already in flight
        creating.current = true;
        const newId = await saveToLibrary(supabase, name || "New character", build, denorm, system);
        creating.current = false;
        setLibId(newId);
        setMode("library");
        // Reflect the new id in the URL so a refresh keeps editing the same build, without a reload.
        router.replace(`/me/forge?lib=${newId}`);
        setSaveState("saved");
        return true;
      }
      if (libId) {
        await updateLibrary(supabase, libId, name || "New character", build, denorm, system);
        setSaveState("saved");
        return true;
      }
      return false;
    } catch {
      creating.current = false;
      setSaveState("error");
      return false;
    }
  }, [supabase, router, mode, row, libId, build, name, speciesVariant, system, pbuild, dbuild, steelBuild, lancerBuild, sheetSnapshot]);

  // Autosave: debounce ~1s after the last change. Only runs once loaded and when there are unsaved
  // edits (saveState "idle"). Skips while picking / signed out / errored.
  useEffect(() => {
    if (status !== "ready") return;
    if (saveState !== "idle") return;
    const t = setTimeout(() => { void persist(); }, 1000);
    return () => clearTimeout(t);
  }, [status, saveState, persist]);

  const saveAndContinue = useCallback(async () => { await persist(); }, [persist]);
  const saveAndExit = useCallback(async () => {
    const ok = await persist();
    if (ok) router.push("/me/library");
  }, [persist, router]);

  // Copy a played campaign character up into the library (so it can be re-launched into other
  // campaigns later). Only meaningful in character mode. Persists any pending edits first so the
  // library copy captures the latest, then snapshots the saved characters row.
  const [copied, setCopied] = useState<"idle" | "copying" | "done" | "error">("idle");
  const saveToLibraryFromCharacter = useCallback(async () => {
    if (mode !== "character" || !row) return;
    setCopied("copying");
    try {
      await persist();                                  // flush edits to the characters row first
      await saveCharacterToLibrary(supabase, row.id);   // then snapshot it into pc_library
      setCopied("done");
    } catch {
      setCopied("error");
    }
  }, [supabase, mode, row, persist]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const psheet = useMemo(() => { try { return derivePf2eSheet(pbuild, PF2_RULES); } catch { return null; } }, [pbuild]);
  const dsheet = useMemo(() => { try { return deriveDaggerheartSheet(dbuild, DH_RULES); } catch { return null; } }, [dbuild]);
  const steelSheet = useMemo(() => { try { return deriveDrawSteelSheet(steelBuild, DS_RULES); } catch { return null; } }, [steelBuild]);
  const lanSheet = useMemo(() => { try { return deriveLancerSheet(lancerBuild, LANCER_RULES); } catch { return null; } }, [lancerBuild]);
  // Readiness aliases, one per system branch.
  // D&D KEEPS `&& !!sheet`: its body uses `sheet` INLINE and relies on TypeScript's aliased-condition
  // narrowing to pass it as non-null. Keep it a plain conjunction (no ternary) or that narrowing breaks.
  // The other four systems render a SELF-CONTAINED component whose `sheet` prop is already nullable
  // (<X>Sheet | null) - and their sheet is null until a class is chosen. They must NOT require a
  // non-null sheet, or the column that CONTAINS the class picker never mounts and the Forge shows blank
  // on a fresh build. So they gate on the selected system only and pass the (possibly null) sheet.
  const dndReady = status === "ready" && system !== "pf2e" && system !== "daggerheart" && system !== "drawsteel" && system !== "lancer" && !!sheet;
  const pf2eReady = status === "ready" && system === "pf2e";
  const dhReady = status === "ready" && system === "daggerheart";
  const steelReady = status === "ready" && system === "drawsteel";
  const lanReady = status === "ready" && system === "lancer";

  // ---------------------------------------------------------------------------
  // The character sheet (phase 5d): what /me/sheet shows. Laid out like a D&D Beyond sheet: the
  // abilities, HP, saves and skills down the left, and the tabs a turn uses on the right (actions,
  // spells, inventory, features and traits, background, notes). Nothing from the builder shows.
  // The turn tracker sits behind the Initiative button, in a small window the player can move.
  // ---------------------------------------------------------------------------
  if (view === "play") {
    // Push 22 (audit G5): the at-the-table tracker for the systems outside D&D 5e.
    const playSheet: SystemPlaySheet | null =
      system === "pf2e" && psheet ? { system: "pf2e", sheet: psheet }
      : system === "daggerheart" && dsheet ? { system: "daggerheart", sheet: dsheet }
      : system === "drawsteel" && steelSheet ? { system: "drawsteel", sheet: steelSheet }
      : system === "lancer" && lanSheet ? { system: "lancer", sheet: lanSheet }
      : null;
    type WithPlay = { play?: SystemPlayState };
    const playState: SystemPlayState | undefined =
      system === "pf2e" ? (pbuild as Pf2eBuild & WithPlay).play
      : system === "daggerheart" ? (dbuild as DHBuild & WithPlay).play
      : system === "drawsteel" ? (steelBuild as DSBuild & WithPlay).play
      : system === "lancer" ? (lancerBuild as LancerBuild & WithPlay).play
      : undefined;
    const setPlayState = (st: SystemPlayState) => {
      if (system === "pf2e") setPbuild((b) => ({ ...b, play: st } as Pf2eBuild));
      else if (system === "daggerheart") setDbuild((b) => ({ ...b, play: st } as DHBuild));
      else if (system === "drawsteel") setSteelBuild((b) => ({ ...b, play: st } as DSBuild));
      else if (system === "lancer") setLancerBuild((b) => ({ ...b, play: st } as LancerBuild));
      setSaveState("idle");
    };
    const charIdNow = mode === "character" && row ? row.id : null;
    const campaignNow = mode === "character" && row ? row.campaign_id : null;
    const spentNow = (build as Build & { spent?: Record<string, number> }).spent || {};
    const playNow = (build as Build & { play?: PlayState }).play || {};
    const forgeHref = mode === "character" && row ? `/me/forge?c=${row.id}` : libId ? `/me/forge?lib=${libId}` : "/me/forge";
    const tabs: [SheetTab, string][] = [
      ["actions", "Actions"],
      ...(playSpells.length ? [["spells", "Spells"] as [SheetTab, string]] : []),
      ["inventory", "Inventory"], ["features", "Features and traits"], ["background", "Background"], ["notes", "Notes"], ["extras", "Extras"],
    ];
    const openTab: SheetTab = tabs.some(([k]) => k === sheetTab) ? sheetTab : "actions";
    const multi = build.multiclass || [];
    const classLine = [
      build.meta.species,
      [build.meta.subclass, build.meta.className].filter(Boolean).join(" ") + (multi.length ? ` ${build.level}` : ""),
      ...multi.map((c) => [c.subclass, c.className].filter(Boolean).join(" ") + ` ${c.level}`),
    ].filter(Boolean).join(" · ");
    // features that cost part of a turn but spend no pool (phase 5f); the pool ones are under Limited use
    const poolNames = [...tracks.pools.map((p) => p.label), ...costedList.map((c) => c.name)].map((x) => x.toLowerCase().replace(/s$/, ""));
    const featureActions: FeatureAction[] = [];
    for (const c of [{ className: build.meta.className, level: build.level }, ...multi].filter((x) => x.className)) {
      for (const g of classProgression(classRecWithSub(c.className), c.level)) {
        for (const f of g.features) {
          const cost = featureCost(f.desc);
          if (!cost) continue;
          const base = f.name.replace(/\s*\(.*\)\s*$/, "").trim();
          const low = base.toLowerCase();
          if (poolNames.some((p) => p === low || low.startsWith(p) || p.startsWith(low))) continue;
          const at = featureActions.findIndex((x) => x.name === base);
          const row = { key: `${c.className}-${base}`, name: base, level: g.level, cost, summary: costSentence(f.desc), from: c.className };
          if (at >= 0) featureActions[at] = row; else featureActions.push(row);
        }
      }
    }
    const initLabel = fightView ? `Initiative · round ${fightView.round}${fightMine?.me.is_turn ? ", your turn" : ""}` : "Initiative";
    const saveText = saveState === "saving" ? "Saving…" : saveState === "error" ? "Could not save" : saveState === "idle" ? "Unsaved changes" : "Saved";
    const tabBtn = (on: boolean): React.CSSProperties => ({
      background: on ? "rgba(0,0,0,0.35)" : "transparent", border: "none", borderBottom: `2px solid ${on ? SAX.brass : "transparent"}`,
      color: on ? STONE.ink : STONE.inkFaint, padding: "9px 12px", fontFamily: FORGE_FONTS.mono, fontSize: 11.5, letterSpacing: "0.12em",
      textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap",
    });
    return (
      <PageShell width={1280}>
        <FontsAndCss />
        <style>{SHEET_CSS}</style>

            {status === "loading" && <Muted>Opening the sheet&hellip;</Muted>}
            {status === "signedout" && <Muted>Sign in to open your character sheet.</Muted>}
            {status === "error" && <Muted>{loadWhy ?? "That character could not be loaded. Pick it again from your characters."}</Muted>}
            {status === "picking" && <Picking stable={stable} base="/me/sheet" lead="Choose a character to play." />}
            {status === "ready" && !dndReady && (
              <div style={stonePanel()}>
                <PanelTitle>Character sheet</PanelTitle>
                <Muted>{system !== "dnd5e"
                  ? (playSheet
                    ? "The full sheet, with attacks, spells and inventory, is for D&D 5e for now. Track this character's numbers below, and change the build in the Forge."
                    : "This character's sheet has not derived yet. Finish the build in the Forge first.")
                  : "This character's sheet has not derived yet. Pick a species and a class in the Forge first."}</Muted>
                <a className="forge-btn" href={forgeHref} style={{ ...stoneButton("stone"), display: "inline-block", marginTop: 10, textDecoration: "none" }}>Open in the Forge</a>
              </div>
            )}
            {/* Push 22 (audit G5): hit points and the system's own resources, saved in the build as play. */}
            {status === "ready" && !dndReady && playSheet && (
              <div style={{ marginTop: 14 }}>
                <SystemPlay play={playSheet} state={playState} onChange={setPlayState} />
              </div>
            )}
            {/* Push 20 (audit G10): the party inventory for a character in a system whose sheet has no
                inventory yet. No Give or Take here (no gear to move into); the stack list, found loot and the
                purse work as they do for the GM. */}
            {status === "ready" && !dndReady && system !== "dnd5e" && campaignNow && (
              <div style={{ marginTop: 14 }}>
                <PartyStash campaignId={campaignNow} ruleset={null} />
              </div>
            )}

            {dndReady && (
              <>
                <header style={{ ...stonePanel(), display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "12px 16px", marginBottom: 14 }}>
                  {portraitUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- a stored portrait of any size, shown small
                    <img src={portraitUrl} alt="" width={56} height={56} style={{ borderRadius: 8, objectFit: "cover", border: `1px solid ${STONE.hi}` }} />
                  )}
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <h1 style={{ fontFamily: FORGE_FONTS.display, fontSize: 26, fontWeight: 600, margin: 0, color: STONE.ink, lineHeight: 1.15 }}>{name || "Character"}</h1>
                    <div style={{ fontSize: 13, color: STONE.inkFaint, marginTop: 2 }}>{classLine}{classLine ? " · " : ""}level {sheet.totalLevel || build.level}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button type="button" className="forge-btn" aria-pressed={initOpen} aria-haspopup="dialog"
                      disabled={!campaignNow} title={campaignNow ? "Show or hide the turn order" : "Only a character at a campaign table is in fights"}
                      onClick={() => setInitOpen((o) => !o)}
                      style={{ ...stoneButton(initOpen || fightMine?.me.is_turn ? "primary" : "stone"), fontSize: 12.5, padding: "6px 12px" }}>{initLabel}</button>
                    {campaignNow && charIdNow && <SheetRollLog campaignId={campaignNow} characterId={charIdNow} />}
                    <a className="forge-btn" href={forgeHref} style={{ ...stoneButton("ghost"), fontSize: 12.5, padding: "6px 12px", textDecoration: "none" }}>Edit in the Forge</a>
                    {charIdNow && <a className="forge-btn" href={`/me/import?into=${charIdNow}`} title="Replace this character's build with a D&D Beyond character-sheet PDF, keeping HP, coins, notes and the rest of the sheet's own state"
                      style={{ ...stoneButton("ghost"), fontSize: 12.5, padding: "6px 12px", textDecoration: "none" }}>Update from D&amp;D Beyond</a>}
                    <span role="status" style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: saveState === "error" ? C.warn : STONE.inkFaint }}>{saveText}</span>
                  </div>
                </header>

                <div className="sax-sheet-grid">
                  <div>
                    <PlaySheet name={name || "Character"} sheet={sheet} saveProf={build.saveProf || []} ruleset={ruleset} importAdjust={build.importAdjust}
                      characterId={charIdNow} hitDice={hitDice} play={playNow} onPlay={setPlay}
                      fight={fightMine} onFightChanged={() => { /* the fight card polls */ }}
                      onShortRestResources={() => setSpentMap(afterShortRest([...tracks.pools, ...tracks.slots], spentNow))}
                      onLongRestResources={clearSpent}
                      overrides={{ ability: build.abilityOverride || {}, hpMaxMod: build.hpMaxMod || 0, hpMaxOverride: build.hpMaxOverride ?? null }}
                      onOverrides={setOverrides}
                      customDefenses={build.customDefenses || {}} onCustomDefenses={setCustomDefenses} />
                    <SheetProficiencies
                      coreTraits={((srd.structuredByName[build.meta.className] || {}) as { core_traits?: string }).core_traits || ""}
                      backgroundRec={bgEff}
                      masteries={Object.entries((build as Build & { classChoices?: Record<string, string[]> }).classChoices || {})
                        .filter(([k]) => /Weapon Mastery/i.test(k)).flatMap(([, v]) => v)}
                      ruleset={ruleset}
                      speciesLanguages={(srd.speciesByName[build.meta.species] as { languages?: string } | undefined)?.languages ?? null}
                      species={build.meta.species}
                      backgroundLanguages={(srd.bgByName[build.meta.background] as { languages?: string } | undefined)?.languages ?? null}
                      classFeatureNames={[{ className: build.meta.className, level: build.level }, ...multi]
                        .filter((c) => c.className)
                        .flatMap((c) => classProgression(classRecWithSub(c.className), c.level).flatMap((g) => g.features.map((f) => f.name)))}
                      chosen={(build as Build & { languages?: string[] }).languages || []}
                      onChosen={setLanguages} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div role="tablist" aria-label="Sheet sections" className="sax-sheet-tabs" style={{ display: "flex", gap: 2, overflowX: "auto", borderBottom: `1px solid ${STONE.hi}`, marginBottom: 12 }}>
                      {tabs.map(([k, l]) => (
                        <button key={k} type="button" role="tab" id={`sheet-tab-${k}`} aria-selected={openTab === k} aria-controls="sheet-panel"
                          onClick={() => setSheetTab(k)} style={tabBtn(openTab === k)}>{l}</button>
                      ))}
                    </div>
                    <div role="tabpanel" id="sheet-panel" aria-labelledby={`sheet-tab-${openTab}`}>
                      {(openTab === "actions" || openTab === "spells") && (
                        <PlayActions tab={openTab} sheet={sheet} charLevel={sheet.totalLevel || build.level || 1}
                          characterId={charIdNow} campaignId={campaignNow}
                          fight={fightView && fightMine ? { view: fightView, me: fightMine.me } : null}
                          attacks={playAttacks} spells={playSpells} pools={tracks.pools} slots={tracks.slots} pactLevel={tracks.pactLevel}
                          spent={spentNow} onSpend={setSpent}
                          costed={costedList} onHealSelf={healSelf} onFightChanged={() => { /* the fight card polls */ }}
                          features={featureActions} />
                      )}
                      {(openTab === "inventory" || openTab === "notes") && (
                        <PlayInventory part={openTab === "inventory" ? "items" : "notes"} gear={build.gear} catalog={gearIndex} itemByName={srd.itemByName} ctx={ctx}
                          str={sheet.abilities.str}
                          attuneMax={attunementLimit([{ className: build.meta.className, level: build.level }, ...multi])}
                          coins={(build as Build & { coins?: Coins }).coins || {}}
                          notes={(build as Build & { notes?: CharNotes }).notes || {}}
                          onGear={setGear} onCoins={setCoins} onNotes={setNotes} />
                      )}
                      {openTab === "inventory" && campaignNow && (
                        <PlayParty campaignId={campaignNow} gear={build.gear} onGear={setGear}
                          coins={(build as Build & { coins?: Coins }).coins || {}} onCoins={setCoins}
                          itemByName={srd.itemByName} ctx={ctx} catalogNames={gearIndex.map((g) => g.name)} />
                      )}
                      {openTab === "features" && (
                        <SheetFeatures
                          classes={[{ className: build.meta.className, level: build.level }, ...multi.map((c) => ({ className: c.className, level: c.level }))]
                            .filter((c) => c.className)
                            .map((c) => ({ ...c, groups: classProgression(classRecWithSub(c.className), c.level) }))}
                          species={build.meta.species} speciesRec={srd.speciesByName[build.meta.species]} shownTraits={speciesTraitsShown}
                          variantName={speciesVariant} variantRec={srd.variantByName[speciesVariant]}
                          feats={[...chosenFeats, ...importedFeats]} itemNotes={sheet.itemNotes || []}
                          importAdjust={importedSheet ? build.importAdjust : undefined}
                          onClearAdjust={() => patch((b) => ({ ...b, importAdjust: { at: new Date().toISOString() } }))}
                          onRematch={() => { reconciledFor.current = null; patch((b) => { const n = { ...b }; delete n.importAdjust; return n; }); }} />
                      )}
                      {openTab === "extras" && (
                        <PlayCompanions companions={(build as Build & { companions?: Companion[] }).companions || []} onChange={setCompanions}
                          monsters={monsterList} characterId={charIdNow} ruleset={ruleset} />
                      )}
                      {openTab === "background" && (
                        <>
                          <SheetBackground background={build.meta.background} desc={backgroundDesc} alignment={row?.alignment ?? null} />
                          <PlayInventory part="traits" gear={build.gear} catalog={gearIndex} itemByName={srd.itemByName} ctx={ctx}
                            str={sheet.abilities.str} attuneMax={3}
                            coins={(build as Build & { coins?: Coins }).coins || {}}
                            notes={(build as Build & { notes?: CharNotes }).notes || {}}
                            onGear={setGear} onCoins={setCoins} onNotes={setNotes} />
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* The turn tracker: always mounted (so targets, HP and conditions keep flowing into
                    the sheet), shown only when the player opens it. */}
                {campaignNow && charIdNow && (
                  <FloatingPanel open={initOpen} onClose={() => setInitOpen(false)} title="Initiative" storageKey="sax-sheet-initiative" width={300}>
                    <FightCard compact campaignId={campaignNow} characterId={charIdNow} onSeen={onFightSeen}
                      sheet={{ ac: sheet.ac, hpMax: sheet.hpMax, saves: sheet.saves as Record<string, number>, saveProfs: build.saveProf || [], spellDc: sheet.isCaster ? sheet.spellDC ?? null : null,
                        speed: sheet.speed, attacksPerAction: attacksPerAction([{ className: build.meta.className, subclass: build.meta.subclass, level: build.level }, ...multi]),
                        hpNow: playNow.hp ?? null, tempNow: playNow.temp ?? 0 }} />
                  </FloatingPanel>
                )}
              </>
            )}
      </PageShell>
    );
  }

  return (
    <PageShell width={920}>
      <FontsAndCss />

          <Header />

          {/* SYSTEM PICKER. A new build can be any system (free workshop); it saves with the build.
              An existing character's system is fixed, so the picker is shown but locked. */}
          {status === "ready" && (
            <div style={{ ...stonePanel(), marginBottom: 20 }}>
              <label style={forgeLabel}>System</label>
              <select aria-label="Game system"
                value={system}
                disabled={mode !== "new"}
                onChange={(e) => { setSystem(e.target.value); setSaveState("idle"); }}
                style={{ ...stoneField(), maxWidth: 320, cursor: mode === "new" ? "pointer" : "default",
                  opacity: mode === "new" ? 1 : 0.7 }}
              >
                {FORGE_SYSTEMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <p style={{ color: STONE.inkFaint, fontSize: 13, marginTop: 8 }}>
                {mode === "new"
                  ? "Build a character in any system. Your choice is saved with the build."
                  : "This character's system is fixed. Start a new build to use another system."}
              </p>
            </div>
          )}

          {/* License attribution for the active system (mechanics ship under the publisher's license).
              Renders nothing for systems with no licensed content. Full notices live at /licenses. */}
          {status === "ready" && <SystemAttribution system={system} />}

          {status === "loading" && <Muted>Stoking the forge&hellip;</Muted>}
          {status === "signedout" && <Muted>Sign in to open the Forge.</Muted>}
          {status === "error" && <Muted>{loadWhy ?? "That character could not be loaded. Head back to your stable and try again."}</Muted>}

          {status === "picking" && <Picking stable={stable} base="/me/forge" lead="Choose a character to bring to the Forge." />}

          {status === "ready" && mode === "new" && system === "dnd5e" && (
            <p style={{ color: STONE.inkFaint, fontSize: 13.5, margin: "0 0 14px" }}>
              New to D&amp;D, or in a hurry? The <a href="/me/quick-build" style={{ color: C.sun }}>quick build</a> makes a level 1 character in three steps, then brings it here.
            </p>
          )}
          {dndReady && quickNote && (
            <div role="status" style={{ ...stonePanel(), marginBottom: 14, borderColor: C.sun }}>
              <PanelTitle hint="Everything here can still be changed.">Quick build done</PanelTitle>
              <p style={{ fontSize: 13.5, color: STONE.ink, margin: "0 0 6px", lineHeight: 1.55 }}>
                Your class, species, background, ability scores and starting gear are in. Still yours to choose: your skills on the Class tab,
                your species&apos; options on the Species tab, your background feat&apos;s options if it has any, and spells on the Spells tab if your class casts them.
                {((build as Build & { quick?: { choose?: string[] } }).quick?.choose ?? []).length > 0 && (
                  <> Your starting gear also lets you pick: {((build as Build & { quick?: { choose?: string[] } }).quick?.choose ?? []).join(", ")}; add those on the Equipment tab.</>
                )}
                {(build as Build & { quick?: { aim?: string } }).quick?.aim && (
                  <> The class quiz pointed you at {(build as Build & { quick?: { aim?: string } }).quick?.aim}, a subclass you pick at level 3.</>
                )}
              </p>
              <button type="button" className="forge-btn" style={{ ...stoneButton("stone"), fontSize: 12.5 }}
                onClick={() => {
                  setQuickNote(false);
                  const u = new URL(window.location.href); u.searchParams.delete("quick"); window.history.replaceState(null, "", u.toString());
                }}>Got it</button>
            </div>
          )}

          {pf2eReady && (
            <Pf2eForge pbuild={pbuild} onChange={(b) => { setPbuild(b); setSaveState("idle"); }}
              sheet={psheet} name={name} onName={editName} />
          )}
          {dhReady && (
            <DaggerheartForge dbuild={dbuild} onChange={(b) => { setDbuild(b); setSaveState("idle"); }}
              sheet={dsheet} name={name} onName={editName} />
          )}
          {steelReady && (
            <DrawSteelForge dsBuild={steelBuild} onChange={(b) => { setSteelBuild(b); setSaveState("idle"); }}
              sheet={steelSheet} name={name} onName={editName} />
          )}
          {lanReady && (
            <LancerForge build={lancerBuild} onChange={(b) => { setLancerBuild(b); setSaveState("idle"); }}
              sheet={lanSheet} name={name} onName={editName} />
          )}
          {dndReady && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
              {/* Name (editable for every mode; it's the character's name). */}
              <div style={stonePanel()}>
                <label style={forgeLabel}>Character name</label>
                <input aria-label="Name your character" value={name} onChange={(e) => editName(e.target.value)} placeholder="Name your character"
                  style={{ ...stoneField(), cursor: "text", fontFamily: FORGE_FONTS.display, fontSize: 20 }} />
                {mode !== "character" && (
                  <p style={{ color: STONE.inkFaint, fontSize: 13, marginTop: 8 }}>
                    This is a saved build in your library. Changes autosave; use “Play in campaign” from your library to bring it to a table.
                  </p>
                )}
                {/* ALTER EGO SWITCH. Sits with the name because that is what changes: the sheet
                    below is a different character, not a different view of this one. Only shown
                    when there is something to switch to - a solo character should not carry the
                    vocabulary of a feature they are not using. */}
                {((mode === "character" && row && kin.length > 1)
                  || (mode === "library" && libId && libKin.length > 1)) && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
                    marginTop: 12 }}>
                    {(mode === "library" ? libKin : kin).map((k) => {
                      const here = k.id === (mode === "library" ? libId : row?.id);
                      return (
                        <button title={here ? "Already here" : undefined} key={k.id} className="forge-btn" disabled={here}
                          onClick={() => {
                            window.location.href = mode === "library"
                              ? `/me/forge?lib=${k.id}` : `/me/forge?c=${k.id}`;
                          }}
                          style={{ ...stoneButton(here ? "primary" : "stone"), fontSize: 12.5,
                            padding: "7px 13px", cursor: here ? "default" : "pointer" }}>
                          {k.name}
                          {k.primary && (
                            <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10,
                              color: here ? STONE.shadow : STONE.inkFaint, marginLeft: 7 }}>
                              primary
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <span style={{ fontSize: 11.5, color: STONE.inkFaint, marginLeft: 4 }}>
                      one player, two sheets
                    </span>
                  </div>
                )}

                {mode === "character" && row && (
                  <div style={{ marginTop: 14 }}>
                    <PortraitUploader
                      label="Character portrait"
                      basePath={`${row.campaign_id}/portraits/${row.id}`}
                      currentUrl={portraitUrl}
                      onUploaded={(url, path) => {
                        setPortraitUrl(url);
                        void supabase.from("characters").update({ portrait_url: path }).eq("id", row.id);
                      }}
                      textColor={STONE.ink} mutedColor={STONE.inkDim}
                      maker name={name || row.name}
                    />
                  </div>
                )}
                {mode !== "character" && (
                  <p style={{ color: STONE.inkFaint, fontSize: 12, marginTop: 6, fontStyle: "italic" }}>
                    Add a portrait once this build is playing in a campaign.
                  </p>
                )}
              </div>

              <TabBar tab={tab} onTab={setTab} build={build} />

              {tab === "identity" && (
              <IdentityPanel
                backgroundRows={srd.backgrounds}
                heldClasses={((build as Build & { multiclass?: { className: string }[] }).multiclass || [])
                  .map((c) => c.className)}
                onAddClass={addClass}
                // No limit on how many. A character in an actual-play with six personas is a real
                // case, the link is one-to-many, and launchWithAlters already loops. The earlier
                // "one alter" cap was my assumption rather than anything the data required.
                onAddAlter={
                  mode === "character" && row && kin.filter((k) => !k.primary).length < MAX_ALTERS
                    ? addAlterEgo
                  : mode === "library" && libId && libKin.filter((k) => !k.primary).length < MAX_ALTERS
                    ? addLibraryAlter
                  : undefined}
                showAlterEgo={(mode === "character" && Boolean(row)) || (mode === "library" && Boolean(libId))}
                alterEgoReason={
                  kin.filter((k) => !k.primary).length >= MAX_ALTERS
                  || libKin.filter((k) => !k.primary).length >= MAX_ALTERS
                    ? `That is ${MAX_ALTERS} alter egos, which is the limit. Rename or remove one to add another.`
                    : "Save this build first, then alter egos can be added to it."}
                build={build} speciesVariant={speciesVariant}
                edition={edition} onEdition={setEdition}
                partners={partners} enabledPartners={enabledPartners} onTogglePartner={togglePartner}
                speciesOpts={speciesOpts} classOpts={classOpts} variantOpts={variantOpts}
                subclassOpts={subclassOpts}
                speciesDesc={speciesDesc} backgroundDesc={backgroundDesc} subclassRoleTags={subclassRoleTags}
                catalogReady={!!catalog} epic={epic}
                onSpecies={setSpecies} onVariant={setVariant} onBackground={setBackground}
                onClassName={setClassName} onSubclass={setSubclass}
              />
              )}

              {tab === "species" && (
                <SpeciesPanel
                  build={build} speciesVariant={speciesVariant}
                  speciesOpts={speciesOpts} variantOpts={variantOpts}
                  speciesRec={srd.speciesByName[build.meta.species]}
                  variantRec={srd.variantByName[speciesVariant]}
                  desc={speciesDesc}
                  mech={speciesMechanics(build.meta.species, ruleset)}
                  resolved={resolvedSpecies}
                  toolNames={srd.equipment.filter((e) => (e as { category?: string }).category === "Tools")
                    .map((e) => e.name).concat(["Gaming Set", "Musical Instrument"]).sort()}
                  choices={(build as Build & { speciesChoices?: Record<string, string> }).speciesChoices || {}}
                  onSpecies={setSpecies} onVariant={setVariant} onChoice={setSpeciesChoice}
                  ownTraits={build.speciesTraits || []} onOwnTraits={setOwnTraits}
                  ownMech={build.speciesMech} onOwnMech={setOwnMech}
                  knownSpecies={!!ctx.species?.[build.meta.species]}
                />
              )}

              {tab === "background" && (
                <BackgroundPanel
                  build={build} backgroundRows={srd.backgrounds}
                  bgRec={srd.bgByName[build.meta.background]} desc={backgroundDesc}
                  onBackground={setBackground} onAsi={setBgAsi}
                  edition={edition}
                  originFeats={srd.featList.filter((f) => (f as { category?: string }).category === "Origin")}
                  originFeat={bgOriginFeat} onOriginFeat={setBgOriginFeat}
                  featRec={srd.featByName[bgEff?.feat || ""]}
                  featAbility={(build as Build & { bgFeatAbility?: string }).bgFeatAbility || ""}
                  onFeatAbility={setBgFeatAbility}
                />
              )}

              {tab === "spells" && (
                <SpellsPanel
                  build={build} spells={srd.spells} sheet={sheet} edition={edition}
                  structuredRec={srd.structuredByName[build.meta.className]}
                  granted={grantedSpells}
                  onToggle={toggleSpell}
                  loadouts={(build as Build & { loadouts?: SpellLoadout[] }).loadouts || []}
                  onSaveLoadout={saveLoadout} onApplyLoadout={applyLoadout} onDeleteLoadout={deleteLoadout}
                />
              )}

              {tab === "abilities" && (
                <AbilitiesPanel build={build} cap={epic.abilityCap} sheet={sheet}
                  onAbility={setAbility} onMany={setAbilities} />
              )}

              {tab === "class" && (
                <ClassTab
                  build={build} sheet={sheet} edition={edition}
                  activeClass={classTab} onClassTab={setClassTab}
                  epicRows={epicRows}
                  classRecFor={classRecWithSub}
                  structuredFor={(cn) => srd.structuredByName[cn]}
                  subclassFor={(cn) => (catalog ? subclassOptions(catalog, cn, enabledPartners) : [])}
                  weapons={srd.equipment} spells={srd.spells} feats={srd.featList}
                  picks={(build as Build & { classChoices?: Record<string, string[]> }).classChoices || {}}
                  onPick={setClassChoice}
                  onLevel={setAnyClassLevel} onSubclass={setAnyClassSubclass} onRemove={removeClass}
                  onChoose={setLevelChoice}
                />
              )}

              {tab === "equipment" && (
                <GrantedEquipmentPanel
                  bgRec={bgEff}
                  coreTraits={((srd.structuredByName[build.meta.className] || {}) as { core_traits?: string }).core_traits || ""}
                  catalog={srd.equipment.map((i) => i.name)}
                  owned={(build.gear?.items || []).map((i) => i.n)}
                  onAdd={addItems}
                />
              )}

              {tab === "equipment" && (
              <GearPanel
                build={build} gearIndex={gearIndex} gearTypes={gearTypes} ctx={ctx}
                itemByName={srd.itemByName}
                onAdd={addItem} onRemove={removeItem} onMod={setItemMod} onVariant={setItemVariant}
              />
              )}

              {/* The sheet is the one panel shown on EVERY tab. It is the thing being edited, and
                  hiding it behind a tab would make each change unverifiable at the moment it is
                  made - which is the whole reason the Forge derives live. */}
              {/* The running fight's card moved to the character sheet (phase 5d), behind its Initiative
                  button: the Forge is for building. */}
              <SheetPanel sheet={sheet} name={name || "Character"} />

              {tab === "finish" && (
                <FinishPanel build={build} name={name} sheet={sheet} onTab={setTab}
                  effects={{
                    ...effects,
                    // Lineage spells are an applied effect like any other, and Finish is where a
                    // player checks what their choices actually did.
                    applied: [
                      ...effects.applied,
                      ...grantedSpells.map((g) => `${g.spell} always prepared, from ${g.from}`),
                    ],
                  }} />
              )}

              {/* Playing happens on the character sheet (phase 5d), its own page. */}
              {tab === "roll" && (
                <div style={stonePanel()}>
                  <PanelTitle hint="Rolls, HP, actions, spells and inventory live on the character sheet, apart from the Forge.">Play this character</PanelTitle>
                  {mode === "new"
                    ? <Muted>Save this build first (it saves itself after your first change), then open its sheet.</Muted>
                    : <a className="forge-btn" href={mode === "character" && row ? `/me/sheet?c=${row.id}` : `/me/sheet?lib=${libId ?? ""}`}
                        style={{ ...stoneButton("primary"), display: "inline-block", textDecoration: "none" }}>Open the character sheet</a>}
                </div>
              )}

              {tab === "roll" && (
                <ResourcePanel {...resInputs} costed={costedList}
                  spent={(build as Build & { spent?: Record<string, number> }).spent || {}}
                  onSpend={setSpent} onRest={clearSpent} onSpentMap={setSpentMap}
                />
              )}

              {tab === "roll" && (
                <MenuPanel menus={[
                  { cn: build.meta.className || "", sc: build.meta.subclass || "", lv: build.level || 1 },
                  ...((build as Build & { multiclass?: { className: string; subclass?: string; level: number }[] })
                    .multiclass || []).map((c) => ({ cn: c.className, sc: c.subclass || "", lv: c.level || 1 })),
                ].flatMap(({ cn, sc, lv }) => menusFor(cn, sc, lv))} />
              )}


              {tab === "features" && build.meta.species && (
                <FeaturesPanel
                  coreTraits={((srd.structuredByName[build.meta.className] || {}) as { core_traits?: string }).core_traits || ""}
                  masteries={Object.entries((build as Build & { classChoices?: Record<string, string[]> }).classChoices || {})
                    .filter(([k]) => /Weapon Mastery/i.test(k))
                    .flatMap(([, v]) => v)}
                  species={build.meta.species} speciesRec={srd.speciesByName[build.meta.species]} shownTraits={speciesTraitsShown}
                  variantName={speciesVariant} variantRec={srd.variantByName[speciesVariant]}
                  background={build.meta.background} backgroundRec={bgEff}
                  className={build.meta.className} classRec={classRecWithSub(build.meta.className)}
                  level={build.level} chosenFeats={chosenFeats}
                />
              )}

              {tab === "features" && !build.meta.species && (
                <div style={stonePanel()}>
                  <PanelTitle>Features and traits</PanelTitle>
                  <Muted>Pick a species on the Identity tab and its traits appear here.</Muted>
                </div>
              )}

              <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color:
                  saveState === "saved" ? C.good : saveState === "error" ? C.warn : STONE.inkFaint }}>
                  {saveState === "saving" ? "Saving to the anvil…"
                    : saveState === "saved" ? "Saved"
                    : saveState === "error" ? "Save failed. Retrying on next change."
                    : "Unsaved changes"}
                </span>
                {mode === "character" && (
                  <Button variant="ghost"
                    disabled={copied === "copying"} onClick={saveToLibraryFromCharacter}>
                    {copied === "copying" ? "Saving to library…"
                      : copied === "done" ? "Saved to library ✓"
                      : copied === "error" ? "Copy failed, retry"
                      : "Save to library"}
                  </Button>
                )}
                {sheet && (
                  <Button variant="ghost" onClick={downloadPdf}>
                    Download PDF
                  </Button>
                )}
                <Button variant="ghost" onClick={saveAndExit}>
                  Save &amp; exit
                </Button>
                <Button variant="primary" onClick={saveAndContinue}>
                  Save &amp; continue
                </Button>
              </div>

              {sheet && (
                <CharacterSheetPrint
                  name={name || "Character"}
                  species={build.meta.species} variantName={speciesVariant}
                  className={build.meta.className} subclass={build.meta.subclass}
                  background={build.meta.background} level={build.level}
                  sheet={sheet}
                  speciesTraits={speciesTraitsShown as PrintTrait[]}
                  variantTraits={traitList(srd.variantByName[speciesVariant]?.traits) as PrintTrait[]}
                  classFeatures={classFeatureGroups}
                  feats={chosenFeats as PrintFeature[]}
                  gear={(build.gear?.items || []).map((e) => ({
                    name: e.n + (e.mod ? ` +${e.mod}` : "") + (e.variant ? ` (${e.variant})` : ""),
                  }))}
                />
              )}
            </div>
          )}
    </PageShell>
  );
}


function TabBar({ tab, onTab, build }: { tab: TabKey; onTab: (t: TabKey) => void; build: Build }) {
  return (
    // A GRID, not a wrapping flex row. With ten tabs, flex-wrap packs as many as fit and leaves a
    // ragged tail - seven then three - which reads as an accident. Five and five is deliberate, and
    // it collapses to two columns on a narrow screen rather than to one long ladder.
    <div style={{
      display: "grid", gap: 4, marginBottom: 4,
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 148px), 1fr))",
      maxWidth: 5 * 168,
    }} role="tablist">
      {TABS.map((t) => {
        const on = tab === t.key;
        const done = t.key !== "finish" && t.ready(build);
        return (
          <button key={t.key} role="tab" aria-selected={on} onClick={() => onTab(t.key)}
            className="forge-btn" style={{
              ...stoneButton(on ? "primary" : "stone"),
              padding: "9px 12px", fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
            {t.label}
            {/* A quiet mark, not a tick and a cross. Half-finished is the normal state of a
                character sheet and it should not read as an error. */}
            {done && (
              <span aria-hidden style={{
                width: 6, height: 6, borderRadius: 3,
                background: on ? STONE.shadow : C.good, opacity: 0.9,
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function FinishPanel({ build, name, sheet, onTab, effects }: {
  build: Build; name: string; sheet: NonNullable<ReturnType<typeof deriveSheet>>;
  onTab: (t: TabKey) => void; effects: ChoiceEffects;
}) {
  // What is not done yet, said plainly, each one a way back to the tab that fixes it. The point is
  // that "am I finished" should be answerable without reading the whole sheet.
  const gaps: { label: string; tab: TabKey }[] = [];
  if (!name.trim()) gaps.push({ label: "The character has no name", tab: "identity" });
  if (!build.meta.species) gaps.push({ label: "No species chosen", tab: "identity" });
  if (!build.meta.className) gaps.push({ label: "No class chosen", tab: "identity" });
  if (build.meta.className && !build.meta.subclass && build.level >= 3) {
    gaps.push({ label: "No subclass, and this character is level 3 or higher", tab: "identity" });
  }
  if (!build.meta.background) gaps.push({ label: "No background chosen", tab: "identity" });
  if (!Object.values(build.abilities || {}).some((v) => Number(v) > 0)) {
    gaps.push({ label: "Ability scores are all zero", tab: "abilities" });
  }
  if (!(build.gear?.items || []).length) gaps.push({ label: "No equipment", tab: "equipment" });

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Everything autosaves as you go; this is a check, not a commit.">
        Finish
      </PanelTitle>

      {gaps.length === 0 ? (
        <p style={{ color: C.good, fontSize: 14, margin: "6px 0 0" }}>
          Nothing left unset. {name.trim() || "This character"} is ready for a table.
        </p>
      ) : (
        <>
          <p style={{ color: STONE.inkDim, fontSize: 13.5, margin: "6px 0 12px", lineHeight: 1.6 }}>
            {gaps.length} thing{gaps.length === 1 ? "" : "s"} still unset. None of it stops you
            playing, and a half-filled character is a perfectly normal thing to bring to a session.
          </p>
          <div style={{ display: "grid", gap: 6 }}>
            {gaps.map((g) => (
              <Button key={g.label} onClick={() => onTab(g.tab)}
                style={{ textAlign: "left", display: "flex",
                  justifyContent: "space-between", gap: 12, fontSize: 13.5 }}>
                <span style={{ color: STONE.ink }}>{g.label}</span>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint }}>
                  {TABS.find((t) => t.key === g.tab)?.label} &rarr;
                </span>
              </Button>
            ))}
          </div>
        </>
      )}

      {(effects.applied.length > 0 || effects.unapplied.length > 0) && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${STONE.hi}` }}>
          <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, letterSpacing: "0.14em",
            textTransform: "uppercase", color: STONE.inkFaint, marginBottom: 8 }}>What your choices did</div>
          {effects.applied.map((a) => (
            <div key={a} style={{ fontSize: 13, color: C.good, lineHeight: 1.7 }}>&#10003; {a}</div>
          ))}
          {effects.unapplied.length > 0 && (
            <>
              <div style={{ fontSize: 13, color: STONE.inkDim, marginTop: 8, lineHeight: 1.6 }}>
                Recorded, but the app cannot work out what they change yet, so they are not in your
                numbers:
              </div>
              {effects.unapplied.map((u) => (
                <div key={u} style={{ fontSize: 13, color: STONE.inkFaint, lineHeight: 1.7 }}>&middot; {u}</div>
              ))}
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${STONE.hi}` }}>
        <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, letterSpacing: "0.14em",
          textTransform: "uppercase", color: STONE.inkFaint, marginBottom: 8 }}>At a glance</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13.5, color: STONE.ink }}>
          <span>AC {sheet.ac}</span>
          <span>HP {sheet.hpMax}</span>
          <span>Level {build.level}</span>
          {build.meta.className && <span>{build.meta.className}{build.meta.subclass ? ` (${build.meta.subclass})` : ""}</span>}
          {build.meta.species && <span>{build.meta.species}</span>}
        </div>
      </div>
    </div>
  );
}


/**
 * The 2024 background ability-score assignment, which had no UI at all until now.
 *
 * THE RULE
 *   A 2024 background names three abilities and you either put +2 into one and +1 into another, or
 *   +1 into all three. The data has carried those three abilities since backgrounds-2024.json was
 *   parsed; nothing was ever applying them.
 *
 * WHY TWO BUTTONS RATHER THAN SIX SPINNERS
 *   There are exactly two legal shapes. Offering free numeric entry would mean validating a rule the
 *   player cannot see, and rejecting their input afterwards. Picking the shape first and then only
 *   asking which ability gets the +2 makes an illegal assignment unreachable rather than caught.
 */
function BackgroundPanel({ build, backgroundRows, bgRec, desc, onBackground, onAsi,
  featRec, featAbility, onFeatAbility, edition, originFeats, originFeat, onOriginFeat }: {
  build: Build;
  edition: Edition;
  originFeats: FeatOption[];
  originFeat: string;
  onOriginFeat: (f: string) => void;
  backgroundRows: BackgroundRecord[];
  bgRec: { ability_scores?: string; feat?: string; skill_proficiencies?: string;
           tool_proficiency?: string; equipment?: string } | undefined;
  desc: Described | null;
  onBackground: (v: string) => void;
  onAsi: (mods: Record<string, number>) => void;
  featRec: FeatOption | undefined;
  featAbility: string;
  onFeatAbility: (a: string) => void;
}) {
  const abilities = useMemo(() => {
    const raw = bgRec?.ability_scores || "";
    return raw.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
      .map((n) => ABBR_TO_KEY[n.slice(0, 3).toLowerCase()] || (n.slice(0, 3).toLowerCase() as Ability))
      .filter((k, i, arr) => k && arr.indexOf(k) === i);
  }, [bgRec]);

  // Push 11 (audit G9): a background from an older book lists no ability scores and no feat. Under the
  // 2024 rules that character still gets the background's increase (any three abilities: +2 and +1, or
  // +1 to three) and an Origin feat, so both are asked here instead of the 2014 note.
  const freeChoice = !!build.meta.background && abilities.length === 0 && edition !== "2014";
  const needsOriginFeat = !!build.meta.background && !bgRec?.feat && edition !== "2014";

  const current = build.bgAsi || {};
  const total = Object.values(current).reduce((a, v) => a + Number(v || 0), 0);
  // One click steps an ability 0 -> +1 -> +2 -> 0, refusing any step that would leave an illegal shape
  // (more than 3 points, two +2s, or a +2 beside two +1s).
  const [freeMsg, setFreeMsg] = useState<string | null>(null);
  const stepFree = (a: Ability) => {
    const now = Number(current[a] || 0);
    const next = now === 0 ? 1 : now === 1 ? 2 : 0;
    const trial: Record<string, number> = { ...current, [a]: next };
    if (!next) delete trial[a];
    const vals = Object.values(trial).map(Number);
    const sum = vals.reduce((x, v) => x + v, 0);
    const legal = sum <= 3 && vals.filter((v) => v === 2).length <= 1 && !(vals.includes(2) && vals.length > 2);
    if (!legal) {
      // stepping to +2 is the usual cause; try skipping straight back to 0 instead
      if (next === 2) { const t = { ...current }; delete t[a]; setFreeMsg(null); onAsi(t); return; }
      setFreeMsg("That would be more than the background gives: +2 and +1, or +1 to three abilities.");
      return;
    }
    setFreeMsg(null);
    onAsi(trial);
  };
  const spread = total === 3 && Object.values(current).every((v) => Number(v) === 1);
  const focused = total === 3 && Object.values(current).some((v) => Number(v) === 2);

  const setSpread = () => onAsi(Object.fromEntries(abilities.map((a) => [a, 1])));
  const setFocus = (two: Ability) => {
    const rest = abilities.filter((a) => a !== two);
    onAsi({ [two]: 2, ...(rest[0] ? { [rest[0]]: 1 } : {}) });
  };

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Where this character came from, and what it gave them.">Background</PanelTitle>

      <PickerField label="Background" value={build.meta.background} onChange={onBackground}
        placeholder={`Search ${backgroundRows.length} backgrounds`}
        rows={backgroundRows.map((b) => ({
          name: b.name,
          // The two things a player is choosing BETWEEN, on the row itself, so the filters are a
          // way to narrow rather than the only way to see what a background offers.
          hint: [b.feat, b.ability_scores].filter(Boolean).join(" \u00b7 "),
          feat: b.feat, abilities: backgroundAbilities(b.ability_scores),
        }))}
        filters={[
          {
            label: "Origin feat",
            values: Array.from(new Set(backgroundRows.map((b) => b.feat).filter(Boolean) as string[])).sort(),
            test: (r, v) => r.feat === v,
          },
          {
            label: "Ability",
            values: [...ABILITY_NAMES],
            test: (r, v) => (r.abilities as string[] | undefined)?.includes(v) ?? false,
          },
        ]} />

      {desc && <DescBlock desc={desc} />}

      {!build.meta.background && (
        <Muted>Pick a background and its ability scores, feat and equipment appear here.</Muted>
      )}

      {build.meta.background && abilities.length === 0 && edition === "2014" && (
        <Muted>
          This background does not list ability scores. That is normal for a 2014 background, where
          the bonuses came from your species instead.
        </Muted>
      )}

      {freeChoice && (
        <div style={{ marginTop: 16 }}>
          <label style={forgeLabel}>Ability scores</label>
          <p style={{ color: STONE.inkDim, fontSize: 13, margin: "0 0 10px", lineHeight: 1.6 }}>
            This background comes from an older book and lists no ability scores. Under the 2024 rules you
            choose them: <strong>+2 to one ability and +1 to another</strong>, or{" "}
            <strong>+1 to three</strong>. Tap an ability to step it through +1, +2 and back to nothing.
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ABILITIES.map((a) => {
              const v = Number(current[a] || 0);
              return (
                <button key={a} className="forge-btn" onClick={() => stepFree(a)}
                  aria-label={`${a.toUpperCase()}: ${v ? `plus ${v}` : "no increase"}`}
                  style={{ ...stoneButton(v ? "primary" : "stone"), fontSize: 13, minWidth: 64 }}>
                  {a.toUpperCase()}{v ? ` +${v}` : ""}
                </button>
              );
            })}
          </div>
          {freeMsg && <p role="alert" style={{ color: C.warn, fontSize: 12.5, margin: "8px 0 0" }}>{freeMsg}</p>}
          <p style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color: total === 3 ? C.good : STONE.inkFaint,
            marginTop: 12, marginBottom: 0 }}>
            {total === 0 ? "nothing assigned yet"
              : total === 3 ? `applied: ${ABILITIES.filter((a) => current[a]).map((a) => `${a.toUpperCase()} +${current[a]}`).join(", ")}`
              : `${total} of 3 points assigned`}
          </p>
        </div>
      )}

      {needsOriginFeat && (
        <div style={{ marginTop: 16 }}>
          <label style={forgeLabel} htmlFor="bg-origin-feat">Origin feat</label>
          <p style={{ color: STONE.inkDim, fontSize: 13, margin: "0 0 8px", lineHeight: 1.6 }}>
            This background names no feat. Under the 2024 rules every background grants an Origin feat, so
            pick one.
          </p>
          <select id="bg-origin-feat" value={originFeat} onChange={(e) => onOriginFeat(e.target.value)}
            style={{ ...stoneField(), width: "100%", maxWidth: 360, fontSize: 16 }}>
            <option value="">Choose an Origin feat</option>
            {originFeats.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        </div>
      )}

      {abilities.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={forgeLabel}>Ability scores</label>
          <p style={{ color: STONE.inkDim, fontSize: 13, margin: "0 0 10px", lineHeight: 1.6 }}>
            {bgRec?.ability_scores}: put <strong>+2 into one and +1 into another</strong>, or{" "}
            <strong>+1 into all three</strong>.
          </p>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <button className="forge-btn" onClick={setSpread}
              style={{ ...stoneButton(spread ? "primary" : "stone"), fontSize: 13 }}>
              +1 to all three
            </button>
            {abilities.map((a) => (
              <button key={a} className="forge-btn" onClick={() => setFocus(a)}
                style={{ ...stoneButton(focused && Number(current[a]) === 2 ? "primary" : "stone"), fontSize: 13 }}>
                +2 {a.toUpperCase()}
              </button>
            ))}
          </div>

          {focused && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: STONE.inkDim }}>and +1 to</span>
              {abilities.filter((a) => Number(current[a]) !== 2).map((a) => (
                <button key={a} className="forge-btn"
                  onClick={() => {
                    const two = abilities.find((x) => Number(current[x]) === 2);
                    onAsi(two ? { [two]: 2, [a]: 1 } : { [a]: 1 });
                  }}
                  style={{ ...stoneButton(Number(current[a]) === 1 ? "primary" : "stone"), fontSize: 13 }}>
                  {a.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <p style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color: total === 3 ? C.good : STONE.inkFaint,
            marginTop: 12, marginBottom: 0 }}>
            {total === 0 ? "nothing assigned yet"
              : total === 3 ? `applied: ${abilities.filter((a) => current[a]).map((a) => `${a.toUpperCase()} +${current[a]}`).join(", ")}`
              : `${total} of 3 points assigned`}
          </p>
        </div>
      )}

      {(bgRec?.feat || (needsOriginFeat && originFeat) || bgRec?.skill_proficiencies || bgRec?.tool_proficiency || bgRec?.equipment) && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${STONE.hi}` }}>
          {/* Shown, not applied. The engine has no route for a granted feat or a tool proficiency
              yet, and printing them as though they were live would be worse than printing them as
              a reminder. */}
          <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, letterSpacing: "0.14em",
            textTransform: "uppercase", color: STONE.inkFaint, marginBottom: 8 }}>
            Also granted
          </div>

          {/* A granted feat whose increase is the player's choice cannot apply itself. Asked here,
              beside the feat that raises the question, rather than left as a silent gap on Finish. */}
          {featRec?.asi && !ABILITIES.some((a) => typeof (featRec.asi as Record<string, unknown>)?.[a] === "number") && (
            <div style={{ marginBottom: 10 }}>
              <label style={forgeLabel}>
                {featRec.name} raises an ability. Which one?
              </label>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {ABILITIES.map((a) => (
                  <button key={a} className="forge-btn" onClick={() => onFeatAbility(a)}
                    style={{ ...stoneButton(featAbility === a ? "primary" : "stone"),
                      fontSize: 12.5, padding: "6px 12px" }}>
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "grid", gap: 5, fontSize: 13.5, color: STONE.ink }}>
            {(bgRec?.feat || (needsOriginFeat && originFeat)) && <span><strong>Feat:</strong> {bgRec?.feat || originFeat}</span>}
            {bgRec?.skill_proficiencies && <span><strong>Skills:</strong> {bgRec.skill_proficiencies}</span>}
            {bgRec?.tool_proficiency && <span><strong>Tools:</strong> {bgRec.tool_proficiency}</span>}
            {bgRec?.equipment && <span><strong>Equipment:</strong> {bgRec.equipment}</span>}
          </div>
          <p style={{ color: STONE.inkFaint, fontSize: 12, marginTop: 8, marginBottom: 0, lineHeight: 1.55 }}>
            The skills and the feat&rsquo;s effects apply to your sheet automatically. The gear is
            offered on the Equipment tab rather than added, so it does not fight a list you have
            already put together.
          </p>
        </div>
      )}
    </div>
  );
}


type SpellLoadout = { name: string; cantrips: string[]; known: string[] };

/**
 * The spell list, filtered to the character's class, with saved loadouts.
 *
 * WHY LOADOUTS ARE SNAPSHOTS
 *   A prepared-caster's list changes every long rest, and the thing a player actually wants is
 *   "give me back Tuesday's list". A live link would mean editing today's spells silently rewrote
 *   Tuesday's, which is the opposite of a loadout - so applying one COPIES into the working set and
 *   the saved copy stays put until it is explicitly saved over.
 *
 * IT DOES NOT ENFORCE LIMITS
 *   How many spells a class may know or prepare depends on level, subclass, ability modifier and a
 *   pile of features the engine does not model. Inventing a cap would be a rule the app made up,
 *   and a player being told "you cannot prepare that" by a tool that is guessing is worse than no
 *   help at all. It COUNTS instead, and the count is the honest form of the same information.
 */
function SpellsPanel({ build, spells, sheet, edition, structuredRec, granted, onToggle, loadouts, onSaveLoadout, onApplyLoadout, onDeleteLoadout }: {
  build: Build;
  edition: string;
  spells: SpellRecord[];
  structuredRec?: unknown;
  granted: { spell: string; from: string; level: number }[];
  sheet: NonNullable<ReturnType<typeof deriveSheet>> | null;
  onToggle: (name: string, cantrip: boolean) => void;
  loadouts: SpellLoadout[];
  onSaveLoadout: (name: string) => void;
  onApplyLoadout: (name: string) => void;
  onDeleteLoadout: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [lvl, setLvl] = useState<string>("");
  const [school, setSchool] = useState<string>("");
  const [onlyMine, setOnlyMine] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [newLoadout, setNewLoadout] = useState("");

  // EVERY class the character holds, not just the primary. A Rogue(Assassin)/Cleric filtered on
  // meta.className alone saw the Rogue list - which for an Assassin is EMPTY - so the tab looked
  // broken rather than incomplete, and the only escape was turning the filter off entirely.
  const myClasses = useMemo(() => {
    const extra = ((build as Build & { multiclass?: { className: string }[] }).multiclass || [])
      .map((c) => c.className);
    // A subclass caster draws from another class's list (Eldritch Knight: Wizard), and spells are
    // tagged by class, so that list joins the filter alongside the class itself.
    const subList = subclassSpellList(build.meta.className || "", build.meta.subclass);
    return [build.meta.className || "", ...(subList ? [subList] : []), ...extra].filter(Boolean);
  }, [build]);
  const cls = myClasses.join(", ");
  const subclassCaster = !!subclassSpellList(build.meta.className || "", build.meta.subclass);
  // Limits for a SINGLE-CLASS subclass caster. The class table (Fighter, Rogue, Monk) has no spell
  // columns, so without this the tab offered the whole Wizard list up to level 9 with no count. A
  // multiclassed character keeps the old behaviour: its other class's list and slots apply too.
  const isMulti = (((build as Build & { multiclass?: unknown[] }).multiclass) || []).length > 0;
  const subCasting = isMulti ? null
    : subclassCasting(build.meta.className || "", build.meta.subclass, build.level || 1, edition);

  const chosen = useMemo(() => new Set([...(build.spells?.cantrips || []), ...(build.spells?.known || [])]),
    [build.spells]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return spells.filter((sp) => {
      // Matches against ANY of the character's classes: a multiclassed caster should see the union
      // of their lists, and a spell on two of them should appear once, not be filtered by whichever
      // class happens to be first.
      if (onlyMine && myClasses.length
        && !spellClasses(sp).some((c) => myClasses.some((mine) => c.toLowerCase() === mine.toLowerCase()))) return false;
      if (onlyMine && subCasting && spellLevel(sp) > subCasting.maxSpellLevel) return false;
      if (lvl !== "" && spellLevel(sp) !== Number(lvl)) return false;
      if (school && (sp.school || "") !== school) return false;
      if (needle && !sp.name.toLowerCase().includes(needle)) return false;
      return true;
    }).sort((a, b) => spellLevel(a) - spellLevel(b) || a.name.localeCompare(b.name));
  }, [spells, myClasses, lvl, school, q, onlyMine, subCasting]);

  // Built from the loaded spells rather than a hardcoded list, so a ruleset or partner content that
  // introduces a school shows it without a code change.
  const schools = useMemo(
    () => Array.from(new Set(spells.map((sp) => sp.school).filter(Boolean) as string[])).sort(),
    [spells],
  );

  const cantripCount = build.spells?.cantrips?.length || 0;
  const knownCount = build.spells?.known?.length || 0;

  // The caps come from the class's own progression table, which carries "Cantrips" and "Prepared
  // Spells" columns. Nothing is invented: a class whose table has no such column gets no cap, and
  // the panel counts without limiting exactly as it did before.
  const caps = useMemo(() => {
    if (subCasting) return { cantrips: subCasting.cantrips, spells: subCasting.spells };
    const row = classTable(structuredRec).find((r) => r.level === (build.level || 1));
    const num = (v: string | undefined) => {
      const n = parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) ? n : null;
    };
    return {
      cantrips: num(row?.columns["Cantrips"] ?? row?.columns["Cantrips Known"]),
      spells: num(row?.columns["Prepared Spells"] ?? row?.columns["Spells Known"]),
    };
  }, [structuredRec, build.level, subCasting]);

  const atCantripCap = caps.cantrips !== null && cantripCount >= caps.cantrips;
  const atSpellCap = caps.spells !== null && knownCount >= caps.spells;

  // 2014 Eldritch Knight / Arcane Trickster: level 1+ spells from outside their two schools are
  // limited, not forbidden, so the list still shows them and blocks adding past the allowance.
  const schoolOf = useMemo(() => new Map(spells.map((sp) => [sp.name, sp.school || ""])), [spells]);
  const offSchool = (sc: string) => !!subCasting?.schools && !subCasting.schools.includes(sc);
  const offSchoolCount = (build.spells?.known || []).filter((n) => offSchool(schoolOf.get(n) || "")).length;
  const atOffSchoolCap = !!subCasting?.schools && offSchoolCount >= subCasting.anySchool;

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Your spells, and saved lists you can swap between.">Spells</PanelTitle>

      {!cls && <Muted>Pick a class on the Identity tab to filter this list.</Muted>}

      {sheet && !sheet.isCaster && cls && !subclassCaster && (
        <p style={{ color: STONE.inkDim, fontSize: 13, margin: "0 0 12px", lineHeight: 1.6 }}>
          {cls} is not a spellcasting class in this ruleset. You can still pick spells here if a
          feat, subclass or item grants them.
        </p>
      )}

      {sheet?.isCaster && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontFamily: FORGE_FONTS.mono,
          fontSize: 12, color: STONE.inkFaint, marginBottom: 12 }}>
          <span>spell attack {sheet.spellAttack >= 0 ? "+" : ""}{sheet.spellAttack}</span>
          <span>save DC {sheet.spellDC}</span>
        </div>
      )}

      {granted.length > 0 && (
        <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${STONE.hi}` }}>
          <label style={forgeLabel}>Always prepared</label>
          <div style={{ display: "grid", gap: 5 }}>
            {granted.map((g) => (
              <div key={g.spell} style={{ display: "flex", gap: 10, alignItems: "baseline",
                flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, color: C.sun }}>{g.spell}</span>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint }}>
                  from {g.from}, at level {g.level}
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "8px 0 0", lineHeight: 1.5 }}>
            These do not count against the numbers below, and there is nothing to pick or unpick.
            Spells from your species or lineage can also be cast once per Long Rest without a slot;
            subclass spells use a slot like any other prepared spell.
          </p>
        </div>
      )}

      {/* Loadouts */}
      <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${STONE.hi}` }}>
        <label style={forgeLabel}>Loadouts</label>
        {loadouts.length === 0 ? (
          <p style={{ color: STONE.inkFaint, fontSize: 12.5, margin: "0 0 8px", lineHeight: 1.55 }}>
            None saved. Pick a set of spells below, name it, and you can bring it back after any
            long rest.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
            {loadouts.map((o) => (
              <div key={o.name} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Button onClick={() => onApplyLoadout(o.name)}
                  style={{ fontSize: 13, flex: "1 1 180px", textAlign: "left" }}>
                  {o.name}
                  <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint, marginLeft: 8 }}>
                    {o.cantrips.length} cantrips, {o.known.length} spells
                  </span>
                </Button>
                <button onClick={() => onSaveLoadout(o.name)} title="Overwrite with the current list"
                  style={{ ...stoneButton("ghost"), fontSize: 12, padding: "6px 10px" }}>Update</button>
                <button onClick={() => onDeleteLoadout(o.name)}
                  style={{ ...stoneButton("ghost"), fontSize: 12, padding: "6px 10px", color: C.warn }}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Name this list (Dungeon delve, Social night)" value={newLoadout} onChange={(e) => setNewLoadout(e.target.value)}
            placeholder="Name this list (Dungeon delve, Social night)"
            style={{ ...stoneField(), flex: "1 1 220px", width: "auto", fontSize: 13, padding: "8px 10px" }} />
          <button className="forge-btn" disabled={!newLoadout.trim()} title={newLoadout.trim() ? undefined : "Name the list first"}
            onClick={() => { onSaveLoadout(newLoadout.trim()); setNewLoadout(""); }}
            style={{ ...stoneButton("primary"), fontSize: 13, opacity: newLoadout.trim() ? 1 : 0.5 }}>
            Save current
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <input aria-label="Search spells" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spells"
          style={{ ...stoneField(), flex: "1 1 180px", width: "auto", fontSize: 13, padding: "8px 10px" }} />
        <select aria-label="Spell level" value={lvl} onChange={(e) => setLvl(e.target.value)}
          style={{ ...stoneField(), width: "auto", minWidth: 110, fontSize: 13, padding: "8px 10px" }}>
          <option value="">Any level</option>
          <option value="0">Cantrips</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={String(n)}>Level {n}</option>)}
        </select>
        <select aria-label="School of magic" value={school} onChange={(e) => setSchool(e.target.value)}
          style={{ ...stoneField(), width: "auto", minWidth: 130, fontSize: 13, padding: "8px 10px" }}>
          <option value="">Any school</option>
          {schools.map((sc) => <option key={sc} value={sc}>{sc}</option>)}
        </select>
        {cls && (
          <button className="forge-btn" onClick={() => setOnlyMine((v) => !v)}
            style={{ ...stoneButton(onlyMine ? "primary" : "stone"), fontSize: 12.5 }}>
            {onlyMine ? cls : "All classes"}
          </button>
        )}
      </div>

      <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint, marginBottom: 6 }}>
        {filtered.length} shown &middot;{" "}
        <span style={{ color: atCantripCap ? C.good : undefined }}>
          {cantripCount}{caps.cantrips !== null ? ` of ${caps.cantrips}` : ""} cantrip{cantripCount === 1 ? "" : "s"}
        </span>{" "}
        and{" "}
        <span style={{ color: atSpellCap ? C.good : undefined }}>
          {knownCount}{caps.spells !== null ? ` of ${caps.spells}` : ""} spell{knownCount === 1 ? "" : "s"}
        </span>
        {subCasting && <> &middot; up to level {subCasting.maxSpellLevel}</>}
        {subCasting?.schools && (
          <span style={{ color: atOffSchoolCap ? C.good : undefined }}>
            {" "}&middot; {offSchoolCount} of {subCasting.anySchool} outside {subCasting.schools.join("/")}
          </span>
        )}
      </div>

      <div style={{ maxHeight: 460, overflowY: "auto", display: "grid", gap: 4, paddingRight: 4 }}>
        {filtered.map((sp) => {
          const lv = spellLevel(sp);
          const cantrip = lv === 0;
          const on = chosen.has(sp.name);
          const isOpen = open === sp.name;
          // Full means "cannot add another", never "cannot remove this one" - a player at the cap
          // must still be able to swap, and a picker that locks up entirely at the limit is the
          // most annoying way to be right.
          const offBlocked = !on && !cantrip && atOffSchoolCap && offSchool(sp.school || "");
          const blocked = (!on && (cantrip ? atCantripCap : atSpellCap)) || offBlocked;
          return (
            <div key={`${sp.name}::${sp.level}`} style={{
              border: `1px solid ${on ? C.sun : STONE.hi}`, borderRadius: 4,
              background: on ? "rgba(200,162,75,0.09)" : "rgba(0,0,0,0.22)", padding: "8px 10px",
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <button onClick={() => { if (!blocked) onToggle(sp.name, cantrip); }}
                  title={offBlocked
                    ? `Only ${subCasting?.anySchool} of your spells can come from outside ${subCasting?.schools?.join(" and ")} at level ${build.level}.`
                    : blocked ? `You already have ${cantrip ? caps.cantrips : caps.spells} at level ${build.level}. Remove one first.` : undefined}
                  style={{ background: "transparent", border: "none",
                    cursor: blocked ? "not-allowed" : "pointer", padding: 0,
                    opacity: blocked ? 0.4 : 1,
                    color: on ? C.sun : STONE.ink, fontSize: 14, fontWeight: 600, textAlign: "left" }}>
                  {on ? "\u2713 " : ""}{sp.name}
                </button>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint }}>
                  {cantrip ? "cantrip" : `lvl ${lv}`}{sp.school ? ` \u00b7 ${sp.school}` : ""}
                  {truthy(sp.concentration) ? " \u00b7 conc" : ""}{truthy(sp.ritual) ? " \u00b7 ritual" : ""}
                </span>
                <button onClick={() => setOpen(isOpen ? null : sp.name)}
                  style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer",
                    color: C.plum, fontSize: 12, fontFamily: FORGE_FONTS.mono }}>
                  {isOpen ? "less" : "read"}
                </button>
              </div>
              {isOpen && (
                <div style={{ marginTop: 8, fontSize: 13, color: STONE.inkDim, lineHeight: 1.6 }}>
                  <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, marginBottom: 6 }}>
                    {[sp.casting_time, sp.range, sp.components, sp.duration].filter(Boolean).join(" \u00b7 ")}
                  </div>
                  {sp.description || "No description in this data set."}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <Muted>Nothing matches. Widen the level, clear the search, or switch off the class filter.</Muted>
        )}
      </div>
    </div>
  );
}



/**
 * Species, lineage, and the choices a species asks for.
 *
 * THE PICKERS ARE READ OUT OF THE RULES TEXT, not typed out beside it. traitOptions() pulls the
 * markdown table or bold bullet list the trait already contains, so the dropdown and the paragraph
 * under it come from one string and cannot drift apart when the SRD data is refetched.
 *
 * WHERE IT CANNOT READ ONE, IT SAYS SO. Gnomish Lineage and the Human traits point at tables that
 * are not in their own description, so they get the prose and a note rather than an empty dropdown
 * under a trait that plainly asks for a decision.
 *
 * A STRUCTURED CHOICE WINS. When rules-data.json has a `choice` for the species (lib/srd/
 * species-mechanics.ts), its options fill the dropdown and the pick is APPLIED: a lineage's speed,
 * darkvision, resistance and spells reach the sheet through resolveSpecies. The 2024 SRD text
 * flattens its tables, so for those species the text route found nothing at all. A species with no
 * structured entry still gets the text route, and its picks stay recorded rather than applied.
 */
function SpeciesPanel({
  build, speciesVariant, speciesOpts, variantOpts, speciesRec, variantRec, desc, mech, resolved, toolNames,
  choices, onSpecies, onVariant, onChoice, ownTraits, onOwnTraits, ownMech, onOwnMech, knownSpecies,
}: {
  ownTraits: OwnTrait[]; onOwnTraits: (list: OwnTrait[]) => void;
  ownMech: OwnSpeciesMech | undefined; onOwnMech: (m: OwnSpeciesMech) => void;
  /** Whether the rules data knows this species (its speed, darkvision and resistances apply on their own). */
  knownSpecies: boolean;
  mech: ReturnType<typeof speciesMechanics>;
  resolved: ReturnType<typeof resolveSpecies>;
  toolNames: string[];
  build: Build; speciesVariant: string;
  speciesOpts: { name: string }[];
  variantOpts: { name: string; variant_kind: string }[];
  speciesRec: { traits?: unknown; size?: string; speed?: string; ability_bonuses?: string } | undefined;
  variantRec: { traits?: unknown; ability_bonuses?: string } | undefined;
  desc: Described | null;
  choices: Record<string, string>;
  onSpecies: (v: string) => void; onVariant: (v: string) => void;
  onChoice: (trait: string, value: string) => void;
}) {
  const traits: TraitEntry[] = useMemo(
    () => [...traitList(speciesRec?.traits), ...traitList(variantRec?.traits)],
    [speciesRec, variantRec],
  );

  // Choices the trait text asks for, plus the species' structured choice when no trait text covers
  // it. Species outside the SRD (Shifter, Reborn) have no trait text in the app at all, so without
  // this their choice would have no dropdown.
  const decisions: TraitEntry[] = useMemo(() => {
    const fromText = traits.filter((t) => traitAsksAChoice(t.desc || ""));
    if (mech?.choice && !fromText.some((t) => structuredChoiceOptions(mech, t.name))) {
      return [...fromText, { name: mech.choice.label, desc: "" } as TraitEntry];
    }
    return fromText;
  }, [traits, mech]);
  // Trait summaries for display when the SRD files carry none for this species.
  const shownTraits: TraitEntry[] = traits.length
    ? traits
    : (mech?.traits || []).map(([name, desc]) => ({ name, desc }) as TraitEntry);

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="What this character is, and the choices that come with it.">Species</PanelTitle>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Field label="Species" value={build.meta.species} onChange={onSpecies}
          options={speciesOpts.map((s) => s.name)} placeholder="Choose a species" />
        {variantOpts.length > 0 && (
          <Field label={variantOpts[0]?.variant_kind === "subrace" ? "Subrace" : "Lineage"}
            value={speciesVariant} onChange={onVariant}
            options={variantOpts.map((v) => v.name)} placeholder="None for this species" />
        )}
      </div>

      {desc && <DescBlock desc={desc} />}

      {!build.meta.species && <Muted>Pick a species and its traits appear here.</Muted>}

      {build.meta.species && (speciesRec?.size || speciesRec?.speed || speciesRec?.ability_bonuses) && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontFamily: FORGE_FONTS.mono,
          fontSize: 12, color: STONE.inkFaint, margin: "10px 0 4px" }}>
          {speciesRec?.size && <span>size {speciesRec.size}</span>}
          {/* The structured speed includes the picked lineage (Wood Elf 35); the record's text is the
              base species only, which read as though the pick had done nothing. */}
          {resolved?.effects.speed
            ? <span>speed {resolved.effects.speed} feet{resolved.option ? ` (${resolved.option})` : ""}</span>
            : speciesRec?.speed && <span>speed {speciesRec.speed}</span>}
          {resolved?.effects.darkvision ? <span>darkvision {resolved.effects.darkvision} feet</span> : null}
          {speciesRec?.ability_bonuses && <span>{speciesRec.ability_bonuses}</span>}
        </div>
      )}

      {decisions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={forgeLabel}>Choices this species asks for</label>
          <div style={{ display: "grid", gap: 10 }}>
            {decisions.map((t) => {
              const key = t.name;
              // A structured choice (rules-data) wins over options parsed from the trait text, which
              // for the 2024 species finds none because the SRD text flattens its tables.
              const structured = structuredChoiceOptions(mech, t.name);
              const opts = structured || traitOptions(t.desc || "");
              // A lineage chosen on the Identity tab counts here too, so the two tabs agree.
              const picked = choices[key]
                || (structured ? matchOption(mech, speciesVariant)?.name || "" : "");
              return (
                <div key={key} style={{ background: "rgba(0,0,0,0.24)", borderRadius: 4,
                  padding: "10px 12px" }}>
                  <div style={{ fontSize: 14, color: STONE.ink, marginBottom: 6 }}>{t.name}</div>
                  {opts.length > 0 ? (
                    <>
                      <select aria-label="Choice" value={picked} onChange={(e) => onChoice(key, e.target.value)}
                        style={{ ...stoneField(), fontSize: 13.5, padding: "8px 10px" }}>
                        <option value="">Not chosen</option>
                        {opts.map((o) => (
                          <option key={o.name} value={o.name}>
                            {o.name}{o.detail ? `: ${o.detail.slice(0, 60)}` : ""}
                          </option>
                        ))}
                      </select>
                      {picked && (
                        <p style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11.5, color: STONE.inkFaint,
                          margin: "6px 0 0" }}>
                          see the Finish tab for what this changed
                        </p>
                      )}
                    </>
                  ) : (
                    <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: 0, lineHeight: 1.55 }}>
                      This one asks you to choose, but its options are not listed in the rules text
                      the app holds. Read the trait below and note your pick for now.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(() => {
        // 2014 ability increases the player assigns. Each slot is a different ability; an ability
        // already used in another slot, or one the species excludes, is not offered.
        const pick = resolved?.effects.asiPick;
        if (!pick) return null;
        const amounts = asiAmounts(pick, choices);
        const exclude = pick.kind === "fixed" ? pick.exclude || [] : [];
        const box = { marginTop: 12, background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "10px 12px" };
        const sel = { ...stoneField(), fontSize: 13.5, padding: "8px 10px", marginTop: 4 };
        return (
          <div style={box}>
            <div style={{ fontSize: 14, color: STONE.ink, marginBottom: 2 }}>
              Ability score increases from {build.meta.species}
            </div>
            {pick.kind === "flexible" && (
              <select aria-label="Choose a pattern" value={choices[SPECIES_ASI_PATTERN_KEY] || ""}
                onChange={(e) => onChoice(SPECIES_ASI_PATTERN_KEY, e.target.value)} style={sel}>
                <option value="">Choose a pattern</option>
                {Object.keys(ASI_PATTERNS).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            )}
            {amounts.map((amt, i) => {
              const taken = amounts.map((_, j) => (j !== i ? choices[speciesAsiKey(j)] : "")).filter(Boolean);
              return (
                <select aria-label="Ability score increase" key={i} value={choices[speciesAsiKey(i)] || ""}
                  onChange={(e) => onChoice(speciesAsiKey(i), e.target.value)} style={sel}>
                  <option value="">+{amt} to...</option>
                  {ABILITIES.filter((a) => !exclude.includes(a) && !taken.includes(a)).map((a) => (
                    <option key={a} value={a}>+{amt} {a.toUpperCase()}</option>
                  ))}
                </select>
              );
            })}
          </div>
        );
      })()}

      {(() => {
        // Skill and tool picks the species grants. Rendered from the structured entry, so Keen
        // Senses offers exactly Insight, Perception and Survival and Skillful offers every skill.
        const sk = resolved?.effects.skillPick;
        const tp = resolved?.effects.toolPick;
        if (!sk && !tp) return null;
        const skillOpts = !sk ? [] : sk.from === "any" ? SKILLS : SKILLS.filter(([k]) => (sk.from as string[]).includes(k));
        const toolOpts = !tp ? [] : tp.from === "any" ? toolNames : (tp.from as string[]);
        const box = { marginTop: 12, background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "10px 12px" };
        const sel = { ...stoneField(), fontSize: 13.5, padding: "8px 10px", marginTop: 4 };
        return (
          <>
            {sk && Array.from({ length: sk.n }, (_, i) => (
              <div key={`sk${i}`} style={box}>
                <div style={{ fontSize: 14, color: STONE.ink, marginBottom: 2 }}>
                  Skill proficiency{sk.n > 1 ? ` ${i + 1}` : ""} from {build.meta.species}
                </div>
                <select aria-label="Skill" value={choices[speciesSkillKey(i)] || ""} onChange={(e) => onChoice(speciesSkillKey(i), e.target.value)} style={sel}>
                  <option value="">Not chosen</option>
                  {skillOpts.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
            ))}
            {tp && Array.from({ length: tp.n }, (_, i) => (
              <div key={`tp${i}`} style={box}>
                <div style={{ fontSize: 14, color: STONE.ink, marginBottom: 2 }}>
                  Tool proficiency{tp.n > 1 ? ` ${i + 1}` : ""} from {build.meta.species}
                </div>
                <select aria-label="Tool" value={choices[speciesToolKey(i)] || ""} onChange={(e) => onChoice(speciesToolKey(i), e.target.value)} style={sel}>
                  <option value="">Not chosen</option>
                  {toolOpts.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            ))}
          </>
        );
      })()}

      {mech?.spellAbility === "choose" && (
        <div style={{ marginTop: 12, background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "10px 12px" }}>
          <div style={{ fontSize: 14, color: STONE.ink, marginBottom: 6 }}>Spellcasting ability for species spells</div>
          <select aria-label="Spellcasting ability for species spells" value={choices[SPECIES_ABILITY_KEY] || ""} onChange={(e) => onChoice(SPECIES_ABILITY_KEY, e.target.value)}
            style={{ ...stoneField(), fontSize: 13.5, padding: "8px 10px" }}>
            <option value="">Not chosen</option>
            {SPECIES_ABILITY_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}

      {shownTraits.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${STONE.hi}` }}>
          <label style={forgeLabel}>Traits</label>
          <div style={{ display: "grid", gap: 10 }}>
            {shownTraits.map((t, i) => (
              <div key={`${t.name}-${i}`}>
                <div style={{ fontSize: 13.5, color: STONE.ink, fontWeight: 600 }}>{t.name}</div>
                <p style={{ fontSize: 13, color: STONE.inkDim, margin: "3px 0 0", lineHeight: 1.6 }}>
                  {t.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {build.meta.species && shownTraits.length === 0 && ownTraits.length === 0 && (
        <Muted>
          No trait data for this species yet. Add its traits below in your own words (or from your
          book), and they show on your sheet.
        </Muted>
      )}

      {build.meta.species && (
        <OwnSpeciesTraits species={build.meta.species} traits={ownTraits} onTraits={onOwnTraits}
          mech={knownSpecies ? undefined : ownMech || {}} onMech={onOwnMech} />
      )}
    </div>
  );
}

/**
 * The player's own species traits (audit: species traits). For a homebrew species, a book the app
 * has no data for, or a trait the bundled summary leaves out. Only the player's words are stored, on
 * their character; nothing here ships as app data. For a species the rules data does not know, it also
 * takes the numbers the sheet needs (speed, darkvision, resistances), since nothing else supplies them.
 */
function OwnSpeciesTraits({ species, traits, onTraits, mech, onMech }: {
  species: string;
  traits: OwnTrait[]; onTraits: (list: OwnTrait[]) => void;
  mech: OwnSpeciesMech | undefined; onMech: (m: OwnSpeciesMech) => void;
}) {
  const field = { ...stoneField(), fontSize: 13.5, padding: "8px 10px" };
  const num = (v: string) => { const n = Math.round(Number(v)); return v.trim() && Number.isFinite(n) && n >= 0 && n <= 500 ? n : undefined; };
  const setAt = (i: number, p: Partial<OwnTrait>) => onTraits(traits.map((t, j) => (j === i ? { ...t, ...p } : t)));
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${STONE.hi}` }}>
      <label style={forgeLabel}>Your own traits</label>
      <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "0 0 10px", lineHeight: 1.55 }}>
        Add anything {species} has that is not listed above. These stay with this character and show on its sheet.
        {traits.some((t) => t.from === "sheet") ? " Traits marked “from your sheet” came in with your D&D Beyond import." : ""}
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {traits.map((t, i) => (
          <div key={i} style={{ background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "10px 12px", display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input aria-label="Trait name" value={t.name} placeholder={"Trait name (Darkvision, Celestial Resistance…)"}
                onChange={(e) => setAt(i, { name: e.target.value.slice(0, 80), from: "player" })} style={{ ...field, flex: 1 }} />
              {t.from === "sheet" && <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint, whiteSpace: "nowrap" }}>from your sheet</span>}
              <button type="button" className="forge-btn" onClick={() => onTraits(traits.filter((_, j) => j !== i))}
                aria-label={`Remove ${t.name || "this trait"}`} style={{ ...stoneButton("ghost"), fontSize: 12, padding: "6px 10px" }}>Remove</button>
            </div>
            <textarea aria-label="What it does" value={t.desc} rows={3} placeholder="What it does, in a sentence or two."
              onChange={(e) => setAt(i, { desc: e.target.value.slice(0, 1500), from: "player" })} style={{ ...field, resize: "vertical", lineHeight: 1.5 }} />
          </div>
        ))}
      </div>
      <button type="button" className="forge-btn" onClick={() => onTraits([...traits, { name: "", desc: "", from: "player" }])}
        style={{ ...stoneButton("ghost"), fontSize: 12.5, padding: "6px 12px", marginTop: 10 }}>+ Add a trait</button>

      {mech && (
        <div style={{ marginTop: 14 }}>
          <label style={forgeLabel}>Numbers for your sheet</label>
          <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "0 0 8px", lineHeight: 1.55 }}>
            Six Axes has no rules data for {species}, so fill these in and the sheet uses them. Leave a box empty if it does not apply.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <label style={{ fontSize: 12.5, color: STONE.inkDim }}>Speed (feet)
              <input inputMode="numeric" value={mech.speed ?? ""} placeholder="30"
                onChange={(e) => onMech({ ...mech, speed: num(e.target.value) })} style={{ ...field, marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12.5, color: STONE.inkDim }}>Darkvision (feet)
              <input inputMode="numeric" value={mech.darkvision ?? ""} placeholder="none"
                onChange={(e) => onMech({ ...mech, darkvision: num(e.target.value) })} style={{ ...field, marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12.5, color: STONE.inkDim }}>Resistances (comma separated)
              <input value={(mech.resist || []).join(", ")} placeholder="poison, necrotic"
                onChange={(e) => onMech({ ...mech, resist: e.target.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 13) })}
                style={{ ...field, marginTop: 4 }} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}




/**
 * The decisions this class asks for, as pickers rather than paragraphs.
 *
 * WHAT IT COVERS AND WHAT IT ADMITS
 *   Only what lib/class-choices.ts lists, which is deliberately a short and certain set. Everything
 *   else in the class still shows as rules text on the progression panel, exactly as before. A
 *   feature the vocabulary does not know about is not broken here - it simply is not claimed.
 *
 * WHY THE COUNT IS SHOWN RATHER THAN ENFORCED BY DISABLING
 *   Over-picking is caught (extra selections are refused once the limit is reached) but the panel
 *   says "2 of 2 chosen" rather than greying the rest out silently. A player who cannot see WHY an
 *   option stopped responding assumes the tool is broken; a count explains itself.
 */
function ClassChoicesPanel({ build, sheet, weapons, spells, feats, picks, onPick, structuredRec, edition }: {
  build: Build;
  sheet: NonNullable<ReturnType<typeof deriveSheet>> | null;
  weapons: ItemRecord[];
  spells: SpellRecord[];
  feats: FeatOption[];
  picks: Record<string, string[]>;
  onPick: (key: string, values: string[]) => void;
  structuredRec?: unknown;
  /** Which ruleset's vocabulary to offer. 2014 and 2024 metamagic are different lists. */
  edition: string;
}) {
  // The level 1 skill grant, read out of the class's own core traits table rather than authored.
  // This is what every class was missing: without it nobody had their own proficiencies, so
  // Expertise had nothing to double and a background's two skills were the whole sheet.
  const fromCore = useMemo<ClassChoice[]>(() => {
    const core = parseCoreTraits(
      ((structuredRec || {}) as { core_traits?: string }).core_traits || "",
    );
    if (!core.skills || !build.meta.className) return [];
    return [{
      className: build.meta.className, level: 1, feature: "Skill Proficiencies",
      choose: core.skills.choose, kind: "skill",
      filter: { options: core.skills.options },
      note: "Chosen once at level 1.",
    }];
  }, [structuredRec, build.meta.className]);

  const list = useMemo(
    () => [
      ...fromCore,
      ...choicesFor(build.meta.className || "", build.meta.subclass || "", build.level || 1, edition),
    ],
    [fromCore, build.meta.className, build.meta.subclass, build.level, edition],
  );

  const data = useMemo(() => ({
    skills: SKILLS.map(([key, label]) => ({ key, label })),
    weapons: (weapons as unknown as { name: string; category?: string; weapon_category?: string;
      weapon_range?: string; mastery?: string }[]).filter((w) => w.category === "Weapon"),
    tools: (weapons as unknown as { name: string; category?: string }[])
      .filter((w) => w.category === "Tools").map((t) => ({ name: t.name })),
    // school and the class list both feed the resolver's filters (Evocation Savant, "two Wizard
    // cantrips"). Dropping them here left any school-filtered pick with an empty list.
    spells: spells.map((sp) => ({ name: sp.name, level: sp.level, school: sp.school, classes: spellClasses(sp) })),
    feats: feats.map((f) => ({ name: f.name, category: (f as { category?: string }).category })),
    // Named options carry a minimum level, so the resolver needs to know the character's.
    characterLevel: build.level || 1,
    // Expertise only offers skills the character already has, so this reads the DERIVED sheet
    // rather than build.skillProf - a skill granted by a background or species is just as
    // proficient as one picked by hand, and asking the raw build would miss those.
    proficientSkills: Object.entries(sheet?.skills || {})
      .filter(([, v]) => (v as { rank: number }).rank > 0)
      .map(([k]) => k),
  }), [weapons, spells, feats, sheet, build.level]);

  if (list.length === 0) {
    return (
      <div style={stonePanel()}>
        <PanelTitle>Choices</PanelTitle>
        <Muted>
          Nothing to pick here for {build.meta.className || "this class"} at level {build.level}.
          Features that ask you to choose still appear as rules text on the progression below.
        </Muted>
      </div>
    );
  }

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Options resolved from the app's own weapon, skill and spell lists.">
        Choices
      </PanelTitle>

      <div style={{ display: "grid", gap: 14 }}>
        {list.map((c: ClassChoice) => {
          const key = choiceKey(c);
          const chosen = picks[key] || [];
          const options = resolveChoice(c, data);
          const full = chosen.length >= c.choose;

          const toggle = (v: string) => {
            if (chosen.includes(v)) onPick(key, chosen.filter((x) => x !== v));
            else if (!full) onPick(key, [...chosen, v]);
          };

          return (
            <div key={key} style={{ background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: 14, color: STONE.ink }}>
                  {c.feature}
                  <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint, marginLeft: 8 }}>
                    level {c.level}
                  </span>
                </span>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11.5,
                  color: full ? C.good : STONE.inkFaint }}>
                  {chosen.length} of {c.choose} chosen
                </span>
              </div>

              {options.length === 0 ? (
                <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: 0, lineHeight: 1.55 }}>
                  {c.filter?.proficientOnly
                    ? "Nothing to choose from yet: expertise doubles a proficiency you already have, and this character has none."
                    : "No options matched. Read the rules text on the progression below."}
                </p>
              ) : (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {options.map((o) => {
                    const on = chosen.includes(o.value);
                    return (
                      <button key={o.value} onClick={() => toggle(o.value)}
                        title={!on && full ? `Already chosen ${c.choose}. Deselect one first.` : undefined}
                        style={{
                          ...stoneButton(on ? "primary" : "stone"),
                          fontSize: 12.5, padding: "6px 11px",
                          opacity: !on && full ? 0.4 : 1,
                          cursor: !on && full ? "not-allowed" : "pointer",
                        }}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {c.note && (
                <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "8px 0 0", lineHeight: 1.5 }}>
                  {c.note}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: STONE.inkFaint, marginTop: 14, marginBottom: 0, lineHeight: 1.55 }}>
        Expertise applies to your sheet as soon as you pick it. Weapon mastery is recorded but has
        no effect the engine can compute yet, so it stays a note rather than a number.
      </p>
    </div>
  );
}


const thStyle: React.CSSProperties = {
  fontFamily: FORGE_FONTS.mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
  color: STONE.inkFaint, textAlign: "left", padding: "5px 10px 5px 0", whiteSpace: "nowrap",
  borderBottom: `1px solid ${STONE.hi}`,
};
const tdStyle: React.CSSProperties = {
  padding: "4px 10px 4px 0", whiteSpace: "nowrap", borderBottom: `1px solid rgba(255,235,200,0.05)`,
};


/**
 * What your background and class hand you, ready to add.
 *
 * WHY IT OFFERS RATHER THAN AUTO-ADDS
 *   A player may already have kitted themselves out, or be rebuilding a character that exists on
 *   paper. Silently appending eight items to a list they curated is a worse failure than making
 *   them press a button, and it is not undoable in one action either.
 *
 * THREE OUTCOMES PER ITEM, NOT TWO
 *   matched  the catalog has it and it can be added with weight, cost and any armour class
 *   choose   the grant points at a decision - "Choose one kind of Artisan's Tools" - which is not a
 *            missing item and must not be reported as one
 *   missing  a real name the catalog does not stock, almost always flavour from a partnered
 *            background: a house signet ring, a school uniform. These get added as a PLAIN NOTE,
 *            because a signet ring belongs on the sheet whether or not the app can price it.
 */
function GrantedEquipmentPanel({ bgRec, coreTraits, catalog, owned, onAdd }: {
  bgRec: { equipment?: string; tool_proficiency?: string } | undefined;
  coreTraits: string;
  catalog: string[];
  owned: string[];
  onAdd: (names: string[]) => void;
}) {
  const [pickedBundle, setPickedBundle] = useState<Record<string, string>>({});

  const sources = useMemo(() => {
    const core = parseCoreTraits(coreTraits);
    const out: { key: string; label: string; text: string; tool?: string }[] = [];
    if (bgRec?.equipment) {
      out.push({ key: "bg", label: "From your background", text: bgRec.equipment, tool: bgRec.tool_proficiency });
    }
    // The class grant is rebuilt from the raw row rather than core.equipment, so both sources go
    // through exactly one parser and cannot disagree about what a bundle contains.
    const classEquip = /\|\s*Starting Equipment\s*\|([^|]*)\|/i.exec(coreTraits)?.[1];
    if (classEquip) out.push({ key: "class", label: "From your class", text: classEquip });
    else if (core.equipment) {
      out.push({ key: "class", label: "From your class",
        text: core.equipment.options.map((o) => `(${o.label}) ${o.items}`).join("; or ") });
    }
    return out;
  }, [bgRec, coreTraits]);

  if (sources.length === 0) return null;

  const has = (n: string) => owned.some((o) => o.toLowerCase() === n.toLowerCase());

  return (
    <div style={{ ...stonePanel(), marginBottom: 14 }}>
      <PanelTitle hint="Your background and class each grant gear. Nothing is added until you say so.">
        Granted equipment
      </PanelTitle>

      <div style={{ display: "grid", gap: 16 }}>
        {sources.map((src) => {
          const bundles = parseGranted(src.text);
          if (!bundles.length) return null;
          const multi = bundles.length > 1;
          const chosen = pickedBundle[src.key] ?? bundles[0].label;
          const active = multi ? bundles.find((b) => b.label === chosen) ?? bundles[0] : bundles[0];

          const resolved = resolveCrossRefs(active.items, src.tool);
          const { matched, missing, choose } = matchGranted(resolved, catalog);
          const toAdd = matched.filter((i) => !has(i.name));

          return (
            <div key={src.key}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, color: STONE.ink }}>{src.label}</span>
                {multi && bundles.map((b) => (
                  <button key={b.label} className="forge-btn"
                    onClick={() => setPickedBundle((p) => ({ ...p, [src.key]: b.label }))}
                    style={{ ...stoneButton(b.label === chosen ? "primary" : "stone"),
                      fontSize: 12, padding: "5px 11px" }}>
                    Option {b.label}
                  </button>
                ))}
              </div>

              {active.currency.length > 0 && (
                <p style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11.5, color: C.sun, margin: "0 0 8px" }}>
                  {active.currency.join(", ")}
                </p>
              )}

              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {matched.map((i) => (
                  <span key={i.raw} style={{ ...stoneChip(), fontSize: 12.5,
                    opacity: has(i.name) ? 0.45 : 1 }}>
                    {i.qty > 1 ? `${i.qty}\u00d7 ` : ""}{i.name}{has(i.name) ? " \u2713" : ""}
                  </span>
                ))}
                {choose.map((i) => (
                  <span key={i.raw} style={{ ...stoneChip(), fontSize: 12.5, color: C.plum }}>
                    {i.name}: your choice
                  </span>
                ))}
                {missing.map((i) => (
                  <span key={i.raw} style={{ ...stoneChip(), fontSize: 12.5, color: STONE.inkFaint }}>
                    {i.name}
                  </span>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button title={toAdd.length === 0 ? "Tick the items to add first" : undefined} className="forge-btn" disabled={toAdd.length === 0}
                  onClick={() => onAdd(toAdd.flatMap((i) => Array.from({ length: Math.min(i.qty, 20) }, () => i.name)))}
                  style={{ ...stoneButton("primary"), fontSize: 12.5, opacity: toAdd.length ? 1 : 0.45 }}>
                  {toAdd.length ? `Add ${toAdd.length} item${toAdd.length === 1 ? "" : "s"}` : "Already added"}
                </button>
                {missing.length > 0 && (
                  <Button
                    onClick={() => onAdd(missing.filter((i) => !has(i.name)).map((i) => i.name))}
                    style={{ fontSize: 12.5 }}>
                    Add {missing.length} as notes
                  </Button>
                )}
              </div>

              {missing.length > 0 && (
                <p style={{ fontSize: 11.5, color: STONE.inkFaint, margin: "8px 0 0", lineHeight: 1.5 }}>
                  The greyed items are not in the equipment catalog, usually because they are
                  flavour from a third-party background. Adding them as notes puts them on the
                  sheet without a weight or a price.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


/**
 * What this character can spend, and how much is left.
 *
 * WHY IT IS ON THE ROLL TAB
 *   Everything else in the Forge is a decision made once. This is the one panel that changes DURING
 *   a session, and it belongs beside the other thing a player touches mid-game rather than filed
 *   with the reference material.
 *
 * IT STORES SPENT, NOT REMAINING
 *   A barbarian levelling from 2 to 3 gains a rage. A stored "2 remaining" would quietly be wrong
 *   from that moment; a stored "1 spent" stays true. The maximum is always read fresh from the
 *   class table.
 *
 * NO AUTOMATIC RESET
 *   The app does not know when your table takes a long rest, and guessing would be worse than
 *   asking: a tracker that silently refilled at the wrong moment is a tracker nobody can trust. The
 *   button is one tap and it is the player's call.
 */
function ResourcePanel({ structuredRec, level, costed, extraPools, extraClasses, mcSlots, spent, onSpend, onRest, onSpentMap, shortRestTick = 0 }: {
  structuredRec?: unknown;
  level: number;
  costed: { name: string; summary: string; resource: string; amount: number }[];
  extraPools: Resource[];
  extraClasses: { rec?: unknown; level: number }[];
  /** Combined slots, non-empty only when the character casts from more than one class. */
  mcSlots: { level: number; slots: number }[];
  spent: Record<string, number>;
  onSpend: (key: string, n: number) => void;
  onRest: () => void;
  onSpentMap: (next: Record<string, number>) => void;
  /** Bumped by the play sheet's short rest: apply each pool's short-rest recovery, as the button below does. */
  shortRestTick?: number;
}) {
  // Species-granted pools sit alongside the class ones; a multiclass caster's combined table replaces
  // the class's own slot row. One function (lib/play/tracks.ts) so the play sheet reads the same.
  const { pools, slots } = useMemo(
    () => trackedResources({ structuredRec, level, extraClasses, extraPools, mcSlots }),
    [structuredRec, level, extraClasses, extraPools, mcSlots],
  );

  // before the early return below: hooks run on every render, in the same order
  const lastTick = useRef(shortRestTick);
  useEffect(() => {
    if (shortRestTick === lastTick.current) return;
    lastTick.current = shortRestTick;
    onSpentMap(afterShortRest([...pools, ...slots], spent));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortRestTick]);

  if (pools.length === 0 && slots.length === 0) return null;

  // Only options whose pool this character actually has. A metamagic button that spends from a
  // resource the tracker cannot see would either do nothing or throw, and both are worse than the
  // button not being there.
  const spendable = costed.filter((c) => pools.some((p) => p.key === c.resource));

  const anySpent = Object.values(spent).some((n) => n > 0);

  const Track = ({ r }: { r: Resource }) => {
    const left = remaining(r, spent);
    const used = spent[r.key] || 0;
    return (
      <div style={{ background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "9px 11px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: STONE.ink }}>{r.label}</span>
          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12,
            color: left === 0 ? C.warn : left < r.max ? C.sun : STONE.inkFaint }}>
            {left} / {r.max}
          </span>
        </div>
        {/* Pips rather than a number field: at these sizes - one to nine - a row of dots is read at
            a glance and cannot be typed wrong mid-session. */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {Array.from({ length: r.max }, (_, i) => {
            const filled = i < left;
            return (
              <button key={i} aria-label={`${r.label} ${i + 1}`}
                onClick={() => onSpend(r.key, filled ? used + 1 : r.max - i - 1)}
                title={filled ? "Spend one" : "Give one back"}
                style={{
                  width: 18, height: 18, borderRadius: 9, cursor: "pointer", padding: 0,
                  background: filled ? C.sun : "transparent",
                  border: `1px solid ${filled ? C.sun : STONE.hi}`,
                }} />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ ...stonePanel(), marginBottom: 14 }}>
      <PanelTitle hint="The only page here that changes during a session.">Resources</PanelTitle>

      {pools.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px,1fr))",
          gap: 8, marginBottom: slots.length ? 14 : 0 }}>
          {pools.map((r) => <Track key={r.key} r={r} />)}
        </div>
      )}

      {slots.length > 0 && (
        <>
          <label style={forgeLabel}>
            Spell slots{mcSlots.length ? " (combined across your caster classes)" : ""}
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 8 }}>
            {slots.map((r) => <Track key={r.key} r={r} />)}
          </div>
        </>
      )}

      {spendable.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <label style={forgeLabel}>Spend on</label>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {spendable.map((c) => {
              const pool = pools.find((p) => p.key === c.resource);
              const left = pool ? remaining(pool, spent) : 0;
              const affordable = left >= c.amount;
              return (
                <Button key={c.name} disabled={!affordable}
                  onClick={() => onSpend(c.resource, (spent[c.resource] || 0) + c.amount)}
                  title={affordable ? c.summary : `Needs ${c.amount}, you have ${left}`}
                  style={{ fontSize: 12.5, padding: "7px 12px",
                    display: "flex", gap: 7, alignItems: "baseline",
                    opacity: affordable ? 1 : 0.4,
                    cursor: affordable ? "pointer" : "not-allowed" }}>
                  <span>{c.name}</span>
                  <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: C.plum }}>
                    &minus;{c.amount}
                  </span>
                </Button>
              );
            })}
          </div>
          <p style={{ fontSize: 11.5, color: STONE.inkFaint, margin: "8px 0 0", lineHeight: 1.5 }}>
            Only the options you have taken, and only while you can afford them. Tapping one spends
            from the pool above; the pips undo it if you change your mind.
          </p>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
        <button className="forge-btn" onClick={onRest} disabled={!anySpent}
          title={anySpent ? "Recover everything a long rest gives back" : "Nothing is spent, so there is nothing to recover"}
          style={{ ...stoneButton(anySpent ? "primary" : "stone"), fontSize: 12.5,
            opacity: anySpent ? 1 : 0.45 }}>
          Long rest
        </button>
        {/* A short rest gives back different amounts per resource - all of a monk's Focus Points,
            one Channel Divinity, none of a barbarian's rages - so this applies each pool's own rule
            rather than one blanket refill. Spell slots are untouched: they are long-rest. */}
        <Button disabled={!anySpent}
          title={anySpent ? "Recover what each feature gets back on a short rest" : "Nothing is spent, so there is nothing to recover"}
          onClick={() => onSpentMap(afterShortRest([...pools, ...slots], spent))}
          style={{ fontSize: 12.5, opacity: anySpent ? 1 : 0.45 }}>
          Short rest
        </Button>
        <span style={{ fontSize: 12, color: STONE.inkFaint, lineHeight: 1.5 }}>
          A short rest returns what each feature actually recovers, not everything.
        </span>
      </div>
    </div>
  );
}


function ClassTab({
  build, sheet, edition, activeClass, onClassTab, epicRows,
  classRecFor, structuredFor, subclassFor, weapons, spells, feats, picks,
  onPick, onLevel, onSubclass, onRemove, onChoose,
}: {
  build: Build;
  sheet: NonNullable<ReturnType<typeof deriveSheet>> | null;
  edition: string;
  activeClass: string;
  onClassTab: (c: string) => void;
  epicRows: LevelGroup[];
  classRecFor: (cn: string) => ClassRecord | undefined;
  structuredFor: (cn: string) => unknown;
  subclassFor: (cn: string) => string[];
  weapons: ItemRecord[];
  spells: SpellRecord[];
  feats: FeatOption[];
  picks: Record<string, string[]>;
  onPick: (key: string, values: string[]) => void;
  onLevel: (cn: string, level: number) => void;
  onSubclass: (cn: string, sc: string) => void;
  onRemove: (cn: string) => void;
  onChoose: (level: number, choice: EpicChoiceInput | null) => void;
}) {
  const extra = ((build as Build & { multiclass?: { className: string; subclass?: string; level: number }[] })
    .multiclass) || [];

  const classes = build.meta.className
    ? [
        { name: build.meta.className, subclass: build.meta.subclass || "", level: build.level, primary: true },
        ...extra.map((c) => ({ name: c.className, subclass: c.subclass || "", level: c.level || 1, primary: false })),
      ]
    : [];

  if (classes.length === 0) {
    return (
      <div style={stonePanel()}>
        <PanelTitle>Class</PanelTitle>
        <Muted>Pick a class on the Identity tab and its levels appear here.</Muted>
      </div>
    );
  }

  const current = classes.find((c) => c.name === activeClass) || classes[0];
  const total = classes.reduce((n, c) => n + c.level, 0);
  // What this class could rise to without the total passing 30.
  const headroom = 30 - (total - current.level);

  return (
    <>
      {classes.length > 1 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }} role="tablist">
          {classes.map((c) => {
            const on = c.name === current.name;
            return (
              <button key={c.name} role="tab" aria-selected={on} className="forge-btn"
                onClick={() => onClassTab(c.name)}
                style={{ ...stoneButton(on ? "primary" : "stone"), fontSize: 13, padding: "8px 14px" }}>
                {c.name} {c.level}
              </button>
            );
          })}
          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11.5, color: C.sun,
            marginLeft: "auto", alignSelf: "center" }}>
            character level {total} of 30
          </span>
        </div>
      )}

      <div style={{ ...stonePanel(), marginBottom: 14 }}>
        <PanelTitle hint={current.primary
          ? "Your first class. Its hit die and saving throws are the ones you started with."
          : "A class taken later. Only the first class contributes a full hit die."}>
          {current.name}
        </PanelTitle>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 14 }}>
          <div>
            <label style={forgeLabel}>Level {current.level}</label>
            <input aria-label={`Level in ${current.name}`} type="range" min={1} max={Math.max(1, headroom)} value={current.level}
              onChange={(e) => onLevel(current.name, Number(e.target.value))}
              style={{ width: "100%" }} />
            <div style={{ display: "flex", justifyContent: "space-between",
              fontFamily: FORGE_FONTS.mono, fontSize: 10.5, color: STONE.inkFaint }}>
              <span>1</span>
              <span>{Math.max(1, headroom)}{headroom < 30 ? " (cap)" : ""}</span>
            </div>
          </div>

          <Field label="Subclass" value={current.subclass}
            onChange={(v) => onSubclass(current.name, v)}
            options={subclassFor(current.name)}
            placeholder="No subclass yet" />
        </div>

        {!current.primary && (
          <button onClick={() => { onRemove(current.name); onClassTab(""); }}
            style={{ ...stoneButton("ghost"), fontSize: 12, padding: "6px 11px", marginTop: 8,
              color: C.warn }}>
            Remove {current.name}
          </button>
        )}
      </div>

      <ClassProgressionPanel
        className={current.name} level={current.level}
        progression={classProgression(classRecFor(current.name), current.level)}
        epicRows={current.primary ? epicRows : []}
        classRec={classRecFor(current.name)}
        structuredRec={structuredFor(current.name)}
      />

      <ClassChoicesPanel
        build={{ ...build, meta: { ...build.meta, className: current.name, subclass: current.subclass },
          level: current.level } as Build}
        sheet={sheet} weapons={weapons} spells={spells} feats={feats}
        structuredRec={structuredFor(current.name)} edition={edition}
        picks={picks} onPick={onPick}
      />

      {/* ASIs are granted PER CLASS at its own 4/8/12/16/19, so a Fighter 4 / Rogue 4 has two. The
          panel is handed this class's ladder rather than the character's total level, which would
          have given one ladder counted from a number neither class reached. */}
      <FeatsPanel
        asiLevels={asiLevelsUpTo(classRecFor(current.name), current.level)}
        choices={build.epicChoices || {}}
        featList={feats} level={current.level} onChoose={onChoose}
      />
    </>
  );
}


/**
 * The menus a character picks from mid-turn: Cunning Strike, Open Hand Technique and the like.
 *
 * REFERENCE, NOT A PICKER. These are decided on the hit and differently on the next one, so there
 * is nothing to store and nothing to spend. What a player needs at the table is the list itself,
 * where they are already sitting when the question comes up.
 *
 * Collapsed by default: a level 14 rogue has six options across two menus and none of them is
 * needed until a hit lands, so opening the Roll tab should not start with a wall of rules text.
 */
function MenuPanel({ menus }: { menus: ClassMenu[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (menus.length === 0) return null;

  return (
    <div style={{ ...stonePanel(), marginBottom: 14 }}>
      <PanelTitle hint="Chosen when you use them, not when you build.">On a hit</PanelTitle>
      <div style={{ display: "grid", gap: 6 }}>
        {menus.map((m) => {
          const isOpen = open === m.name;
          return (
            <div key={m.name} style={{ background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "9px 11px" }}>
              <button onClick={() => setOpen(isOpen ? null : m.name)}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0,
                  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 13.5, color: STONE.ink }}>{m.name}</span>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint }}>
                  {m.options.length} options {isOpen ? "-" : "+"}
                </span>
              </button>
              {isOpen && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 12.5, color: STONE.inkDim, margin: "0 0 8px", lineHeight: 1.55 }}>
                    {m.when}
                  </p>
                  <div style={{ display: "grid", gap: 5 }}>
                    {m.options.map((o) => (
                      <div key={o.name} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, color: C.sun, minWidth: 92 }}>{o.name}</span>
                        {o.cost && (
                          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: C.plum }}>
                            {o.cost}
                          </span>
                        )}
                        <span style={{ fontSize: 12.5, color: STONE.inkDim, flex: 1, lineHeight: 1.5 }}>
                          {o.summary}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FontsAndCss() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap"
        rel="stylesheet"
      />
      <style>{FORGE_BUTTON_CSS}</style>
    </>
  );
}

function Header() {
  return (
    <header style={{ textAlign: "center", margin: "10px 0 6px" }}>
      <h1 style={{ ...forgeHeading, fontSize: 40, margin: 0 }}>THE FORGE</h1>
      <p style={{ color: STONE.inkDim, fontStyle: "italic", fontSize: 17, marginTop: 4 }}>
        where characters are hammered into shape
      </p>
      <Rule />
    </header>
  );
}

function Rule() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "26px 0" }}>
      <span style={forgeRuleLine} />
      <span style={forgeBoss} />
      <span style={{ ...forgeRuleLine, transform: "scaleX(-1)" }} />
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ textAlign: "center", color: STONE.inkDim, fontSize: 15, lineHeight: 1.65, marginTop: 30 }}>{children}</p>;
}

function PanelTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={forgePanelTitle}>{children}</h2>
      {hint && <p style={{ color: STONE.inkFaint, fontSize: 14, marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

// A description block: the composed "lead" line always shows; longer prose (body) reveals on click.
// Used for species, background, and gear so a picker explains what a choice actually does.
function DescBlock({ title, desc, compact }: { title?: string; desc: Described; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasBody = !!desc.body;
  return (
    <div style={{
      padding: compact ? "8px 12px" : "10px 14px", borderRadius: 4,
      background: "linear-gradient(180deg, rgba(14,11,8,0.5), rgba(40,36,30,0.4))",
      boxShadow: "inset 0 1px 0 rgba(255,230,190,0.05), inset 0 0 0 1px rgba(0,0,0,0.3)",
    }}>
      {title && (
        <div style={{ fontFamily: FORGE_FONTS.display, fontSize: 14, color: STONE.brassHi, marginBottom: 3 }}>{title}</div>
      )}
      <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12.5, color: STONE.inkDim, lineHeight: 1.5 }}>{desc.lead}</div>
      {hasBody && open && (
        <p style={{ fontFamily: FORGE_FONTS.body, fontSize: 14, color: STONE.ink, lineHeight: 1.55, marginTop: 8 }}>
          {desc.body}
        </p>
      )}
      {hasBody && (
        <button onClick={() => setOpen((v) => !v)}
          style={{ marginTop: 6, background: "none", border: "none", cursor: "pointer",
            fontFamily: FORGE_FONTS.mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
            color: SAX.brass, padding: 0 }}>
          {open ? "Hide details −" : "Details +"}
        </button>
      )}
    </div>
  );
}

// A carved dropdown (stoneField + a brass chevron).

export type PickerFilter = {
  label: string;
  /** The distinct values, in the order they should appear. Computed by the caller. */
  values: string[];
  /** Which of a row's values this filter tests against. */
  test: (row: PickerRow, value: string) => boolean;
};

export type PickerRow = { name: string; hint?: string; [k: string]: unknown };

/**
 * A searchable, filterable replacement for a plain dropdown.
 *
 * WHY NOT JUST A LONGER <select>
 *   123 backgrounds, 223 feats, 249 magic items. A native dropdown of 223 names is a scroll with no
 *   way to narrow it, and the thing a player is doing - "show me the feats that raise Dexterity" -
 *   is not expressible in one at all.
 *
 * WHAT IT DELIBERATELY KEEPS
 *   The current value is ALWAYS visible and always clearable, even when a filter would exclude it.
 *   A picker that hides what you already chose because you then typed in the search box makes it
 *   look like the choice was lost, and the recovery - clear the search - is not obvious when the
 *   thing you want to check has vanished.
 *
 * WHAT IT DOES NOT DO
 *   It does not virtualise. The largest list here is 335 spells and these render as plain buttons;
 *   the monster picker needed windowing at 3,210 and this does not.
 */
function PickerField({
  label, value, onChange, rows, filters, placeholder, maxHeight = 300,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: PickerRow[];
  filters?: PickerFilter[];
  placeholder?: string;
  maxHeight?: number;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  const shown = useMemo(() => {
    return rows.filter((r) => {
      if (!textMatches(`${r.name} ${r.hint || ""}`, q)) return false;
      for (const f of filters || []) {
        const v = active[f.label];
        if (v && !f.test(r, v)) return false;
      }
      return true;
    });
  }, [rows, q, active, filters]);

  const anyFilter = Object.values(active).some(Boolean) || q.trim().length > 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={forgeLabel}>{label}</label>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <input aria-label={value || placeholder || `Search ${label.toLowerCase()}`} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={value || placeholder || `Search ${label.toLowerCase()}`}
          style={{ ...stoneField(), flex: "1 1 200px", width: "auto", fontSize: 13.5, padding: "9px 11px" }} />
        {(filters || []).map((f) => (
          <select aria-label={f.label} key={f.label} value={active[f.label] || ""}
            onChange={(e) => { setActive((a) => ({ ...a, [f.label]: e.target.value })); setOpen(true); }}
            style={{ ...stoneField(), width: "auto", minWidth: 130, fontSize: 13, padding: "9px 10px" }}>
            <option value="" style={OPTION_STYLE}>{f.label}</option>
            {f.values.map((v) => <option key={v} value={v} style={OPTION_STYLE}>{v}</option>)}
          </select>
        ))}
        {anyFilter && (
          <Button onClick={() => { setQ(""); setActive({}); }}
            style={{ fontSize: 12.5, padding: "8px 12px" }}>Clear</Button>
        )}
      </div>

      {/* The current pick, outside the filtered list so narrowing can never hide it. */}
      {value && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <span style={{ ...stoneChip(), fontSize: 13, background: "rgba(200,162,75,0.16)", color: C.sun }}>
            {value}
          </span>
          <button onClick={() => onChange("")}
            style={{ background: "transparent", border: "none", cursor: "pointer",
              color: STONE.inkFaint, fontSize: 12, fontFamily: FORGE_FONTS.mono }}>
            clear
          </button>
        </div>
      )}

      {(open || anyFilter) && (
        <>
          <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint, marginBottom: 4 }}>
            {shown.length} of {rows.length}
          </div>
          <div style={{ maxHeight, overflowY: "auto", display: "grid", gap: 3, paddingRight: 4 }}>
            {shown.map((r) => (
              <button key={r.name} className="forge-btn"
                onClick={() => { onChange(r.name); setQ(""); setOpen(false); }}
                style={{ ...stoneButton(r.name === value ? "primary" : "stone"),
                  textAlign: "left", fontSize: 13, padding: "8px 11px",
                  display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>{r.name}</span>
                {r.hint && (
                  <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint,
                    flexShrink: 0, maxWidth: "50%", overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap" }}>
                    {r.hint}
                  </span>
                )}
              </button>
            ))}
            {shown.length === 0 && (
              <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "6px 0" }}>
                Nothing matches. Clear a filter or widen the search.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, onChange, options, placeholder, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; placeholder?: string; disabled?: boolean;
}) {
  // A stored value the list does not hold (an imported "Light Domain" where the catalog says "Light",
  // "Aberrant Sorcery" where it says "Aberrant Mind") is shown as it is, first, instead of the select
  // falling back to the placeholder and looking unset.
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <div style={{ marginBottom: 16, position: "relative" }}>
      <label style={forgeLabel}>{label}</label>
      <select aria-label="Choose" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        style={{ ...stoneField(), opacity: disabled ? 0.5 : 1 }}>
        <option value="" style={OPTION_STYLE}>{placeholder || `Choose ${label.toLowerCase()}`}</option>
        {opts.map((o) => <option key={o} value={o} style={OPTION_STYLE}>{o}</option>)}
      </select>
      <span style={{ position: "absolute", right: 14, bottom: 14, fontSize: 9, color: SAX.brass, pointerEvents: "none" }}>▼</span>
    </div>
  );
}

function IdentityPanel(props: {
  build: Build; speciesVariant: string;
  edition: Edition; onEdition: (e: Edition) => void;
  partners: string[]; enabledPartners: Set<string>; onTogglePartner: (p: string) => void;
  speciesOpts: { name: string }[]; classOpts: { name: string }[];
  variantOpts: { name: string; variant_kind: string }[]; subclassOpts: string[];
  backgroundRows: BackgroundRecord[];
  heldClasses: string[];
  onAddClass: (cn: string) => void;
  /** Absent when one already exists, or on a library build with no campaign to put one in. */
  onAddAlter?: () => void;
  /** Whether to show the section at all, and what to say when the button is not available. */
  showAlterEgo: boolean;
  alterEgoReason: string;
  speciesDesc: Described | null; backgroundDesc: Described | null; subclassRoleTags: string[];
  catalogReady: boolean;
  epic: { abilityCap: number; asiCount: number; epicFeatCount: number };
  onSpecies: (v: string) => void; onVariant: (v: string) => void; onBackground: (v: string) => void;
  onClassName: (v: string) => void; onSubclass: (v: string) => void;
}) {
  const {
    build, speciesVariant, edition, onEdition, partners, enabledPartners, onTogglePartner,
    speciesOpts, classOpts, variantOpts, subclassOpts, backgroundRows, heldClasses, onAddClass, onAddAlter, showAlterEgo, alterEgoReason,
    speciesDesc, backgroundDesc,
    subclassRoleTags, catalogReady, epic,
    onSpecies, onVariant, onBackground, onClassName, onSubclass,
  } = props;
  const [adding, setAdding] = useState("");

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Who this character is. Content comes from your campaign catalog; toggle partners to widen it.">Identity</PanelTitle>

      {/* Ruleset toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ ...forgeLabel, marginBottom: 0 }}>Rules</span>
        {(["2024", "2014", "both"] as Edition[]).map((e) => {
          const on = edition === e;
          return (
            <button key={e} className={`forge-btn ${on ? "is-primary" : "is-ghost"}`}
              style={{ ...stoneButton(on ? "primary" : "ghost"), padding: "6px 14px", fontSize: 12 }}
              onClick={() => onEdition(e)}>
              {e === "both" ? "Both" : e}
            </button>
          );
        })}
      </div>

      {/* Partner chips */}
      {partners.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <label style={forgeLabel}>Partnered content (off by default)</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {partners.map((p) => {
              const on = enabledPartners.has(p);
              return (
                <button key={p} onClick={() => onTogglePartner(p)}
                  style={{
                    ...stoneChip(on ? "brass" : "moss"),
                    cursor: "pointer", border: "none",
                    opacity: on ? 1 : 0.62,
                    color: on ? STONE.brassHi : STONE.inkDim,
                  }}>
                  {on ? "◆" : "◇"} {p}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!catalogReady && (
        <p role="status" style={{ color: STONE.inkFaint, fontSize: 13, marginBottom: 12 }}>Loading the catalog&hellip;</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Field label="Species" value={build.meta.species}
          onChange={onSpecies} options={speciesOpts.map((s) => s.name)} />
        <Field label={variantOpts[0]?.variant_kind === "lineage" ? "Lineage" : "Subrace"}
          value={speciesVariant} onChange={onVariant}
          options={variantOpts.map((v) => v.name)}
          placeholder={variantOpts.length ? "Choose one" : "None for this species"}
          disabled={variantOpts.length === 0} />
        <Field label="Class" value={build.meta.className}
          onChange={onClassName} options={classOpts.map((c) => c.name)} />
        <Field label="Subclass" value={build.meta.subclass}
          onChange={onSubclass} options={subclassOpts}
          placeholder={build.meta.className ? "Choose subclass" : "Choose a class first"}
          disabled={!build.meta.className} />
      </div>

      {/* Full width, because it carries a search box and two filters and would be cramped in the
          three-up grid the other pickers share. */}
      <PickerField label="Background" value={build.meta.background} onChange={onBackground}
        placeholder="Search backgrounds"
        rows={backgroundRows.map((b) => ({
          name: b.name,
          hint: [b.feat, b.ability_scores].filter(Boolean).join(" \u00b7 "),
          feat: b.feat, abilities: backgroundAbilities(b.ability_scores),
        }))}
        filters={[
          {
            label: "Origin feat",
            values: Array.from(new Set(backgroundRows.map((b) => b.feat).filter(Boolean) as string[])).sort(),
            test: (r, v) => r.feat === v,
          },
          { label: "Ability", values: [...ABILITY_NAMES],
            test: (r, v) => (r.abilities as string[] | undefined)?.includes(v) ?? false },
        ]} />

      {/* Descriptions of the current species / background, so the pickers explain themselves. */}
      {(speciesDesc || backgroundDesc) && (
        <div style={{ marginTop: 4, marginBottom: 8, display: "grid", gap: 10 }}>
          {speciesDesc && build.meta.species && (
            <DescBlock title={build.meta.species} desc={speciesDesc} />
          )}
          {backgroundDesc && build.meta.background && (
            <DescBlock title={build.meta.background} desc={backgroundDesc} />
          )}
        </div>
      )}

      {/* Subclass tactical role, from the catalog. Labeled as ROLE, not a rules description: the
          catalog has no prose, so we surface what it truthfully has: how the subclass plays. */}
      {build.meta.subclass && subclassRoleTags.length > 0 && (
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, letterSpacing: "0.12em",
            textTransform: "uppercase", color: STONE.inkFaint }}>
            {build.meta.subclass} plays as
          </span>
          {subclassRoleTags.map((t) => (
            <span key={t} style={stoneChip("moss")}>{t.replace(/_/g, " ")}</span>
          ))}
        </div>
      )}

      {/* Level lives on the Class tab now, one slider per class. Keeping a second copy here would
          mean a multiclass character had their Fighter level in one place and their Monk level in
          another, which is the disconnect the sub-tabs exist to remove. */}
      <div style={{ marginTop: 10, paddingTop: 12, borderTop: `1px solid ${STONE.hi}` }}>
        <label style={forgeLabel}>Classes</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select aria-label="Class to add" value={adding} onChange={(e) => setAdding(e.target.value)}
            style={{ ...stoneField(), width: "auto", minWidth: 180, padding: "8px 10px", fontSize: 13 }}>
            <option value="" style={OPTION_STYLE}>Add another class&hellip;</option>
            {classOpts.map((c) => c.name)
              .filter((n) => n !== build.meta.className && !heldClasses.includes(n))
              .map((n) => <option key={n} value={n} style={OPTION_STYLE}>{n}</option>)}
          </select>
          <button className="forge-btn" disabled={!adding || !build.meta.className}
            title={!build.meta.className ? "Choose a first class above, then add another" : !adding ? "Pick a class in the list first" : undefined}
            onClick={() => { onAddClass(adding); setAdding(""); }}
            style={{ ...stoneButton("primary"), fontSize: 12.5,
              opacity: adding && build.meta.className ? 1 : 0.45 }}>
            Add
          </button>
        </div>
        <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "8px 0 0", lineHeight: 1.5 }}>
          {build.meta.className
            ? "Set each class's level and subclass on the Class tab. Levels total 30 at most."
            : "Pick a first class above before adding another."}
        </p>
      </div>

      {/* ALTER EGO belongs here rather than on Finish: it is a fact about WHO this character is,
          alongside species and class, not a box left unticked. Finish asks "what have I not done
          yet", and adding a second character is not a gap to close. */}
      {showAlterEgo && (
        <div style={{ marginTop: 10, paddingTop: 12, borderTop: `1px solid ${STONE.hi}` }}>
          <label style={forgeLabel}>Alter ego</label>
          <p style={{ fontSize: 12.5, color: STONE.inkDim, margin: "0 0 10px", lineHeight: 1.6 }}>
            Another character this one becomes: a changeling&rsquo;s other faces, a curse that takes
            over, a shape you are forced into. Each gets its own sheet, its own class and level, and
            you switch between them at the top of this page. Up to ten.
          </p>
          {onAddAlter ? (
            <>
              <Button onClick={onAddAlter}
                style={{ fontSize: 12.5 }}>
                Add an alter ego
              </Button>
              <p style={{ fontSize: 11.5, color: STONE.inkFaint, margin: "8px 0 0", lineHeight: 1.5 }}>
                Recording and events stay on this character, whichever sheet is open. Your GM sees
                both on the Roster.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: 0, lineHeight: 1.55 }}>
              {alterEgoReason}
            </p>
          )}
        </div>
      )}
        {build.level > 20 && (
          <div style={{ marginTop: 10 }}>
            <span style={stoneChip("brass")}>Epic tier</span>
            <span style={stoneChip("brass")}>{epic.asiCount} ability boosts</span>
            <span style={stoneChip("brass")}>{epic.epicFeatCount} epic feats</span>
            <span style={stoneChip("moss")}>Ability cap {epic.abilityCap}</span>
          </div>
        )}
    </div>
  );
}


/**
 * How the six scores get decided: by hand, from the standard array, by point buy, or rolled.
 *
 * THREE MODELS, NOT ONE
 *   Array and Roll hand you a POOL and ask where each value goes; every value is used exactly once.
 *   Point buy gives a BUDGET with a non-linear cost curve and a ceiling of 15. Manual is neither.
 *   The rules live in lib/ability-gen so this component only has to render them.
 *
 * IT WRITES THROUGH TO THE BUILD IMMEDIATELY
 *   There is no "apply" step. A half-assigned array is a legitimate state to leave a character in,
 *   and holding the scores hostage in local state until the pool is full would mean a refresh loses
 *   them - which is exactly the kind of thing a builder should never do.
 */
function AbilityGenerator({ build, onAbility, onMany }: {
  build: Build;
  onAbility: (a: Ability, v: number) => void;
  onMany: (scores: Partial<Record<AbilityKey, number>>) => void;
}) {
  const [mode, setMode] = useState<GenMode>("manual");
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [rolled, setRolled] = useState(false);

  const scores = build.abilities as Partial<Record<AbilityKey, number>>;
  const spent = pointsSpent(scores);
  const left = POINT_BUDGET - spent;

  const startArray = () => {
    setMode("array"); setRolled(false);
    setPool(makePool(STANDARD_ARRAY));
  };

  const rollNew = () => {
    // 4d6 keep highest 3, six times, through the same crypto-backed roller the dice tab uses. A
    // Math.random array would be the one set of numbers on the sheet that nobody could vouch for.
    const vals = Array.from({ length: 6 }, () => rollDice("4d6kh3").total).sort((a, b) => b - a);
    setMode("roll"); setRolled(true);
    setPool(makePool(vals));
  };

  const place = (index: number, k: AbilityKey) => {
    const next = poolAssign(pool, index, k);
    setPool(next);
    onMany(poolScores(next));
  };

  const lift = (index: number) => {
    const freed = pool[index]?.assignedTo;
    const next = poolUnassign(pool, index);
    setPool(next);
    // The ability it came off goes back to 8 rather than keeping a value it no longer has any claim
    // to; leaving the old number sitting there reads as though it were still assigned.
    if (freed) onAbility(freed as Ability, POINT_MIN);
    onMany(poolScores(next));
  };

  const usingPool = mode === "array" || mode === "roll";

  return (
    <div style={{ marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid ${STONE.hi}` }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <button className="forge-btn" onClick={() => setMode("manual")}
          style={{ ...stoneButton(mode === "manual" ? "primary" : "stone"), fontSize: 12.5 }}>By hand</button>
        <button className="forge-btn" onClick={startArray}
          style={{ ...stoneButton(mode === "array" ? "primary" : "stone"), fontSize: 12.5 }}>Standard array</button>
        <button className="forge-btn" onClick={() => { setMode("point"); onMany(pointBuyReset()); }}
          style={{ ...stoneButton(mode === "point" ? "primary" : "stone"), fontSize: 12.5 }}>Point buy</button>
        <button className="forge-btn" onClick={rollNew}
          style={{ ...stoneButton(mode === "roll" ? "primary" : "stone"), fontSize: 12.5 }}>
          {mode === "roll" && rolled ? "Roll again" : "Roll"}
        </button>
      </div>

      {mode === "manual" && (
        <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: 0, lineHeight: 1.55 }}>
          Type whatever you like below. Nothing is checked, which is right for a character copied
          from paper or handed to you by a GM.
        </p>
      )}

      {mode === "point" && (
        <div>
          <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap",
            fontFamily: FORGE_FONTS.mono, fontSize: 12.5, marginBottom: 8 }}>
            <span style={{ color: left === 0 ? C.good : left < 0 ? C.warn : C.sun }}>
              {left} of {POINT_BUDGET} points left
            </span>
            <span style={{ color: STONE.inkFaint }}>each score {POINT_MIN} to {POINT_MAX}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px,1fr))", gap: 6 }}>
            {ABILITIES.map((a) => {
              const k = a as AbilityKey;
              const v = scores[k] ?? POINT_MIN;
              return (
                <div key={a} style={{ background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "8px 10px",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint }}>
                    {a.toUpperCase()}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => canLower(scores, k) && onAbility(a, v - 1)}
                      disabled={!canLower(scores, k)} aria-label={`Lower ${a}`}
                      title={!canLower(scores, k) ? `${POINT_MIN} is the lowest a point-buy score goes` : undefined}
                      style={{ ...stoneButton("ghost"), padding: "2px 8px", fontSize: 14,
                        opacity: canLower(scores, k) ? 1 : 0.3 }}>&minus;</button>
                    <span style={{ fontSize: 16, color: STONE.ink, minWidth: 20, textAlign: "center" }}>{v}</span>
                    <button onClick={() => canRaise(scores, k) && onAbility(a, v + 1)}
                      disabled={!canRaise(scores, k)} aria-label={`Raise ${a}`}
                      title={!canRaise(scores, k) ? (v < POINT_MAX ? "Not enough points left" : `${POINT_MAX} is the highest a point-buy score goes`) : undefined}
                      style={{ ...stoneButton("ghost"), padding: "2px 8px", fontSize: 14,
                        opacity: canRaise(scores, k) ? 1 : 0.3 }}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {usingPool && pool.length > 0 && (
        <div>
          <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: "0 0 8px", lineHeight: 1.55 }}>
            {poolComplete(pool)
              ? "All six placed. Tap a value to lift it off again."
              : "Tap a value, then the ability it belongs to."}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {pool.map((e, i) => (
              <div key={`${e.value}-${i}`} style={{
                background: e.assignedTo ? "rgba(200,162,75,0.16)" : "rgba(0,0,0,0.28)",
                border: `1px solid ${e.assignedTo ? C.sun : STONE.hi}`,
                borderRadius: 4, padding: "6px 9px", display: "flex", alignItems: "center", gap: 7,
              }}>
                <span style={{ fontSize: 16, color: e.assignedTo ? C.sun : STONE.ink }}>{e.value}</span>
                {e.assignedTo ? (
                  <button onClick={() => lift(i)}
                    style={{ background: "transparent", border: "none", cursor: "pointer",
                      color: STONE.inkFaint, fontSize: 11, fontFamily: FORGE_FONTS.mono }}>
                    {e.assignedTo.toUpperCase()} &times;
                  </button>
                ) : (
                  <select aria-label="Put this score in" value="" onChange={(ev) => ev.target.value && place(i, ev.target.value as AbilityKey)}
                    style={{ ...stoneField(), width: "auto", fontSize: 11.5, padding: "3px 6px" }}>
                    <option value="">to&hellip;</option>
                    {ABILITIES.map((a) => (
                      <option key={a} value={a} style={OPTION_STYLE}>{a.toUpperCase()}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AbilitiesPanel({ build, cap, sheet, onAbility, onMany }: {
  build: Build; cap: number;
  sheet: NonNullable<ReturnType<typeof deriveSheet>>;
  onAbility: (a: Ability, v: number) => void;
  onMany: (scores: Partial<Record<AbilityKey, number>>) => void;
}) {
  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Base scores. Species, background, and gear can raise these, and the effective value shows below each.">Ability scores</PanelTitle>
      <AbilityGenerator build={build} onAbility={onAbility} onMany={onMany} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px,1fr))", gap: 14 }}>
        {ABILITIES.map((a) => {
          const eff = sheet.abilities[a];
          const changed = eff !== build.abilities[a];
          return (
            <div key={a} style={statTile()}>
              <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10, letterSpacing: "0.2em",
                textTransform: "uppercase", color: STONE.inkFaint, marginBottom: 6 }}>{a}</div>
              <input aria-label={`${a.toUpperCase()} score`} type="number" min={1} max={cap} value={build.abilities[a]}
                onChange={(e) => onAbility(a, parseInt(e.target.value, 10))}
                style={{ width: 56, textAlign: "center", fontFamily: FORGE_FONTS.mono, fontSize: 20,
                  color: STONE.ink, background: "rgba(0,0,0,0.35)", border: "none", borderRadius: 3,
                  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.7)", padding: "4px 0" }} />
              <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, marginTop: 6,
                color: changed ? STONE.brassHi : STONE.inkDim }}>
                {changed ? `→ ${eff}` : ""} ({fmtMod(sheet.mods[a])})
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Shows what the class grants at each level, up to the character's current level. Each level is a
// row; features reveal their description on tap. ASI levels are flagged (the picker that lets you
// spend them is a separate, later build).
function ClassProgressionPanel({ className, level, progression, epicRows, classRec, structuredRec }: {
  className: string; level: number; progression: LevelGroup[]; epicRows: LevelGroup[];
  classRec: ClassRecord | undefined;
  structuredRec?: unknown;
}) {
  // The progression table, from the fetched data. Absent for a class the fetch did not cover, and
  // the panel simply does not draw it - the feature list below has always been the substance and
  // this is the numbers beside it.
  const table = useMemo(() => classTable(structuredRec), [structuredRec]);
  const cols = useMemo(() => classTableColumns(table), [table]);
  // Just the current level by default. Even capped at the character's level, sixteen rows of a
  // table whose only changing numbers are two columns is a wall to scroll past on the way to the
  // features, and the row a player wants is almost always the one they are on.
  const [fullTable, setFullTable] = useState(false);
  const shownRows = useMemo(() => {
    const upto = table.filter((r) => r.level <= Math.max(1, level));
    return fullTable ? upto : upto.slice(-1);
  }, [table, level, fullTable]);

  const meta = [
    classRec?.hit_die ? `Hit die d${String(classRec.hit_die).replace(/^d/i, "")}` : null,
    classRec?.primary_ability ? `Primary: ${classRec.primary_ability}` : null,
    classRec?.saving_throws ? `Saves: ${classRec.saving_throws}` : null,
  ].filter(Boolean).join("  ·  ");

  const tableBlock = cols.length > 0 && shownRows.length > 0 ? (
    <div style={{ marginBottom: 16 }}>
      {table.length > 1 && (
        <Button onClick={() => setFullTable((v) => !v)}
          style={{ fontSize: 12, padding: "5px 11px", marginBottom: 6 }}>
          {fullTable ? "Just this level" : `Show all ${Math.min(table.length, Math.max(1, level))} levels`}
        </Button>
      )}
      <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "right" }}>Lvl</th>
            {cols.map((c) => <th key={c} style={thStyle}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {shownRows.map((r) => {
            const here = r.level === level;
            return (
              <tr key={r.level} style={{ background: here ? "rgba(200,162,75,0.12)" : undefined }}>
                <td style={{ ...tdStyle, textAlign: "right", color: here ? C.sun : STONE.inkDim }}>
                  {r.level}
                </td>
                {cols.map((c) => (
                  <td key={c} style={{ ...tdStyle, color: here ? STONE.ink : STONE.inkDim }}>
                    {r.columns[c] || "-"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  ) : null;

  const renderRow = (grp: LevelGroup) => (
    <div key={grp.level} style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 12, alignItems: "start" }}>
      <div style={{ fontFamily: FORGE_FONTS.display, fontSize: 18, color: STONE.brassHi, textAlign: "right", paddingTop: 2 }}>
        {grp.level}
      </div>
      <div style={{ display: "grid", gap: 6, borderLeft: `1px solid ${STONE.mortar}`, paddingLeft: 12 }}>
        {grp.features.map((f, i) => (
          <FeatureLine key={`${f.name}-${i}`} name={f.name} desc={f.desc}
            asi={/ability score improvement/i.test(f.name)} />
        ))}
      </div>
    </div>
  );

  return (
    <div style={stonePanel()}>
      <PanelTitle hint={`Everything ${className} grants through level ${level}. Tap a feature to read it.`}>
        {className} progression
      </PanelTitle>

      {meta && (
        <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color: STONE.inkDim, marginBottom: 14 }}>{meta}</div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {tableBlock}
      {progression.map(renderRow)}
      </div>

      {epicRows.length > 0 && (
        <>
          <div style={{ ...forgeLabel, marginTop: 20, marginBottom: 10, color: SAX.brass }}>
            Epic tiers (21-30)
          </div>
          <p style={{ color: STONE.inkFaint, fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>
            Published class tables end at 20. Past that, advancement comes from the epic framework, higher proficiency, ability increases, and epic boons, rather than new class features.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {epicRows.map(renderRow)}
          </div>
        </>
      )}
    </div>
  );
}

// One class feature: name always shows; description reveals on tap. ASI features get a brass tag
// (a hint that this level carries an ability-or-feat choice, which the picker will handle later).
function FeatureLine({ name, desc, asi }: { name: string; desc: string; asi?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDesc = !!desc;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => hasDesc && setOpen((v) => !v)}
          style={{
            background: "none", border: "none", padding: 0, textAlign: "left",
            cursor: hasDesc ? "pointer" : "default",
            fontFamily: FORGE_FONTS.body, fontSize: 15.5, color: STONE.ink,
          }}>
          {name}{hasDesc ? <span style={{ color: SAX.brass, fontSize: 11, marginLeft: 6 }}>{open ? "−" : "+"}</span> : null}
        </button>
        {asi && <span style={stoneChip("brass")}>ability or feat</span>}
      </div>
      {open && hasDesc && (
        <p style={{ fontFamily: FORGE_FONTS.body, fontSize: 13.5, color: STONE.inkDim, lineHeight: 1.55, margin: "5px 0 2px" }}>
          {desc}
        </p>
      )}
    </div>
  );
}

// The ASI / feat picker. One slot per ASI level the character has reached. Each slot lets the
// player take an ability-score increase (+2 to one, or +1 to two) OR a feat. The choice writes into
// build.epicChoices[level], which the engine reads: ability mods raise the score, a feat's name
// shows on the sheet (and any structured mods it carries apply). Feats without machine-readable
// effects still record and display, they just don't move numbers until that effect is authored.
function FeatsPanel({ asiLevels, choices, featList, level, onChoose }: {
  asiLevels: number[];
  choices: Record<number, EpicChoice[]>;
  featList: FeatOption[];
  level: number;
  onChoose: (level: number, choice: EpicChoiceInput | null) => void;
}) {
  // Epic Boon opportunities: level 19 (the class Epic Boon feature) plus the epic-feat levels
  // 21/25/29. Each takes an Epic Boon feat (a distinct pool from ordinary feats). Keyed above the
  // level-1000 offset so an epic-boon choice at level 19 never collides with an ASI at 19.
  const EPIC_BOON_LEVELS = [19, 21, 25, 29].filter((l) => l <= level);
  const epicBoons = useMemo(() => featList.filter((f) => f.category === "Epic Boon"), [featList]);

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="At each of these levels you take an ability score increase or a feat. Ability increases flow into the sheet; a feat with a known bonus applies its increase too.">
        Ability increases &amp; feats
      </PanelTitle>
      <div style={{ display: "grid", gap: 14 }}>
        {asiLevels.map((level) => (
          <AsiSlot key={level} level={level} choice={choices[level]?.[0]} featList={featList}
            onChoose={(c) => onChoose(level, c)} />
        ))}
      </div>

      {EPIC_BOON_LEVELS.length > 0 && (
        <>
          <div style={{ ...forgeLabel, marginTop: 22, marginBottom: 10, color: SAX.brass }}>Epic Boons</div>
          <div style={{ display: "grid", gap: 14 }}>
            {EPIC_BOON_LEVELS.map((lvl) => (
              <BoonSlot key={`boon-${lvl}`} level={lvl} choice={choices[1000 + lvl]?.[0]}
                boons={epicBoons} onChoose={(c) => onChoose(1000 + lvl, c)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// An epic-boon slot: choose an Epic Boon feat (level 19+). Uses the same FeatEditor, restricted to
// the boon pool. Stored at level key 1000+level so it doesn't collide with the ASI at the same
// level; the engine reads all epicChoices keys regardless of the offset.
function BoonSlot({ level, choice, boons, onChoose }: {
  level: number; choice: EpicChoiceInput | undefined; boons: FeatOption[];
  onChoose: (choice: EpicChoiceInput | null) => void;
}) {
  return (
    <div style={{ borderLeft: `2px solid ${STONE.mortar}`, paddingLeft: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: FORGE_FONTS.display, fontSize: 16, color: STONE.brassHi }}>Level {level}</span>
        <span style={stoneChip("brass")}>epic boon</span>
        <span style={{ flex: 1 }} />
        {choice && (
          <Button variant="ghost" style={{ padding: "5px 12px", fontSize: 12 }}
            onClick={() => onChoose(null)}>Clear</Button>
        )}
      </div>
      <FeatEditor choice={choice || { name: "", isFeat: true, desc: "" }} featList={boons} onChoose={onChoose} />
    </div>
  );
}

// One ASI level's choice: a mode toggle (Ability / Feat / clear) plus the matching picker.
function AsiSlot({ level, choice, featList, onChoose }: {
  level: number; choice: EpicChoiceInput | undefined; featList: FeatOption[];
  onChoose: (choice: EpicChoiceInput | null) => void;
}) {
  const mode: "none" | "asi" | "feat" =
    !choice ? "none" : choice.isFeat ? "feat" : "asi";

  return (
    <div style={{ borderLeft: `2px solid ${STONE.mortar}`, paddingLeft: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: FORGE_FONTS.display, fontSize: 16, color: STONE.brassHi }}>Level {level}</span>
        {level >= 21 && <span style={stoneChip("brass")}>epic</span>}
        <span style={{ flex: 1 }} />
        {(["asi", "feat"] as const).map((m) => (
          <button key={m} className={`forge-btn ${mode === m ? "is-primary" : "is-ghost"}`}
            style={{ ...stoneButton(mode === m ? "primary" : "ghost"), padding: "5px 12px", fontSize: 12 }}
            onClick={() => {
              if (m === "asi") onChoose({ name: "Ability Score Improvement", isFeat: false, mods: {} });
              else onChoose({ name: "", isFeat: true, desc: "" });
            }}>
            {m === "asi" ? "Ability +" : "Feat"}
          </button>
        ))}
        {mode !== "none" && (
          <Button variant="ghost" style={{ padding: "5px 12px", fontSize: 12 }}
            onClick={() => onChoose(null)}>Clear</Button>
        )}
      </div>

      {mode === "asi" && <AsiEditor choice={choice as EpicChoiceInput} onChoose={onChoose} />}
      {mode === "feat" && <FeatEditor choice={choice as EpicChoiceInput} featList={featList} onChoose={onChoose} />}
      {mode === "none" && (
        <p style={{ color: STONE.inkFaint, fontSize: 13 }}>Choose an ability increase or a feat.</p>
      )}
    </div>
  );
}

// Ability-score-increase editor: +2 to one ability, or +1 to two. Writes the mods the engine adds
// to the scores.
function AsiEditor({ choice, onChoose }: {
  choice: EpicChoiceInput; onChoose: (c: EpicChoiceInput) => void;
}) {
  const mods = choice.mods || {};
  const total = ABILITIES.reduce((n, a) => n + (mods[a] || 0), 0);
  const set = (a: Ability, v: number) => {
    const next = { ...mods };
    if (v <= 0) delete next[a]; else next[a] = v;
    onChoose({ ...choice, name: "Ability Score Improvement", isFeat: false, mods: next });
  };
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(88px,1fr))", gap: 8 }}>
        {ABILITIES.map((a) => {
          const cur = mods[a] || 0;
          // A given ability can take +1 or +2; total across all abilities must be <= 2.
          const canPlus = total < 2 || cur > 0;
          return (
            <div key={a} style={{ ...statTile(), padding: "8px 6px" }}>
              <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10, letterSpacing: "0.2em",
                textTransform: "uppercase", color: STONE.inkFaint, marginBottom: 5 }}>{a}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Button title={cur <= 0 ? "Nothing to lower" : undefined} variant="ghost" style={{ padding: "2px 9px" }}
                  onClick={() => set(a, cur - 1)} disabled={cur <= 0} aria-label={`Lower ${a}`}>−</Button>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 16, color: cur ? STONE.brassHi : STONE.inkFaint, minWidth: 20 }}>
                  {cur ? `+${cur}` : "none"}
                </span>
                <Button variant="ghost" style={{ padding: "2px 9px" }}
                  onClick={() => set(a, cur + 1)} disabled={!canPlus || cur >= 2} aria-label={`Raise ${a}`}
                  title={cur >= 2 ? "Two is the most one ability can take" : !canPlus ? "No increases left to give" : undefined}>+</Button>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ color: total === 2 ? C.good : STONE.inkFaint, fontSize: 12, marginTop: 8, fontFamily: FORGE_FONTS.mono }}>
        {total}/2 points assigned{total === 2 ? " ✓" : ""}
      </p>
    </div>
  );
}

// Feat editor: pick a feat, see its prerequisite + description. Records the feat by name; a note is
// shown because most feats' mechanical effects aren't structured data yet, so they display but
// don't auto-modify the sheet.
function FeatEditor({ choice, featList, onChoose }: {
  choice: EpicChoiceInput; featList: FeatOption[]; onChoose: (c: EpicChoiceInput) => void;
}) {
  const picked = featList.find((f) => f.name === choice.name);
  const desc = picked ? describeFeat(picked) : null;
  const asi = picked?.asi;

  // Which abilities the feat's increase can go to, and by how much.
  const asiAbilities: Ability[] | null = !asi ? null
    : Array.isArray(asi.choice) ? (asi.choice as Ability[])
    : (asi.any ? [...ABILITIES] : null);   // {any} -> any ability; fixed handled below
  const asiAmount = asi ? (asi.amount || asi.any || firstFixedAmount(asi)) : 0;
  const fixedAbility = asi ? fixedAsiAbility(asi) : null;   // e.g. {str:1} -> "str"

  // The ability currently chosen for a variable increase (stored in choice.mods).
  const chosenAbility = choice.mods
    ? (ABILITIES.find((a) => typeof choice.mods?.[a] === "number") as Ability | undefined)
    : undefined;

  // Push 20 (audit G15): a feat's numeric effects (hit points, speed, AC, initiative) are no longer
  // stored on the choice. The engine counts each feat by name from RulesContext.featEffects, so the
  // numbers stay right when the data changes, and Tough no longer counts twice. Older choices that
  // still carry them are skipped by the engine. Only the ability increase is stored here.
  const featEffectMods = (): Record<string, number> => ({});

  const pickFeat = (name: string) => {
    const f = featList.find((x) => x.name === name);
    const next: EpicChoiceInput = { name, isFeat: true, desc: f?.description || "", mods: { ...featEffectMods() } };
    // Apply a FIXED ability increase immediately; leave variable ones for the ability selector.
    const fa = f?.asi ? fixedAsiAbility(f.asi) : null;
    const amt = f?.asi ? (f.asi.amount || f.asi.any || firstFixedAmount(f.asi)) : 0;
    if (fa && amt) next.mods = { ...next.mods, [fa]: amt };
    onChoose(next);
  };
  const pickAbility = (a: Ability) => {
    // Keep the feat's structured effects; set the chosen ability's increase.
    const base = featEffectMods();
    onChoose({ ...choice, mods: asiAmount ? { ...base, [a]: asiAmount } : base });
  };

  return (
    <div>
      {/* 223 feats in a native dropdown is a scroll with no way to narrow it, and the question a
          player is actually asking - "which of these raise my Dexterity" - cannot be expressed in
          one at all. Same picker as the background field. */}
      <PickerField label="" value={choice.name || ""} onChange={pickFeat}
        placeholder="Search feats"
        rows={featList.map((f) => ({
          name: f.name,
          hint: [
            f.category && f.category !== "Feat" ? f.category : "",
            featAbilities((f as { description?: string }).description).map((a) => a.slice(0, 3).toUpperCase()).join("/"),
          ].filter(Boolean).join(" \u00b7 "),
          category: f.category,
          abilities: featAbilities((f as { description?: string }).description),
        }))}
        filters={[
          { label: "Raises", values: [...ABILITY_NAMES],
            test: (r, v) => (r.abilities as string[] | undefined)?.includes(v) ?? false },
          {
            label: "Category",
            values: Array.from(new Set(featList.map((f) => f.category).filter(Boolean) as string[])).sort(),
            test: (r, v) => r.category === v,
          },
        ]} />

      {/* Ability selector for feats whose increase is player's choice ({any} or {choice:[...]}). */}
      {picked && asiAbilities && asiAmount ? (
        <div style={{ marginTop: 8 }}>
          <label style={forgeLabel}>+{asiAmount} to</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {asiAbilities.map((a) => (
              <button key={a} onClick={() => pickAbility(a)}
                className={`forge-btn ${chosenAbility === a ? "is-primary" : "is-ghost"}`}
                style={{ ...stoneButton(chosenAbility === a ? "primary" : "ghost"), padding: "5px 12px", fontSize: 12 }}>
                {a.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {picked && fixedAbility && asiAmount ? (
        <p style={{ color: C.good, fontSize: 12, marginTop: 8, fontFamily: FORGE_FONTS.mono }}>
          +{asiAmount} {fixedAbility.toUpperCase()} applied
        </p>
      ) : null}

      {picked?.effects ? (
        <p style={{ color: C.good, fontSize: 12, marginTop: 6, fontFamily: FORGE_FONTS.mono }}>
          {[
            picked.effects.hpPerLevel ? `+${picked.effects.hpPerLevel} HP per level` : null,
            picked.effects.speed ? `+${picked.effects.speed} ft speed` : null,
            picked.effects.ac ? `+${picked.effects.ac} AC` : null,
            picked.effects.initiative ? `+${picked.effects.initiative} initiative` : null,
          ].filter(Boolean).join("  ·  ")} applied
        </p>
      ) : null}

      {desc && <div style={{ marginTop: 8 }}><DescBlock desc={desc} compact /></div>}
      {picked && !asi && !picked.effects && (
        <p style={{ color: STONE.inkFaint, fontSize: 12, marginTop: 6, fontStyle: "italic" }}>
          Recorded on your sheet. This feat&rsquo;s other effects are noted here for reference.
        </p>
      )}
    </div>
  );
}

// Helpers for reading the parsed feat asi shape.
function fixedAsiAbility(asi: FeatAsi): Ability | null {
  for (const a of ABILITIES) if (typeof asi[a] === "number") return a;
  return null;
}
function firstFixedAmount(asi: FeatAsi): number {
  for (const a of ABILITIES) if (typeof asi[a] === "number") return asi[a] as number;
  return 0;
}

// A consolidated read-only reference: everything this character HAS, gathered from the sources that
// otherwise show scattered across the Identity and picker panels. Species + lineage traits,
// background, the class features gained (a compact roster, the full per-level view lives in the
// progression panel), and the feats/boons chosen. Honest about data gaps: non-SRD catalog species
// and most lineages carry only a name, so those show the name with a note rather than fake traits.

/**
 * What this character is trained with: weapons, armour, tools, saving throws, and any weapon
 * masteries they have picked.
 *
 * DERIVED, NOT STORED
 *   Every line here already exists somewhere - the class core-traits table, the background's tool
 *   row, the Weapon Mastery picks in build.classChoices. Adding columns to hold a second copy would
 *   mean two things to keep in step and a migration to write, for information that is a render away.
 *
 * IT SHOWS THE GRANT, NOT A COMPUTED TOTAL
 *   "Simple weapons and Martial weapons that have the Finesse or Light property" is a rule, and
 *   turning it into a checked list of forty weapon names would be a worse answer than the sentence.
 *   Where the data IS a list - masteries, tools - it is shown as one.
 */
function ProficiencyBlock({ coreTraits, backgroundRec, masteries }: {
  coreTraits: string;
  backgroundRec: BackgroundRecord | undefined;
  masteries: string[];
}) {
  const core = useMemo(() => parseCoreTraits(coreTraits), [coreTraits]);

  const rows: { label: string; value: string }[] = [];
  if (core.savingThrows) rows.push({ label: "Saving throws", value: core.savingThrows });
  if (core.armor) rows.push({ label: "Armor training", value: core.armor });
  if (core.weapons) rows.push({ label: "Weapons", value: core.weapons });

  // Tools come from two places and are worth keeping apart: a player checking why they can pick a
  // lock wants to know whether it was the class or the background.
  if (core.tools) rows.push({ label: "Tools (class)", value: core.tools });
  if (backgroundRec?.tool_proficiency) {
    rows.push({ label: "Tools (background)", value: backgroundRec.tool_proficiency });
  }
  if (masteries.length) rows.push({ label: "Weapon mastery", value: masteries.join(", ") });

  if (rows.length === 0) return null;

  return (
    <FeatureGroup label="Proficiencies">
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
            <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10.5, letterSpacing: "0.1em",
              textTransform: "uppercase", color: STONE.inkFaint, minWidth: 128, flexShrink: 0 }}>
              {r.label}
            </span>
            <span style={{ fontSize: 13.5, color: STONE.ink, lineHeight: 1.55 }}>{r.value}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: STONE.inkFaint, margin: "10px 0 0", lineHeight: 1.5 }}>
        Skill proficiencies are listed with the skills, where they carry their bonus. These are the
        ones that have no number attached.
      </p>
    </FeatureGroup>
  );
}

function FeaturesPanel({
  species, speciesRec, shownTraits, variantName, variantRec, background, backgroundRec,
  className, classRec, level, chosenFeats, coreTraits, masteries,
}: {
  species: string; speciesRec: SpeciesMechRecord | undefined;
  /** SRD, bundled summary and the player's own traits together (shownSpeciesTraits). */
  shownTraits?: TraitEntry[];
  variantName: string; variantRec: SpeciesVariantRec | undefined;
  background: string; backgroundRec: BackgroundRecord | undefined;
  className: string; classRec: ClassRecord | undefined;
  level: number;
  chosenFeats: { level: number; name: string; desc?: string; category?: string }[];
  coreTraits: string;
  masteries: string[];
}) {
  const speciesTraits = shownTraits ?? traitList(speciesRec?.traits);
  const variantTraits = traitList(variantRec?.traits);
  const bgDesc = describeBackground(backgroundRec);
  // Class features the character has gained, as a compact "level: names" roster.
  const classFeatures = (classRec?.features_by_level || [])
    .filter((f) => f.level <= level)
    .reduce<Record<number, string[]>>((acc, f) => {
      (acc[f.level] = acc[f.level] || []).push(f.name); return acc;
    }, {});
  const classFeatureLevels = Object.keys(classFeatures).map(Number).sort((a, b) => a - b);

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Everything this character has: species and lineage traits, background, class features, and the feats and boons you've taken.">
        Features &amp; traits
      </PanelTitle>

      {/* Proficiencies first: this is the reference block a player checks mid-session, and burying
          it under three groups of prose means scrolling past everything they already know. */}
      <ProficiencyBlock coreTraits={coreTraits} backgroundRec={backgroundRec} masteries={masteries} />

      {/* Species */}
      <FeatureGroup label={species || "Species"}>
        {speciesTraits.length > 0
          ? speciesTraits.map((t, i) => <TraitItem key={i} trait={t} />)
          : <MutedNote>No traits recorded for this species yet. Add your own on the Species tab.</MutedNote>}
      </FeatureGroup>

      {/* Lineage / subrace */}
      {variantName && (
        <FeatureGroup label={`${variantName}${variantRec?.variant_kind ? ` (${variantRec.variant_kind})` : ""}`}>
          {variantTraits.length > 0
            ? variantTraits.map((t, i) => <TraitItem key={i} trait={t} />)
            : <MutedNote>This lineage&rsquo;s benefits aren&rsquo;t in the ruleset data yet, only its name is recorded.</MutedNote>}
        </FeatureGroup>
      )}

      {/* Background */}
      {background && (
        <FeatureGroup label={background}>
          {bgDesc ? <TraitItem trait={{ name: "", desc: [bgDesc.lead, bgDesc.body].filter(Boolean).join(": ") }} />
                  : <MutedNote>Background recorded.</MutedNote>}
        </FeatureGroup>
      )}

      {/* Class features gained */}
      {className && classFeatureLevels.length > 0 && (
        <FeatureGroup label={`${className} features`}>
          <div style={{ display: "grid", gap: 4 }}>
            {classFeatureLevels.map((lv) => (
              <div key={lv} style={{ display: "flex", gap: 10, fontSize: 13.5 }}>
                <span style={{ fontFamily: FORGE_FONTS.mono, color: STONE.brassHi, minWidth: 26 }}>L{lv}</span>
                <span style={{ color: STONE.ink }}>{classFeatures[lv].join(", ")}</span>
              </div>
            ))}
          </div>
          <MutedNote>Full descriptions are in the progression panel above.</MutedNote>
        </FeatureGroup>
      )}

      {/* Feats & boons chosen */}
      {chosenFeats.length > 0 && (
        <FeatureGroup label="Feats & boons">
          {chosenFeats.map((f, i) => (
            <div key={`${f.name}-${i}`} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: FORGE_FONTS.body, fontSize: 15, color: STONE.ink }}>{f.name}</span>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint }}>L{f.level}</span>
                {f.category && f.category !== "Feat" && <span style={stoneChip("moss")}>{f.category}</span>}
              </div>
              {f.desc && (
                <p style={{ fontFamily: FORGE_FONTS.body, fontSize: 13, color: STONE.inkDim, lineHeight: 1.5, margin: "3px 0 0" }}>
                  {f.desc}
                </p>
              )}
            </div>
          ))}
        </FeatureGroup>
      )}
    </div>
  );
}

// A labeled group within the Features panel.
function FeatureGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ ...forgeLabel, color: SAX.brass, marginBottom: 8 }}>{label}</div>
      <div style={{ borderLeft: `2px solid ${STONE.mortar}`, paddingLeft: 12 }}>{children}</div>
    </div>
  );
}

// One trait: bold name (if any) then description.
function TraitItem({ trait }: { trait: TraitEntry }) {
  return (
    <p style={{ fontFamily: FORGE_FONTS.body, fontSize: 13.5, color: STONE.inkDim, lineHeight: 1.55, margin: "0 0 6px" }}>
      {trait.name && <span style={{ color: STONE.ink, fontWeight: 600 }}>{trait.name}. </span>}
      {trait.desc}
    </p>
  );
}

function MutedNote({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: FORGE_FONTS.body, fontSize: 12.5, color: STONE.inkFaint, fontStyle: "italic", margin: "4px 0 0" }}>
      {children}
    </p>
  );
}

function GearPanel({ build, gearIndex, gearTypes, ctx, itemByName, onAdd, onRemove, onMod, onVariant }: {
  build: Build; gearIndex: GearOption[]; gearTypes: string[];
  ctx: ReturnType<typeof buildRulesContext>;
  itemByName: Record<string, ItemRecord>;
  onAdd: (n: string) => void; onRemove: (i: number) => void;
  onMod: (i: number, mod: number) => void; onVariant: (i: number, v: string) => void;
}) {
  const [pick, setPick] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [rarityFilter, setRarityFilter] = useState("");
  const [magicFilter, setMagicFilter] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return gearIndex.filter((g) =>
      (magicFilter === "" || (magicFilter === "magic" ? g.magic : !g.magic)) &&
      (rarityFilter === "" || g.rarity === rarityFilter) &&
      (!typeFilter || g.type === typeFilter) && (!q || g.name.toLowerCase().includes(q)),
    );
  }, [gearIndex, query, typeFilter, rarityFilter, magicFilter]);

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Equip gear and it flows into the sheet: armor sets AC, a belt can set a score, a +1 weapon adjusts attacks.">Gear</PanelTitle>

      {/* Search + type filter */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 220px" }}>
          <label style={forgeLabel}>Search</label>
          <input aria-label="Filter by name…" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name…"
            style={{ ...stoneField(), cursor: "text" }} />
        </div>
        <div style={{ flex: "1 1 150px", position: "relative" }}>
          <label style={forgeLabel}>Type</label>
          <select aria-label="Magic or mundane" value={magicFilter} onChange={(e) => setMagicFilter(e.target.value)} style={stoneField()}>
            <option value="" style={OPTION_STYLE}>Everything</option>
            <option value="mundane" style={OPTION_STYLE}>Mundane only</option>
            <option value="magic" style={OPTION_STYLE}>Magical only</option>
          </select>
          <select aria-label="Rarity" value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)} style={stoneField()}>
            <option value="" style={OPTION_STYLE}>Any rarity</option>
            {RARITY_ORDER.filter((r) => gearIndex.some((g) => g.rarity === r))
              .map((r) => <option key={r} value={r} style={OPTION_STYLE}>{r}</option>)}
          </select>
          <select aria-label="Item type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={stoneField()}>
            <option value="" style={OPTION_STYLE}>All types</option>
            {gearTypes.map((t) => <option key={t} value={t} style={OPTION_STYLE}>{t}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <label style={forgeLabel}>Add item ({filtered.length})</label>
          <select aria-label="Item to add" value={pick} onChange={(e) => setPick(e.target.value)} style={stoneField()}>
            <option value="" style={OPTION_STYLE}>Choose an item</option>
            {filtered.map((g) => <option key={g.name} value={g.name} style={OPTION_STYLE}>{g.name}  ·  {g.type}</option>)}
          </select>
        </div>
        <Button
          onClick={() => { onAdd(pick); setPick(""); }}>Add</Button>
      </div>

      {build.gear.items.length === 0 && (
        <p style={{ color: STONE.inkFaint, fontSize: 14 }}>No gear yet. Add a weapon, armor, or a wondrous item.</p>
      )}

      {build.gear.items.map((e, i) => {
        const def = ctx.items[e.n];
        const variantSpec = ctx.itemVariants[e.n];
        const canMod = def && (def.kind === "Armor" || def.kind === "Weapon");
        const desc = describeItem(itemByName[e.n]);
        return (
          <div key={`${e.n}-${i}`} style={{ padding: "10px 0", borderBottom: `1px solid ${STONE.mortar}` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ flex: 1, fontFamily: FORGE_FONTS.body, fontSize: 16, color: STONE.ink }}>
                {e.n}
                {def?.sub ? <span style={{ color: STONE.inkFaint, fontSize: 13 }}> · {def.sub}</span> : null}
                {e.eq === false ? <span style={{ color: STONE.inkFaint, fontSize: 13 }}> · in your pack (equip it on the Play tab)</span> : null}
              </span>

              {variantSpec && (
                <select aria-label="Variant" value={e.variant || ""} onChange={(ev) => onVariant(i, ev.target.value)}
                  style={{ ...stoneField(), width: 150, padding: "6px 10px", fontSize: 13 }}>
                  <option value="" style={OPTION_STYLE}>{variantSpec.options[0] ? "Choose variant" : ""}</option>
                  {variantSpec.options.map((o) => <option key={o.name} value={o.name} style={OPTION_STYLE}>{o.name}</option>)}
                </select>
              )}

              {canMod && (
                <select aria-label="Modifier" value={e.mod || 0} onChange={(ev) => onMod(i, parseInt(ev.target.value, 10))}
                  style={{ ...stoneField(), width: 74, padding: "6px 10px", fontSize: 13 }}>
                  {[0, 1, 2, 3].map((n) => <option key={n} value={n} style={OPTION_STYLE}>{n ? `+${n}` : "±0"}</option>)}
                </select>
              )}

              <Button variant="ghost" style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => onRemove(i)}>Remove</Button>
            </div>

            {desc && <div style={{ marginTop: 8 }}><DescBlock desc={desc} compact /></div>}
          </div>
        );
      })}
    </div>
  );
}

function SheetPanel({ sheet, name }: {
  sheet: NonNullable<ReturnType<typeof deriveSheet>>; name: string;
}) {
  const [showSkillText, setShowSkillText] = useState(false);
  const trained = SKILLS.filter(([k]) => sheet.skills[k]?.rank > 0);
  const tiles: [string, string, string?][] = [
    ["Armor", String(sheet.ac), sheet.acFormula ? "unarmored" : "with armor"],
    ["Hit points", String(sheet.hpMax)],
    ["Prof", fmtMod(sheet.proficiencyBonus)],
    ["Initiative", fmtMod(sheet.initiative)],
    ["Speed", String(sheet.speed), sheet.speedLabel || undefined],
    ...(sheet.isCaster ? [["Spell DC", String(sheet.spellDC)] as [string, string],
                          ["Spell atk", fmtMod(sheet.spellAttack)] as [string, string]] : []),
    ...(sheet.sneakDice ? [["Sneak", `${sheet.sneakDice}d6`] as [string, string]] : []),
    ...(sheet.martialArts ? [["Martial arts", `d${sheet.martialArts}`] as [string, string]] : []),
  ];
  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Recomputed on every change. This is what actually hits the table.">
        {name} · live sheet
      </PanelTitle>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px,1fr))", gap: 12 }}>
        {tiles.map(([label, val, sub]) => (
          <div key={label} style={statTile()}>
            <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10, letterSpacing: "0.2em",
              textTransform: "uppercase", color: STONE.inkFaint, marginBottom: 5 }}>{label}</div>
            <div style={{ fontFamily: FORGE_FONTS.mono, fontWeight: 600, fontSize: 24, color: STONE.ink, lineHeight: 1 }}>{val}</div>
            {sub && <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10, color: STONE.inkFaint, marginTop: 4 }}>{sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={forgeLabel}>Saving throws</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ABILITIES.map((a) => (
            <span key={a} style={stoneChip("brass")}>{a.toUpperCase()} {fmtMod(sheet.saves[a])}</span>
          ))}
        </div>
      </div>

      {(sheet.senses.length > 0 || sheet.otherSpeeds.length > 0) && (
        <div style={{ marginTop: 14 }}>
          <div style={forgeLabel}>Senses and movement</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[...sheet.senses, ...sheet.otherSpeeds].map((x) => <span key={x} style={stoneChip("brass")}>{x}</span>)}
          </div>
        </div>
      )}

      {(sheet.advAgainst.length > 0 || sheet.advSaves.length > 0) && (
        <div style={{ marginTop: 14 }}>
          <div style={forgeLabel}>Advantage on saves</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sheet.advSaves.length > 0 && (
              <span style={stoneChip("brass")}>
                {sheet.advSaves.map((a) => a.toUpperCase()).join(", ")} saves{sheet.advSavesVs ? ` vs ${sheet.advSavesVs}` : ""}
              </span>
            )}
            {sheet.advAgainst.map((c) => (
              <span key={c} style={stoneChip("brass")}>vs {c.charAt(0).toUpperCase() + c.slice(1)}</span>
            ))}
          </div>
        </div>
      )}

      {sheet.immune.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={forgeLabel}>Immunities</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sheet.immune.map((r) => <span key={r} style={stoneChip("moss")}>{r}</span>)}
          </div>
        </div>
      )}

      {sheet.resist.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={forgeLabel}>Resistances</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sheet.resist.map((r, i) => <span key={`${r}-${i}`} style={stoneChip("moss")}>{r}</span>)}
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={forgeLabel}>Trained skills</div>
          {trained.length > 0 && (
            <button onClick={() => setShowSkillText((v) => !v)}
              style={{ background: "none", border: "none", cursor: "pointer",
                fontFamily: FORGE_FONTS.mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
                color: SAX.brass, padding: 0, marginBottom: 7 }}>
              {showSkillText ? "hide −" : "what do these do? +"}
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {trained.map(([k, label]) => (
            <span key={k} style={stoneChip("brass")}>
              {label} {fmtMod(sheet.skills[k].val)}{sheet.skills[k].rank === 2 ? " ⋆" : ""}
            </span>
          ))}
          {trained.length === 0 && (
            <span style={{ color: STONE.inkFaint, fontSize: 13 }}>No trained skills yet.</span>
          )}
        </div>

        {showSkillText && trained.length > 0 && (
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {trained.map(([k, label, ability]) => {
              const d = describeSkill(k, ability);
              if (!d) return null;
              return (
                <div key={k} style={{ fontSize: 13.5, lineHeight: 1.5, color: STONE.inkDim }}>
                  <span style={{ color: STONE.brassHi, fontFamily: FORGE_FONTS.display }}>{label}</span>
                  <span style={{ color: STONE.inkFaint }}> ({ability.toUpperCase()}) </span>
                  {d.body}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Picking({ stable, base, lead }: { stable: StableRow[]; base: string; lead: string }) {
  if (stable.length === 0) {
    return <Muted>No characters yet. Claim one at your table, then open it here to build its sheet.</Muted>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 10 }}>
      <p style={{ color: STONE.inkDim, textAlign: "center", marginBottom: 8 }}>{lead}</p>
      {stable.map((c) => (
        <a key={c.character_id} href={`${base}?c=${c.character_id}`} style={{ textDecoration: "none" }}>
          <div style={{ ...stonePanel(), padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: FORGE_FONTS.display, fontSize: 18, color: STONE.ink }}>{c.name}</span>
            <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color: STONE.inkDim }}>
              {[c.level ? `L${c.level}` : null, c.species, c.class].filter(Boolean).join(" · ")}
              {"  "}<span style={{ color: SAX.brass }}>{c.campaign_name}</span>
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers + local types
// ---------------------------------------------------------------------------

type GearOption = { name: string; type: string; magic: boolean; rarity?: string };

// A species variant/lineage record. Only SRD subraces carry traits; catalog variants are name-only.
type SpeciesVariantRec = { name: string; variant_kind?: string; ability_bonuses?: string; traits?: unknown };

// A feat as loaded from the SRD feats JSON (matches descriptions.ts FeatRecord). `asi` is a
// structured ability-score increase parsed from the feat: {str:1} fixed, {any:N} player picks any,
// or {choice:[...], amount:N} player picks from a set. Applied into the choice's mods so it moves
// the sheet. Per-ability keys are numbers; the reserved keys any/choice/amount describe variable
// increases.
type FeatAsi = {
  str?: number; dex?: number; con?: number; int?: number; wis?: number; cha?: number;
  any?: number; choice?: string[]; amount?: number;
};
// Structured non-ASI feat effects the engine can apply retroactively: hpPerLevel (Tough adds 2 HP
// per level), speed (Mobile/Speedy add feet). These flow through the same mods object as the ASI,
// which the engine reads as em.hpPerLevel / em.speed.
type FeatEffects = { hpPerLevel?: number; hpFlat?: number; speed?: number; ac?: number; acArmored?: number; initiative?: number; initiativeProf?: number };
type FeatOption = { name: string; category?: string; prerequisite?: string; description?: string; asi?: FeatAsi; effects?: FeatEffects };

// What the picker writes into build.epicChoices[level]. It's an EpicChoice the engine already
// reads (name + mods, where mods like { str: 2 } raise ability scores), plus two UI-only fields:
// isFeat (which editor to show) and desc (the feat's text to display). The engine ignores the extra
// fields; the ability mods in `mods` are what actually move the sheet.
type EpicChoiceInput = {
  name?: string;
  isFeat?: boolean;
  desc?: string;
  mods?: Record<string, number>;
};

const fmtMod = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

// The open dropdown list is drawn by the browser, not the page, so it ignores stoneField()'s dark
// styling and defaults to light-on-light (the low-contrast bug). Styling each <option> explicitly
// with a dark stone background and bright ink text fixes the contrast in the popup.
const OPTION_STYLE: React.CSSProperties = { background: "#1a1611", color: "#f0e6d0" };

// structuredClone is available in modern browsers; fall back to JSON for older ones.
function structuredCloneSafe<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// The character sheet's own panels (phase 5d)
// ---------------------------------------------------------------------------

type SheetTab = "actions" | "spells" | "inventory" | "features" | "background" | "notes" | "extras";

// Two columns on a wide screen (the stats down the left as on a D&D Beyond sheet), one on anything
// narrower. A stylesheet rather than a width hook, so the server render is already right.
const SHEET_CSS = `
.sax-sheet-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
@media (min-width: 1100px) { .sax-sheet-grid { grid-template-columns: minmax(360px, 440px) minmax(0, 1fr); } }
.sax-sheet-tabs::-webkit-scrollbar { height: 4px; }
`;

// Features and traits: each class's features up to its level (name first, the rules text a click
// away, as D&D Beyond shows them), the species and lineage traits, feats, and what active magic items
// add. Proficiencies sit in the left column (SheetProficiencies).
function SheetFeatures({ classes, species, speciesRec, shownTraits, variantName, variantRec, feats, itemNotes, importAdjust, onClearAdjust, onRematch }: {
  classes: { className: string; level: number; groups: LevelGroup[] }[];
  species: string; speciesRec: SpeciesMechRecord | undefined;
  shownTraits?: TraitEntry[];
  variantName: string; variantRec: SpeciesVariantRec | undefined;
  feats: { level: number; name: string; desc?: string; category?: string }[];
  itemNotes: string[];
  /** Phase 5i.2: an imported character's adjustments to match D&D Beyond, listed so nothing is hidden. */
  importAdjust?: ImportAdjust; onClearAdjust?: () => void; onRematch?: () => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allKeys = classes.flatMap((c) => c.groups.flatMap((g) => g.features.map((f, i) => `${c.className}-${g.level}-${i}`)));
  const allOpen = allKeys.length > 0 && allKeys.every((k) => open.has(k));
  const speciesTraits = shownTraits ?? traitList(speciesRec?.traits);
  const variantTraits = traitList(variantRec?.traits);
  return (
    <div style={stonePanel()}>
      {classes.map((c) => (
        <FeatureGroup key={c.className} label={`${c.className} features`}>
          {c.groups.length === 0 && <MutedNote>No feature text for this class in the ruleset data.</MutedNote>}
          {c.groups.map((g) => g.features.map((f, i) => {
            const k = `${c.className}-${g.level}-${i}`, on = open.has(k);
            return (
              <div key={k} style={{ marginBottom: 6 }}>
                <button type="button" onClick={() => toggle(k)} aria-expanded={on}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.brassHi, minWidth: 26 }}>L{g.level}</span>
                  <span style={{ fontFamily: FORGE_FONTS.body, fontSize: 15, color: STONE.ink }}>{f.name}</span>
                </button>
                {on && <p style={{ fontFamily: FORGE_FONTS.body, fontSize: 13.5, color: STONE.inkDim, lineHeight: 1.55, margin: "4px 0 8px 36px", whiteSpace: "pre-wrap" }}>{f.desc || "No rules text in the data."}</p>}
              </div>
            );
          }))}
        </FeatureGroup>
      ))}
      {allKeys.length > 0 && (
        <button type="button" className="forge-btn" onClick={() => setOpen(allOpen ? new Set() : new Set(allKeys))}
          style={{ ...stoneButton("ghost"), fontSize: 12, padding: "4px 10px", marginBottom: 14 }}>{allOpen ? "Hide every description" : "Show every description"}</button>
      )}

      <FeatureGroup label={species || "Species"}>
        {speciesTraits.length > 0
          ? speciesTraits.map((t, i) => <TraitItem key={i} trait={t} />)
          : <MutedNote>No traits recorded for this species yet. Add your own in the Forge, on the Species tab.</MutedNote>}
      </FeatureGroup>
      {variantName && (
        <FeatureGroup label={`${variantName}${variantRec?.variant_kind ? ` (${variantRec.variant_kind})` : ""}`}>
          {variantTraits.length > 0 ? variantTraits.map((t, i) => <TraitItem key={i} trait={t} />) : <MutedNote>This lineage&rsquo;s benefits are not in the ruleset data yet.</MutedNote>}
        </FeatureGroup>
      )}

      {feats.length > 0 && (
        <FeatureGroup label="Feats">
          {feats.map((f, i) => <TraitItem key={`${f.name}-${i}`} trait={{ name: f.level ? `${f.name} (level ${f.level})` : `${f.name}${f.category ? ` (${f.category})` : ""}`, desc: f.desc || "" }} />)}
        </FeatureGroup>
      )}

      {itemNotes.length > 0 && (
        <FeatureGroup label="From your magic items">
          {itemNotes.map((n) => <p key={n} style={{ fontFamily: FORGE_FONTS.body, fontSize: 13.5, color: STONE.inkDim, margin: "0 0 4px" }}>{n}</p>)}
        </FeatureGroup>
      )}

      {importAdjust && (() => {
        const sg = (n: number) => (n > 0 ? `+${n}` : `${n}`);
        const lines: string[] = [];
        if (importAdjust.ac) lines.push(`Armor Class ${sg(importAdjust.ac)}`);
        if (importAdjust.hp) lines.push(`Hit point maximum ${sg(importAdjust.hp)}`);
        if (importAdjust.init) lines.push(`Initiative ${sg(importAdjust.init)}`);
        if (importAdjust.speed) lines.push(`Speed ${sg(importAdjust.speed)} ft`);
        if (importAdjust.spellDC) lines.push(`Spell save DC ${sg(importAdjust.spellDC)}`);
        if (importAdjust.spellAttack) lines.push(`Spell attack ${sg(importAdjust.spellAttack)}`);
        for (const [a, v] of Object.entries(importAdjust.saves || {})) if (v) lines.push(`${a.toUpperCase()} save ${sg(v)}`);
        for (const [k, v] of Object.entries(importAdjust.skills || {})) if (v) lines.push(`${SKILLS.find(([x]) => x === k)?.[1] ?? k} ${sg(v)}`);
        for (const [n, v] of Object.entries(importAdjust.attacks || {})) lines.push(`${n}: ${[v.hit ? `${sg(v.hit)} to hit` : "", v.dmg ? `${sg(v.dmg)} damage` : "", v.damage ? `${v.damage} damage` : ""].filter(Boolean).join(", ")}`);
        for (const [k, v] of Object.entries(importAdjust.passives || {})) if (v) lines.push(`Passive ${k} ${sg(v)}`);
        return (
          <FeatureGroup label="Matched to your D&D Beyond sheet">
            {lines.length ? (
              <>
                <p style={{ fontFamily: FORGE_FONTS.body, fontSize: 13, color: STONE.inkDim, margin: "0 0 6px" }}>
                  D&amp;D Beyond counts these and Six Axes does not work them out yet (a feat, magic item or feature it does not model), so they are added to match your sheet:
                </p>
                <p style={{ fontFamily: FORGE_FONTS.body, fontSize: 13.5, color: STONE.ink, margin: "0 0 8px" }}>{lines.join(" · ")}</p>
              </>
            ) : <p style={{ fontFamily: FORGE_FONTS.body, fontSize: 13, color: STONE.inkDim, margin: "0 0 8px" }}>Every number matches your D&amp;D Beyond sheet with no adjustment.</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {lines.length > 0 && onClearAdjust && <button type="button" className="forge-btn" onClick={onClearAdjust} style={{ fontSize: 12 }}>Use Six Axes&apos; own numbers</button>}
              {onRematch && <button type="button" className="forge-btn" onClick={onRematch} style={{ fontSize: 12 }}>Match D&amp;D Beyond again</button>}
            </div>
          </FeatureGroup>
        );
      })()}
    </div>
  );
}

// Background: what the background is, with the alignment; the personality traits, ideals, bonds and
// flaws sit under it (the inventory component's notes, so they save with the rest of the notes).
function SheetBackground({ background, desc, alignment }: { background: string; desc: Described | null; alignment: string | null }) {
  return (
    <div style={{ ...stonePanel(), marginBottom: 12 }}>
      <PanelTitle>{background || "Background"}</PanelTitle>
      {alignment && <p style={{ fontSize: 13, color: STONE.inkFaint, margin: "0 0 8px" }}>Alignment: {alignment}</p>}
      {desc ? <DescBlock desc={desc} /> : <Muted>No background chosen. Pick one in the Forge.</Muted>}
    </div>
  );
}

// The language names of each edition's rules, offered when adding one (any other can be typed in).
const LANGUAGES: Record<"2014" | "2024", string[]> = {
  "2024": ["Common", "Common Sign Language", "Draconic", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc",
    "Abyssal", "Celestial", "Deep Speech", "Druidic", "Infernal", "Primordial", "Sylvan", "Thieves' Cant", "Undercommon"],
  "2014": ["Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc",
    "Abyssal", "Celestial", "Deep Speech", "Draconic", "Infernal", "Primordial", "Sylvan", "Undercommon"],
};

// Proficiencies and languages, in the sheet's left column as on D&D Beyond (phase 5e). Armor, weapon
// and tool proficiencies come from the class and background. Languages are partly worked out (a
// 2014 species' own languages, Druidic or Thieves' Cant from a class feature, Common in the 2024
// rules) and partly chosen, since backgrounds and the 2024 origin say "of your choice": the chosen
// ones are stored as build.languages and can be removed; the worked-out ones cannot.
function SheetProficiencies({ coreTraits, backgroundRec, masteries, ruleset, species, speciesLanguages, backgroundLanguages, classFeatureNames, chosen, onChosen }: {
  coreTraits: string; backgroundRec: BackgroundRecord | undefined; masteries: string[];
  ruleset: "2014" | "2024"; species: string; speciesLanguages: string | null; backgroundLanguages: string | null;
  classFeatureNames: string[]; chosen: string[]; onChosen: (list: string[]) => void;
}) {
  const [pick, setPick] = useState("");
  const [typed, setTyped] = useState("");
  const granted: { name: string; from: string }[] = [];
  const grant = (name: string, from: string) => { if (name && !granted.some((g) => g.name.toLowerCase() === name.toLowerCase())) granted.push({ name, from }); };
  if (ruleset === "2024") grant("Common", "2024 rules");
  for (const raw of (speciesLanguages || "").split(/,|\band\b/)) {
    const nm = raw.trim();
    // a fixed language name, not "one extra language of your choice"
    if (nm && nm.split(/\s+/).length <= 3 && !/choice|one|extra|any/i.test(nm)) grant(nm, species || "Species");
  }
  if (classFeatureNames.some((f) => /^druidic$/i.test(f.trim()))) grant("Druidic", "Druid");
  if (classFeatureNames.some((f) => /^thieves[\u2019']? cant$/i.test(f.trim()))) grant("Thieves' Cant", "Rogue");
  const known = new Set([...granted.map((g) => g.name.toLowerCase()), ...chosen.map((c) => c.toLowerCase())]);
  const add = (nm: string) => {
    const v = nm.trim().slice(0, 40);
    if (!v || known.has(v.toLowerCase())) return;
    onChosen([...chosen, v]); setPick(""); setTyped("");
  };
  const hint = ruleset === "2024"
    ? "The 2024 rules give Common plus two languages of your choice."
    : backgroundLanguages && !/^none$/i.test(backgroundLanguages.trim()) ? `Your background: ${backgroundLanguages}.` : null;
  const chip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: STONE.ink, border: `1px solid ${STONE.hi}`, borderRadius: 999, padding: "2px 10px" };
  return (
    <div style={{ ...stonePanel(), marginTop: 12 }} role="region" aria-label="Proficiencies and languages">
      <ProficiencyBlock coreTraits={coreTraits} backgroundRec={backgroundRec} masteries={masteries} />
      <FeatureGroup label="Languages">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {granted.map((g) => <span key={g.name} title={`From ${g.from}`} style={chip}>{g.name}<span style={{ fontSize: 10.5, color: STONE.inkFaint }}>{g.from}</span></span>)}
          {chosen.map((c) => (
            <span key={c} style={chip}>{c}
              <button type="button" onClick={() => onChosen(chosen.filter((x) => x !== c))} aria-label={`Remove ${c}`}
                style={{ background: "none", border: "none", color: STONE.inkFaint, cursor: "pointer", padding: 0, fontSize: 12 }}>remove</button>
            </span>
          ))}
          {granted.length + chosen.length === 0 && <MutedNote>No languages yet.</MutedNote>}
        </div>
        {hint && <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "8px 0 0" }}>{hint}</p>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <select aria-label="Add a language" value={pick} onChange={(e) => { setPick(e.target.value); if (e.target.value) add(e.target.value); }}
            style={{ ...stoneField(), width: "auto", padding: "5px 8px", fontSize: 13 }}>
            <option value="" style={OPTION_STYLE}>Add a language</option>
            {LANGUAGES[ruleset].filter((l) => !known.has(l.toLowerCase())).map((l) => <option key={l} value={l} style={OPTION_STYLE}>{l}</option>)}
          </select>
          <input aria-label="Another language" value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 40))} placeholder="or type one"
            onKeyDown={(e) => { if (e.key === "Enter") add(typed); }} style={{ ...stoneField(), width: 140, padding: "5px 8px", fontSize: 13, cursor: "text" }} />
          <Button type="button" disabled={!typed.trim()} title={typed.trim() ? undefined : "Type something to add first"} onClick={() => add(typed)} style={{ fontSize: 12, padding: "4px 10px" }}>Add</Button>
        </div>
      </FeatureGroup>
    </div>
  );
}

// The header's roll log (phase 5f): this character's rolls in the campaign's open session, from the
// sheet, the tabletop and D&D Beyond alike, newest first. Read through tabletop_feed (players cannot
// read vtt_events or vtt_messages directly), only while the list is open, every 8 seconds.
type LogRoll = { key: string; at: string; label: string; total: number | null; nat: 20 | 1 | null; from: string | null };
function SheetRollLog({ campaignId, characterId }: { campaignId: string; characterId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [rolls, setRolls] = useState<LogRoll[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("tabletop_feed", { p_campaign: campaignId, p_since: null, p_limit: 200 });
    if (error) { setErr(/not at this table/.test(error.message) ? "Only the table's players and GM see its rolls." : `Could not read the rolls: ${error.message}`); return; }
    setErr(null);
    const f = (data ?? {}) as {
      messages?: { id: string; kind: string; character_id: string | null; created_at: string; roll: { label?: string; total?: number; natural?: number | null } | null }[];
      outside_rolls?: { id: string; character_id?: string | null; source: string; name: string | null; at: string; rolls: { total?: number; critical_success?: boolean; critical_failure?: boolean } | null }[];
    };
    const out: LogRoll[] = [];
    for (const m of f.messages ?? []) {
      if (m.kind !== "roll" || m.character_id !== characterId || !m.roll) continue;
      out.push({ key: `m-${m.id}`, at: m.created_at, label: m.roll.label || "Roll", total: m.roll.total ?? null, nat: m.roll.natural === 20 ? 20 : m.roll.natural === 1 ? 1 : null, from: "Tabletop" });
    }
    for (const r of f.outside_rolls ?? []) {
      if (r.character_id !== characterId) continue;
      out.push({ key: `e-${r.id}`, at: r.at, label: r.name || "Roll", total: r.rolls?.total ?? null, nat: r.rolls?.critical_success ? 20 : r.rolls?.critical_failure ? 1 : null,
        from: r.source === "beyond20" ? "D&D Beyond" : r.source === "foundry" ? "Foundry" : null });
    }
    out.sort((a, b) => (a.at < b.at ? 1 : -1));
    setRolls(out.slice(0, 30));
  }, [supabase, campaignId, characterId]);
  useEffect(() => {
    if (!open) return;
    void load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 8000);
    return () => clearInterval(id);
  }, [open, load]);
  const time = (iso: string) => { return fmtTime(iso); };
  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="forge-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}
        style={{ ...stoneButton(open ? "primary" : "stone"), fontSize: 12.5, padding: "6px 12px" }}>Rolls</button>
      {open && (
        <div role="region" aria-label="Your rolls this session"
          style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 40, width: "min(320px, calc(100vw - 32px))", maxHeight: 360, overflowY: "auto",
            background: "rgba(20,17,13,0.98)", border: `1px solid ${STONE.hi}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.5)", padding: 8 }}>
          <div style={{ ...forgeLabel, margin: "0 0 6px" }}>Your rolls this session</div>
          {err && <p role="alert" style={{ fontSize: 12.5, color: C.warn, margin: 0 }}>{err}</p>}
          {!err && rolls === null && <p role="status" style={{ fontSize: 12.5, color: STONE.inkFaint, margin: 0 }}>Loading&hellip;</p>}
          {!err && rolls && rolls.length === 0 && <p style={{ fontSize: 12.5, color: STONE.inkFaint, margin: 0 }}>No rolls yet, or no session open.</p>}
          {rolls && rolls.map((r) => (
            <div key={r.key} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "4px 2px", borderBottom: `1px solid ${STONE.hi}` }}>
              <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 16, fontWeight: 700, minWidth: 32, textAlign: "right", color: r.nat === 20 ? C.good : r.nat === 1 ? C.warn : STONE.ink }}>{r.total ?? "?"}</span>
              <span style={{ flex: 1, fontSize: 13, color: STONE.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
              {r.from && <span style={{ fontSize: 10.5, color: STONE.inkFaint }}>{r.from}</span>}
              <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10.5, color: STONE.inkFaint }}>{time(r.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
