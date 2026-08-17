"use client";

// The PF2e build UI for the Forge. Presentational: it edits a Pf2eBuild and shows the live sheet the
// page derives (derivePf2eSheet). The page owns state, persistence, and the shell (nav/save status);
// this renders the body when the character's system is pf2e, parallel to the D&D build column.

import React from "react";
import {
  SKILL_ABILITY,
  type Pf2eBuild, type Pf2eSheet, type PF2Ability, type PF2Save, type ProfRank,
} from "@/lib/pf2e/character";
import { PF2_RULES } from "@/lib/pf2e/rules-data";
import { STONE, FORGE_FONTS, stonePanel, stoneField, forgeLabel, statTile } from "@/lib/forge-theme";

const ABILITIES: [PF2Ability, string][] = [
  ["str", "Str"], ["dex", "Dex"], ["con", "Con"], ["int", "Int"], ["wis", "Wis"], ["cha", "Cha"],
];
const SAVES: [PF2Save, string][] = [["fortitude", "Fort"], ["reflex", "Ref"], ["will", "Will"]];
const SKILLS = Object.keys(SKILL_ABILITY);
const ARMOR_CATEGORIES = ["unarmored", "light", "medium", "heavy"] as const;
type BoostKey = keyof Pf2eBuild["boosts"];

const RANK_LABEL: Record<ProfRank, string> = { 0: "U", 1: "T", 2: "E", 3: "M", 4: "L" };
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export default function Pf2eForge({
  pbuild, onChange, sheet, name, onName,
}: {
  pbuild: Pf2eBuild;
  onChange: (b: Pf2eBuild) => void;
  sheet: Pf2eSheet | null;
  name: string;
  onName: (s: string) => void;
}) {
  const set = (p: Partial<Pf2eBuild>) => onChange({ ...pbuild, ...p });
  const anc = PF2_RULES.ancestries[pbuild.ancestryId];
  const cls = PF2_RULES.classes[pbuild.classId];
  const heritageOptions = Object.values(PF2_RULES.heritages).filter((h) => h.ancestryId === pbuild.ancestryId);
  const keyOptions = cls ? cls.keyAbility : (["str", "dex", "con", "int", "wis", "cha"] as PF2Ability[]);
  const freeAncestry = anc ? anc.boosts.filter((b) => b === "free").length : 0;

  const stages: { key: BoostKey; label: string; count: number; min: number }[] = [
    { key: "ancestry", label: "Ancestry (free)", count: freeAncestry, min: 1 },
    { key: "background", label: "Background", count: 2, min: 1 },
    { key: "level1", label: "Level 1", count: 4, min: 1 },
    { key: "level5", label: "Level 5", count: 4, min: 5 },
    { key: "level10", label: "Level 10", count: 4, min: 10 },
    { key: "level15", label: "Level 15", count: 4, min: 15 },
    { key: "level20", label: "Level 20", count: 4, min: 20 },
  ];

  const setBoost = (key: BoostKey, i: number, ability: PF2Ability | "") => {
    const arr = [...pbuild.boosts[key]];
    if (ability === "") arr.splice(i, 1); else arr[i] = ability;
    set({ boosts: { ...pbuild.boosts, [key]: arr } });
  };
  const setAncestry = (id: string) => set({ ancestryId: id, heritageId: "", boosts: { ...pbuild.boosts, ancestry: [] } });
  const setClass = (id: string) => {
    const first = PF2_RULES.classes[id]?.keyAbility[0] ?? pbuild.keyAbility;
    set({ classId: id, keyAbility: first });
  };
  const toggleSkill = (id: string) => {
    const next = { ...pbuild.skills };
    if (next[id]) delete next[id]; else next[id] = 1;
    set({ skills: next });
  };

  const selStyle = { ...stoneField(), cursor: "pointer" as const };
  const abilitySelect = (value: PF2Ability | undefined, onSel: (a: PF2Ability | "") => void) => (
    <select value={value ?? ""} onChange={(e) => onSel(e.target.value as PF2Ability | "")} style={{ ...selStyle, minWidth: 74 }}>
      <option value="">-</option>
      {ABILITIES.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
    </select>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
      {/* Name */}
      <div style={stonePanel()}>
        <label style={forgeLabel}>Character name</label>
        <input value={name} onChange={(e) => onName(e.target.value)} placeholder="Name your character"
          style={{ ...stoneField(), cursor: "text", fontFamily: FORGE_FONTS.display, fontSize: 20 }} />
      </div>

      {/* Identity */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Identity</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 8 }}>
          <Field label="Level">
            <input type="number" min={1} max={20} value={pbuild.level}
              onChange={(e) => set({ level: Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)) })} style={stoneField()} />
          </Field>
          <Field label="Ancestry">
            <select value={pbuild.ancestryId} onChange={(e) => setAncestry(e.target.value)} style={selStyle}>
              <option value="">Choose...</option>
              {Object.values(PF2_RULES.ancestries).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Heritage">
            <select value={pbuild.heritageId} onChange={(e) => set({ heritageId: e.target.value })} style={selStyle} disabled={!pbuild.ancestryId}>
              <option value="">Choose...</option>
              {heritageOptions.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
          <Field label="Background">
            <select value={pbuild.backgroundId} onChange={(e) => set({ backgroundId: e.target.value })} style={selStyle}>
              <option value="">Choose...</option>
              {Object.values(PF2_RULES.backgrounds).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Class">
            <select value={pbuild.classId} onChange={(e) => setClass(e.target.value)} style={selStyle}>
              <option value="">Choose...</option>
              {Object.values(PF2_RULES.classes).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Key ability">
            <select value={pbuild.keyAbility} onChange={(e) => set({ keyAbility: e.target.value as PF2Ability })} style={selStyle}>
              {keyOptions.map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
            </select>
          </Field>
        </div>
        {anc && <p style={{ color: STONE.inkDim, fontSize: 12, marginTop: 10 }}>
          {anc.name}: {anc.hp} HP, {anc.size}, Speed {anc.speed} ft.
          {anc.flaws.length > 0 && ` Flaw: ${anc.flaws.join(", ")}.`}
        </p>}
      </div>

      {/* Ability boosts */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Ability boosts</div>
        <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
          A boost is +2 (or +1 once a score is 18+). Ancestry fixed boosts and flaws apply automatically.
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {stages.filter((st) => pbuild.level >= st.min && st.count > 0).map((st) => (
            <div key={st.key} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ ...forgeLabel, minWidth: 130 }}>{st.label}</span>
              {Array.from({ length: st.count }).map((_, i) => (
                <React.Fragment key={i}>{abilitySelect(pbuild.boosts[st.key][i], (a) => setBoost(st.key, i, a))}</React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Skills */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Skills {cls ? `(train ${cls.trainedSkills} + Int)` : ""}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 8 }}>
          {SKILLS.map((s) => (
            <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: STONE.ink, cursor: "pointer", textTransform: "capitalize" }}>
              <input type="checkbox" checked={Boolean(pbuild.skills[s])} onChange={() => toggleSkill(s)} />
              {s}
            </label>
          ))}
        </div>
      </div>

      {/* Armor */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Armor</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 8 }}>
          <Field label="Category">
            <select value={pbuild.armor.category} onChange={(e) => set({ armor: { ...pbuild.armor, category: e.target.value as Pf2eBuild["armor"]["category"] } })} style={selStyle}>
              {ARMOR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Dex cap">
            <input type="number" value={pbuild.armor.dexCap}
              onChange={(e) => set({ armor: { ...pbuild.armor, dexCap: parseInt(e.target.value, 10) || 0 } })} style={stoneField()} />
          </Field>
          <Field label="Item bonus">
            <input type="number" value={pbuild.armor.itemBonus}
              onChange={(e) => set({ armor: { ...pbuild.armor, itemBonus: parseInt(e.target.value, 10) || 0 } })} style={stoneField()} />
          </Field>
        </div>
      </div>

      {/* Live sheet */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Sheet</div>
        {!sheet ? (
          <p style={{ color: STONE.inkDim, fontSize: 13, marginTop: 8 }}>Choose an ancestry and class to derive the sheet.</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 8, marginTop: 8 }}>
              <Stat label="AC" value={`${sheet.ac}`} />
              <Stat label="HP" value={`${sheet.hp}`} />
              <Stat label="Perception" value={sign(sheet.perception)} />
              <Stat label="Class DC" value={`${sheet.classDc}`} />
              {sheet.spellDc != null && <Stat label="Spell DC" value={`${sheet.spellDc}`} />}
              {SAVES.map(([k, lbl]) => <Stat key={k} label={lbl} value={sign(sheet.saves[k])} />)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginTop: 12 }}>
              {ABILITIES.map(([k, lbl]) => (
                <div key={k} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10, color: STONE.inkDim, textTransform: "uppercase" }}>{lbl}</div>
                  <div style={{ fontFamily: FORGE_FONTS.display, fontSize: 18, color: STONE.ink }}>{sheet.abilities[k]}</div>
                  <div style={{ fontSize: 11, color: STONE.inkDim }}>{sign(sheet.mods[k])}</div>
                </div>
              ))}
            </div>
            {Object.keys(sheet.skills).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ ...forgeLabel, marginBottom: 6 }}>Trained skills</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Object.entries(sheet.skills).map(([s, v]) => (
                    <span key={s} style={{ fontSize: 12.5, color: STONE.ink, textTransform: "capitalize" }}>
                      {s} {sign(v)}{" "}
                      <span style={{ color: STONE.inkDim, fontFamily: FORGE_FONTS.mono, fontSize: 10 }}>{RANK_LABEL[pbuild.skills[s] ?? 1]}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
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
