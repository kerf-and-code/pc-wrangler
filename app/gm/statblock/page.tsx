"use client";

// The GM monster stat-block creator (/gm/statblock). Counterpart to the Forge, but FLAT: a monster
// is authored directly, there is no derivation engine. This is a form editor over the stat_blocks
// `block` JSONB, kept in sync with the denormalized challenge columns the encounter builder reads.
//
// Three modes, mirroring the Forge:
//   ?sb=<id>  edit an existing stat block
//   ?new      author a fresh one (blank, or prefilled from an SRD monster)
//   neither   list the GM's stat blocks to pick, plus New / prefill entry points

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadSrd } from "@/lib/srd/srd";
import {
  blankStatBlock, statBlockFromMonster,
  createStatBlock, getStatBlock, updateStatBlock, listStatBlocks,
  type StatBlockDoc, type StatBlockRow, type NamedEntry,
} from "@/lib/stat-blocks";
import {
  STONE, FORGE_FONTS, stonePanel, stoneButton, stoneField,
  forgeBackground, forgeVignette, forgeLabel, FORGE_BUTTON_CSS,
} from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";
import SixAxesNav from "@/components/six-axes-nav";

type SrdMode = "2024" | "2014" | "both";
type MonsterRec = Record<string, unknown> & { name: string; cr?: string | number };

const ABILITIES: [keyof Pick<StatBlockDoc, "str" | "dex" | "con" | "int" | "wis" | "cha">, string][] = [
  ["str", "STR"], ["dex", "DEX"], ["con", "CON"], ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"],
];

// Standard 5e CR -> XP table, for keeping XP sensible when the GM sets CR by hand.
const CR_XP: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
  "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900, "8": 3900,
  "9": 5000, "10": 5900, "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000,
  "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000,
  "23": 50000, "24": 62000, "25": 75000, "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};

function abilMod(score: number): string {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : String(m);
}

export default function StatBlockPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: STONE.ink }}>Loading the workshop…</div>}>
      <StatBlockInner />
    </Suspense>
  );
}

function StatBlockInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sbId = params.get("sb");
  const isNew = params.get("new") !== null;

  const supabase = useMemo(() => createClient(), []);
  const [gmId, setGmId] = useState<string | null>(null);

  const [srdMode, setSrdMode] = useState<SrdMode>("2014");
  const [status, setStatus] = useState<"loading" | "ready" | "picker">("loading");
  const [rows, setRows] = useState<StatBlockRow[]>([]);

  // The document under edit and its identity.
  const [name, setName] = useState("");
  const [block, setBlock] = useState<StatBlockDoc>(blankStatBlock);
  const [rowId, setRowId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const creatingRef = useRef(false);

  // SRD monsters for the prefill picker.
  const monsters = useMemo<MonsterRec[]>(
    () => (loadSrd("monsters", srdMode) as unknown as MonsterRec[]) || [],
    [srdMode],
  );

  // --- initial load: resolve the GM, then route to edit / new / picker ---
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!alive) return;
      setGmId(auth.user?.id || null);

      if (sbId) {
        const row = await getStatBlock(supabase, sbId);
        if (!alive) return;
        if (row) {
          setName(row.name);
          setBlock({ ...blankStatBlock(), ...row.block });
          setRowId(row.id);
          setStatus("ready");
        } else {
          setStatus("picker");
        }
        return;
      }
      if (isNew) {
        setName("");
        setBlock(blankStatBlock());
        setRowId(null);
        setStatus("ready");
        return;
      }
      // No target: show the picker (existing library + new/prefill entry points).
      const list = await listStatBlocks(supabase).catch(() => []);
      if (!alive) return;
      setRows(list);
      setStatus("picker");
    })();
    return () => { alive = false; };
  }, [supabase, sbId, isNew]);

  // --- persistence: debounced autosave once we have a target we can write to ---
  const persist = useCallback(async (nextName: string, nextBlock: StatBlockDoc) => {
    if (!gmId) return;
    setSaveState("saving");
    try {
      if (rowId) {
        await updateStatBlock(supabase, rowId, { name: nextName || "Unnamed", block: nextBlock });
      } else {
        if (creatingRef.current) return;
        creatingRef.current = true;
        const id = await createStatBlock(supabase, {
          gmId, campaignId: null, name: nextName || "Unnamed",
          sourceEdition: srdMode === "both" ? "2024" : srdMode, block: nextBlock,
        });
        setRowId(id);
        creatingRef.current = false;
        router.replace(`/gm/statblock?sb=${id}`);
      }
      setSaveState("saved");
    } catch {
      setSaveState("error");
      creatingRef.current = false;
    }
  }, [gmId, rowId, supabase, srdMode, router]);

  // Debounce writes ~1s after the last edit. For a brand-new block (no rowId yet) hold off until it
  // has a name, so merely opening "New" doesn't litter the library with empty "Unnamed" blocks.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (status !== "ready") return;
    if (!rowId && !name.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void persist(name, block); }, 1000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // persist intentionally omitted to avoid a new timer on every identity change; name+block drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, block, status, rowId]);

  // --- block mutation helpers ---
  const patch = useCallback((p: Partial<StatBlockDoc>) => setBlock((b) => ({ ...b, ...p })), []);
  const setAbil = (k: string, v: number) => patch({ [k]: v } as Partial<StatBlockDoc>);
  // When CR changes, offer the standard XP so it stays coherent (GM can still override XP).
  const setCr = (cr: string) => patch({ cr, xp: CR_XP[cr] ?? block.xp });

  const prefillFrom = (monsterName: string) => {
    const m = monsters.find((x) => x.name === monsterName);
    if (!m) return;
    setName(m.name);
    setBlock(statBlockFromMonster(m));
    setRowId(null);
    setStatus("ready");
    router.replace("/gm/statblock?new");
  };

  const saveAndExit = async () => { await persist(name, block); router.push("/gm/statblock"); };

  // -------------------------------------------------------------------------
  if (status === "loading") {
    return <Shell><div style={{ color: STONE.inkDim, padding: 20 }}>Opening the workshop…</div></Shell>;
  }

  if (status === "picker") {
    return (
      <Shell>
        <PickerView
          rows={rows} monsters={monsters} srdMode={srdMode} onSrdMode={setSrdMode}
          onNew={() => router.push("/gm/statblock?new")}
          onEdit={(id) => router.push(`/gm/statblock?sb=${id}`)}
          onPrefill={prefillFrom}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ display: "grid", gap: 18, maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <input
            value={name} onChange={(e) => setName(e.target.value)} placeholder="Creature name"
            style={{ ...stoneField(), fontFamily: FORGE_FONTS.display, fontSize: 22, flex: 1, minWidth: 240 }}
          />
          <SrdToggle mode={srdMode} onMode={setSrdMode} />
        </div>

        <IdentityBlock block={block} onPatch={patch} onCr={setCr} />
        <AbilityBlock block={block} onAbil={setAbil} />
        <DefensesBlock block={block} onPatch={patch} />

        <EntryListPanel title="Traits" hint="Passive features (e.g. Nimble Escape, Pack Tactics)."
          entries={block.special_abilities} onChange={(v) => patch({ special_abilities: v })} />
        <EntryListPanel title="Actions" hint="Attacks and activated abilities."
          entries={block.actions} onChange={(v) => patch({ actions: v })} />
        <EntryListPanel title="Bonus Actions" hint="Optional; leave empty if none."
          entries={block.bonus_actions} onChange={(v) => patch({ bonus_actions: v })} collapsedWhenEmpty />
        <EntryListPanel title="Reactions" hint="Optional; leave empty if none."
          entries={block.reactions} onChange={(v) => patch({ reactions: v })} collapsedWhenEmpty />
        <EntryListPanel title="Legendary Actions" hint="For legendary creatures."
          entries={block.legendary_actions} onChange={(v) => patch({ legendary_actions: v })} collapsedWhenEmpty />
        <EntryListPanel title="Special Attacks" hint="Custom signature attacks."
          entries={block.special_attacks} onChange={(v) => patch({ special_attacks: v })} collapsedWhenEmpty />

        <div style={stonePanel()}>
          <div style={forgeLabel}>Notes</div>
          <textarea
            value={block.notes || ""} onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Lair, tactics, treasure, or anything else for your eyes."
            style={{ ...stoneField(), width: "100%", minHeight: 70, marginTop: 6, resize: "vertical" }}
          />
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color:
            saveState === "saved" ? SAX.good : saveState === "error" ? SAX.warn : STONE.inkFaint }}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved"
              : saveState === "error" ? "Save failed. Retrying on next change." : "Unsaved changes"}
          </span>
          <button className="forge-btn is-primary" style={stoneButton("primary")} onClick={saveAndExit}>
            Save &amp; close
          </button>
        </div>
      </div>
    </Shell>
  );
}

// A challenge-and-identity block: size, type, alignment, CR/XP, AC/HP, speed.
function IdentityBlock({ block, onPatch, onCr }: {
  block: StatBlockDoc; onPatch: (p: Partial<StatBlockDoc>) => void; onCr: (cr: string) => void;
}) {
  return (
    <div style={stonePanel()}>
      <div style={forgeLabel}>Identity &amp; challenge</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 8 }}>
        <Field label="Size"><input value={block.size} onChange={(e) => onPatch({ size: e.target.value })} style={stoneField()} /></Field>
        <Field label="Type"><input value={block.type} onChange={(e) => onPatch({ type: e.target.value })} style={stoneField()} /></Field>
        <Field label="Subtype"><input value={block.subtype || ""} onChange={(e) => onPatch({ subtype: e.target.value })} style={stoneField()} /></Field>
        <Field label="Alignment"><input value={block.alignment} onChange={(e) => onPatch({ alignment: e.target.value })} style={stoneField()} /></Field>
        <Field label="Challenge (CR)">
          <input value={block.cr} onChange={(e) => onCr(e.target.value)} style={stoneField()} />
        </Field>
        <Field label="XP"><NumInput value={block.xp} onChange={(v) => onPatch({ xp: v })} /></Field>
        <Field label="Prof. bonus"><NumInput value={block.proficiency_bonus ?? null} onChange={(v) => onPatch({ proficiency_bonus: v })} /></Field>
        <Field label="Armor Class"><NumInput value={block.ac} onChange={(v) => onPatch({ ac: v })} /></Field>
        <Field label="Hit Points"><NumInput value={block.hp} onChange={(v) => onPatch({ hp: v })} /></Field>
        <Field label="Hit dice"><input value={block.hit_dice || ""} onChange={(e) => onPatch({ hit_dice: e.target.value })} placeholder="e.g. 2d6" style={stoneField()} /></Field>
        <Field label="Speed"><input value={block.speed} onChange={(e) => onPatch({ speed: e.target.value })} placeholder="30 ft." style={stoneField()} /></Field>
      </div>
    </div>
  );
}

// The six ability scores with live modifiers.
function AbilityBlock({ block, onAbil }: { block: StatBlockDoc; onAbil: (k: string, v: number) => void }) {
  return (
    <div style={stonePanel()}>
      <div style={forgeLabel}>Ability scores</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginTop: 8 }}>
        {ABILITIES.map(([k, lbl]) => (
          <div key={k} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkDim }}>{lbl}</div>
            <input
              type="number" value={block[k]} onChange={(e) => onAbil(k, parseInt(e.target.value, 10) || 0)}
              style={{ ...stoneField(), textAlign: "center", padding: "6px 2px", width: "100%" }}
            />
            <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 13, color: STONE.brassHi, marginTop: 2 }}>
              {abilMod(block[k])}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Senses, languages, and the resistance/immunity/vulnerability lists (comma-separated).
function DefensesBlock({ block, onPatch }: { block: StatBlockDoc; onPatch: (p: Partial<StatBlockDoc>) => void }) {
  const csv = (arr: string[]) => arr.join(", ");
  const parse = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <div style={stonePanel()}>
      <div style={forgeLabel}>Defenses &amp; senses</div>
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        <Field label="Senses"><input value={block.senses} onChange={(e) => onPatch({ senses: e.target.value })} placeholder="darkvision 60 ft., passive Perception 9" style={stoneField()} /></Field>
        <Field label="Languages"><input value={block.languages} onChange={(e) => onPatch({ languages: e.target.value })} placeholder="Common, Goblin" style={stoneField()} /></Field>
        <Field label="Damage resistances"><input value={csv(block.damage_resistances)} onChange={(e) => onPatch({ damage_resistances: parse(e.target.value) })} style={stoneField()} /></Field>
        <Field label="Damage immunities"><input value={csv(block.damage_immunities)} onChange={(e) => onPatch({ damage_immunities: parse(e.target.value) })} style={stoneField()} /></Field>
        <Field label="Damage vulnerabilities"><input value={csv(block.damage_vulnerabilities)} onChange={(e) => onPatch({ damage_vulnerabilities: parse(e.target.value) })} style={stoneField()} /></Field>
        <Field label="Condition immunities"><input value={csv(block.condition_immunities)} onChange={(e) => onPatch({ condition_immunities: parse(e.target.value) })} style={stoneField()} /></Field>
      </div>
    </div>
  );
}

// A repeatable list of {name, desc} entries with add/remove. Used for traits/actions/etc.
function EntryListPanel({ title, hint, entries, onChange, collapsedWhenEmpty }: {
  title: string; hint: string; entries: NamedEntry[];
  onChange: (v: NamedEntry[]) => void; collapsedWhenEmpty?: boolean;
}) {
  const [open, setOpen] = useState(!collapsedWhenEmpty || entries.length > 0);
  const add = () => { onChange([...entries, { name: "", desc: "" }]); setOpen(true); };
  const update = (i: number, e: NamedEntry) => onChange(entries.map((x, j) => (j === i ? e : x)));
  const remove = (i: number) => onChange(entries.filter((_, j) => j !== i));

  return (
    <div style={stonePanel()}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={forgeLabel}>{title}</div>
        <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint }}>{entries.length}</span>
        <span style={{ flex: 1 }} />
        {collapsedWhenEmpty && entries.length === 0 && !open ? (
          <button className="forge-btn is-ghost" style={{ ...stoneButton("ghost"), padding: "5px 12px", fontSize: 12 }} onClick={() => setOpen(true)}>Add</button>
        ) : (
          <button className="forge-btn is-ghost" style={{ ...stoneButton("ghost"), padding: "5px 12px", fontSize: 12 }} onClick={add}>+ Add</button>
        )}
      </div>
      {open && (
        <>
          <p style={{ fontSize: 12, color: STONE.inkFaint, margin: "4px 0 10px" }}>{hint}</p>
          <div style={{ display: "grid", gap: 10 }}>
            {entries.map((e, i) => (
              <div key={i} style={{ borderLeft: `2px solid ${STONE.mortar}`, paddingLeft: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <input value={e.name} onChange={(ev) => update(i, { ...e, name: ev.target.value })}
                    placeholder="Name" style={{ ...stoneField(), flex: 1, fontWeight: 600 }} />
                  <button className="forge-btn is-ghost" style={{ ...stoneButton("ghost"), padding: "4px 10px", fontSize: 11 }} onClick={() => remove(i)}>Remove</button>
                </div>
                <textarea value={e.desc} onChange={(ev) => update(i, { ...e, desc: ev.target.value })}
                  placeholder="Description" style={{ ...stoneField(), width: "100%", minHeight: 54, resize: "vertical" }} />
              </div>
            ))}
            {entries.length === 0 && <p style={{ fontSize: 12.5, color: STONE.inkFaint, fontStyle: "italic" }}>None yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}

// The landing/picker view: existing library, plus New and prefill-from-SRD.
function PickerView({ rows, monsters, srdMode, onSrdMode, onNew, onEdit, onPrefill }: {
  rows: StatBlockRow[]; monsters: MonsterRec[]; srdMode: SrdMode; onSrdMode: (m: SrdMode) => void;
  onNew: () => void; onEdit: (id: string) => void; onPrefill: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return monsters.slice(0, 60);
    return monsters.filter((m) => m.name.toLowerCase().includes(s)).slice(0, 60);
  }, [q, monsters]);

  return (
    <div style={{ display: "grid", gap: 20, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: FORGE_FONTS.display, fontSize: 26, color: STONE.ink, margin: 0 }}>Stat block workshop</h1>
        <span style={{ flex: 1 }} />
        <button className="forge-btn is-primary" style={stoneButton("primary")} onClick={onNew}>+ New from scratch</button>
      </div>

      {rows.length > 0 && (
        <div style={stonePanel()}>
          <div style={forgeLabel}>Your stat blocks</div>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {rows.map((r) => (
              <button key={r.id} onClick={() => onEdit(r.id)}
                style={{ ...stoneButton("stone"), textAlign: "left", display: "flex", gap: 12, alignItems: "baseline" }}>
                <span style={{ fontFamily: FORGE_FONTS.body, fontSize: 15, color: STONE.ink }}>{r.name}</span>
                <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color: STONE.inkFaint }}>
                  CR {r.cr || "?"} · {r.size || ""} {r.type || ""} · AC {r.ac ?? "?"} · HP {r.hp ?? "?"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={stonePanel()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={forgeLabel}>Start from an SRD monster</div>
          <span style={{ flex: 1 }} />
          <SrdToggle mode={srdMode} onMode={onSrdMode} />
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search monsters…"
          style={{ ...stoneField(), width: "100%", margin: "10px 0" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
          {filtered.map((m) => (
            <button key={m.name} onClick={() => onPrefill(m.name)}
              style={{ ...stoneButton("stone"), textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 13.5, color: STONE.ink }}>{m.name}</span>
              <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkFaint }}>CR {String(m.cr ?? "?")}</span>
            </button>
          ))}
        </div>
        {monsters.length === 0 && <p style={{ color: STONE.inkFaint, fontSize: 13 }}>No monsters loaded for this ruleset.</p>}
      </div>
    </div>
  );
}

function SrdToggle({ mode, onMode }: { mode: SrdMode; onMode: (m: SrdMode) => void }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {(["2024", "2014", "both"] as const).map((m) => (
        <button key={m} className={`forge-btn ${mode === m ? "is-primary" : "is-ghost"}`}
          style={{ ...stoneButton(mode === m ? "primary" : "ghost"), padding: "5px 12px", fontSize: 12 }}
          onClick={() => onMode(m)}>
          {m === "both" ? "Both" : m}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 3 }}>
      <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10.5, color: STONE.inkDim, textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</span>
      {children}
    </label>
  );
}

// A numeric input that stores null for empty rather than 0.
function NumInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input type="number" value={value ?? ""} onChange={(e) => {
      const v = e.target.value;
      onChange(v === "" ? null : parseInt(v, 10));
    }} style={stoneField()} />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", ...forgeBackground() }}>
      <style>{FORGE_BUTTON_CSS}</style>
      <SixAxesNav />
      <div style={forgeVignette()} />
      <div style={{ position: "relative", padding: "28px 20px 80px" }}>{children}</div>
    </div>
  );
}
