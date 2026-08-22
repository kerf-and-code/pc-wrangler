"use client";

// components/encounter-balancer.tsx
//
// The free, no-login encounter balancer. Reuses the SAME per-system math as the in-app builder:
//   D&D 5e    -> lib/tools/encounter-dnd (constants copied verbatim from app/gm/encounters)
//   PF2e      -> lib/pf2e/encounter (real lib)
//   Draw Steel-> lib/drawsteel/encounter + adversary (real libs, EV vs party-strength bands)
//   Daggerheart-> lib/daggerheart/encounter + adversary (real libs, Battle Points by adversary type)
// No auth, no campaign, no save; state lives in memory for the session.
//
// "Who's at the table" is entered by hand (class, subclass, level). The line under it is the funnel: in
// the product this fills in from the players' actual characters, measured from real play. Class/subclass
// are captured for that continuity; each system's budget keys on what the rules actually use (levels and
// party size, plus Draw Steel Victories and the Daggerheart adjustments).

import { useMemo, useState } from "react";
import { SAX, STONE, surfaces } from "@/lib/theme";
import { stoneField } from "@/lib/forge-theme";
import { computeDnd, CR_LIST, type DndMethod } from "@/lib/tools/encounter-dnd";
import { pf2Budget, pf2EncounterXp, pf2Threat, PF2_THREATS, PF2_THREAT_LABEL } from "@/lib/pf2e/encounter";
import { dsBands, dsDifficultyOf, dsSpend, dsBenchmarkEV, DS_DIFFICULTY_LABEL } from "@/lib/drawsteel/encounter";
import { DS_ORGANIZATIONS, type DSOrganization } from "@/lib/drawsteel/adversary";
import { dhAdjustedBudget, dhSpend, dhBattlePoints, DH_ADJUSTMENTS, type DHAdjustment } from "@/lib/daggerheart/encounter";
import { DH_ADVERSARY_TYPES, type DHAdversaryType } from "@/lib/daggerheart/adversary";

type SystemKey = "dnd" | "pf2e" | "drawsteel" | "daggerheart";

const SYSTEMS: [SystemKey, string][] = [
  ["dnd", "Dungeons & Dragons 5e"],
  ["pf2e", "Pathfinder 2e"],
  ["drawsteel", "Draw Steel"],
  ["daggerheart", "Daggerheart"],
];

const LEVEL_MAX: Record<SystemKey, number> = { dnd: 20, pf2e: 20, drawsteel: 10, daggerheart: 10 };

const CLASSES: Record<SystemKey, string[]> = {
  dnd: ["Artificer", "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"],
  pf2e: ["Alchemist", "Barbarian", "Bard", "Champion", "Cleric", "Druid", "Fighter", "Investigator", "Monk", "Oracle", "Ranger", "Rogue", "Sorcerer", "Swashbuckler", "Witch", "Wizard"],
  drawsteel: ["Censor", "Conduit", "Elementalist", "Fury", "Null", "Shadow", "Tactician", "Talent", "Troubadour"],
  daggerheart: ["Bard", "Druid", "Guardian", "Ranger", "Rogue", "Seraph", "Sorcerer", "Warrior", "Wizard"],
};

let seq = 0;
const nid = () => `r${++seq}`;

type PC = { id: string; cls: string; sub: string; level: number };

export default function EncounterBalancer() {
  const [system, setSystemRaw] = useState<SystemKey>("dnd");
  const [method, setMethod] = useState<DndMethod>("2024");
  const [party, setParty] = useState<PC[]>([
    { id: nid(), cls: "Fighter", sub: "", level: 3 },
    { id: nid(), cls: "Cleric", sub: "", level: 3 },
    { id: nid(), cls: "Rogue", sub: "", level: 3 },
    { id: nid(), cls: "Wizard", sub: "", level: 3 },
  ]);
  const [dndRows, setDndRows] = useState<{ id: string; cr: string; count: number }[]>([{ id: nid(), cr: "2", count: 2 }]);
  const [pfRows, setPfRows] = useState<{ id: string; level: number; count: number }[]>([{ id: nid(), level: 3, count: 2 }]);
  const [dsRows, setDsRows] = useState<{ id: string; org: DSOrganization; level: number; count: number }[]>([{ id: nid(), org: "platoon", level: 3, count: 1 }]);
  const [dsVictories, setDsVictories] = useState(0);
  const [dhRows, setDhRows] = useState<{ id: string; type: DHAdversaryType; count: number }[]>([{ id: nid(), type: "standard", count: 3 }]);
  const [dhAdj, setDhAdj] = useState<DHAdjustment[]>([]);

  // Switching systems clamps party classes and levels into the new system's ranges.
  const setSystem = (next: SystemKey) => {
    setSystemRaw(next);
    const list = CLASSES[next];
    const max = LEVEL_MAX[next];
    setParty((xs) => xs.map((p) => ({
      ...p,
      cls: list.includes(p.cls) ? p.cls : list[0],
      level: Math.min(max, Math.max(1, p.level)),
    })));
  };

  const levels = party.map((p) => p.level);
  const partySize = party.length;
  const avgLevel = (max: number) => Math.max(1, Math.min(max, Math.round(levels.reduce((a, b) => a + b, 0) / Math.max(1, partySize))));

  const dnd = useMemo(
    () => computeDnd(levels, dndRows.map((r) => ({ cr: r.cr, count: r.count })), method),
    [levels, dndRows, method],
  );
  const pf = useMemo(() => {
    const size = Math.max(1, partySize);
    const pfLevel = avgLevel(20);
    const foeLevels = pfRows.flatMap((r) => Array(Math.max(0, r.count)).fill(r.level) as number[]);
    const total = pf2EncounterXp(foeLevels, pfLevel);
    return { size, pfLevel, total, threat: pf2Threat(total, size), budget: pf2Budget(size) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels, partySize, pfRows]);
  const ds = useMemo(() => {
    const size = Math.max(1, partySize);
    const level = avgLevel(10);
    const bands = dsBands(size, level, dsVictories);
    const spent = dsSpend(dsRows.map((r) => ({ ev: dsBenchmarkEV(r.org, r.level), count: r.count })));
    const diff = spent === 0 ? null : dsDifficultyOf(spent, bands);
    return { size, level, bands, spent, diff };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels, partySize, dsRows, dsVictories]);
  const dh = useMemo(() => {
    const size = Math.max(1, partySize);
    const budget = dhAdjustedBudget(size, dhAdj);
    const spent = dhSpend(dhRows.map((r) => ({ type: r.type, count: r.count })));
    return { size, budget, spent };
  }, [partySize, dhRows, dhAdj]);

  const classList = CLASSES[system];
  const levelMax = LEVEL_MAX[system];

  return (
    <div>
      {/* System picker */}
      <div style={row}>
        <label style={fieldLabel}>System</label>
        <select value={system} onChange={(e) => setSystem(e.target.value as SystemKey)} style={{ ...input, maxWidth: 260 }}>
          {SYSTEMS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {system === "dnd" && (
          <div style={{ display: "inline-flex", gap: 6, marginLeft: 10 }}>
            {(["2024", "2014"] as const).map((m) => (
              <button key={m} onClick={() => setMethod(m)} style={m === method ? pillOn : pill}>{m === "2024" ? "2024 rules" : "2014 rules"}</button>
            ))}
          </div>
        )}
      </div>

      {/* Who's at the table */}
      <section style={card}>
        <h2 style={h2}>Who&apos;s at the table</h2>
        <p style={note}>In Six Axes this fills in automatically from your players&apos; characters. Here, add them by hand.</p>
        <div style={{ marginTop: 12 }}>
          {party.map((p) => (
            <div key={p.id} style={pcRow}>
              <select value={p.cls} onChange={(e) => upd(setParty, p.id, { cls: e.target.value })} style={{ ...input, flex: "1 1 130px" }}>
                {classList.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={p.sub} onChange={(e) => upd(setParty, p.id, { sub: e.target.value })} placeholder="Subclass (optional)" maxLength={40} style={{ ...input, flex: "1 1 150px" }} />
              <input type="number" min={1} max={levelMax} value={p.level} onChange={(e) => upd(setParty, p.id, { level: clampInt(e.target.value, 1, levelMax) })} style={{ ...input, width: 74 }} aria-label="Level" />
              <button onClick={() => setParty((xs) => xs.length > 1 ? xs.filter((x) => x.id !== p.id) : xs)} style={xBtn} aria-label="Remove">×</button>
            </div>
          ))}
        </div>
        <button onClick={() => setParty((xs) => [...xs, { id: nid(), cls: classList[0], sub: "", level: Math.min(levelMax, xs[xs.length - 1]?.level ?? 1) }])} style={addBtn}>Add a character</button>
        {system === "drawsteel" && (
          <div style={{ ...pcRow, marginTop: 12 }}>
            <label style={fieldLabel}>Victories earned (avg)</label>
            <input type="number" min={0} value={dsVictories} onChange={(e) => setDsVictories(Math.max(0, parseInt(e.target.value, 10) || 0))} style={{ ...input, width: 84 }} />
          </div>
        )}
      </section>

      {/* The fight */}
      <section style={card}>
        <h2 style={h2}>The fight</h2>

        {system === "dnd" && (
          <>
            <p style={note}>Add monsters by challenge rating. Numbers use the {method} DMG method.</p>
            <div style={{ marginTop: 12 }}>
              {dndRows.map((f) => (
                <div key={f.id} style={pcRow}>
                  <label style={miniLbl}>CR</label>
                  <select value={f.cr} onChange={(e) => upd(setDndRows, f.id, { cr: e.target.value })} style={{ ...input, flex: "1 1 100px" }}>
                    {CR_LIST.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <label style={miniLbl}>x</label>
                  <input type="number" min={1} value={f.count} onChange={(e) => upd(setDndRows, f.id, { count: clampCount(e.target.value) })} style={{ ...input, width: 74 }} aria-label="Count" />
                  <button onClick={() => setDndRows((xs) => xs.filter((x) => x.id !== f.id))} style={xBtn} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
            <button onClick={() => setDndRows((xs) => [...xs, { id: nid(), cr: "1", count: 1 }])} style={addBtn}>Add a monster</button>
          </>
        )}

        {system === "pf2e" && (
          <>
            <p style={note}>Add creatures by level. Pathfinder prices each creature against the party&apos;s level.</p>
            <div style={{ marginTop: 12 }}>
              {pfRows.map((f) => (
                <div key={f.id} style={pcRow}>
                  <label style={miniLbl}>Creature level</label>
                  <input type="number" min={-1} max={25} value={f.level} onChange={(e) => upd(setPfRows, f.id, { level: clampInt(e.target.value, -1, 25) })} style={{ ...input, width: 84 }} aria-label="Creature level" />
                  <label style={miniLbl}>x</label>
                  <input type="number" min={1} value={f.count} onChange={(e) => upd(setPfRows, f.id, { count: clampCount(e.target.value) })} style={{ ...input, width: 74 }} aria-label="Count" />
                  <button onClick={() => setPfRows((xs) => xs.filter((x) => x.id !== f.id))} style={xBtn} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
            <button onClick={() => setPfRows((xs) => [...xs, { id: nid(), level: pf.pfLevel, count: 1 }])} style={addBtn}>Add a creature</button>
          </>
        )}

        {system === "drawsteel" && (
          <>
            <p style={note}>Add monsters by organization and level; EV comes from the design benchmark. Minions are bought in groups of four, so a Minion row&apos;s count is the number of groups.</p>
            <div style={{ marginTop: 12 }}>
              {dsRows.map((f) => (
                <div key={f.id} style={pcRow}>
                  <select value={f.org} onChange={(e) => upd(setDsRows, f.id, { org: e.target.value as DSOrganization })} style={{ ...input, flex: "1 1 130px" }}>
                    {DS_ORGANIZATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <label style={miniLbl}>Lvl</label>
                  <input type="number" min={1} max={10} value={f.level} onChange={(e) => upd(setDsRows, f.id, { level: clampInt(e.target.value, 1, 10) })} style={{ ...input, width: 70 }} aria-label="Creature level" />
                  <label style={miniLbl}>x</label>
                  <input type="number" min={1} value={f.count} onChange={(e) => upd(setDsRows, f.id, { count: clampCount(e.target.value) })} style={{ ...input, width: 70 }} aria-label="Count" />
                  <span style={evTag}>EV {dsBenchmarkEV(f.org, f.level) * Math.max(0, f.count)}</span>
                  <button onClick={() => setDsRows((xs) => xs.filter((x) => x.id !== f.id))} style={xBtn} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
            <button onClick={() => setDsRows((xs) => [...xs, { id: nid(), org: "platoon", level: ds.level, count: 1 }])} style={addBtn}>Add a monster</button>
          </>
        )}

        {system === "daggerheart" && (
          <>
            <p style={note}>Add adversaries by type; each costs Battle Points by type. A Minion row&apos;s count is the number of party-sized groups.</p>
            <div style={{ marginTop: 12 }}>
              {dhRows.map((f) => (
                <div key={f.id} style={pcRow}>
                  <select value={f.type} onChange={(e) => upd(setDhRows, f.id, { type: e.target.value as DHAdversaryType })} style={{ ...input, flex: "1 1 150px" }}>
                    {DH_ADVERSARY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <label style={miniLbl}>x</label>
                  <input type="number" min={1} value={f.count} onChange={(e) => upd(setDhRows, f.id, { count: clampCount(e.target.value) })} style={{ ...input, width: 74 }} aria-label="Count" />
                  <button onClick={() => setDhRows((xs) => xs.filter((x) => x.id !== f.id))} style={xBtn} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
            <button onClick={() => setDhRows((xs) => [...xs, { id: nid(), type: "standard", count: 1 }])} style={addBtn}>Add an adversary</button>
            <div style={{ marginTop: 16 }}>
              <div style={fieldLabel}>Adjustments</div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {DH_ADJUSTMENTS.map((a) => (
                  <label key={a.id} style={adjRow}>
                    <input
                      type="checkbox"
                      checked={dhAdj.includes(a.id)}
                      onChange={(e) => setDhAdj((xs) => e.target.checked ? [...xs, a.id] : xs.filter((x) => x !== a.id))}
                    />
                    <span>{a.label}</span>
                    <span style={adjDelta}>{a.delta > 0 ? `+${a.delta}` : a.delta}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Verdict */}
      {system === "dnd" && (
        <section style={verdictCard}>
          <div style={verdictTop}>
            <div><div style={verdictLabel}>Difficulty</div><div style={{ ...verdictBig, color: bandColorDnd(dnd.band) }}>{dnd.band}</div></div>
            <div style={{ textAlign: "right" }}>
              <div style={verdictLabel}>Encounter XP</div>
              <div style={verdictNum}>{dnd.foeXp.toLocaleString()}</div>
              {method === "2014" && dnd.multiplier !== 1 && <div style={mini}>{dnd.foeXpRaw.toLocaleString()} raw x{dnd.multiplier}</div>}
            </div>
          </div>
          <div style={tierRow}>
            {dnd.tiers.map((t, i) => <div key={i} style={tierCell}><div style={tierLabel}>{dnd.labels[i]}</div><div style={tierNum}>{t.toLocaleString()}</div></div>)}
          </div>
          <p style={verdictNote}>{method === "2024" ? "2024 method: no encounter multiplier, so ten monsters count as ten monsters." : "2014 method: the party-size multiplier is applied to the raw XP before comparing."}</p>
        </section>
      )}

      {system === "pf2e" && (
        <section style={verdictCard}>
          <div style={verdictTop}>
            <div><div style={verdictLabel}>Threat</div><div style={{ ...verdictBig, color: bandColorPf(pf.threat) }}>{pf.threat ? PF2_THREAT_LABEL[pf.threat] : "Below Trivial"}</div></div>
            <div style={{ textAlign: "right" }}><div style={verdictLabel}>Encounter XP</div><div style={verdictNum}>{pf.total}</div><div style={mini}>party level {pf.pfLevel}, {pf.size} PC{pf.size === 1 ? "" : "s"}</div></div>
          </div>
          <div style={tierRow}>
            {PF2_THREATS.map((t) => <div key={t} style={tierCell}><div style={tierLabel}>{PF2_THREAT_LABEL[t]}</div><div style={tierNum}>{pf.budget[t]}</div></div>)}
          </div>
          <p style={verdictNote}>Pathfinder assumes a single party level; this uses the average of the characters above. Creatures are priced by how far their level sits from the party&apos;s.</p>
        </section>
      )}

      {system === "drawsteel" && (
        <section style={verdictCard}>
          <div style={verdictTop}>
            <div><div style={verdictLabel}>Difficulty</div><div style={{ ...verdictBig, color: bandColorDs(ds.diff) }}>{ds.diff ? DS_DIFFICULTY_LABEL[ds.diff] : "Empty"}</div></div>
            <div style={{ textAlign: "right" }}><div style={verdictLabel}>EV spent</div><div style={verdictNum}>{ds.spent}</div><div style={mini}>party strength {ds.bands.es}</div></div>
          </div>
          <div style={tierRow}>
            <div style={tierCell}><div style={tierLabel}>Trivial</div><div style={tierNum}>&lt;{ds.bands.trivialMax}</div></div>
            <div style={tierCell}><div style={tierLabel}>Easy</div><div style={tierNum}>{ds.bands.trivialMax}&ndash;{ds.bands.standardMin - 1}</div></div>
            <div style={tierCell}><div style={tierLabel}>Standard</div><div style={tierNum}>{ds.bands.standardMin}&ndash;{ds.bands.standardMax}</div></div>
            <div style={tierCell}><div style={tierLabel}>Hard</div><div style={tierNum}>{ds.bands.standardMax + 1}&ndash;{ds.bands.hardMax}</div></div>
            <div style={tierCell}><div style={tierLabel}>Extreme</div><div style={tierNum}>&gt;{ds.bands.hardMax}</div></div>
          </div>
          <p style={verdictNote}>Each hero&apos;s strength is 4 + 2 per level; two average Victories add another hero&apos;s worth. Each cell shows the EV range that lands in that band.</p>
        </section>
      )}

      {system === "daggerheart" && (
        <section style={verdictCard}>
          <div style={verdictTop}>
            <div><div style={verdictLabel}>Balance</div><div style={{ ...verdictBig, color: bandColorDh(dh.spent, dh.budget) }}>{dhStatus(dh.spent, dh.budget)}</div></div>
            <div style={{ textAlign: "right" }}><div style={verdictLabel}>Battle points</div><div style={verdictNum}>{dh.spent} / {dh.budget}</div><div style={mini}>{dh.size} PC{dh.size === 1 ? "" : "s"}, base {dhBattlePoints(dh.size)}</div></div>
          </div>
          <p style={verdictNote}>Start with three points per PC plus two, adjust, then spend. Spending under the budget is an easier fight; over it, a harder one.</p>
        </section>
      )}
    </div>
  );
}

// helpers -------------------------------------------------------------
function upd<T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, id: string, patch: Partial<T>) {
  setter((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
}
function clampCount(v: string) { return Math.max(1, parseInt(v, 10) || 1); }
function clampInt(v: string, lo: number, hi: number) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function bandColorDnd(band: string) {
  if (band === "Deadly" || band === "High") return "#d97d6d";
  if (band === "Hard" || band === "Moderate") return "#e2b878";
  if (band === "Trivial") return STONE.inkFaint;
  return "#9aa880";
}
function bandColorPf(t: string | null) {
  if (t === "extreme" || t === "severe") return "#d97d6d";
  if (t === "moderate") return "#e2b878";
  if (!t || t === "trivial") return STONE.inkFaint;
  return "#9aa880";
}
function bandColorDs(t: string | null) {
  if (t === "extreme" || t === "hard") return "#d97d6d";
  if (t === "standard") return "#e2b878";
  if (!t || t === "trivial") return STONE.inkFaint;
  return "#9aa880";
}
function dhStatus(spent: number, budget: number) {
  if (spent > budget) return "Over budget";
  if (spent === budget) return "On budget";
  return "Under budget";
}
function bandColorDh(spent: number, budget: number) {
  if (spent > budget) return "#d97d6d";
  if (spent === budget) return "#e2b878";
  return "#9aa880";
}

// styles (carved dark forge register) --------------------------------
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 };
const card: React.CSSProperties = { marginTop: 20, padding: "20px 0 0", borderTop: "1px solid rgba(255,235,200,0.1)" };
const h2: React.CSSProperties = { fontSize: 22, fontWeight: 600, margin: "0 0 4px", color: STONE.ink, fontFamily: "var(--forge-display, 'Cinzel', serif)" };
const note: React.CSSProperties = { fontSize: 14.5, color: STONE.inkFaint, fontStyle: "italic", margin: 0, lineHeight: 1.55, fontFamily: SAX.serif };
const pcRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" };
const fieldLabel: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.04em", color: STONE.inkDim, textTransform: "uppercase" };
const miniLbl: React.CSSProperties = { ...fieldLabel, flex: "0 0 auto", margin: "0 2px" };
const input: React.CSSProperties = { ...stoneField(), fontSize: 15.5, boxSizing: "border-box", colorScheme: "dark" };
const addBtn: React.CSSProperties = { marginTop: 6, background: "rgba(0,0,0,0.24)", color: STONE.brassHi, border: `1px solid ${STONE.hi}`, borderRadius: 3, padding: "8px 14px", fontSize: 13.5, cursor: "pointer", fontFamily: SAX.serif };
const xBtn: React.CSSProperties = { background: "transparent", border: "none", color: STONE.inkFaint, fontSize: 20, lineHeight: 1, cursor: "pointer", padding: "0 4px" };
const pill: React.CSSProperties = { background: "rgba(0,0,0,0.24)", color: STONE.inkDim, border: `1px solid ${STONE.hi}`, borderRadius: 3, padding: "7px 12px", fontSize: 12.5, cursor: "pointer", fontFamily: SAX.mono, letterSpacing: "0.04em" };
const pillOn: React.CSSProperties = { ...pill, background: `linear-gradient(180deg, ${STONE.brassHi}, ${SAX.brass})`, color: "#241a0d", borderColor: SAX.brass };
const evTag: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 12, color: STONE.brassHi, whiteSpace: "nowrap" };
const adjRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, color: STONE.ink, cursor: "pointer", fontFamily: SAX.serif };
const adjDelta: React.CSSProperties = { marginLeft: "auto", fontFamily: SAX.mono, fontSize: 12.5, color: STONE.brassHi };
const verdictCard: React.CSSProperties = { ...surfaces.slate, marginTop: 24, padding: "20px 22px" };
const verdictTop: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 };
const verdictLabel: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: SAX.brass, marginBottom: 4 };
const verdictBig: React.CSSProperties = { fontSize: 30, fontWeight: 700, lineHeight: 1.1, fontFamily: "var(--forge-display, 'Cinzel', serif)" };
const verdictNum: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 22, color: STONE.ink };
const mini: React.CSSProperties = { fontSize: 12, color: STONE.inkFaint, marginTop: 2, fontFamily: SAX.serif };
const tierRow: React.CSSProperties = { display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" };
const tierCell: React.CSSProperties = { flex: "1 1 0", minWidth: 62, textAlign: "center", padding: "8px 6px", background: "rgba(0,0,0,0.24)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)", borderRadius: 4 };
const tierLabel: React.CSSProperties = { fontSize: 11, color: STONE.inkDim, textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: SAX.mono };
const tierNum: React.CSSProperties = { fontFamily: SAX.mono, fontSize: 15, color: STONE.ink, marginTop: 2 };
const verdictNote: React.CSSProperties = { fontSize: 13, color: STONE.inkFaint, margin: "14px 0 0", lineHeight: 1.55, fontFamily: SAX.serif };
