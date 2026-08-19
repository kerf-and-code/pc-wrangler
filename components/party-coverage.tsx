"use client";

import { useMemo, useState } from "react";
import {
  CoverageSystem,
  PartyMember,
  Role,
  ROLES,
  ROLE_LABEL,
  ROLE_GAP,
  ROLE_QUESTION,
  SYSTEMS,
  computeCoverage,
  rolesForOption,
  systemConfig,
} from "@/lib/party/coverage";

// components/party-coverage.tsx
//
// The free, no-login party coverage check. Enter the party (pick a class per character, or an archetype,
// or just the roles), and see the gaps: no healer, no front line, no face. Pure client-side compute over
// lib/party/coverage.ts, the SAME engine the in-app coverage read uses. No account, nothing saved.
//
// D&D here is the coarse, class-only read; the app does the deep, subclass-and-third-party-aware version
// off your players' actual characters. The upsell block at the bottom says so.

type Row = { name: string; value: string; roles: Role[] };

function defaultRows(system: CoverageSystem): Row[] {
  const cfg = systemConfig(system);
  if (cfg.inputMode === "roles") {
    return Array.from({ length: 4 }, () => ({ name: "", value: "", roles: [] as Role[] }));
  }
  const opts = cfg.options;
  return Array.from({ length: 4 }, (_, i) => {
    const o = opts[i % opts.length];
    return { name: "", value: o ? o.value : "", roles: [] as Role[] };
  });
}

export default function PartyCoverage() {
  const [system, setSystem] = useState<CoverageSystem>("dnd");
  const [rows, setRows] = useState<Row[]>(() => defaultRows("dnd"));

  const cfg = systemConfig(system);

  const coverage = useMemo(() => {
    const members: PartyMember[] = rows.map((r) => ({
      label: r.name,
      roles: cfg.inputMode === "roles" ? r.roles : rolesForOption(system, r.value),
    }));
    return computeCoverage(system, members);
  }, [rows, system, cfg.inputMode]);

  function changeSystem(next: CoverageSystem) {
    setSystem(next);
    setRows(defaultRows(next));
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function toggleRole(i: number, role: Role) {
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const has = r.roles.includes(role);
        return { ...r, roles: has ? r.roles.filter((x) => x !== role) : [...r.roles, role] };
      }),
    );
  }

  function addRow() {
    const first = cfg.options[0];
    setRows((rs) => [...rs, { name: "", value: first ? first.value : "", roles: [] }]);
  }

  function removeRow(i: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));
  }

  const gapCount = coverage.missing.length;

  return (
    <div>
      {/* System picker */}
      <div style={panel}>
        <label style={fieldLabel} htmlFor="system">System</label>
        <select
          id="system"
          value={system}
          onChange={(e) => changeSystem(e.target.value as CoverageSystem)}
          style={select}
        >
          {SYSTEMS.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        {cfg.note && <p style={noteText}>{cfg.note}</p>}
      </div>

      {/* Party editor */}
      <div style={panel}>
        <div style={panelHead}>Who is at the table</div>
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((r, i) => (
            <div key={i} style={rowBox}>
              <div style={rowTop}>
                <input
                  value={r.name}
                  onChange={(e) => updateRow(i, { name: e.target.value })}
                  placeholder={`${cap(cfg.memberNoun)} ${i + 1} (optional name)`}
                  style={nameInput}
                />
                {cfg.inputMode !== "roles" && (
                  <select
                    value={r.value}
                    onChange={(e) => updateRow(i, { value: e.target.value })}
                    style={rowSelect}
                  >
                    {cfg.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
                <button type="button" onClick={() => removeRow(i)} style={removeBtn} aria-label="Remove">
                  ×
                </button>
              </div>

              {cfg.inputMode === "roles" ? (
                <div style={roleChips}>
                  {ROLES.map((role) => {
                    const on = r.roles.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => toggleRole(i, role)}
                        style={{ ...chip, ...(on ? chipOn : null) }}
                      >
                        {ROLE_LABEL[role]}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={rowRoles}>
                  {(rolesForOption(system, r.value) || []).map((role) => (
                    <span key={role} style={roleTag}>{ROLE_LABEL[role]}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addRow} style={addBtn}>+ Add a {cfg.memberNoun}</button>
      </div>

      {/* Coverage readout */}
      <div style={panel}>
        <div style={panelHead}>Coverage</div>
        <p style={summaryLine}>
          {gapCount === 0 ? (
            <span style={{ color: "#3d6b3d", fontWeight: 600 }}>
              All {coverage.relevant.length} roles covered.
            </span>
          ) : (
            <span>
              <span style={{ color: "#a4442e", fontWeight: 600 }}>
                {gapCount} gap{gapCount === 1 ? "" : "s"}:
              </span>{" "}
              {coverage.missing.map((r) => ROLE_LABEL[r]).join(", ")}.
            </span>
          )}
        </p>

        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {coverage.relevant.map((role) => {
            const who = coverage.contributors[role];
            const covered = who.length > 0;
            return (
              <div key={role} style={{ ...covRow, ...(covered ? null : covRowGap) }}>
                <div style={covLabel}>
                  <span style={{ ...dot, background: covered ? "#3d6b3d" : "#c14a2e" }} />
                  <span style={{ fontWeight: 600 }}>{ROLE_LABEL[role]}</span>
                </div>
                <div style={covWho}>
                  {covered ? uniq(who).join(", ") : ROLE_GAP[role]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* What a balanced party has */}
      <details style={explain}>
        <summary style={explainSummary}>What each role does</summary>
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {coverage.relevant.map((role) => (
            <p key={role} style={explainLine}>
              <strong>{ROLE_LABEL[role]}:</strong> {ROLE_QUESTION[role]}.
            </p>
          ))}
        </div>
      </details>

      {/* Upsell */}
      <div style={upsell}>
        <div style={upsellHead}>This is the quick version</div>
        <p style={upsellBody}>
          This tool reads a party you type in by hand. Inside Six Axes, coverage reads your{" "}
          <em>actual</em> party, the characters your players built, so it is automatic and always current,
          updating as they level or respec. It sits next to the encounter balancer (build a fight for this
          exact party), session prep, and the deeper read of how your table plays.
        </p>
        <p style={upsellBody}>
          For D&D it goes further: coverage is class-and-subclass aware and includes third-party classes,
          working end to end with the character forge, rather than the rough class-only read you get here.
        </p>
      </div>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function uniq(a: string[]): string[] {
  return Array.from(new Set(a));
}

// ---- styles (cream document register, matching tools-shell) ----

const panel: React.CSSProperties = {
  border: "1px solid #ddd4c2", background: "#fffdf8", borderRadius: 6, padding: "16px 18px", marginBottom: 16,
};
const panelHead: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, letterSpacing: "0.14em",
  textTransform: "uppercase", color: "#8a7a55", marginBottom: 12,
};
const fieldLabel: React.CSSProperties = {
  display: "block", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11,
  letterSpacing: "0.14em", textTransform: "uppercase", color: "#8a7a55", marginBottom: 8,
};
const select: React.CSSProperties = {
  width: "100%", padding: "9px 10px", borderRadius: 4, border: "1px solid #c9bfa8", background: "#fff",
  color: "#2a2620", fontSize: 15.5, fontFamily: "inherit",
};
const noteText: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.55, color: "#7a7060", margin: "10px 0 0" };
const rowBox: React.CSSProperties = { border: "1px solid #e6ddca", borderRadius: 5, padding: "10px 12px", background: "#fffefb" };
const rowTop: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const nameInput: React.CSSProperties = {
  flex: "1 1 160px", minWidth: 0, padding: "8px 10px", borderRadius: 4, border: "1px solid #d8cdb4",
  background: "#fff", color: "#2a2620", fontSize: 14.5, fontFamily: "inherit",
};
const rowSelect: React.CSSProperties = {
  flex: "1 1 200px", padding: "8px 10px", borderRadius: 4, border: "1px solid #c9bfa8", background: "#fff",
  color: "#2a2620", fontSize: 14.5, fontFamily: "inherit",
};
const removeBtn: React.CSSProperties = {
  flex: "0 0 auto", width: 30, height: 30, borderRadius: 4, border: "1px solid #d8cdb4", background: "#fff",
  color: "#9a7b5b", fontSize: 18, lineHeight: 1, cursor: "pointer",
};
const rowRoles: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 };
const roleTag: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, color: "#6b6250",
  border: "1px solid #e0d6bf", borderRadius: 3, padding: "2px 7px", background: "#faf6ec",
};
const roleChips: React.CSSProperties = { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 };
const chip: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11.5, color: "#7a7060",
  border: "1px solid #d8cdb4", borderRadius: 3, padding: "4px 9px", background: "#fff", cursor: "pointer",
};
const chipOn: React.CSSProperties = { background: "#3a352c", color: "#f6f2e9", borderColor: "#3a352c" };
const addBtn: React.CSSProperties = {
  marginTop: 12, padding: "8px 14px", borderRadius: 4, border: "1px dashed #c3b48f", background: "transparent",
  color: "#8a6a2f", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit",
};
const summaryLine: React.CSSProperties = { fontSize: 16, lineHeight: 1.5, margin: "0 0 12px" };
const covRow: React.CSSProperties = {
  display: "flex", gap: 12, alignItems: "baseline", justifyContent: "space-between",
  padding: "8px 10px", borderRadius: 4, background: "#faf6ec", border: "1px solid #ece3cf",
};
const covRowGap: React.CSSProperties = { background: "#fbeee9", border: "1px solid #ecccbf" };
const covLabel: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" };
const dot: React.CSSProperties = { display: "inline-block", width: 9, height: 9, borderRadius: "50%" };
const covWho: React.CSSProperties = { fontSize: 14, color: "#5a5344", textAlign: "right", flex: "1 1 auto" };
const explain: React.CSSProperties = {
  border: "1px solid #e6ddca", borderRadius: 6, padding: "12px 16px", marginBottom: 16, background: "#fffdf8",
};
const explainSummary: React.CSSProperties = { cursor: "pointer", fontSize: 14.5, color: "#8a6a2f", fontWeight: 600 };
const explainLine: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.55, color: "#4a443a", margin: 0 };
const upsell: React.CSSProperties = {
  border: "1px solid #d8cdb4", borderRadius: 6, padding: "18px 20px", background: "#f3ecdd", marginTop: 4,
};
const upsellHead: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 11, letterSpacing: "0.14em",
  textTransform: "uppercase", color: "#8a7a55", marginBottom: 8,
};
const upsellBody: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: "#4a443a", margin: "0 0 10px" };
