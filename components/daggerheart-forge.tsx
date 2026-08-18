"use client";

// The Daggerheart build UI for the Forge. Presentational: it edits a DHBuild and shows the live sheet
// the page derives (deriveDaggerheartSheet). The page owns state, persistence, and the shell (nav/save
// status); this renders the body when the character's system is daggerheart, parallel to the D&D and
// PF2e build columns. Mechanics only: no Darrington Press card/feature text is rendered here.

import React from "react";
import {
  DH_TRAITS, DH_TRAIT_ARRAY, tierOf,
  type DHBuild, type DHSheet, type DHTrait, type Advancement, type AdvancementKind, type DHExperience,
  type DHCustomWeapon, type DHDamageType, type DHBurden,
} from "@/lib/daggerheart/character";
import {
  DH_RULES, DH_CLASS_LIST, DH_ANCESTRY_LIST, DH_COMMUNITY_LIST, DH_ARMOR_LIST, DH_WEAPON_LIST, subclassesForClass,
} from "@/lib/daggerheart/rules-data";
import { STONE, FORGE_FONTS, stonePanel, stoneField, forgeLabel, statTile } from "@/lib/forge-theme";

const TRAIT_LABEL: Record<DHTrait, string> = {
  agility: "Agility", strength: "Strength", finesse: "Finesse",
  instinct: "Instinct", presence: "Presence", knowledge: "Knowledge",
};
const TRAIT_VALUE_OPTIONS = [2, 1, 0, -1];

// Each level from 2 on grants two advancement slots; "proficiency" and "multiclass" each cost both.
const ADVANCEMENTS: { kind: AdvancementKind; label: string; cost: number }[] = [
  { kind: "trait", label: "Increase two traits (+1 each)", cost: 1 },
  { kind: "hp", label: "+1 Hit Point slot", cost: 1 },
  { kind: "stress", label: "+1 Stress slot", cost: 1 },
  { kind: "experience", label: "+1 to two Experiences", cost: 1 },
  { kind: "domainCard", label: "Additional domain card", cost: 1 },
  { kind: "evasion", label: "+1 Evasion", cost: 1 },
  { kind: "subclass", label: "Upgraded subclass card", cost: 1 },
  { kind: "proficiency", label: "+1 Proficiency (2 slots)", cost: 2 },
  { kind: "multiclass", label: "Multiclass (2 slots)", cost: 2 },
];
const advCost = (kind: AdvancementKind): number => ADVANCEMENTS.find((a) => a.kind === kind)?.cost ?? 1;

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export default function DaggerheartForge({
  dbuild, onChange, sheet, name, onName,
}: {
  dbuild: DHBuild;
  onChange: (b: DHBuild) => void;
  sheet: DHSheet | null;
  name: string;
  onName: (s: string) => void;
}) {
  const set = (p: Partial<DHBuild>) => onChange({ ...dbuild, ...p });
  const setCustom = (p: Partial<DHCustomWeapon>) => set({ customWeapon: { ...dbuild.customWeapon, ...p } });
  const cls = DH_RULES.classes[dbuild.classId];
  const subOptions = dbuild.classId ? subclassesForClass(dbuild.classId) : [];

  const selStyle = { ...stoneField(), cursor: "pointer" as const };

  // --- traits ---
  const setTrait = (t: DHTrait, v: number) => set({ traits: { ...dbuild.traits, [t]: v } });
  // Compare the assigned values against the required multiset (+2,+1,+1,0,0,-1).
  const assigned = DH_TRAITS.map((t) => dbuild.traits[t] ?? 0).slice().sort((a, b) => b - a);
  const target = DH_TRAIT_ARRAY.slice().sort((a, b) => b - a);
  const arrayOk = assigned.length === target.length && assigned.every((v, i) => v === target[i]);

  // --- class / subclass ---
  const setClass = (id: string) => set({ classId: id, subclassId: "" });

  // --- advancements ---
  const usedSlots = dbuild.advancements.reduce((n, a) => n + advCost(a.kind), 0);
  const totalSlots = Math.max(0, (Math.min(10, Math.max(1, dbuild.level)) - 1) * 2);
  const addAdvancement = (kind: AdvancementKind) => {
    const next: Advancement = { kind };
    if (kind === "trait") next.traits = ["agility", "strength"];
    if (kind === "experience") next.experiences = ["", ""];
    set({ advancements: [...dbuild.advancements, next] });
  };
  const removeAdvancement = (i: number) => set({ advancements: dbuild.advancements.filter((_, j) => j !== i) });
  const setAdvancementTrait = (i: number, slot: 0 | 1, t: DHTrait) => {
    const arr = dbuild.advancements.map((a, j) => {
      if (j !== i) return a;
      const traits = [...(a.traits ?? ["agility", "strength"])] as DHTrait[];
      traits[slot] = t;
      return { ...a, traits };
    });
    set({ advancements: arr });
  };

  // --- experiences ---
  const setExperience = (i: number, patch: Partial<DHExperience>) => {
    const arr = dbuild.experiences.map((e, j) => (j === i ? { ...e, ...patch } : e));
    set({ experiences: arr });
  };
  const addExperience = () => set({ experiences: [...dbuild.experiences, { name: "", bonus: 2 }] });
  const removeExperience = (i: number) => set({ experiences: dbuild.experiences.filter((_, j) => j !== i) });

  // --- loadout (freeform card labels, no catalog) ---
  const setLoadout = (i: number, v: string) => set({ loadout: dbuild.loadout.map((c, j) => (j === i ? v : c)) });
  const addLoadout = () => { if (dbuild.loadout.length < 5) set({ loadout: [...dbuild.loadout, ""] }); };
  const removeLoadout = (i: number) => set({ loadout: dbuild.loadout.filter((_, j) => j !== i) });

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
            <input type="number" min={1} max={10} value={dbuild.level}
              onChange={(e) => set({ level: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })} style={stoneField()} />
          </Field>
          <Field label="Class">
            <select value={dbuild.classId} onChange={(e) => setClass(e.target.value)} style={selStyle}>
              <option value="">Choose...</option>
              {DH_CLASS_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Subclass">
            <select value={dbuild.subclassId} onChange={(e) => set({ subclassId: e.target.value })} style={selStyle} disabled={!dbuild.classId}>
              <option value="">Choose...</option>
              {subOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Ancestry">
            <select value={dbuild.ancestryId} onChange={(e) => set({ ancestryId: e.target.value })} style={selStyle}>
              <option value="">Choose...</option>
              {DH_ANCESTRY_LIST.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Second ancestry (Mixed)">
            <select value={dbuild.ancestryId2} onChange={(e) => set({ ancestryId2: e.target.value })} style={selStyle}>
              <option value="">None</option>
              {DH_ANCESTRY_LIST.filter((a) => a.id !== dbuild.ancestryId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Community">
            <select value={dbuild.communityId} onChange={(e) => set({ communityId: e.target.value })} style={selStyle}>
              <option value="">Choose...</option>
              {DH_COMMUNITY_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        {cls && <p style={{ color: STONE.inkDim, fontSize: 12, marginTop: 10 }}>
          {cls.name}: Evasion {cls.evasion}, HP {cls.hp}, domains {cls.domains.map((d) => DH_RULES.domains[d].name).join(" & ")}.
        </p>}
      </div>

      {/* Traits */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Traits</div>
        <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
          Assign the array +2, +1, +1, 0, 0, -1 across the six traits.{" "}
          <span style={{ color: arrayOk ? STONE.inkDim : "#c0562f" }}>
            {arrayOk ? "Array matches." : "Array does not yet match."}
          </span>
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          {DH_TRAITS.map((t) => (
            <Field key={t} label={TRAIT_LABEL[t]}>
              <select value={dbuild.traits[t] ?? 0} onChange={(e) => setTrait(t, parseInt(e.target.value, 10))} style={selStyle}>
                {TRAIT_VALUE_OPTIONS.map((v) => <option key={v} value={v}>{sign(v)}</option>)}
              </select>
            </Field>
          ))}
        </div>
      </div>

      {/* Armor */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Armor</div>
        <div style={{ marginTop: 8 }}>
          <Field label="Equipped armor">
            <select value={dbuild.armorId} onChange={(e) => set({ armorId: e.target.value })} style={selStyle}>
              <option value="">Unarmored</option>
              {DH_ARMOR_LIST.map((a) => (
                <option key={a.id} value={a.id}>
                  T{a.tier} · {a.name} ({a.baseMajor}/{a.baseSevere}, score {a.baseScore})
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* Weapon */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Weapon</div>
        <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 8px" }}>
          The attack rolls with the weapon's trait; damage rolls Proficiency dice of the weapon die plus its flat modifier.
          Tier 1 weapons are listed; use Custom for higher tiers or homebrew.
        </p>
        <Field label="Equipped weapon">
          <select value={dbuild.weaponId} onChange={(e) => set({ weaponId: e.target.value })} style={selStyle}>
            <option value="">None</option>
            {DH_WEAPON_LIST.filter((w) => w.tier <= tierOf(dbuild.level)).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({TRAIT_LABEL[w.trait]}, {w.range}, {w.damageDie}{w.damageBonus ? `+${w.damageBonus}` : ""} {w.damageType}{w.magic ? ", magic" : ""})
              </option>
            ))}
            <option value="custom">Custom weapon…</option>
          </select>
        </Field>
        {dbuild.weaponId === "custom" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 10 }}>
            <Field label="Name"><input value={dbuild.customWeapon.name} onChange={(e) => setCustom({ name: e.target.value })} style={stoneField()} /></Field>
            <Field label="Trait">
              <select value={dbuild.customWeapon.trait} onChange={(e) => setCustom({ trait: e.target.value as DHTrait })} style={selStyle}>
                {DH_TRAITS.map((t) => <option key={t} value={t}>{TRAIT_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Range"><input value={dbuild.customWeapon.range} onChange={(e) => setCustom({ range: e.target.value })} style={stoneField()} /></Field>
            <Field label="Damage die">
              <select value={dbuild.customWeapon.damageDie} onChange={(e) => setCustom({ damageDie: e.target.value })} style={selStyle}>
                {["d4", "d6", "d8", "d10", "d12", "d20"].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Damage bonus"><input type="number" value={dbuild.customWeapon.damageBonus} onChange={(e) => setCustom({ damageBonus: parseInt(e.target.value, 10) || 0 })} style={stoneField()} /></Field>
            <Field label="Type">
              <select value={dbuild.customWeapon.damageType} onChange={(e) => setCustom({ damageType: e.target.value as DHDamageType })} style={selStyle}>
                <option value="phy">phy</option><option value="mag">mag</option>
              </select>
            </Field>
            <Field label="Burden">
              <select value={dbuild.customWeapon.burden} onChange={(e) => setCustom({ burden: e.target.value as DHBurden })} style={selStyle}>
                <option value="One-Handed">One-Handed</option><option value="Two-Handed">Two-Handed</option>
              </select>
            </Field>
          </div>
        )}
      </div>

      {/* Advancements */}
      {dbuild.level >= 2 && (
        <div style={stonePanel()}>
          <div style={forgeLabel}>Advancements</div>
          <p style={{ color: usedSlots > totalSlots ? "#c0562f" : STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
            Slots used {usedSlots} of {totalSlots} (two per level from 2 to {Math.min(10, dbuild.level)}).
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {dbuild.advancements.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: STONE.ink, minWidth: 210 }}>
                  {ADVANCEMENTS.find((o) => o.kind === a.kind)?.label ?? a.kind}
                </span>
                {a.kind === "trait" && (
                  <>
                    {[0, 1].map((slot) => (
                      <select key={slot} value={a.traits?.[slot] ?? "agility"}
                        onChange={(e) => setAdvancementTrait(i, slot as 0 | 1, e.target.value as DHTrait)} style={{ ...selStyle, minWidth: 110 }}>
                        {DH_TRAITS.map((t) => <option key={t} value={t}>{TRAIT_LABEL[t]}</option>)}
                      </select>
                    ))}
                  </>
                )}
                <button type="button" onClick={() => removeAdvancement(i)}
                  style={{ ...selStyle, cursor: "pointer", padding: "6px 10px", fontSize: 12 }}>Remove</button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <select defaultValue="" onChange={(e) => { if (e.target.value) { addAdvancement(e.target.value as AdvancementKind); e.target.value = ""; } }}
              style={{ ...selStyle, minWidth: 220 }}>
              <option value="">Add advancement...</option>
              {ADVANCEMENTS.map((o) => <option key={o.kind} value={o.kind}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Experiences */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Experiences</div>
        <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
          Two at +2 to start; a new one is gained at the level 2, 5, and 8 tier achievements.
          {sheet && ` This level expects ${sheet.experienceSlots}.`}
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {dbuild.experiences.map((e, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input value={e.name} onChange={(ev) => setExperience(i, { name: ev.target.value })} placeholder="Experience"
                style={{ ...stoneField(), cursor: "text", flex: "1 1 200px" }} />
              <input type="number" value={e.bonus} onChange={(ev) => setExperience(i, { bonus: parseInt(ev.target.value, 10) || 0 })}
                style={{ ...stoneField(), width: 70 }} />
              <button type="button" onClick={() => removeExperience(i)}
                style={{ ...selStyle, cursor: "pointer", padding: "6px 10px", fontSize: 12 }}>Remove</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addExperience}
          style={{ ...selStyle, cursor: "pointer", padding: "7px 12px", fontSize: 12.5, marginTop: 10 }}>Add Experience</button>
      </div>

      {/* Loadout */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Loadout {sheet ? `(${dbuild.loadout.length} of ${sheet.loadoutMax})` : ""}</div>
        <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
          {cls ? `Domain cards from ${cls.domains.map((d) => DH_RULES.domains[d].name).join(" and ")}. ` : ""}
          Track card names here; the card catalog is not shipped.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {dbuild.loadout.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input value={c} onChange={(ev) => setLoadout(i, ev.target.value)} placeholder="Domain card"
                style={{ ...stoneField(), cursor: "text", flex: "1 1 200px" }} />
              <button type="button" onClick={() => removeLoadout(i)}
                style={{ ...selStyle, cursor: "pointer", padding: "6px 10px", fontSize: 12 }}>Remove</button>
            </div>
          ))}
        </div>
        {dbuild.loadout.length < 5 && (
          <button type="button" onClick={addLoadout}
            style={{ ...selStyle, cursor: "pointer", padding: "7px 12px", fontSize: 12.5, marginTop: 10 }}>Add card</button>
        )}
      </div>

      {/* Live sheet */}
      <div style={stonePanel()}>
        <div style={forgeLabel}>Sheet</div>
        {!sheet ? (
          <p style={{ color: STONE.inkDim, fontSize: 13, marginTop: 8 }}>Choose a class to derive the sheet.</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 8, marginTop: 8 }}>
              <Stat label="Evasion" value={`${sheet.evasion}`} />
              <Stat label="HP" value={`${sheet.hp}`} />
              <Stat label="Stress" value={`${sheet.stress}`} />
              <Stat label="Hope" value={`${sheet.hopeStart}/${sheet.hopeMax}`} />
              <Stat label="Proficiency" value={`${sheet.proficiency}`} />
              <Stat label="Major" value={`${sheet.major}`} />
              <Stat label="Severe" value={`${sheet.severe}`} />
              <Stat label="Armor" value={`${sheet.armorScore}`} />
              <Stat label="Spellcast" value={sheet.spellcast == null ? "-" : sign(sheet.spellcast)} />
              {sheet.attackMod != null && <Stat label="Attack" value={sign(sheet.attackMod)} />}
              {sheet.damage && <Stat label="Damage" value={sheet.damage} />}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginTop: 12 }}>
              {DH_TRAITS.map((t) => (
                <div key={t} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 10, color: STONE.inkDim, textTransform: "uppercase" }}>{TRAIT_LABEL[t].slice(0, 3)}</div>
                  <div style={{ fontFamily: FORGE_FONTS.display, fontSize: 20, color: STONE.ink }}>{sign(sheet.traits[t])}</div>
                </div>
              ))}
            </div>
            <p style={{ color: STONE.inkDim, fontSize: 12, marginTop: 12 }}>
              Tier {sheet.tier} · subclass {["foundation", "specialization", "mastery"][sheet.subclassTier - 1] ?? "foundation"}
              {" · "}domains {sheet.domains.map((d) => DH_RULES.domains[d].name).join(" & ")}
              {" · "}{sheet.domainCardsKnown} domain cards known
              {sheet.spellcastTrait ? ` · Spellcast: ${TRAIT_LABEL[sheet.spellcastTrait]}` : ""}
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
