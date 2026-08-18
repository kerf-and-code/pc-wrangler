"use client";

// The Draw Steel build UI for the Forge. Presentational: it edits a DSBuild and shows the live sheet
// the page derives (deriveDrawSteelSheet). The page owns state, persistence, and the shell; this renders
// the body when the character's system is drawsteel, parallel to the D&D / PF2e / Daggerheart columns.
// Mechanics only. Draw Steel content is used under the Draw Steel Creator License (attribution lives in
// lib/systems/drawsteel.ts and must appear in a user-visible place in the app).

import React from "react";
import {
  DS_CHARS, DS_CHAR_LABEL,
  type DSBuild, type DSSheet, type DSChar,
} from "@/lib/drawsteel/character";
import { DS_RULES, DS_CLASS_LIST, DS_ANCESTRY_LIST, DS_KIT_LIST } from "@/lib/drawsteel/rules-data";
import { STONE, FORGE_FONTS, stonePanel, stoneField, forgeLabel, statTile } from "@/lib/forge-theme";

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const dmgTriple = (d: [number, number, number]) => `${sign(d[0])}/${sign(d[1])}/${sign(d[2])}`;

export default function DrawSteelForge({
  dsBuild, onChange, sheet, name, onName,
}: {
  dsBuild: DSBuild;
  onChange: (b: DSBuild) => void;
  sheet: DSSheet | null;
  name: string;
  onName: (s: string) => void;
}) {
  const set = (p: Partial<DSBuild>) => onChange({ ...dsBuild, ...p });
  const cls = DS_RULES.classes[dsBuild.classId];
  const selStyle = { ...stoneField(), cursor: "pointer" as const };
  const setChar = (c: DSChar, v: number) =>
    set({ characteristics: { ...dsBuild.characteristics, [c]: Math.max(-5, Math.min(5, v)) } });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
      {/* Name */}
      <div style={stonePanel()}>
        <label style={forgeLabel}>Character name</label>
        <input value={name} onChange={(e) => onName(e.target.value)} placeholder="Name your hero"
          style={{ ...stoneField(), cursor: "text", fontFamily: FORGE_FONTS.display, fontSize: 20 }} />
      </div>

      {/* Identity */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Identity</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 8 }}>
          <Field label="Level">
            <input type="number" min={1} max={10} value={dsBuild.level}
              onChange={(e) => set({ level: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })} style={stoneField()} />
          </Field>
          <Field label="Class">
            <select value={dsBuild.classId} onChange={(e) => set({ classId: e.target.value })} style={selStyle}>
              <option value="">Choose...</option>
              {DS_CLASS_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Ancestry">
            <select value={dsBuild.ancestryId} onChange={(e) => set({ ancestryId: e.target.value })} style={selStyle}>
              <option value="">Choose...</option>
              {DS_ANCESTRY_LIST.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Kit">
            <select value={dsBuild.kitId} onChange={(e) => set({ kitId: e.target.value })} style={selStyle}>
              <option value="">None</option>
              {DS_KIT_LIST.map((kt) => <option key={kt.id} value={kt.id}>{kt.name}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* Characteristics */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Characteristics</div>
        {cls ? (
          <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
            {cls.name} fixes {Object.entries(cls.fixed).map(([c, v]) => `${DS_CHAR_LABEL[c as DSChar]} ${sign(v as number)}`).join(", ")}.
            {" "}Assign one array to the rest: {cls.arrays.map((a) => a.map(sign).join("/")).join("   ·   ")}.
          </p>
        ) : (
          <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>Choose a class to see its fixed values and arrays.</p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          {DS_CHARS.map((c) => (
            <Field key={c} label={DS_CHAR_LABEL[c]}>
              <input type="number" min={-5} max={5} value={dsBuild.characteristics[c] ?? 0}
                onChange={(e) => setChar(c, parseInt(e.target.value, 10) || 0)} style={stoneField()} />
            </Field>
          ))}
        </div>
      </div>

      {/* Live sheet */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Sheet</div>
        {!sheet ? (
          <p style={{ color: STONE.inkDim, fontSize: 13, marginTop: 8 }}>Choose a class to derive the sheet.</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 8, marginTop: 8 }}>
              <Stat label="Stamina" value={`${sheet.stamina}`} />
              <Stat label="Recoveries" value={`${sheet.recoveries}`} />
              <Stat label="Recovery" value={`${sheet.recoveryValue}`} />
              <Stat label="Winded" value={`${sheet.winded}`} />
              <Stat label="Speed" value={`${sheet.speed}`} />
              <Stat label="Stability" value={`${sheet.stability}`} />
              <Stat label="Size" value={sheet.size} />
              <Stat label="Disengage" value={`${sheet.disengage}`} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginTop: 12 }}>
              {DS_CHARS.map((c) => (
                <div key={c} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10, color: STONE.inkDim, textTransform: "uppercase" }}>{DS_CHAR_LABEL[c].slice(0, 3)}</div>
                  <div style={{ fontFamily: FORGE_FONTS.display, fontSize: 20, color: STONE.ink }}>{sign(sheet.characteristics[c])}</div>
                </div>
              ))}
            </div>
            <p style={{ color: STONE.inkDim, fontSize: 12, marginTop: 12 }}>
              Echelon {sheet.echelon} · Potency (weak/avg/strong) {sheet.potency.weak}/{sheet.potency.average}/{sheet.potency.strong} from {DS_CHAR_LABEL[sheet.keyChar]}
              {" · "}Melee dmg {dmgTriple(sheet.meleeDamage)}{sheet.meleeDistance ? ` · melee dist +${sheet.meleeDistance}` : ""}
              {" · "}Ranged dmg {dmgTriple(sheet.rangedDamage)}{sheet.rangedDistance ? ` · ranged dist +${sheet.rangedDistance}` : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={forgeLabel}>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={statTile()}>
      <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10, color: STONE.inkDim, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: FORGE_FONTS.display, fontSize: 22, color: STONE.ink }}>{value}</div>
    </div>
  );
}
