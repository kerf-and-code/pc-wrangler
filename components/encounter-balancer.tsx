"use client";

// components/encounter-balancer.tsx
//
// The free, no-login encounter balancer. Reuses the SAME per-system math as the in-app builder: the D&D
// constants (lib/tools/encounter-dnd, copied verbatim from app/gm/encounters) and the real Pathfinder 2e
// encounter lib. No auth, no campaign, no save; state lives in memory for the session.
//
// "Who's at the table" is entered by hand here (class, subclass, level). The line under it is the funnel:
// in the product this fills in from the players' actual characters, and the analysis is measured from
// real play rather than typed in. Class and subclass are captured for that continuity (and future role
// coverage); the encounter math itself keys on level and party size, exactly as the tabletop rules do.

import { useMemo, useState } from "react";
import {
  computeDnd, CR_LIST, type DndMethod,
} from "@/lib/tools/encounter-dnd";
import {
  pf2Budget, pf2EncounterXp, pf2Threat, PF2_THREATS, PF2_THREAT_LABEL,
} from "@/lib/pf2e/encounter";

type SystemKey = "dnd" | "pf2e";

const CLASSES: Record<SystemKey, string[]> = {
  dnd: ["Artificer", "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"],
  pf2e: ["Alchemist", "Barbarian", "Bard", "Champion", "Cleric", "Druid", "Fighter", "Investigator", "Monk", "Oracle", "Ranger", "Rogue", "Sorcerer", "Swashbuckler", "Witch", "Wizard"],
};

let seq = 0;
const nid = () => `r${++seq}`;

type PC = { id: string; cls: string; sub: string; level: number };
type PfFoe = { id: string; level: number; count: number };

export default function EncounterBalancer() {
  const [system, setSystem] = useState<SystemKey>("dnd");
  const [method, setMethod] = useState<DndMethod>("2024");
  const [party, setParty] = useState<PC[]>([
    { id: nid(), cls: "Fighter", sub: "", level: 3 },
    { id: nid(), cls: "Cleric", sub: "", level: 3 },
    { id: nid(), cls: "Rogue", sub: "", level: 3 },
    { id: nid(), cls: "Wizard", sub: "", level: 3 },
  ]);
  const [dndRows, setDndRows] = useState<{ id: string; cr: string; count: number }[]>([
    { id: nid(), cr: "2", count: 2 },
  ]);
  const [pfRows, setPfRows] = useState<PfFoe[]>([{ id: nid(), level: 3, count: 2 }]);

  const levels = party.map((p) => p.level);
  const partySize = party.length;

  const dnd = useMemo(
    () => computeDnd(levels, dndRows.map((r) => ({ cr: r.cr, count: r.count })), method),
    [levels, dndRows, method],
  );

  const pf = useMemo(() => {
    const size = Math.max(1, partySize);
    const pfLevel = Math.max(1, Math.round(levels.reduce((a, b) => a + b, 0) / size));
    const foeLevels = pfRows.flatMap((r) => Array(Math.max(0, r.count)).fill(r.level) as number[]);
    const total = pf2EncounterXp(foeLevels, pfLevel);
    const threat = pf2Threat(total, size);
    const budget = pf2Budget(size);
    return { size, pfLevel, total, threat, budget };
  }, [levels, partySize, pfRows]);

  const classList = CLASSES[system];

  return (
    <div>
      {/* System picker */}
      <div style={row}>
        <label style={fieldLabel}>System</label>
        <select value={system} onChange={(e) => setSystem(e.target.value as SystemKey)} style={{ ...input, maxWidth: 260 }}>
          <option value="dnd">Dungeons &amp; Dragons 5e</option>
          <option value="pf2e">Pathfinder 2e</option>
        </select>
        {system === "dnd" && (
          <div style={{ display: "inline-flex", gap: 6, marginLeft: 10 }}>
            {(["2024", "2014"] as const).map((m) => (
              <button key={m} onClick={() => setMethod(m)} style={m === method ? pillOn : pill}>
                {m === "2024" ? "2024 rules" : "2014 rules"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Who's at the table */}
      <section style={card}>
        <h2 style={h2}>Who&apos;s at the table</h2>
        <p style={note}>
          In Six Axes this fills in automatically from your players&apos; characters. Here, add them by hand.
        </p>
        <div style={{ marginTop: 12 }}>
          {party.map((p) => (
            <div key={p.id} style={pcRow}>
              <select value={p.cls} onChange={(e) => upd(setParty, p.id, { cls: e.target.value })} style={{ ...input, flex: "1 1 130px" }}>
                {classList.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                value={p.sub}
                onChange={(e) => upd(setParty, p.id, { sub: e.target.value })}
                placeholder="Subclass (optional)"
                maxLength={40}
                style={{ ...input, flex: "1 1 150px" }}
              />
              <input
                type="number" min={1} max={20} value={p.level}
                onChange={(e) => upd(setParty, p.id, { level: clampLevel(e.target.value) })}
                style={{ ...input, width: 74 }}
                aria-label="Level"
              />
              <button onClick={() => setParty((xs) => xs.length > 1 ? xs.filter((x) => x.id !== p.id) : xs)} style={xBtn} aria-label="Remove">×</button>
            </div>
          ))}
        </div>
        <button onClick={() => setParty((xs) => [...xs, { id: nid(), cls: classList[0], sub: "", level: xs[xs.length - 1]?.level ?? 1 }])} style={addBtn}>
          Add a character
        </button>
      </section>

      {/* The fight */}
      <section style={card}>
        <h2 style={h2}>The fight</h2>
        {system === "dnd" ? (
          <>
            <p style={note}>Add monsters by challenge rating. Numbers use the {method} DMG method.</p>
            <div style={{ marginTop: 12 }}>
              {dndRows.map((f) => (
                <div key={f.id} style={pcRow}>
                  <label style={{ ...fieldLabel, flex: "0 0 auto", marginRight: 4 }}>CR</label>
                  <select value={f.cr} onChange={(e) => upd(setDndRows, f.id, { cr: e.target.value })} style={{ ...input, flex: "1 1 100px" }}>
                    {CR_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <label style={{ ...fieldLabel, flex: "0 0 auto", margin: "0 4px" }}>x</label>
                  <input type="number" min={1} value={f.count} onChange={(e) => upd(setDndRows, f.id, { count: clampCount(e.target.value) })} style={{ ...input, width: 74 }} aria-label="Count" />
                  <button onClick={() => setDndRows((xs) => xs.filter((x) => x.id !== f.id))} style={xBtn} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
            <button onClick={() => setDndRows((xs) => [...xs, { id: nid(), cr: "1", count: 1 }])} style={addBtn}>Add a monster</button>
          </>
        ) : (
          <>
            <p style={note}>Add creatures by their level. Pathfinder prices each creature against the party&apos;s level.</p>
            <div style={{ marginTop: 12 }}>
              {pfRows.map((f) => (
                <div key={f.id} style={pcRow}>
                  <label style={{ ...fieldLabel, flex: "0 0 auto", marginRight: 4 }}>Creature level</label>
                  <input type="number" min={-1} max={25} value={f.level} onChange={(e) => upd(setPfRows, f.id, { level: clampInt(e.target.value, -1, 25) })} style={{ ...input, width: 84 }} aria-label="Creature level" />
                  <label style={{ ...fieldLabel, flex: "0 0 auto", margin: "0 4px" }}>x</label>
                  <input type="number" min={1} value={f.count} onChange={(e) => upd(setPfRows, f.id, { count: clampCount(e.target.value) })} style={{ ...input, width: 74 }} aria-label="Count" />
                  <button onClick={() => setPfRows((xs) => xs.filter((x) => x.id !== f.id))} style={xBtn} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
            <button onClick={() => setPfRows((xs) => [...xs, { id: nid(), level: pf.pfLevel, count: 1 }])} style={addBtn}>Add a creature</button>
          </>
        )}
      </section>

      {/* Verdict */}
      {system === "dnd" ? (
        <section style={verdictCard}>
          <div style={verdictTop}>
            <div>
              <div style={verdictLabel}>Difficulty</div>
              <div style={{ ...verdictBig, color: bandColorDnd(dnd.band) }}>{dnd.band}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={verdictLabel}>Encounter XP</div>
              <div style={verdictNum}>{dnd.foeXp.toLocaleString()}</div>
              {method === "2014" && dnd.multiplier !== 1 && (
                <div style={mini}>{dnd.foeXpRaw.toLocaleString()} raw x{dnd.multiplier}</div>
              )}
            </div>
          </div>
          <div style={tierRow}>
            {dnd.tiers.map((t, i) => (
              <div key={i} style={tierCell}>
                <div style={tierLabel}>{dnd.labels[i]}</div>
                <div style={tierNum}>{t.toLocaleString()}</div>
              </div>
            ))}
          </div>
          <p style={verdictNote}>
            {method === "2024"
              ? "2024 method: no encounter multiplier, so ten monsters count as ten monsters."
              : "2014 method: the party-size multiplier is applied to the raw XP before comparing."}
          </p>
        </section>
      ) : (
        <section style={verdictCard}>
          <div style={verdictTop}>
            <div>
              <div style={verdictLabel}>Threat</div>
              <div style={{ ...verdictBig, color: bandColorPf(pf.threat) }}>
                {pf.threat ? PF2_THREAT_LABEL[pf.threat] : "Below Trivial"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={verdictLabel}>Encounter XP</div>
              <div style={verdictNum}>{pf.total}</div>
              <div style={mini}>party level {pf.pfLevel}, {pf.size} PC{pf.size === 1 ? "" : "s"}</div>
            </div>
          </div>
          <div style={tierRow}>
            {PF2_THREATS.map((t) => (
              <div key={t} style={tierCell}>
                <div style={tierLabel}>{PF2_THREAT_LABEL[t]}</div>
                <div style={tierNum}>{pf.budget[t]}</div>
              </div>
            ))}
          </div>
          <p style={verdictNote}>
            Pathfinder assumes a single party level; this uses the average of the characters above. Creatures
            are priced by how far their level sits from the party&apos;s.
          </p>
        </section>
      )}
    </div>
  );
}

// helpers -------------------------------------------------------------
function upd<T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, id: string, patch: Partial<T>) {
  setter((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
}
function clampLevel(v: string) { return clampInt(v, 1, 20); }
function clampCount(v: string) { return Math.max(1, parseInt(v, 10) || 1); }
function clampInt(v: string, lo: number, hi: number) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function bandColorDnd(band: string) {
  if (band === "Deadly" || band === "High") return "#9a3b2e";
  if (band === "Hard" || band === "Moderate") return "#8a6a2f";
  if (band === "Trivial") return "#8a8069";
  return "#4a7a4a";
}
function bandColorPf(t: string | null) {
  if (t === "extreme" || t === "severe") return "#9a3b2e";
  if (t === "moderate") return "#8a6a2f";
  if (!t || t === "trivial") return "#8a8069";
  return "#4a7a4a";
}

// styles --------------------------------------------------------------
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 };
const card: React.CSSProperties = { marginTop: 20, padding: "20px 0 0", borderTop: "1px solid #ddd4c2" };
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 600, margin: "0 0 4px", color: "#2a2620" };
const note: React.CSSProperties = { fontSize: 14.5, color: "#7a6f57", fontStyle: "italic", margin: 0, lineHeight: 1.55 };
const pcRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" };
const fieldLabel: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12, letterSpacing: "0.04em",
  color: "#6a6252", textTransform: "uppercase",
};
const input: React.CSSProperties = {
  padding: "9px 11px", fontSize: 15.5, fontFamily: "'Iowan Old Style', Georgia, serif", color: "#2a2620",
  background: "#fffdf8", border: "1px solid #c9bfa8", borderRadius: 3, boxSizing: "border-box", colorScheme: "light",
};
const addBtn: React.CSSProperties = {
  marginTop: 6, background: "transparent", color: "#8a6a2f", border: "1px solid #c9bfa8", borderRadius: 3,
  padding: "8px 14px", fontSize: 13.5, cursor: "pointer", fontFamily: "'Iowan Old Style', Georgia, serif",
};
const xBtn: React.CSSProperties = {
  background: "transparent", border: "none", color: "#b0a488", fontSize: 20, lineHeight: 1, cursor: "pointer", padding: "0 4px",
};
const pill: React.CSSProperties = {
  background: "transparent", color: "#6a6252", border: "1px solid #c9bfa8", borderRadius: 3, padding: "7px 12px",
  fontSize: 12.5, cursor: "pointer", fontFamily: "ui-monospace, monospace", letterSpacing: "0.04em",
};
const pillOn: React.CSSProperties = { ...pill, background: "#3a352c", color: "#f6f2e9", borderColor: "#3a352c" };
const verdictCard: React.CSSProperties = {
  marginTop: 24, padding: "20px 22px", background: "#fffdf8", border: "1px solid #cfc3a4", borderRadius: 8,
};
const verdictTop: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 };
const verdictLabel: React.CSSProperties = {
  fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a7a55", marginBottom: 4,
};
const verdictBig: React.CSSProperties = { fontSize: 30, fontWeight: 700, lineHeight: 1.1 };
const verdictNum: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 22, color: "#2a2620" };
const mini: React.CSSProperties = { fontSize: 12, color: "#8a8069", marginTop: 2 };
const tierRow: React.CSSProperties = { display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" };
const tierCell: React.CSSProperties = {
  flex: "1 1 0", minWidth: 70, textAlign: "center", padding: "8px 6px", background: "#f3ecdb", borderRadius: 4,
};
const tierLabel: React.CSSProperties = { fontSize: 11, color: "#8a7a55", textTransform: "uppercase", letterSpacing: "0.04em" };
const tierNum: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 15, color: "#2a2620", marginTop: 2 };
const verdictNote: React.CSSProperties = { fontSize: 13, color: "#8a8069", margin: "14px 0 0", lineHeight: 1.55 };
