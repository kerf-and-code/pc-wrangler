"use client";

// The Draw Steel build UI for the Forge. Presentational: it edits a DSBuild and shows the live sheet
// the page derives (deriveDrawSteelSheet). The page owns state, persistence, and the shell; this renders
// the body when the character's system is drawsteel, parallel to the D&D / PF2e / Daggerheart columns.
// Mechanics only. Draw Steel content is used under the Draw Steel Creator License (attribution lives in
// lib/systems/drawsteel.ts and must appear in a user-visible place in the app).

import React from "react";
import {
  DS_CHARS, DS_CHAR_LABEL,
  careerChoiceSlots,
  type DSBuild, type DSSheet, type DSChar,
} from "@/lib/drawsteel/character";
import { DS_RULES, DS_CLASS_LIST, DS_ANCESTRY_LIST, DS_KIT_LIST, DS_CAREER_LIST } from "@/lib/drawsteel/rules-data";
import { slotOptions, slotLabel, DS_PERK_GROUP_LABEL, DS_SKILL_GROUPS, DS_SKILL_GROUP_LABEL, type DSSkillSlot } from "@/lib/drawsteel/careers";
import { abilitiesForClass, abilityExplainer, type DSAbility } from "@/lib/drawsteel/abilities";
import { DS_DEITIES, domainsForDeity } from "@/lib/drawsteel/deities";
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
  const career = dsBuild.careerId ? DS_RULES.careers[dsBuild.careerId] : undefined;
  const anc = dsBuild.ancestryId ? DS_RULES.ancestries[dsBuild.ancestryId] : undefined;
  const selStyle = { ...stoneField(), cursor: "pointer" as const };
  const setChar = (c: DSChar, v: number) =>
    set({ characteristics: { ...dsBuild.characteristics, [c]: Math.max(-5, Math.min(5, v)) } });

  // Changing ancestry resets the purchased traits so a stale, now-illegal selection doesn't carry over.
  const setAncestry = (id: string) => set({ ancestryId: id, ancestryTraitIds: [] });

  // Changing class resets the subclass selection (a subclass belongs to one class).
  const setClass = (id: string) => set({ classId: id, subclassIds: [], subclassSkill: "" });

  // Subclass state. `sc` is the current class's subclass concept (or undefined).
  const sc = cls?.subclass;
  const subIds = dsBuild.subclassIds ?? [];
  const setSubAt = (i: number, id: string) => {
    const next = [...subIds];
    while (next.length < (sc?.picks ?? 1)) next.push("");
    next[i] = id;
    set({ subclassIds: next.slice(0, sc?.picks ?? 1), subclassSkill: "" });
  };
  // The chosen option (across picks) that grants a group skill, if any, drives a skill sub-picker.
  const groupGrantOption = sc
    ? sc.options.find((o) => subIds.includes(o.id) && o.grantsSkillFrom)
    : undefined;
  const applySubclassQuick = () => {
    if (!sc) return;
    set({ subclassIds: [...sc.quick], subclassSkill: sc.quickSkill ?? "" });
  };

  // Class abilities: the catalog for this class up to the character's level, grouped by level. The
  // player toggles which they have taken; we store the ids and show a mechanics-only explainer. The
  // effect numbers are on the card in the SRD, never reproduced here.
  const abilityIds = dsBuild.abilityIds ?? [];
  const classAbilities = dsBuild.classId ? abilitiesForClass(dsBuild.classId, dsBuild.level) : [];
  const abilitiesByLevel = classAbilities.reduce<Record<string, DSAbility[]>>((acc, a) => {
    const k = a.level == null ? "0" : String(a.level);
    (acc[k] ||= []).push(a);
    return acc;
  }, {});
  const abilityLevels = Object.keys(abilitiesByLevel).sort((a, b) => Number(a) - Number(b));
  const toggleAbility = (id: string) =>
    set({ abilityIds: abilityIds.includes(id) ? abilityIds.filter((x) => x !== id) : [...abilityIds, id] });

  // Deity & Domains (faith). Conduit picks 2 domains, Censor 1; the domain choices are constrained to
  // the chosen deity's portfolio. Changing deity resets the domains so a stale, off-portfolio pick
  // can't linger.
  const faithDomains = cls?.faithDomains ?? 0;
  const domainIds = dsBuild.domainIds ?? [];
  const deityDomains = dsBuild.deityId ? domainsForDeity(dsBuild.deityId) : [];
  const setDeity = (id: string) => set({ deityId: id, domainIds: [] });
  const setDomainAt = (i: number, id: string) => {
    const next = [...domainIds];
    while (next.length < faithDomains) next.push("");
    next[i] = id;
    set({ domainIds: next.slice(0, faithDomains) });
  };

  const ancTraitIds = dsBuild.ancestryTraitIds ?? [];
  const ancSpent = anc ? anc.purchasedTraits.filter((t) => ancTraitIds.includes(t.id)).reduce((s, t) => s + t.cost, 0) : 0;
  const ancRemaining = (anc?.points ?? 0) - ancSpent;

  const toggleTrait = (id: string, cost: number) => {
    if (ancTraitIds.includes(id)) {
      set({ ancestryTraitIds: ancTraitIds.filter((t) => t !== id) });
    } else if (cost <= ancRemaining) {
      set({ ancestryTraitIds: [...ancTraitIds, id] });
    }
  };

  // Quick build: fill purchased traits from the ancestry's recommended set, in order, up to the budget.
  const applyAncestryQuick = () => {
    if (!anc) return;
    let left = anc.points;
    const picks: string[] = [];
    for (const id of anc.quickTraits) {
      const t = anc.purchasedTraits.find((p) => p.id === id);
      if (t && t.cost <= left) { picks.push(t.id); left -= t.cost; }
    }
    set({ ancestryTraitIds: picks });
  };

  // Changing career resets the career-specific choices so stale skills/languages don't carry over.
  const setCareer = (id: string) =>
    set({ careerId: id, careerSkillChoices: [], careerLanguages: [] });

  const choiceSlots = careerChoiceSlots(career);
  const choices = dsBuild.careerSkillChoices ?? [];
  const setChoice = (i: number, v: string) => {
    const next = [...choices];
    while (next.length < choiceSlots.length) next.push("");
    next[i] = v;
    set({ careerSkillChoices: next.slice(0, choiceSlots.length) });
  };

  const langs = dsBuild.careerLanguages ?? [];
  const setLang = (i: number, v: string) => {
    const next = [...langs];
    while (next.length < (career?.languages ?? 0)) next.push("");
    next[i] = v;
    set({ careerLanguages: next.slice(0, career?.languages ?? 0) });
  };

  // Fixed skills already granted (so we can gray them out of choice dropdowns and avoid duplicates).
  const fixedSkills = career ? career.skills.filter((s) => s.fixed).map((s) => s.fixed as string) : [];

  // Quick build: fill each choice slot with the first recommended skill that is legal for it and unused.
  const applyQuickBuild = () => {
    if (!career) return;
    const used = new Set<string>(fixedSkills);
    const picks: string[] = [];
    for (const slot of choiceSlots) {
      const opts = slotOptions(slot);
      const pick = career.quickSkills.find((s) => opts.includes(s) && !used.has(s)) ?? "";
      if (pick) used.add(pick);
      picks.push(pick);
    }
    set({ careerSkillChoices: picks });
  };

  // Options for a choice dropdown: the slot's legal skills, minus anything already taken elsewhere.
  const optionsFor = (slot: DSSkillSlot, i: number): string[] => {
    const taken = new Set<string>(fixedSkills);
    choices.forEach((c, j) => { if (j !== i && c) taken.add(c); });
    return slotOptions(slot).filter((s) => !taken.has(s) || s === choices[i]);
  };

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
            <select value={dsBuild.classId} onChange={(e) => setClass(e.target.value)} style={selStyle}>
              <option value="">Choose...</option>
              {DS_CLASS_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Ancestry">
            <select value={dsBuild.ancestryId} onChange={(e) => setAncestry(e.target.value)} style={selStyle}>
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
          <Field label="Career">
            <select value={dsBuild.careerId} onChange={(e) => setCareer(e.target.value)} style={selStyle}>
              <option value="">Choose...</option>
              {DS_CAREER_LIST.map((cr) => <option key={cr.id} value={cr.id}>{cr.name}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* Subclass */}
      {sc && (
        <div style={stonePanel()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={forgeLabel}>{sc.concept}{sc.picks > 1 ? ` (pick ${sc.picks})` : ""}</div>
            <button onClick={applySubclassQuick}
              style={{ ...stoneField(), width: "auto", cursor: "pointer", padding: "4px 12px", fontSize: 12 }}>
              Quick build
            </button>
          </div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {Array.from({ length: sc.picks }).map((_, i) => {
              const taken = new Set(subIds.filter((_v, j) => j !== i && subIds[j]));
              return (
                <Field key={i} label={sc.picks > 1 ? `Choice ${i + 1}` : "Subclass"}>
                  <select value={subIds[i] ?? ""} onChange={(e) => setSubAt(i, e.target.value)} style={selStyle}>
                    <option value="">Choose...</option>
                    {sc.options.filter((o) => !taken.has(o.id) || o.id === subIds[i]).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}{o.grantsSkill ? ` (${o.grantsSkill})` : o.grantsSkillFrom ? ` (${DS_SKILL_GROUP_LABEL[o.grantsSkillFrom]} skill)` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })}
            {groupGrantOption?.grantsSkillFrom && (
              <Field label={`${groupGrantOption.name} skill (${DS_SKILL_GROUP_LABEL[groupGrantOption.grantsSkillFrom]})`}>
                <select value={dsBuild.subclassSkill ?? ""} onChange={(e) => set({ subclassSkill: e.target.value })} style={selStyle}>
                  <option value="">Choose...</option>
                  {DS_SKILL_GROUPS[groupGrantOption.grantsSkillFrom].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            )}
          </div>
        </div>
      )}

      {/* Deity & Domains (faith) */}
      {cls && faithDomains > 0 && (
        <div style={stonePanel()}>
          <div style={forgeLabel}>Deity &amp; domains</div>
          <p style={{ color: STONE.inkDim, fontSize: 12, margin: "6px 0 10px" }}>
            Choose a deity or saint, then {faithDomains === 1 ? "one domain" : `${faithDomains} domains`} from
            their portfolio. Each domain grants a piety trigger, a prayer effect, and features as you level;
            those are printed in your SRD.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <Field label="Deity or saint">
              <select value={dsBuild.deityId} onChange={(e) => setDeity(e.target.value)} style={selStyle}>
                <option value="">Choose...</option>
                <optgroup label="Deities">
                  {DS_DEITIES.filter((x) => x.kind === "deity").map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Saints &amp; heroes">
                  {DS_DEITIES.filter((x) => x.kind === "saint").map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </optgroup>
              </select>
            </Field>
            {Array.from({ length: faithDomains }).map((_, i) => {
              const taken = new Set(domainIds.filter((_v, j) => j !== i && domainIds[j]));
              return (
                <Field key={i} label={faithDomains > 1 ? `Domain ${i + 1}` : "Domain"}>
                  <select value={domainIds[i] ?? ""} onChange={(e) => setDomainAt(i, e.target.value)}
                    disabled={!dsBuild.deityId} style={selStyle}>
                    <option value="">{dsBuild.deityId ? "Choose..." : "Pick a deity first"}</option>
                    {deityDomains.filter((dm) => !taken.has(dm.id) || dm.id === domainIds[i]).map((dm) => (
                      <option key={dm.id} value={dm.id}>{dm.name}</option>
                    ))}
                  </select>
                </Field>
              );
            })}
          </div>
        </div>
      )}

      {/* Class abilities */}
      {cls && classAbilities.length > 0 && (
        <div style={stonePanel()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={forgeLabel}>Abilities</div>
            <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color: STONE.inkDim }}>
              {cls.resource} · {abilityIds.length} taken
            </span>
          </div>
          <p style={{ color: STONE.inkDim, fontSize: 12, margin: "6px 0 10px" }}>
            Your heroic resource is <strong style={{ color: STONE.ink }}>{cls.resource}</strong>. Tap the abilities
            you have taken. Each line shows what an ability is; the exact effect is on its card in your SRD.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {abilityLevels.map((lvl) => (
              <div key={lvl}>
                <div style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkDim, textTransform: "uppercase", marginBottom: 6 }}>
                  {lvl === "0" ? "General" : `Level ${lvl}`}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {abilitiesByLevel[lvl].map((a) => {
                    const on = abilityIds.includes(a.id);
                    return (
                      <button key={a.id} type="button" onClick={() => toggleAbility(a.id)}
                        style={{
                          ...selStyle, textAlign: "left", padding: "8px 10px", cursor: "pointer",
                          borderColor: on ? STONE.brassHi : undefined,
                          background: on ? STONE.shadow : (selStyle.background as string),
                          display: "grid", gap: 3,
                        }}>
                        <span style={{ fontSize: 13.5, color: STONE.ink, fontWeight: 600 }}>
                          {on ? "✓ " : ""}{a.name}{a.subclass ? ` (${a.subclass})` : ""}
                        </span>
                        <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkDim }}>
                          {abilityExplainer(a)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ancestry traits */}
      <div style={stonePanel()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={forgeLabel}>Ancestry traits</div>
          {anc && anc.purchasedTraits.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color: ancRemaining < 0 ? STONE.blood : STONE.inkDim }}>
                {ancSpent} / {anc.points} pts
              </span>
              <button onClick={applyAncestryQuick}
                style={{ ...stoneField(), width: "auto", cursor: "pointer", padding: "4px 12px", fontSize: 12 }}>
                Quick build
              </button>
            </div>
          )}
        </div>
        {!anc ? (
          <p style={{ color: STONE.inkDim, fontSize: 12, margin: "6px 0 0" }}>
            Choose an ancestry to see its signature traits and spend ancestry points on purchased traits.
          </p>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            {/* Signature (automatic) */}
            {anc.signatureTraits.length > 0 && (
              <div>
                <div style={{ ...forgeLabel, marginBottom: 4 }}>Signature (automatic)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {anc.signatureTraits.map((t) => (
                    <span key={t.id} style={chip}>
                      {t.name}{t.mods ? ` · ${modLabel(t.mods)}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Purchased */}
            <div>
              <div style={{ ...forgeLabel, marginBottom: 4 }}>Purchased ({anc.points} points)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
                {anc.purchasedTraits.map((t) => {
                  const on = ancTraitIds.includes(t.id);
                  const affordable = on || t.cost <= ancRemaining;
                  return (
                    <button key={t.id} type="button" onClick={() => toggleTrait(t.id, t.cost)} disabled={!affordable}
                      style={{
                        ...selStyle, textAlign: "left", padding: "7px 10px", fontSize: 13,
                        cursor: affordable ? "pointer" : "default",
                        opacity: affordable ? 1 : 0.4,
                        borderColor: on ? STONE.brassHi : undefined,
                        color: on ? STONE.ink : STONE.inkDim,
                      }}>
                      <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 11, color: STONE.inkDim, marginRight: 6 }}>
                        {on ? "✓" : ""}{t.cost}p
                      </span>
                      {t.name}{t.mods ? ` · ${modLabel(t.mods)}` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Career */}
      <div style={stonePanel()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={forgeLabel}>Career</div>
          {career && choiceSlots.length > 0 && (
            <button onClick={applyQuickBuild}
              style={{ ...stoneField(), width: "auto", cursor: "pointer", padding: "4px 12px", fontSize: 12 }}>
              Quick build
            </button>
          )}
        </div>
        {!career ? (
          <p style={{ color: STONE.inkDim, fontSize: 12, margin: "6px 0 0" }}>
            Choose a career. Every hero has one — it grants skills, languages, and a perk.
          </p>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            {/* Fixed skills */}
            {fixedSkills.length > 0 && (
              <div>
                <div style={{ ...forgeLabel, marginBottom: 4 }}>Granted skills</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {fixedSkills.map((s) => (
                    <span key={s} style={chip}>{s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Choice skills */}
            {choiceSlots.length > 0 && (
              <div>
                <div style={{ ...forgeLabel, marginBottom: 4 }}>Choose skills</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  {choiceSlots.map((slot, i) => (
                    <Field key={i} label={slotLabel(slot)}>
                      <select value={choices[i] ?? ""} onChange={(e) => setChoice(i, e.target.value)} style={selStyle}>
                        <option value="">Choose...</option>
                        {optionsFor(slot, i).map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </Field>
                  ))}
                </div>
              </div>
            )}

            {/* Languages */}
            {career.languages > 0 && (
              <div>
                <div style={{ ...forgeLabel, marginBottom: 4 }}>
                  Languages ({career.languages})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                  {Array.from({ length: career.languages }).map((_, i) => (
                    <input key={i} value={langs[i] ?? ""} onChange={(e) => setLang(i, e.target.value)}
                      placeholder={`Language ${i + 1}`} style={{ ...stoneField(), cursor: "text" }} />
                  ))}
                </div>
              </div>
            )}

            {/* Perk */}
            <p style={{ color: STONE.inkDim, fontSize: 12, margin: 0 }}>
              Perk: one <strong style={{ color: STONE.ink }}>{DS_PERK_GROUP_LABEL[career.perkGroup]}</strong> perk
              {" "}(quick build: {career.quickPerk}).
            </p>
          </div>
        )}
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

            {/* Subclass output */}
            {sheet.subclassConcept && sheet.subclassNames.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${STONE.hi}` }}>
                <div style={{ ...forgeLabel, marginBottom: 6 }}>
                  {sheet.subclassConcept}: {sheet.subclassNames.join(", ")}
                </div>
                {sheet.subclassSkills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {sheet.subclassSkills.map((s) => <span key={s} style={chip}>{s}</span>)}
                  </div>
                )}
              </div>
            )}

            {/* Faith output */}
            {sheet.faithDomains > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${STONE.hi}` }}>
                <div style={{ ...forgeLabel, marginBottom: 6 }}>
                  Faith{sheet.deityName ? `: ${sheet.deityName}` : ""}
                </div>
                {sheet.domainNames.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {sheet.domainNames.map((n) => <span key={n} style={chip}>{n}</span>)}
                  </div>
                ) : (
                  <span style={{ color: STONE.inkDim, fontSize: 12 }}>
                    {sheet.deityName ? `Choose ${sheet.faithDomains} domain${sheet.faithDomains > 1 ? "s" : ""}.` : "Choose a deity and domains."}
                  </span>
                )}
              </div>
            )}

            {/* Abilities output */}
            {sheet.heroicResource && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${STONE.hi}` }}>
                <div style={{ ...forgeLabel, marginBottom: 6 }}>
                  Abilities · heroic resource: {sheet.heroicResource}
                </div>
                {sheet.abilityNames.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {sheet.abilityNames.map((n) => <span key={n} style={chip}>{n}</span>)}
                  </div>
                ) : (
                  <span style={{ color: STONE.inkDim, fontSize: 12 }}>No abilities taken yet.</span>
                )}
              </div>
            )}

            {/* Ancestry output */}
            {sheet.ancestryName && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${STONE.hi}` }}>
                <div style={{ ...forgeLabel, marginBottom: 6 }}>
                  {sheet.ancestryName} · traits ({sheet.ancestryPointsSpent}/{sheet.ancestryPoints} pts)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {sheet.signatureTraitNames.map((n) => (
                    <span key={`sig-${n}`} style={{ ...chip, borderStyle: "dashed" }}>{n}</span>
                  ))}
                  {sheet.purchasedTraitNames.map((n) => (
                    <span key={`buy-${n}`} style={chip}>{n}</span>
                  ))}
                  {sheet.purchasedTraitNames.length === 0 && (
                    <span style={{ color: STONE.inkDim, fontSize: 12 }}>No purchased traits yet.</span>
                  )}
                </div>
              </div>
            )}

            {/* Career output */}
            {sheet.careerName && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${STONE.hi}` }}>
                <div style={{ ...forgeLabel, marginBottom: 6 }}>{sheet.careerName}</div>
                {sheet.skills.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {sheet.skills.map((s) => <span key={s} style={chip}>{s}</span>)}
                  </div>
                ) : (
                  <p style={{ color: STONE.inkDim, fontSize: 12, margin: "0 0 8px" }}>No skills chosen yet.</p>
                )}
                <p style={{ color: STONE.inkDim, fontSize: 12, margin: 0 }}>
                  {sheet.languagesCount > 0
                    ? <>Languages: {sheet.languages.length ? sheet.languages.join(", ") : `${sheet.languagesCount} to choose`}. </>
                    : null}
                  {sheet.perkGroup ? <>Perk from the {DS_PERK_GROUP_LABEL[sheet.perkGroup]} group.</> : null}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const chip: React.CSSProperties = {
  fontFamily: FORGE_FONTS.mono,
  fontSize: 12,
  color: STONE.ink,
  background: STONE.shadow,
  border: `1px solid ${STONE.hi}`,
  borderRadius: 6,
  padding: "3px 9px",
};

// A short label for a trait's flat numeric mod, e.g. "+1 stability", "+6 Stamina/echelon".
function modLabel(m: { stability?: number; recoveries?: number; speed?: number; staminaPerEchelon?: number; size?: string }): string {
  const parts: string[] = [];
  if (m.stability) parts.push(`${m.stability > 0 ? "+" : ""}${m.stability} stability`);
  if (m.recoveries) parts.push(`${m.recoveries > 0 ? "+" : ""}${m.recoveries} Recoveries`);
  if (m.speed) parts.push(`${m.speed > 0 ? "+" : ""}${m.speed} speed`);
  if (m.staminaPerEchelon) parts.push(`+${m.staminaPerEchelon} Stamina/echelon`);
  if (m.size) parts.push(`size ${m.size}`);
  return parts.join(", ");
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
