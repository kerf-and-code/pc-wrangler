"use client";

// The Lancer build UI for the Forge. Presentational: it edits a LancerBuild and shows the live sheet the
// page derives (deriveLancerSheet). The page owns state, persistence, and the shell; this renders the body
// when the character's system is lancer, parallel to the D&D / PF2e / Daggerheart / Draw Steel columns.
// Mechanics only. Lancer content is used under the Lancer Third Party License (attribution lives in
// lib/systems/lancer.ts and must appear in a user-visible place in the app).

import React from "react";
import {
  MECH_SKILLS, MECH_SKILL_LABEL, MAX_LEVEL, MAX_MECH_SKILL, mechSkillSpent, sizeLabel,
  type LancerBuild, type LancerSheet, type MechSkill,
} from "@/lib/lancer/character";
import { LANCER_FRAME_LIST } from "@/lib/lancer/rules-data";
import { STONE, FORGE_FONTS, stonePanel, stoneField, forgeLabel, statTile } from "@/lib/forge-theme";

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

// Frames grouped by manufacturer for the picker (the list is already sorted manufacturer -> LL -> name).
const MANUFACTURERS: string[] = LANCER_FRAME_LIST.reduce<string[]>((acc, f) => {
  if (!acc.includes(f.manufacturer)) acc.push(f.manufacturer);
  return acc;
}, []);

export default function LancerForge({
  build, onChange, sheet, name, onName,
}: {
  build: LancerBuild;
  onChange: (b: LancerBuild) => void;
  sheet: LancerSheet | null;
  name: string;
  onName: (s: string) => void;
}) {
  const set = (p: Partial<LancerBuild>) => onChange({ ...build, ...p });
  const setSkill = (k: MechSkill, v: number) =>
    set({ skills: { ...build.skills, [k]: Math.max(0, Math.min(MAX_MECH_SKILL, v)) } });
  const selStyle = { ...stoneField(), cursor: "pointer" as const };
  const spent = mechSkillSpent(build.skills);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
      {/* Callsign */}
      <div style={stonePanel()}>
        <label style={forgeLabel}>Pilot callsign</label>
        <input value={name} onChange={(e) => onName(e.target.value)} placeholder="Name your pilot"
          style={{ ...stoneField(), cursor: "text", fontFamily: FORGE_FONTS.display, fontSize: 20 }} />
      </div>

      {/* Identity */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Identity</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 8 }}>
          <Field label="License level">
            <input type="number" min={0} max={MAX_LEVEL} value={build.level}
              onChange={(e) => set({ level: Math.max(0, Math.min(MAX_LEVEL, parseInt(e.target.value, 10) || 0)) })} style={stoneField()} />
          </Field>
          <Field label="Frame">
            <select value={build.frameId} onChange={(e) => set({ frameId: e.target.value })} style={selStyle}>
              <option value="">Choose...</option>
              {MANUFACTURERS.map((man) => (
                <optgroup key={man} label={man}>
                  {LANCER_FRAME_LIST.filter((f) => f.manufacturer === man).map((f) => (
                    <option key={f.id} value={f.id}>{f.name}{f.licenseLevel ? ` (LL${f.licenseLevel})` : ""}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>
        {sheet && (
          <p style={{ color: STONE.inkDim, fontSize: 12, margin: "10px 0 0" }}>
            {sheet.frame.manufacturer} {sheet.frame.name} · Grit {sheet.grit} · Mounts {sheet.frame.mounts.join(", ") || "none"}
          </p>
        )}
      </div>

      {/* Mech skills (HASE) */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Mech skills (HASE)</div>
        <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
          Distribute points across the four skills (0 to {MAX_MECH_SKILL} each). {spent} spent.
          Hull adds HP and repairs, Agility adds Evasion and Speed, Systems adds E-Defense, Tech Attack, and SP,
          Engineering adds Heat Capacity.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          {MECH_SKILLS.map((k) => (
            <Field key={k} label={MECH_SKILL_LABEL[k]}>
              <input type="number" min={0} max={MAX_MECH_SKILL} value={build.skills[k] ?? 0}
                onChange={(e) => setSkill(k, parseInt(e.target.value, 10) || 0)} style={stoneField()} />
            </Field>
          ))}
        </div>
      </div>

      {/* Live sheet */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Sheet</div>
        {!sheet ? (
          <p style={{ color: STONE.inkDim, fontSize: 13, marginTop: 8 }}>Choose a frame to derive the sheet.</p>
        ) : (
          <>
            <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkDim, textTransform: "uppercase", letterSpacing: "0.4px", margin: "8px 0 6px" }}>Pilot</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 8 }}>
              <Stat label="HP" value={`${sheet.pilot.hp}`} />
              <Stat label="Evasion" value={`${sheet.pilot.evasion}`} />
              <Stat label="E-Def" value={`${sheet.pilot.edef}`} />
              <Stat label="Speed" value={`${sheet.pilot.speed}`} />
              <Stat label="Attack" value={sign(sheet.pilot.attackBonus)} />
            </div>

            <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkDim, textTransform: "uppercase", letterSpacing: "0.4px", margin: "14px 0 6px" }}>Mech</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 8 }}>
              <Stat label="HP" value={`${sheet.mech.hp}`} />
              <Stat label="Heat Cap" value={`${sheet.mech.heatCap}`} />
              <Stat label="Repair" value={`${sheet.mech.repCap}`} />
              <Stat label="Evasion" value={`${sheet.mech.evasion}`} />
              <Stat label="E-Def" value={`${sheet.mech.edef}`} />
              <Stat label="Speed" value={`${sheet.mech.speed}`} />
              <Stat label="Save" value={`${sheet.mech.saveTarget}`} />
              <Stat label="Tech Atk" value={sign(sheet.mech.techAttack)} />
              <Stat label="Attack" value={sign(sheet.mech.attackBonus)} />
              <Stat label="SP" value={`${sheet.mech.sp}`} />
              <Stat label="Sensors" value={`${sheet.mech.sensors}`} />
              <Stat label="Armor" value={`${sheet.mech.armor}`} />
              <Stat label="Size" value={sizeLabel(sheet.mech.size)} />
              <Stat label="Structure" value={`${sheet.mech.structure}`} />
              <Stat label="Stress" value={`${sheet.mech.stress}`} />
            </div>
            <p style={{ color: STONE.inkDim, fontSize: 12, marginTop: 12 }}>
              Grit {sheet.grit} · Limited system bonus {sign(sheet.mech.limitedBonus)} · Mounts {sheet.frame.mounts.join(", ") || "none"}
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
