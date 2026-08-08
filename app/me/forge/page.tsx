"use client";

// app/me/forge/page.tsx
//
// The Forge — the player-side PC character-sheet creator. Identity (catalog-driven pickers),
// ability scores, gear, and a live sheet computed by deriveSheet on every edit.
//
// THREE MODES, ONE FORGE:
//   ?c=<character_id>   — a campaign character, backed by a `characters` row.
//   ?lib=<library_id>   — a saved/sandbox build, backed by a `pc_library` row.
//   (neither)           — a NEW build, backed by nothing yet; the first save creates a pc_library
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

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SAX } from "@/lib/theme";
import SixAxesNav from "@/components/six-axes-nav";
import { C, STONE, FORGE_FONTS, forgeBackground, forgeVignette, stonePanel, stoneButton, FORGE_BUTTON_CSS, statTile, stoneField, stoneChip, forgeHeading, forgePanelTitle, forgeLabel, forgeRuleLine, forgeBoss } from "@/lib/forge-theme";
import { loadSrd } from "@/lib/srd/srd";
import { applyAdvantage } from "@/lib/dice";
import { traitOptions, traitAsksAChoice } from "@/lib/species-choices";
import { choicesFor, resolveChoice, choiceKey, type ClassChoice } from "@/lib/class-choices";
import { classTable, classTableColumns } from "@/lib/class-table";
import { choiceEffects, applyToBuild, type ChoiceEffects } from "@/lib/apply-choices";
import { parseCoreTraits } from "@/lib/core-traits";
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
  traitList, type TraitEntry, type Described,
  type ItemRecord, type BackgroundRecord, type SpeciesMechRecord,
} from "@/lib/descriptions";
import { CharacterSheetPrint, type PrintTrait, type PrintFeature } from "@/components/character-sheet-print";
import { PortraitUploader } from "@/components/portrait-uploader";
import {
  classProgression, asiLevelsUpTo, epicProgression,
  type ClassRecord, type LevelGroup,
} from "@/lib/class-progression";
import {
  deriveSheet, epicAdvancement, ABILITIES, SKILLS, DEFAULT_EPIC,
  type Ability, type Build, type EpicChoice,
} from "@/lib/srd/derive-sheet";
import { hasPrintedAbilities, suppressItemEffects } from "@/lib/ddb-import";

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

// The default export wraps the working component in a Suspense boundary, because ForgeInner calls
// useSearchParams(), which Next.js requires be inside <Suspense> so the route can prerender.
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
  { key: "background", label: "Background", ready: (b) => Boolean(b.meta.background) && bgAsiTotal(b) > 0 },
  { key: "spells", label: "Spells", ready: (b) => Boolean((b.spells?.cantrips?.length || 0) + (b.spells?.known?.length || 0)) },
  { key: "abilities", label: "Abilities", ready: (b) => Object.values(b.abilities || {}).some((v) => Number(v) > 0) },
  { key: "equipment", label: "Equipment", ready: (b) => Boolean((b.gear?.items || []).length) },
  { key: "roll",      label: "Roll",      ready: () => true },
  { key: "features",  label: "Features",  ready: (b) => Boolean(b.meta.species) },
  { key: "finish",    label: "Finish",    ready: () => true },
];

export default function ForgePage() {
  return (
    <Suspense fallback={null}>
      <ForgeInner />
    </Suspense>
  );
}

function ForgeInner() {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();
  const charId = params.get("c");
  const libIdParam = params.get("lib");

  // Which backing store the current session edits. Derived from the URL on load; a NEW build flips
  // to library once its first save creates a pc_library row.
  const [mode, setMode] = useState<Mode>(charId ? "character" : libIdParam ? "library" : "new");
  const [libId, setLibId] = useState<string | null>(libIdParam);

  // The open tab lives in the URL so a half-built character survives a refresh and a tab can be
  // linked to directly. replaceState rather than router.replace: this is a view change, not a
  // navigation, and pushing it through the router would re-run the page's data effects on every
  // tab click.
  const tabParam = params.get("tab") as TabKey | null;
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
  const [name, setName] = useState<string>("");
  const [speciesVariant, setSpeciesVariant] = useState<string>("");
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "picking" | "error" | "signedout">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Catalog + its scoping controls.
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [edition, setEdition] = useState<Edition>("2024");
  const [enabledPartners, setEnabledPartners] = useState<Set<string>>(new Set());

  // A brand-new build has no ?c and no ?lib: it's immediately editable (no fetch needed). A ?c or
  // ?lib load fetches that row. Either way the catalog loads up front.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setStatus("signedout"); return; }

      loadCatalog(supabase).then((c) => { if (active) setCatalog(c); }).catch(() => { /* pickers degrade to empty */ });

      // NEW build: nothing to fetch, start from a fresh sheet.
      if (mode === "new") {
        if (!active) return;
        setName("New character");
        setStatus("ready");
        return;
      }

      // LIBRARY build.
      if (mode === "library" && libIdParam) {
        const { data, error } = await supabase
          .from("pc_library")
          .select("id, name, build, species, class, subclass, species_variant, level, portrait_url")
          .eq("id", libIdParam)
          .single();
        if (!active) return;
        if (error || !data) { setStatus("error"); return; }
        const r = data as LibRow;
        setBuild(seedFromDenorm(normalizeBuild(r.build), r));
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
        .select("id, name, build, species, class, subclass, species_variant, level, alignment, campaign_id, portrait_url")
        .eq("id", charId)
        .single();
      if (!active) return;
      if (error || !data) { setStatus("error"); return; }
      const r = data as CharRow;
      setRow(r);
      setBuild(seedFromDenorm(normalizeBuild(r.build), r));
      setName(r.name || "");
      setSpeciesVariant(r.species_variant || "");
      if (r.portrait_url) {
        const { data: pu } = supabase.storage.from("campaign-maps").getPublicUrl(r.portrait_url);
        setPortraitUrl(pu.publicUrl);
      }
      setStatus("ready");
    })();
    return () => { active = false; };
  }, [supabase, charId, libIdParam, mode]);

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

  // Description of the currently selected species / background, for the Identity panel.
  const speciesDesc = useMemo<Described | null>(
    () => describeSpecies(srd.speciesByName[build.meta.species]),
    [srd.speciesByName, build.meta.species],
  );
  const backgroundDesc = useMemo<Described | null>(
    () => describeBackground(srd.bgByName[build.meta.background]),
    [srd.bgByName, build.meta.background],
  );

  // Per-level class progression up to the character's current level, for the progression panel.
  const progression = useMemo<LevelGroup[]>(
    () => classProgression(srd.classByName[build.meta.className], build.level),
    [srd.classByName, build.meta.className, build.level],
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

  // Class features gained, grouped by level, for the printable sheet's compact roster.
  const classFeatureGroups = useMemo(() => {
    const rec = srd.classByName[build.meta.className];
    const byLevel: Record<number, string[]> = {};
    (rec?.features_by_level || []).forEach((f) => {
      if (f.level <= build.level) (byLevel[f.level] = byLevel[f.level] || []).push(f.name);
    });
    return Object.keys(byLevel).map(Number).sort((a, b) => a - b).map((lv) => ({ level: lv, names: byLevel[lv] }));
  }, [srd.classByName, build.meta.className, build.level]);

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

  const ctx = useMemo(() => buildRulesContext(edition === "2014" ? "2014" : "2024"), [edition]);

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
  const effects: ChoiceEffects = useMemo(() => {
    const traits = traitList(srd.speciesByName[build.meta.species]?.traits)
      .concat(traitList(srd.variantByName[speciesVariant]?.traits));
    const options: Record<string, { name: string; detail?: string }[]> = {};
    for (const t of traits) options[t.name] = traitOptions(t.desc);

    const cls = build.meta.className || "";
    const expertiseKeys = choicesFor(cls, build.meta.subclass || "", build.level || 1)
      .filter((c) => c.feature.toLowerCase().includes("expertise"))
      .map(choiceKey);

    // The level 1 skill grant is built here from the same shape ClassChoicesPanel uses, so both
    // agree on the key. Deriving the key twice is unfortunate; deriving it two DIFFERENT ways would
    // mean picks that save under one name and are read under another, which fails silently.
    const skillProfKeys = cls
      ? [choiceKey({ className: cls, level: 1, feature: "Skill Proficiencies", choose: 0, kind: "skill" })]
      : [];

    return choiceEffects({
      background: srd.bgByName[build.meta.background],
      speciesTraits: traits,
      speciesChoices: (build as Build & { speciesChoices?: Record<string, string> }).speciesChoices || {},
      speciesOptions: options,
      classChoices: (build as Build & { classChoices?: Record<string, string[]> }).classChoices || {},
      expertiseKeys,
      skillProfKeys,
    });
  }, [build, speciesVariant, srd.speciesByName, srd.variantByName, srd.bgByName]);

  const deriveCtx = useMemo(() => {
    const base = printedAbilities ? suppressItemEffects(ctx) : ctx;
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
  }, [ctx, printedAbilities, effects.resist, build.meta.species]);

  // Apply the chosen species' ability bonuses (2014 carry "CON +2"; 2024 carry none) into
  // build.featMods, which the engine adds to the base scores.
  const buildForDerive = useMemo<Build>(() => {
    const mech = srd.speciesByName[build.meta.species];
    const bonus = parseAbilityBonuses(mech?.ability_bonuses);
    // ADDITIVE, not spread. The old version overwrote, so a species +2 CON and a background +1 CON
    // came out as +2. Nothing wrote a background bonus before, so the bug had never fired.
    const merged: Record<string, number> = {};
    for (const src of [build.featMods || {}, build.bgAsi || {}, bonus]) {
      for (const [k, v] of Object.entries(src)) merged[k] = (merged[k] || 0) + Number(v || 0);
    }
    // Granted skills and expertise fold in here, so the engine sees them as though the player had
    // ticked them by hand - which is the point: a proficiency from a background is not a lesser
    // proficiency.
    return applyToBuild({ ...build, featMods: merged }, effects);
  }, [build, srd.speciesByName, effects]);

  const sheet = useMemo(() => {
    try { return deriveSheet(buildForDerive, deriveCtx); } catch { return null; }
  }, [buildForDerive, deriveCtx]);

  const epic = useMemo(() => epicAdvancement(build.level), [build.level]);

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
  // its rules — the catalog has no prose). Shown as role chips, labeled as such.
  const subclassRoleTags = useMemo(
    () => (catalog ? subclassRoles(catalog, build.meta.className, build.meta.subclass) : []),
    [catalog, build.meta.className, build.meta.subclass],
  );

  // --- gear catalog (mundane + magic) with type + search ---
  const gearIndex = useMemo(() => {
    const rows: GearOption[] = [];
    srd.equipment.forEach((e) => rows.push({ name: e.name, type: e.category || "Gear", magic: false }));
    srd.magic.forEach((m) => rows.push({ name: m.name, type: m.category || "Wondrous", magic: true }));
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

  const setSpecies = (v: string) => patch((b) => { b.meta.species = v; return b; });
  const setVariant = (v: string) => { setSpeciesVariant(v); setSaveState("idle"); };
  const setBackground = (v: string) => patch((b) => {
    b.meta.background = v;
    // A new background offers different abilities, so the old assignment is meaningless rather than
    // merely stale. Clearing it is honest; carrying it over would silently apply a bonus the new
    // background does not grant.
    b.bgAsi = {};
    return b;
  });
  const setBgAsi = (mods: Record<string, number>) => patch((b) => { b.bgAsi = mods; return b; });

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
  const creating = useRef(false);
  const persist = useCallback(async (): Promise<boolean> => {
    setSaveState("saving");
    try {
      if (mode === "character") {
        if (!row) return false;
        const { error } = await supabase
          .from("characters")
          .update({
            build: build as unknown as Record<string, unknown>,
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
        const newId = await saveToLibrary(supabase, name || "New character", build, denorm);
        creating.current = false;
        setLibId(newId);
        setMode("library");
        // Reflect the new id in the URL so a refresh keeps editing the same build, without a reload.
        router.replace(`/me/forge?lib=${newId}`);
        setSaveState("saved");
        return true;
      }
      if (libId) {
        await updateLibrary(supabase, libId, name || "New character", build, denorm);
        setSaveState("saved");
        return true;
      }
      return false;
    } catch {
      creating.current = false;
      setSaveState("error");
      return false;
    }
  }, [supabase, router, mode, row, libId, build, name, speciesVariant]);

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

  const shellStyle: React.CSSProperties = {
    position: "relative", minHeight: "100dvh", color: STONE.ink,
    fontFamily: FORGE_FONTS.body, ...forgeBackground(),
  };

  const editable = status === "ready" && !!sheet;

  return (
    <div style={shellStyle}>
      <FontsAndCss />
      <div style={forgeVignette} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px 64px" }}>
          <SixAxesNav />

          <Header />

          {status === "loading" && <Muted>Stoking the forge&hellip;</Muted>}
          {status === "signedout" && <Muted>Sign in to open the Forge.</Muted>}
          {status === "error" && <Muted>That character could not be loaded. Head back to your stable and try again.</Muted>}

          {status === "picking" && <Picking stable={stable} />}

          {editable && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
              {/* Name (editable for every mode; it's the character's name). */}
              <div style={stonePanel()}>
                <label style={forgeLabel}>Character name</label>
                <input value={name} onChange={(e) => editName(e.target.value)} placeholder="Name your character"
                  style={{ ...stoneField(), cursor: "text", fontFamily: FORGE_FONTS.display, fontSize: 20 }} />
                {mode !== "character" && (
                  <p style={{ color: STONE.inkFaint, fontSize: 13, marginTop: 8 }}>
                    This is a saved build in your library. Changes autosave; use “Play in campaign” from your library to bring it to a table.
                  </p>
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
                build={build} speciesVariant={speciesVariant}
                edition={edition} onEdition={setEdition}
                partners={partners} enabledPartners={enabledPartners} onTogglePartner={togglePartner}
                speciesOpts={speciesOpts} classOpts={classOpts} variantOpts={variantOpts}
                subclassOpts={subclassOpts}
                speciesDesc={speciesDesc} backgroundDesc={backgroundDesc} subclassRoleTags={subclassRoleTags}
                catalogReady={!!catalog} epic={epic}
                onSpecies={setSpecies} onVariant={setVariant} onBackground={setBackground}
                onClassName={setClassName} onSubclass={setSubclass} onLevel={setLevel}
              />
              )}

              {tab === "species" && (
                <SpeciesPanel
                  build={build} speciesVariant={speciesVariant}
                  speciesOpts={speciesOpts} variantOpts={variantOpts}
                  speciesRec={srd.speciesByName[build.meta.species]}
                  variantRec={srd.variantByName[speciesVariant]}
                  desc={speciesDesc}
                  choices={(build as Build & { speciesChoices?: Record<string, string> }).speciesChoices || {}}
                  onSpecies={setSpecies} onVariant={setVariant} onChoice={setSpeciesChoice}
                />
              )}

              {tab === "background" && (
                <BackgroundPanel
                  build={build} backgroundRows={srd.backgrounds}
                  bgRec={srd.bgByName[build.meta.background]} desc={backgroundDesc}
                  onBackground={setBackground} onAsi={setBgAsi}
                />
              )}

              {tab === "spells" && (
                <SpellsPanel
                  build={build} spells={srd.spells} sheet={sheet}
                  onToggle={toggleSpell}
                  loadouts={(build as Build & { loadouts?: SpellLoadout[] }).loadouts || []}
                  onSaveLoadout={saveLoadout} onApplyLoadout={applyLoadout} onDeleteLoadout={deleteLoadout}
                />
              )}

              {tab === "abilities" && (
                <AbilitiesPanel build={build} cap={epic.abilityCap} sheet={sheet} onAbility={setAbility} />
              )}

              {tab === "class" && build.meta.className && (progression.length > 0 || epicRows.length > 0) && (
                <ClassProgressionPanel
                  className={build.meta.className} level={build.level}
                  progression={progression} epicRows={epicRows}
                  classRec={srd.classByName[build.meta.className]}
                  structuredRec={srd.structuredByName[build.meta.className]}
                />
              )}

              {tab === "class" && !build.meta.className && (
                <div style={stonePanel()}>
                  <PanelTitle>Class</PanelTitle>
                  <Muted>Pick a class on the Identity tab and its levels appear here.</Muted>
                </div>
              )}

              {tab === "class" && build.meta.className && (
                <ClassChoicesPanel
                  build={build} sheet={sheet}
                  weapons={srd.equipment} spells={srd.spells}
                  structuredRec={srd.structuredByName[build.meta.className]}
                  picks={(build as Build & { classChoices?: Record<string, string[]> }).classChoices || {}}
                  onPick={setClassChoice}
                />
              )}

              {tab === "class" && build.meta.className && (asiLevels.length > 0 || build.level >= 19) && (
                <FeatsPanel
                  asiLevels={asiLevels} choices={build.epicChoices || {}}
                  featList={srd.featList} level={build.level} onChoose={setLevelChoice}
                />
              )}

              {tab === "equipment" && (
                <GrantedEquipmentPanel
                  bgRec={srd.bgByName[build.meta.background]}
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
              <SheetPanel sheet={sheet} name={name || "Character"} />

              {tab === "finish" && (
                <FinishPanel build={build} name={name} sheet={sheet} onTab={setTab} effects={effects} />
              )}

              {tab === "roll" && (
                <RollPanel sheet={sheet} build={build}
                  characterId={mode === "character" && row ? row.id : null} />
              )}

              {tab === "features" && build.meta.species && (
                <FeaturesPanel
                  species={build.meta.species} speciesRec={srd.speciesByName[build.meta.species]}
                  variantName={speciesVariant} variantRec={srd.variantByName[speciesVariant]}
                  background={build.meta.background} backgroundRec={srd.bgByName[build.meta.background]}
                  className={build.meta.className} classRec={srd.classByName[build.meta.className]}
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
                  <button className="forge-btn is-ghost" style={stoneButton("ghost")}
                    disabled={copied === "copying"} onClick={saveToLibraryFromCharacter}>
                    {copied === "copying" ? "Saving to library…"
                      : copied === "done" ? "Saved to library ✓"
                      : copied === "error" ? "Copy failed — retry"
                      : "Save to library"}
                  </button>
                )}
                {sheet && (
                  <button className="forge-btn is-ghost" style={stoneButton("ghost")} onClick={downloadPdf}>
                    Download PDF
                  </button>
                )}
                <button className="forge-btn is-ghost" style={stoneButton("ghost")} onClick={saveAndExit}>
                  Save &amp; exit
                </button>
                <button className="forge-btn is-primary" style={stoneButton("primary")} onClick={saveAndContinue}>
                  Save &amp; continue
                </button>
              </div>

              {sheet && (
                <CharacterSheetPrint
                  name={name || "Character"}
                  species={build.meta.species} variantName={speciesVariant}
                  className={build.meta.className} subclass={build.meta.subclass}
                  background={build.meta.background} level={build.level}
                  sheet={sheet}
                  speciesTraits={traitList(srd.speciesByName[build.meta.species]?.traits) as PrintTrait[]}
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
        </div>
      </div>
    </div>
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
              <button key={g.label} onClick={() => onTab(g.tab)} className="forge-btn"
                style={{ ...stoneButton("stone"), textAlign: "left", display: "flex",
                  justifyContent: "space-between", gap: 12, fontSize: 13.5 }}>
                <span style={{ color: STONE.ink }}>{g.label}</span>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint }}>
                  {TABS.find((t) => t.key === g.tab)?.label} &rarr;
                </span>
              </button>
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
function BackgroundPanel({ build, backgroundRows, bgRec, desc, onBackground, onAsi }: {
  build: Build;
  backgroundRows: BackgroundRecord[];
  bgRec: { ability_scores?: string; feat?: string; skill_proficiencies?: string;
           tool_proficiency?: string; equipment?: string } | undefined;
  desc: Described | null;
  onBackground: (v: string) => void;
  onAsi: (mods: Record<string, number>) => void;
}) {
  const abilities = useMemo(() => {
    const raw = bgRec?.ability_scores || "";
    return raw.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
      .map((n) => ABBR_TO_KEY[n.slice(0, 3).toLowerCase()] || (n.slice(0, 3).toLowerCase() as Ability))
      .filter((k, i, arr) => k && arr.indexOf(k) === i);
  }, [bgRec]);

  const current = build.bgAsi || {};
  const total = Object.values(current).reduce((a, v) => a + Number(v || 0), 0);
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
        placeholder="Search 123 backgrounds"
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

      {build.meta.background && abilities.length === 0 && (
        <Muted>
          This background does not list ability scores. That is normal for a 2014 background, where
          the bonuses came from your species instead.
        </Muted>
      )}

      {abilities.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={forgeLabel}>Ability scores</label>
          <p style={{ color: STONE.inkDim, fontSize: 13, margin: "0 0 10px", lineHeight: 1.6 }}>
            {bgRec?.ability_scores} — put <strong>+2 into one and +1 into another</strong>, or{" "}
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

      {(bgRec?.feat || bgRec?.skill_proficiencies || bgRec?.tool_proficiency || bgRec?.equipment) && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${STONE.hi}` }}>
          {/* Shown, not applied. The engine has no route for a granted feat or a tool proficiency
              yet, and printing them as though they were live would be worse than printing them as
              a reminder. */}
          <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, letterSpacing: "0.14em",
            textTransform: "uppercase", color: STONE.inkFaint, marginBottom: 8 }}>
            Also granted
          </div>
          <div style={{ display: "grid", gap: 5, fontSize: 13.5, color: STONE.ink }}>
            {bgRec?.feat && <span><strong>Feat:</strong> {bgRec.feat}</span>}
            {bgRec?.skill_proficiencies && <span><strong>Skills:</strong> {bgRec.skill_proficiencies}</span>}
            {bgRec?.tool_proficiency && <span><strong>Tools:</strong> {bgRec.tool_proficiency}</span>}
            {bgRec?.equipment && <span><strong>Equipment:</strong> {bgRec.equipment}</span>}
          </div>
          <p style={{ color: STONE.inkFaint, fontSize: 12, marginTop: 8, marginBottom: 0, lineHeight: 1.55 }}>
            The skills are applied to your sheet automatically. The feat and the gear are not: add
            the equipment on the Equipment tab, and take the feat as one of your ASI picks.
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
function SpellsPanel({ build, spells, sheet, onToggle, loadouts, onSaveLoadout, onApplyLoadout, onDeleteLoadout }: {
  build: Build;
  spells: SpellRecord[];
  sheet: NonNullable<ReturnType<typeof deriveSheet>> | null;
  onToggle: (name: string, cantrip: boolean) => void;
  loadouts: SpellLoadout[];
  onSaveLoadout: (name: string) => void;
  onApplyLoadout: (name: string) => void;
  onDeleteLoadout: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [lvl, setLvl] = useState<string>("");
  const [onlyMine, setOnlyMine] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [newLoadout, setNewLoadout] = useState("");

  const cls = build.meta.className || "";
  const chosen = useMemo(() => new Set([...(build.spells?.cantrips || []), ...(build.spells?.known || [])]),
    [build.spells]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return spells.filter((sp) => {
      if (onlyMine && cls && !spellClasses(sp).some((c) => c.toLowerCase() === cls.toLowerCase())) return false;
      if (lvl !== "" && spellLevel(sp) !== Number(lvl)) return false;
      if (needle && !sp.name.toLowerCase().includes(needle)) return false;
      return true;
    }).sort((a, b) => spellLevel(a) - spellLevel(b) || a.name.localeCompare(b.name));
  }, [spells, cls, lvl, q, onlyMine]);

  const cantripCount = build.spells?.cantrips?.length || 0;
  const knownCount = build.spells?.known?.length || 0;

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Your spells, and saved lists you can swap between.">Spells</PanelTitle>

      {!cls && <Muted>Pick a class on the Identity tab to filter this list.</Muted>}

      {sheet && !sheet.isCaster && cls && (
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
                <button className="forge-btn" onClick={() => onApplyLoadout(o.name)}
                  style={{ ...stoneButton("stone"), fontSize: 13, flex: "1 1 180px", textAlign: "left" }}>
                  {o.name}
                  <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint, marginLeft: 8 }}>
                    {o.cantrips.length} cantrips, {o.known.length} spells
                  </span>
                </button>
                <button onClick={() => onSaveLoadout(o.name)} title="Overwrite with the current list"
                  style={{ ...stoneButton("ghost"), fontSize: 12, padding: "6px 10px" }}>Update</button>
                <button onClick={() => onDeleteLoadout(o.name)}
                  style={{ ...stoneButton("ghost"), fontSize: 12, padding: "6px 10px", color: C.warn }}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={newLoadout} onChange={(e) => setNewLoadout(e.target.value)}
            placeholder="Name this list (Dungeon delve, Social night)"
            style={{ ...stoneField(), flex: "1 1 220px", width: "auto", fontSize: 13, padding: "8px 10px" }} />
          <button className="forge-btn" disabled={!newLoadout.trim()}
            onClick={() => { onSaveLoadout(newLoadout.trim()); setNewLoadout(""); }}
            style={{ ...stoneButton("primary"), fontSize: 13, opacity: newLoadout.trim() ? 1 : 0.5 }}>
            Save current
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spells"
          style={{ ...stoneField(), flex: "1 1 180px", width: "auto", fontSize: 13, padding: "8px 10px" }} />
        <select value={lvl} onChange={(e) => setLvl(e.target.value)}
          style={{ ...stoneField(), width: "auto", minWidth: 110, fontSize: 13, padding: "8px 10px" }}>
          <option value="">Any level</option>
          <option value="0">Cantrips</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={String(n)}>Level {n}</option>)}
        </select>
        {cls && (
          <button className="forge-btn" onClick={() => setOnlyMine((v) => !v)}
            style={{ ...stoneButton(onlyMine ? "primary" : "stone"), fontSize: 12.5 }}>
            {onlyMine ? cls : "All classes"}
          </button>
        )}
      </div>

      <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint, marginBottom: 6 }}>
        {filtered.length} shown &middot; you have {cantripCount} cantrip{cantripCount === 1 ? "" : "s"} and {knownCount} spell{knownCount === 1 ? "" : "s"}
      </div>

      <div style={{ maxHeight: 460, overflowY: "auto", display: "grid", gap: 4, paddingRight: 4 }}>
        {filtered.map((sp) => {
          const lv = spellLevel(sp);
          const cantrip = lv === 0;
          const on = chosen.has(sp.name);
          const isOpen = open === sp.name;
          return (
            <div key={`${sp.name}::${sp.level}`} style={{
              border: `1px solid ${on ? C.sun : STONE.hi}`, borderRadius: 4,
              background: on ? "rgba(200,162,75,0.09)" : "rgba(0,0,0,0.22)", padding: "8px 10px",
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <button onClick={() => onToggle(sp.name, cantrip)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0,
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
 * Rolling straight off the sheet.
 *
 * WHY THE MODIFIERS ARE NOT RETYPED
 *   Every number here comes from deriveSheet, which is the same engine that draws the sheet below.
 *   A roller that asks the player what their Stealth bonus is has moved the arithmetic back to the
 *   human, and the whole reason the Forge derives live is so nobody has to hold it.
 *
 * WHERE THE ROLL GOES
 *   The server rolls and logs it, so the number shown and the number stored cannot disagree. It
 *   reaches the same Mechanics page as a Beyond20 roll, at the same fidelity, because the app
 *   produced it rather than overhearing it. A build that is not playing at a table has no session
 *   to log to; it still rolls, and says so rather than pretending it recorded something.
 */
function RollPanel({ sheet, build, characterId }: {
  sheet: NonNullable<ReturnType<typeof deriveSheet>> | null;
  build: Build;
  characterId: string | null;
}) {
  const [mode, setMode] = useState<"flat" | "adv" | "dis">("flat");
  const [log, setLog] = useState<{ label: string; total: number; notation: string;
    natural: 20 | 1 | null; logged: boolean; at: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const doRoll = useCallback(async (label: string, mod: number, kind: string) => {
    setBusy(true); setNote(null);
    const base = `1d20${mod >= 0 ? "+" : "-"}${Math.abs(mod)}`;
    const notation = applyAdvantage(base, mode);
    try {
      const res = await fetch("/api/rolls/player", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId, notation, kind, label }),
      });
      const out = await res.json();
      if (!res.ok) { setNote(out.error ?? "Could not roll."); return; }
      setLog((l) => [{
        label, total: out.result.total, notation: out.result.notation,
        natural: out.result.natural, logged: Boolean(out.logged), at: Date.now(),
      }, ...l].slice(0, 20));
      if (!out.logged && out.reason) setNote(`Rolled, not recorded: ${out.reason}.`);
    } catch {
      setNote("Could not reach the server.");
    } finally { setBusy(false); }
  }, [characterId, mode]);

  if (!sheet) {
    return (
      <div style={stonePanel()}>
        <PanelTitle>Roll</PanelTitle>
        <Muted>The sheet has not derived yet. Pick a class and species first.</Muted>
      </div>
    );
  }

  // rank 0 untrained, 1 proficient, 2 expertise. Shown as a mark rather than a word: the number
  // beside it already says how much, and what a player is scanning for is "am I good at this".
  const Btn = ({ label, mod, kind, rank = 0 }: {
    label: string; mod: number; kind: string; rank?: number;
  }) => (
    <button className="forge-btn" disabled={busy} onClick={() => void doRoll(label, mod, kind)}
      title={rank >= 2 ? "Expertise" : rank >= 1 ? "Proficient" : undefined}
      style={{ ...stoneButton("stone"), display: "flex", justifyContent: "space-between",
        gap: 8, fontSize: 13, textAlign: "left", alignItems: "center",
        borderColor: rank >= 2 ? C.sun : rank >= 1 ? "rgba(200,162,75,0.4)" : undefined }}>
      <span style={{ color: STONE.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
        {rank >= 1 && (
          <span aria-hidden style={{
            width: 6, height: 6, borderRadius: 3, flexShrink: 0,
            background: rank >= 2 ? C.sun : "rgba(200,162,75,0.55)",
            boxShadow: rank >= 2 ? `0 0 0 2px rgba(200,162,75,0.22)` : undefined,
          }} />
        )}
        <span style={{ fontFamily: FORGE_FONTS.mono, color: C.plum }}>
          {mod >= 0 ? "+" : ""}{mod}
        </span>
      </span>
    </button>
  );

  const skillNames = Object.keys(sheet.skills || {}).sort();

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Every bonus comes from the sheet below, so there is nothing to retype.">
        Roll
      </PanelTitle>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {(["dis", "flat", "adv"] as const).map((m) => (
          <button key={m} className="forge-btn" onClick={() => setMode(m)}
            style={{ ...stoneButton(mode === m ? "primary" : "stone"), fontSize: 12.5 }}>
            {m === "adv" ? "Advantage" : m === "dis" ? "Disadvantage" : "Straight"}
          </button>
        ))}
        <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint, marginLeft: "auto" }}>
          {characterId ? "rolls are recorded to your session" : "library build \u2014 not recorded"}
        </span>
      </div>

      <label style={forgeLabel}>Ability checks</label>
      {/* Six columns, matching the six abilities exactly, so the last one never orphans onto a row
          of its own. Skills use the same grid so the whole panel lines up rather than each block
          finding its own rhythm. */}
      <div style={{ display: "grid", gridTemplateColumns: ROLL_GRID, gap: 5, marginBottom: 14 }}>
        {ABILITIES.map((a) => (
          <Btn key={a} label={a.toUpperCase()} mod={sheet.mods[a] ?? 0} kind="check" />
        ))}
      </div>

      <label style={forgeLabel}>Saving throws</label>
      <div style={{ display: "grid", gridTemplateColumns: ROLL_GRID, gap: 5, marginBottom: 14 }}>
        {ABILITIES.map((a) => (
          <Btn key={a} label={`${a.toUpperCase()} save`} mod={sheet.saves[a] ?? 0} kind="save"
            rank={(build.saveProf || []).includes(a) ? 1 : 0} />
        ))}
      </div>

      <label style={forgeLabel}>Skills</label>
      <div style={{ display: "grid", gridTemplateColumns: ROLL_GRID, gap: 5, marginBottom: 14 }}>
        {skillNames.map((k) => (
          <Btn key={k} label={k} mod={sheet.skills[k]?.val ?? 0} kind="skill"
            rank={sheet.skills[k]?.rank ?? 0} />
        ))}
      </div>

      <label style={forgeLabel}>Other</label>
      <div style={{ display: "grid", gridTemplateColumns: ROLL_GRID, gap: 5 }}>
        <Btn label="Initiative" mod={sheet.initiative ?? 0} kind="initiative" />
        {sheet.isCaster && <Btn label="Spell attack" mod={sheet.spellAttack ?? 0} kind="attack" />}
      </div>

      {note && <p style={{ color: C.warn, fontSize: 12.5, marginTop: 12, marginBottom: 0 }}>{note}</p>}

      {log.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${STONE.hi}` }}>
          <label style={forgeLabel}>This sitting</label>
          {log.map((r) => (
            <div key={r.at} style={{ display: "flex", justifyContent: "space-between",
              alignItems: "baseline", gap: 10, padding: "6px 0", borderTop: `1px solid ${STONE.hi}` }}>
              <span style={{ fontSize: 13.5, color: STONE.ink }}>
                {r.label}
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint, marginLeft: 8 }}>
                  {r.notation}{r.logged ? "" : " \u00b7 not recorded"}
                </span>
              </span>
              <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 19,
                color: r.natural === 20 ? C.good : r.natural === 1 ? C.warn : C.sun }}>
                {r.total}
              </span>
            </div>
          ))}
        </div>
      )}
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
 * THE CHOICE IS RECORDED, NOT APPLIED. Picking Black draconic ancestry does not yet grant acid
 * resistance: the engine has no route from a species choice to a derived effect. Storing it is
 * still worth doing - it is on the sheet, it survives to the table, and it is what a later pass
 * would read - but a panel that implied the number had moved would be lying about the sheet.
 */
function SpeciesPanel({
  build, speciesVariant, speciesOpts, variantOpts, speciesRec, variantRec, desc,
  choices, onSpecies, onVariant, onChoice,
}: {
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

  const decisions = traits.filter((t) => traitAsksAChoice(t.desc || ""));

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
          {speciesRec?.speed && <span>speed {speciesRec.speed}</span>}
          {speciesRec?.ability_bonuses && <span>{speciesRec.ability_bonuses}</span>}
        </div>
      )}

      {decisions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={forgeLabel}>Choices this species asks for</label>
          <div style={{ display: "grid", gap: 10 }}>
            {decisions.map((t) => {
              const key = t.name;
              const opts = traitOptions(t.desc || "");
              const picked = choices[key] || "";
              return (
                <div key={key} style={{ background: "rgba(0,0,0,0.24)", borderRadius: 4,
                  padding: "10px 12px" }}>
                  <div style={{ fontSize: 14, color: STONE.ink, marginBottom: 6 }}>{t.name}</div>
                  {opts.length > 0 ? (
                    <>
                      <select value={picked} onChange={(e) => onChoice(key, e.target.value)}
                        style={{ ...stoneField(), fontSize: 13.5, padding: "8px 10px" }}>
                        <option value="">Not chosen</option>
                        {opts.map((o) => (
                          <option key={o.name} value={o.name}>
                            {o.name}{o.detail ? ` \u2014 ${o.detail.slice(0, 60)}` : ""}
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

      {traits.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${STONE.hi}` }}>
          <label style={forgeLabel}>Traits</label>
          <div style={{ display: "grid", gap: 10 }}>
            {traits.map((t, i) => (
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

      {build.meta.species && traits.length === 0 && (
        <Muted>
          No trait data for this species yet. Catalog entries from partnered content are names only;
          the SRD species carry full traits.
        </Muted>
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
function ClassChoicesPanel({ build, sheet, weapons, spells, picks, onPick, structuredRec }: {
  build: Build;
  sheet: NonNullable<ReturnType<typeof deriveSheet>> | null;
  weapons: ItemRecord[];
  spells: SpellRecord[];
  picks: Record<string, string[]>;
  onPick: (key: string, values: string[]) => void;
  structuredRec?: unknown;
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
      ...choicesFor(build.meta.className || "", build.meta.subclass || "", build.level || 1),
    ],
    [fromCore, build.meta.className, build.meta.subclass, build.level],
  );

  const data = useMemo(() => ({
    skills: SKILLS.map(([key, label]) => ({ key, label })),
    weapons: (weapons as unknown as { name: string; category?: string; weapon_category?: string;
      weapon_range?: string; mastery?: string }[]).filter((w) => w.category === "Weapon"),
    tools: (weapons as unknown as { name: string; category?: string }[])
      .filter((w) => w.category === "Tools").map((t) => ({ name: t.name })),
    spells: spells.map((sp) => ({ name: sp.name, level: sp.level })),
    // Expertise only offers skills the character already has, so this reads the DERIVED sheet
    // rather than build.skillProf - a skill granted by a background or species is just as
    // proficient as one picked by hand, and asking the raw build would miss those.
    proficientSkills: Object.entries(sheet?.skills || {})
      .filter(([, v]) => (v as { rank: number }).rank > 0)
      .map(([k]) => k),
  }), [weapons, spells, sheet]);

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

// One grid for every block on the Roll tab. Six columns fits the six abilities exactly and divides
// the eighteen skills into three clean rows.
const ROLL_GRID = "repeat(auto-fit, minmax(min(100%, 132px), 1fr))";

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
                    {i.name} \u2014 your choice
                  </span>
                ))}
                {missing.map((i) => (
                  <span key={i.raw} style={{ ...stoneChip(), fontSize: 12.5, color: STONE.inkFaint }}>
                    {i.name}
                  </span>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button className="forge-btn" disabled={toAdd.length === 0}
                  onClick={() => onAdd(toAdd.flatMap((i) => Array.from({ length: Math.min(i.qty, 20) }, () => i.name)))}
                  style={{ ...stoneButton("primary"), fontSize: 12.5, opacity: toAdd.length ? 1 : 0.45 }}>
                  {toAdd.length ? `Add ${toAdd.length} item${toAdd.length === 1 ? "" : "s"}` : "Already added"}
                </button>
                {missing.length > 0 && (
                  <button className="forge-btn"
                    onClick={() => onAdd(missing.filter((i) => !has(i.name)).map((i) => i.name))}
                    style={{ ...stoneButton("stone"), fontSize: 12.5 }}>
                    Add {missing.length} as notes
                  </button>
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
      <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, letterSpacing: "0.42em",
        textTransform: "uppercase", color: SAX.brass, marginBottom: 12 }}>
        Kerf &amp; Code · Six Axes
      </div>
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
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={value || placeholder || `Search ${label.toLowerCase()}`}
          style={{ ...stoneField(), flex: "1 1 200px", width: "auto", fontSize: 13.5, padding: "9px 11px" }} />
        {(filters || []).map((f) => (
          <select key={f.label} value={active[f.label] || ""}
            onChange={(e) => { setActive((a) => ({ ...a, [f.label]: e.target.value })); setOpen(true); }}
            style={{ ...stoneField(), width: "auto", minWidth: 130, fontSize: 13, padding: "9px 10px" }}>
            <option value="" style={OPTION_STYLE}>{f.label}</option>
            {f.values.map((v) => <option key={v} value={v} style={OPTION_STYLE}>{v}</option>)}
          </select>
        ))}
        {anyFilter && (
          <button className="forge-btn" onClick={() => { setQ(""); setActive({}); }}
            style={{ ...stoneButton("stone"), fontSize: 12.5, padding: "8px 12px" }}>Clear</button>
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
  return (
    <div style={{ marginBottom: 16, position: "relative" }}>
      <label style={forgeLabel}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        style={{ ...stoneField(), opacity: disabled ? 0.5 : 1 }}>
        <option value="" style={OPTION_STYLE}>{placeholder || `Choose ${label.toLowerCase()}`}</option>
        {options.map((o) => <option key={o} value={o} style={OPTION_STYLE}>{o}</option>)}
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
  speciesDesc: Described | null; backgroundDesc: Described | null; subclassRoleTags: string[];
  catalogReady: boolean;
  epic: { abilityCap: number; asiCount: number; epicFeatCount: number };
  onSpecies: (v: string) => void; onVariant: (v: string) => void; onBackground: (v: string) => void;
  onClassName: (v: string) => void; onSubclass: (v: string) => void; onLevel: (v: number) => void;
}) {
  const {
    build, speciesVariant, edition, onEdition, partners, enabledPartners, onTogglePartner,
    speciesOpts, classOpts, variantOpts, subclassOpts, backgroundRows,
    speciesDesc, backgroundDesc,
    subclassRoleTags, catalogReady, epic,
    onSpecies, onVariant, onBackground, onClassName, onSubclass, onLevel,
  } = props;

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
        <p style={{ color: STONE.inkFaint, fontSize: 13, marginBottom: 12 }}>Loading the catalog&hellip;</p>
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

      {/* Subclass tactical role, from the catalog. Labeled as ROLE, not a rules description — the
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

      <div style={{ marginTop: 6 }}>
        <label style={forgeLabel}>Level</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input type="range" min={1} max={30} value={build.level}
            onChange={(e) => onLevel(parseInt(e.target.value, 10))}
            style={{ flex: 1, accentColor: SAX.brass }} />
          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 22, color: STONE.brassHi, minWidth: 34, textAlign: "right" }}>
            {build.level}
          </span>
        </div>
        {build.level > 20 && (
          <div style={{ marginTop: 10 }}>
            <span style={stoneChip("brass")}>Epic tier</span>
            <span style={stoneChip("brass")}>{epic.asiCount} ability boosts</span>
            <span style={stoneChip("brass")}>{epic.epicFeatCount} epic feats</span>
            <span style={stoneChip("moss")}>Ability cap {epic.abilityCap}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AbilitiesPanel({ build, cap, sheet, onAbility }: {
  build: Build; cap: number;
  sheet: NonNullable<ReturnType<typeof deriveSheet>>;
  onAbility: (a: Ability, v: number) => void;
}) {
  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Base scores. Species, background, and gear can raise these — the effective value shows below each.">Ability scores</PanelTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px,1fr))", gap: 14 }}>
        {ABILITIES.map((a) => {
          const eff = sheet.abilities[a];
          const changed = eff !== build.abilities[a];
          return (
            <div key={a} style={statTile()}>
              <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10, letterSpacing: "0.2em",
                textTransform: "uppercase", color: STONE.inkFaint, marginBottom: 6 }}>{a}</div>
              <input type="number" min={1} max={cap} value={build.abilities[a]}
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
  // Only up to the character's level. A level 3 Barbarian being shown rage counts for level 17 is
  // not information, it is a wall to scroll past.
  const shownRows = useMemo(() => table.filter((r) => r.level <= Math.max(1, level)), [table, level]);

  const meta = [
    classRec?.hit_die ? `Hit die d${String(classRec.hit_die).replace(/^d/i, "")}` : null,
    classRec?.primary_ability ? `Primary: ${classRec.primary_ability}` : null,
    classRec?.saving_throws ? `Saves: ${classRec.saving_throws}` : null,
  ].filter(Boolean).join("  ·  ");

  const tableBlock = cols.length > 0 && shownRows.length > 0 ? (
    <div style={{ marginBottom: 16, overflowX: "auto" }}>
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
                    {r.columns[c] || "\u2014"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
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
          <button className="forge-btn is-ghost" style={{ ...stoneButton("ghost"), padding: "5px 12px", fontSize: 12 }}
            onClick={() => onChoose(null)}>Clear</button>
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
          <button className="forge-btn is-ghost" style={{ ...stoneButton("ghost"), padding: "5px 12px", fontSize: 12 }}
            onClick={() => onChoose(null)}>Clear</button>
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
                <button className="forge-btn is-ghost" style={{ ...stoneButton("ghost"), padding: "2px 9px" }}
                  onClick={() => set(a, cur - 1)} disabled={cur <= 0}>−</button>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 16, color: cur ? STONE.brassHi : STONE.inkFaint, minWidth: 20 }}>
                  {cur ? `+${cur}` : "—"}
                </span>
                <button className="forge-btn is-ghost" style={{ ...stoneButton("ghost"), padding: "2px 9px" }}
                  onClick={() => set(a, cur + 1)} disabled={!canPlus || cur >= 2}>+</button>
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

  // Non-ASI structured effects (Tough's hpPerLevel, speed feats) go into mods too, so the engine
  // applies them retroactively. They live alongside any ability increase.
  const featEffectMods = (f: FeatOption | undefined): Record<string, number> => {
    const e = f?.effects; if (!e) return {};
    const m: Record<string, number> = {};
    if (e.hpPerLevel) m.hpPerLevel = e.hpPerLevel;
    if (e.speed) m.speed = e.speed;
    if (e.ac) m.ac = e.ac;
    if (e.initiative) m.initiative = e.initiative;
    return m;
  };

  const pickFeat = (name: string) => {
    const f = featList.find((x) => x.name === name);
    const next: EpicChoiceInput = { name, isFeat: true, desc: f?.description || "", mods: { ...featEffectMods(f) } };
    // Apply a FIXED ability increase immediately; leave variable ones for the ability selector.
    const fa = f?.asi ? fixedAsiAbility(f.asi) : null;
    const amt = f?.asi ? (f.asi.amount || f.asi.any || firstFixedAmount(f.asi)) : 0;
    if (fa && amt) next.mods = { ...next.mods, [fa]: amt };
    onChoose(next);
  };
  const pickAbility = (a: Ability) => {
    // Keep the feat's structured effects; set the chosen ability's increase.
    const base = featEffectMods(picked);
    onChoose({ ...choice, mods: asiAmount ? { ...base, [a]: asiAmount } : base });
  };

  return (
    <div>
      <div style={{ position: "relative" }}>
        <select value={choice.name || ""} style={stoneField()} onChange={(e) => pickFeat(e.target.value)}>
          <option value="" style={OPTION_STYLE}>Choose a feat</option>
          {featList.map((f) => (
            <option key={f.name} value={f.name} style={OPTION_STYLE}>
              {f.name}{f.category && f.category !== "Feat" ? ` · ${f.category}` : ""}
            </option>
          ))}
        </select>
        <span style={{ position: "absolute", right: 14, top: 14, fontSize: 9, color: SAX.brass, pointerEvents: "none" }}>▼</span>
      </div>

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
function FeaturesPanel({
  species, speciesRec, variantName, variantRec, background, backgroundRec,
  className, classRec, level, chosenFeats,
}: {
  species: string; speciesRec: SpeciesMechRecord | undefined;
  variantName: string; variantRec: SpeciesVariantRec | undefined;
  background: string; backgroundRec: BackgroundRecord | undefined;
  className: string; classRec: ClassRecord | undefined;
  level: number;
  chosenFeats: { level: number; name: string; desc?: string; category?: string }[];
}) {
  const speciesTraits = traitList(speciesRec?.traits);
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

      {/* Species */}
      <FeatureGroup label={species || "Species"}>
        {speciesTraits.length > 0
          ? speciesTraits.map((t, i) => <TraitItem key={i} trait={t} />)
          : <MutedNote>Traits for this species aren&rsquo;t modeled yet, only its name is on the sheet.</MutedNote>}
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
          {bgDesc ? <TraitItem trait={{ name: "", desc: [bgDesc.lead, bgDesc.body].filter(Boolean).join(" — ") }} />
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return gearIndex.filter((g) =>
      (!typeFilter || g.type === typeFilter) && (!q || g.name.toLowerCase().includes(q)),
    );
  }, [gearIndex, query, typeFilter]);

  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Equip gear and it flows into the sheet — armor sets AC, a belt can set a score, a +1 weapon adjusts attacks.">Gear</PanelTitle>

      {/* Search + type filter */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 220px" }}>
          <label style={forgeLabel}>Search</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name…"
            style={{ ...stoneField(), cursor: "text" }} />
        </div>
        <div style={{ flex: "1 1 150px", position: "relative" }}>
          <label style={forgeLabel}>Type</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={stoneField()}>
            <option value="" style={OPTION_STYLE}>All types</option>
            {gearTypes.map((t) => <option key={t} value={t} style={OPTION_STYLE}>{t}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <label style={forgeLabel}>Add item ({filtered.length})</label>
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={stoneField()}>
            <option value="" style={OPTION_STYLE}>Choose an item</option>
            {filtered.map((g) => <option key={g.name} value={g.name} style={OPTION_STYLE}>{g.name}  ·  {g.type}</option>)}
          </select>
        </div>
        <button className="forge-btn" style={stoneButton("stone")}
          onClick={() => { onAdd(pick); setPick(""); }}>Add</button>
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
              </span>

              {variantSpec && (
                <select value={e.variant || ""} onChange={(ev) => onVariant(i, ev.target.value)}
                  style={{ ...stoneField(), width: 150, padding: "6px 10px", fontSize: 13 }}>
                  <option value="" style={OPTION_STYLE}>{variantSpec.options[0] ? "Choose variant" : ""}</option>
                  {variantSpec.options.map((o) => <option key={o.name} value={o.name} style={OPTION_STYLE}>{o.name}</option>)}
                </select>
              )}

              {canMod && (
                <select value={e.mod || 0} onChange={(ev) => onMod(i, parseInt(ev.target.value, 10))}
                  style={{ ...stoneField(), width: 74, padding: "6px 10px", fontSize: 13 }}>
                  {[0, 1, 2, 3].map((n) => <option key={n} value={n} style={OPTION_STYLE}>{n ? `+${n}` : "±0"}</option>)}
                </select>
              )}

              <button className="forge-btn is-ghost" style={{ ...stoneButton("ghost"), padding: "6px 12px", fontSize: 12 }}
                onClick={() => onRemove(i)}>Remove</button>
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

function Picking({ stable }: { stable: StableRow[] }) {
  if (stable.length === 0) {
    return <Muted>No characters yet. Claim one at your table, then open it here to build its sheet.</Muted>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 10 }}>
      <p style={{ color: STONE.inkDim, textAlign: "center", marginBottom: 8 }}>Choose a character to bring to the Forge.</p>
      {stable.map((c) => (
        <a key={c.character_id} href={`/me/forge?c=${c.character_id}`} style={{ textDecoration: "none" }}>
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

type GearOption = { name: string; type: string; magic: boolean };

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
type FeatEffects = { hpPerLevel?: number; speed?: number; ac?: number; initiative?: number };
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
