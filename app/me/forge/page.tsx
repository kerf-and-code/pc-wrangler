"use client";

// app/me/forge/page.tsx
//
// The Forge — the player-side PC character-sheet creator. Core slice: identity pickers, ability
// scores, gear (the part that makes items change the derived stats), and a live sheet computed by
// deriveSheet on every edit. Wired to characters.build.
//
// DATA PATH. The stable (app/me/characters) lists a player's characters via the my_characters RPC.
// The Forge opens ONE of them with ?c=<character_id>, reads its build jsonb + denormalized columns
// straight from the characters table, and writes build back with an update (the existing
// "owner or gm edits character" UPDATE policy already permits the owner). No new table: the sheet
// IS characters.build. If ?c is absent the page lists the stable so the player can pick one.
//
// AESTHETIC. Uses the locked dungeon design language from lib/forge-theme: the wall background,
// translucent carved-stone panels, depth buttons, recessed stat tiles. Cinzel for display.

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SAX, stoneBackground } from "@/lib/theme";
import SixAxesNav from "@/components/six-axes-nav";
import {
  STONE, FORGE_FONTS, forgeBackground, forgeVignette, stonePanel, stoneButton,
  FORGE_BUTTON_CSS, statTile, stoneField, stoneChip, forgeHeading, forgePanelTitle,
  forgeLabel, forgeRuleLine, forgeBoss,
} from "@/lib/forge-theme";
import { loadSrd } from "@/lib/srd/srd";
import { buildRulesContext } from "@/lib/srd/rules-context";
import {
  deriveSheet, epicAdvancement, ABILITIES, SKILLS,
  type Ability, type Build, type Ruleset, type GearEntry,
} from "@/lib/srd/derive-sheet";

// ---------------------------------------------------------------------------
// A fresh build: sensible level-1 defaults the player edits from.
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

// The stored build may be partial or from an older shape; fill any gaps so deriveSheet never
// reads undefined. This is the one place that reconciles characters.build with the engine's Build.
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
  level: number | null; alignment: string | null; campaign_id: string;
};

type StableRow = {
  character_id: string; name: string; campaign_id: string; campaign_name: string;
  species: string | null; class: string | null; level: number | null; kind: string;
};

const RULESET: Ruleset = "2024"; // core slice fixes the ruleset; a toggle comes in the next pass

// SRD option lists, loaded once for the current ruleset.
type NameRow = { name: string };
type SpeciesData = { species: NameRow[]; variants: unknown[] };
type SubclassRow = { class: string; subclass: string };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// The default export wraps the working component in a Suspense boundary, because ForgeInner
// calls useSearchParams() (to read ?c=<id>), which Next.js requires be inside <Suspense> so the
// route can prerender instead of being forced fully dynamic.
export default function ForgePage() {
  return (
    <Suspense fallback={null}>
      <ForgeInner />
    </Suspense>
  );
}

function ForgeInner() {
  const supabase = createClient();
  const params = useSearchParams();
  const charId = params.get("c");

  const [stable, setStable] = useState<StableRow[]>([]);
  const [row, setRow] = useState<CharRow | null>(null);
  const [build, setBuild] = useState<Build>(emptyBuild());
  const [status, setStatus] = useState<"loading" | "ready" | "picking" | "error" | "signedout">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Load: either the chosen character (?c) or the stable to pick from.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setStatus("signedout"); return; }

      if (!charId) {
        const { data, error } = await supabase.rpc("my_characters");
        if (!active) return;
        if (error) { setStatus("error"); return; }
        setStable(((data as StableRow[]) || []).filter((c) => c.kind === "pc"));
        setStatus("picking");
        return;
      }

      const { data, error } = await supabase
        .from("characters")
        .select("id, name, build, species, class, subclass, level, alignment, campaign_id")
        .eq("id", charId)
        .single();
      if (!active) return;
      if (error || !data) { setStatus("error"); return; }
      const r = data as CharRow;
      setRow(r);
      setBuild(seedFromRow(normalizeBuild(r.build), r));
      setStatus("ready");
    })();
    return () => { active = false; };
  }, [supabase, charId]);

  // Seed build.meta / level from the denormalized columns when the jsonb is empty (a character
  // claimed at the table has species/class set but may never have been opened in the Forge).
  function seedFromRow(b: Build, r: CharRow): Build {
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

  // --- SRD option lists + rules context (memoized on ruleset) ---
  const srd = useMemo(() => {
    const species = loadSrd("species", RULESET) as unknown as SpeciesData;
    const classes = loadSrd("classes", RULESET) as unknown as NameRow[];
    const backgrounds = loadSrd("backgrounds", RULESET) as unknown as NameRow[];
    const subclasses = loadSrd("subclasses", RULESET) as unknown as SubclassRow[];
    const equipment = loadSrd("equipment", RULESET) as unknown as NameRow[];
    const magic = loadSrd("magic-items", RULESET) as unknown as NameRow[];
    return { species, classes, backgrounds, subclasses, equipment, magic };
  }, []);

  const ctx = useMemo(() => buildRulesContext(RULESET), []);

  // The live sheet: recomputed on every build change. This is the whole point.
  const sheet = useMemo(() => {
    try { return deriveSheet(build, ctx); } catch { return null; }
  }, [build, ctx]);

  const epic = useMemo(() => epicAdvancement(build.level), [build.level]);

  // Subclasses filtered to the chosen class.
  const classSubclasses = useMemo(
    () => srd.subclasses.filter((s) => s.class === build.meta.className).map((s) => s.subclass),
    [srd.subclasses, build.meta.className],
  );

  // Every item the player can add (mundane gear + magic items), by name.
  const itemNames = useMemo(() => {
    const names = new Set<string>();
    srd.equipment.forEach((e) => names.add(e.name));
    srd.magic.forEach((m) => names.add(m.name));
    return Array.from(names).sort();
  }, [srd.equipment, srd.magic]);

  // --- mutations (all go through setBuild so the sheet re-derives) ---
  const patch = useCallback((fn: (b: Build) => Build) => {
    setBuild((prev) => fn(structuredCloneSafe(prev)));
    setSaveState("idle");
  }, []);

  const setMeta = (k: keyof Build["meta"], v: string) =>
    patch((b) => { b.meta[k] = v; if (k === "className") b.meta.subclass = ""; return b; });
  const setLevel = (v: number) =>
    patch((b) => { b.level = Math.max(1, Math.min(30, v || 1)); return b; });
  const setAbility = (a: Ability, v: number) =>
    patch((b) => { b.abilities[a] = Math.max(1, Math.min(epic.abilityCap, v || 10)); return b; });
  const addItem = (name: string) =>
    patch((b) => { if (name) b.gear.items = [...b.gear.items, { n: name }]; return b; });
  const removeItem = (i: number) =>
    patch((b) => { b.gear.items = b.gear.items.filter((_, idx) => idx !== i); return b; });
  const setItemMod = (i: number, mod: number) =>
    patch((b) => { b.gear.items = b.gear.items.map((e, idx) => idx === i ? { ...e, mod } : e); return b; });
  const setItemVariant = (i: number, variant: string) =>
    patch((b) => { b.gear.items = b.gear.items.map((e, idx) => idx === i ? { ...e, variant } : e); return b; });

  // --- save: write build + the denormalized columns the roster/encounter read ---
  const save = useCallback(async () => {
    if (!row) return;
    setSaveState("saving");
    const { error } = await supabase
      .from("characters")
      .update({
        build: build as unknown as Record<string, unknown>,
        species: build.meta.species || null,
        class: build.meta.className || null,
        subclass: build.meta.subclass || null,
        level: build.level,
      })
      .eq("id", row.id);
    setSaveState(error ? "error" : "saved");
  }, [supabase, row, build]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const shellStyle: React.CSSProperties = {
    position: "relative", minHeight: "100dvh", color: STONE.ink,
    fontFamily: FORGE_FONTS.body, ...forgeBackground(),
  };

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

          {status === "picking" && (
            <Picking stable={stable} />
          )}

          {status === "ready" && sheet && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
              <IdentityPanel
                build={build} srd={srd} classSubclasses={classSubclasses}
                epic={epic} onMeta={setMeta} onLevel={setLevel}
              />

              <AbilitiesPanel build={build} cap={epic.abilityCap} sheet={sheet} onAbility={setAbility} />

              <GearPanel
                build={build} itemNames={itemNames} ctx={ctx}
                onAdd={addItem} onRemove={removeItem} onMod={setItemMod} onVariant={setItemVariant}
              />

              <SheetPanel build={build} sheet={sheet} epic={epic} name={row?.name || "Character"} />

              <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "flex-end" }}>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color:
                  saveState === "saved" ? SAX.good : saveState === "error" ? SAX.warn : STONE.inkFaint }}>
                  {saveState === "saving" ? "Saving to the anvil…"
                    : saveState === "saved" ? "Saved"
                    : saveState === "error" ? "Save failed. Try again."
                    : "Unsaved changes"}
                </span>
                <button className="forge-btn is-primary" style={stoneButton("primary")} onClick={save}>
                  Save character
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

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

// A carved dropdown (stoneField + a brass chevron).
function Field({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: 16, position: "relative" }}>
      <label style={forgeLabel}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={stoneField()}>
        <option value="">{placeholder || `Choose ${label.toLowerCase()}`}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <span style={{ position: "absolute", right: 14, bottom: 14, fontSize: 9, color: SAX.brass, pointerEvents: "none" }}>▼</span>
    </div>
  );
}

function IdentityPanel({ build, srd, classSubclasses, epic, onMeta, onLevel }: {
  build: Build; srd: ReturnType<typeof useSrdShape>; classSubclasses: string[];
  epic: { abilityCap: number; asiCount: number; epicFeatCount: number };
  onMeta: (k: keyof Build["meta"], v: string) => void; onLevel: (v: number) => void;
}) {
  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Who this character is. Levels 1 to 30; past 20 unlocks epic advancement.">Identity</PanelTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Field label="Species" value={build.meta.species}
          onChange={(v) => onMeta("species", v)} options={srd.species.species.map((s) => s.name)} />
        <Field label="Background" value={build.meta.background}
          onChange={(v) => onMeta("background", v)} options={srd.backgrounds.map((b) => b.name)} />
        <Field label="Class" value={build.meta.className}
          onChange={(v) => onMeta("className", v)} options={srd.classes.map((c) => c.name)} />
        <Field label="Subclass" value={build.meta.subclass}
          onChange={(v) => onMeta("subclass", v)} options={classSubclasses}
          placeholder={build.meta.className ? "Choose subclass" : "Choose a class first"} />
      </div>
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
      <PanelTitle hint="Base scores. Gear can raise or set these — the effective value shows below each.">Ability scores</PanelTitle>
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

function GearPanel({ build, itemNames, ctx, onAdd, onRemove, onMod, onVariant }: {
  build: Build; itemNames: string[];
  ctx: ReturnType<typeof buildRulesContext>;
  onAdd: (n: string) => void; onRemove: (i: number) => void;
  onMod: (i: number, mod: number) => void; onVariant: (i: number, v: string) => void;
}) {
  const [pick, setPick] = useState("");
  return (
    <div style={stonePanel()}>
      <PanelTitle hint="Equip gear and it flows into the sheet — armor sets AC, a belt can set a score, a +1 weapon adjusts attacks.">Gear</PanelTitle>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <label style={forgeLabel}>Add item</label>
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={stoneField()}>
            <option value="">Choose an item</option>
            {itemNames.map((n) => <option key={n} value={n}>{n}</option>)}
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
        return (
          <div key={`${e.n}-${i}`} style={{ display: "flex", gap: 10, alignItems: "center",
            padding: "8px 0", borderBottom: `1px solid ${STONE.mortar}` }}>
            <span style={{ flex: 1, fontFamily: FORGE_FONTS.body, fontSize: 16, color: STONE.ink }}>
              {e.n}
              {def?.sub ? <span style={{ color: STONE.inkFaint, fontSize: 13 }}> · {def.sub}</span> : null}
            </span>

            {variantSpec && (
              <select value={e.variant || ""} onChange={(ev) => onVariant(i, ev.target.value)}
                style={{ ...stoneField(), width: 150, padding: "6px 10px", fontSize: 13 }}>
                <option value="">{variantSpec.options[0] ? "Choose variant" : ""}</option>
                {variantSpec.options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
            )}

            {canMod && (
              <select value={e.mod || 0} onChange={(ev) => onMod(i, parseInt(ev.target.value, 10))}
                style={{ ...stoneField(), width: 74, padding: "6px 10px", fontSize: 13 }}>
                {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n ? `+${n}` : "±0"}</option>)}
              </select>
            )}

            <button className="forge-btn is-ghost" style={{ ...stoneButton("ghost"), padding: "6px 12px", fontSize: 12 }}
              onClick={() => onRemove(i)}>Remove</button>
          </div>
        );
      })}
    </div>
  );
}

function SheetPanel({ build, sheet, epic, name }: {
  build: Build; sheet: NonNullable<ReturnType<typeof deriveSheet>>;
  epic: { abilityCap: number }; name: string;
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

      {/* Saves */}
      <div style={{ marginTop: 18 }}>
        <div style={forgeLabel}>Saving throws</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ABILITIES.map((a) => (
            <span key={a} style={stoneChip("brass")}>{a.toUpperCase()} {fmtMod(sheet.saves[a])}</span>
          ))}
        </div>
      </div>

      {/* Resistances, if any */}
      {sheet.resist.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={forgeLabel}>Resistances</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sheet.resist.map((r, i) => <span key={`${r}-${i}`} style={stoneChip("moss")}>{r}</span>)}
          </div>
        </div>
      )}

      {/* Skills the character is trained in */}
      <div style={{ marginTop: 14 }}>
        <div style={forgeLabel}>Trained skills</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SKILLS.filter(([k]) => sheet.skills[k]?.rank > 0).map(([k, name]) => (
            <span key={k} style={stoneChip("brass")}>
              {name} {fmtMod(sheet.skills[k].val)}{sheet.skills[k].rank === 2 ? " ⋆" : ""}
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
// Small helpers
// ---------------------------------------------------------------------------

const fmtMod = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

// structuredClone is available in modern browsers; fall back to JSON for older ones.
function structuredCloneSafe<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

// A tiny type alias so IdentityPanel's prop can name the srd shape without repeating it.
function useSrdShape() {
  return {
    species: { species: [] as { name: string }[], variants: [] as unknown[] },
    classes: [] as { name: string }[],
    backgrounds: [] as { name: string }[],
    subclasses: [] as { class: string; subclass: string }[],
    equipment: [] as { name: string }[],
    magic: [] as { name: string }[],
  };
}
