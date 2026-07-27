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
import {
  STONE, FORGE_FONTS, forgeBackground, forgeVignette, stonePanel, stoneButton,
  FORGE_BUTTON_CSS, statTile, stoneField, stoneChip, forgeHeading, forgePanelTitle,
  forgeLabel, forgeRuleLine, forgeBoss,
} from "@/lib/forge-theme";
import { loadSrd } from "@/lib/srd/srd";
import { buildRulesContext } from "@/lib/srd/rules-context";
import {
  loadCatalog, partnerList, speciesOptions, classOptions, variantOptions, subclassOptions,
  type Catalog, type Edition,
} from "@/lib/catalog";
import {
  saveToLibrary, updateLibrary, saveCharacterToLibrary, type LibraryDenorm,
} from "@/lib/pc-library";
import {
  describeItem, describeBackground, describeSpecies, type Described,
  type ItemRecord, type BackgroundRecord, type SpeciesMechRecord,
} from "@/lib/descriptions";
import {
  deriveSheet, epicAdvancement, ABILITIES, SKILLS,
  type Ability, type Build,
} from "@/lib/srd/derive-sheet";

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

  const [stable, setStable] = useState<StableRow[]>([]);
  const [row, setRow] = useState<CharRow | null>(null);
  const [build, setBuild] = useState<Build>(emptyBuild());
  const [name, setName] = useState<string>("");
  const [speciesVariant, setSpeciesVariant] = useState<string>("");
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
        .select("id, name, build, species, class, subclass, species_variant, level, alignment, campaign_id")
        .eq("id", charId)
        .single();
      if (!active) return;
      if (error || !data) { setStatus("error"); return; }
      const r = data as CharRow;
      setRow(r);
      setBuild(seedFromDenorm(normalizeBuild(r.build), r));
      setName(r.name || "");
      setSpeciesVariant(r.species_variant || "");
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
    const speciesData = loadSrd("species", srdMode) as unknown as { species: SpeciesMechRecord[]; variants: unknown[] };
    const speciesByName: Record<string, SpeciesMechRecord> = {};
    (speciesData.species || []).forEach((s) => { speciesByName[s.name] = s; });
    const bgByName: Record<string, BackgroundRecord> = {};
    backgrounds.forEach((b) => { bgByName[b.name] = b; });
    // One item lookup for descriptions (mundane + magic, first wins on a both-mode name collision).
    const itemByName: Record<string, ItemRecord> = {};
    equipment.forEach((e) => { if (!itemByName[e.name]) itemByName[e.name] = e; });
    magic.forEach((m) => { if (!itemByName[m.name]) itemByName[m.name] = m; });
    return { backgrounds, equipment, magic, speciesByName, bgByName, itemByName };
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

  const ctx = useMemo(() => buildRulesContext(edition === "2014" ? "2014" : "2024"), [edition]);

  // Apply the chosen species' ability bonuses (2014 carry "CON +2"; 2024 carry none) into
  // build.featMods, which the engine adds to the base scores.
  const buildForDerive = useMemo<Build>(() => {
    const mech = srd.speciesByName[build.meta.species];
    const bonus = parseAbilityBonuses(mech?.ability_bonuses);
    return { ...build, featMods: { ...(build.featMods || {}), ...bonus } };
  }, [build, srd.speciesByName]);

  const sheet = useMemo(() => {
    try { return deriveSheet(buildForDerive, ctx); } catch { return null; }
  }, [buildForDerive, ctx]);

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
  const setBackground = (v: string) => patch((b) => { b.meta.background = v; return b; });
  const setClassName = (v: string) => patch((b) => { b.meta.className = v; b.meta.subclass = ""; return b; });
  const setSubclass = (v: string) => patch((b) => { b.meta.subclass = v; return b; });
  const setLevel = (v: number) => patch((b) => { b.level = Math.max(1, Math.min(30, v || 1)); return b; });
  const setAbility = (a: Ability, v: number) =>
    patch((b) => { b.abilities[a] = Math.max(1, Math.min(epic.abilityCap, v || 10)); return b; });
  const addItem = (nm: string) =>
    patch((b) => { if (nm) b.gear.items = [...b.gear.items, { n: nm }]; return b; });
  const removeItem = (i: number) =>
    patch((b) => { b.gear.items = b.gear.items.filter((_, idx) => idx !== i); return b; });
  const setItemMod = (i: number, mod: number) =>
    patch((b) => { b.gear.items = b.gear.items.map((e, idx) => idx === i ? { ...e, mod } : e); return b; });
  const setItemVariant = (i: number, variant: string) =>
    patch((b) => { b.gear.items = b.gear.items.map((e, idx) => idx === i ? { ...e, variant } : e); return b; });
  const editName = (v: string) => { setName(v); setSaveState("idle"); };

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
              </div>

              <IdentityPanel
                build={build} speciesVariant={speciesVariant}
                edition={edition} onEdition={setEdition}
                partners={partners} enabledPartners={enabledPartners} onTogglePartner={togglePartner}
                speciesOpts={speciesOpts} classOpts={classOpts} variantOpts={variantOpts}
                subclassOpts={subclassOpts} backgroundOpts={srd.backgrounds.map((b) => b.name)}
                speciesDesc={speciesDesc} backgroundDesc={backgroundDesc}
                catalogReady={!!catalog} epic={epic}
                onSpecies={setSpecies} onVariant={setVariant} onBackground={setBackground}
                onClassName={setClassName} onSubclass={setSubclass} onLevel={setLevel}
              />

              <AbilitiesPanel build={build} cap={epic.abilityCap} sheet={sheet} onAbility={setAbility} />

              <GearPanel
                build={build} gearIndex={gearIndex} gearTypes={gearTypes} ctx={ctx}
                itemByName={srd.itemByName}
                onAdd={addItem} onRemove={removeItem} onMod={setItemMod} onVariant={setItemVariant}
              />

              <SheetPanel sheet={sheet} name={name || "Character"} />

              <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color:
                  saveState === "saved" ? SAX.good : saveState === "error" ? SAX.warn : STONE.inkFaint }}>
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
                <button className="forge-btn is-ghost" style={stoneButton("ghost")} onClick={saveAndExit}>
                  Save &amp; exit
                </button>
                <button className="forge-btn is-primary" style={stoneButton("primary")} onClick={saveAndContinue}>
                  Save &amp; continue
                </button>
              </div>
            </div>
          )}
        </div>
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
  variantOpts: { name: string; variant_kind: string }[]; subclassOpts: string[]; backgroundOpts: string[];
  speciesDesc: Described | null; backgroundDesc: Described | null;
  catalogReady: boolean;
  epic: { abilityCap: number; asiCount: number; epicFeatCount: number };
  onSpecies: (v: string) => void; onVariant: (v: string) => void; onBackground: (v: string) => void;
  onClassName: (v: string) => void; onSubclass: (v: string) => void; onLevel: (v: number) => void;
}) {
  const {
    build, speciesVariant, edition, onEdition, partners, enabledPartners, onTogglePartner,
    speciesOpts, classOpts, variantOpts, subclassOpts, backgroundOpts, speciesDesc, backgroundDesc,
    catalogReady, epic,
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
        <Field label="Background" value={build.meta.background}
          onChange={onBackground} options={backgroundOpts} />
      </div>

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
        <div style={forgeLabel}>Trained skills</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SKILLS.filter(([k]) => sheet.skills[k]?.rank > 0).map(([k, label]) => (
            <span key={k} style={stoneChip("brass")}>
              {label} {fmtMod(sheet.skills[k].val)}{sheet.skills[k].rank === 2 ? " ⋆" : ""}
            </span>
          ))}
          {SKILLS.every(([k]) => (sheet.skills[k]?.rank || 0) === 0) && (
            <span style={{ color: STONE.inkFaint, fontSize: 13 }}>No trained skills yet.</span>
          )}
        </div>
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
