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
import { fitsMount, systemsSpUsed, modsSpUsed, modFits } from "@/lib/lancer/loadout";
import { LANCER_WEAPONS, LANCER_SYSTEMS, LANCER_MODS } from "@/lib/lancer/loadout-data";
import {
  talentPointsAvailable, licenseRanksAvailable, skillPointsAvailable, ranksSpent, setRank, removeRank,
  skillBonusForRank, MAX_TALENT_RANK, MAX_LICENSE_RANK, MAX_SKILL_RANK,
} from "@/lib/lancer/pilot";
import { LANCER_TALENTS, LANCER_SKILL_TRIGGERS } from "@/lib/lancer/pilot-data";
import { STONE, FORGE_FONTS, stonePanel, stoneField, forgeLabel, statTile } from "@/lib/forge-theme";

const ROMAN = ["", "I", "II", "III"];

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const licenseOf = (lic: string) => lic || "Integrated";

// Frames grouped by manufacturer for the picker (the list is already sorted manufacturer -> LL -> name).
const MANUFACTURERS: string[] = LANCER_FRAME_LIST.reduce<string[]>((acc, f) => {
  if (!acc.includes(f.manufacturer)) acc.push(f.manufacturer);
  return acc;
}, []);
// License groupings for the weapon / system pickers (empty license shows as "Integrated").
const WEAPON_LICENSES: string[] = LANCER_WEAPONS.reduce<string[]>((acc, w) => {
  const l = licenseOf(w.license); if (!acc.includes(l)) acc.push(l); return acc;
}, []);
const SYSTEM_LICENSES: string[] = LANCER_SYSTEMS.reduce<string[]>((acc, s) => {
  const l = licenseOf(s.license); if (!acc.includes(l)) acc.push(l); return acc;
}, []);
// License lines a pilot can rank up: every non-GMS frame is its own license (GMS gear is license-free).
const LICENSE_LINES = LANCER_FRAME_LIST.filter((f) => f.manufacturer !== "GENERAL MASSIVE SYSTEMS");
const LICENSE_MANUFACTURERS: string[] = LICENSE_LINES.reduce<string[]>((acc, f) => {
  if (!acc.includes(f.manufacturer)) acc.push(f.manufacturer); return acc;
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

  // A weapon sits in the frame's mount slot at index i. Changing frame clears the weapon layout, since a
  // different frame has different mounts.
  const setWeapon = (i: number, id: string) => {
    const next = [...build.weapons];
    while (next.length <= i) next.push("");
    next[i] = id;
    // A mod belongs to the weapon it sits on; changing the weapon clears its mod.
    const nextMods = [...build.mods];
    while (nextMods.length <= i) nextMods.push("");
    nextMods[i] = "";
    set({ weapons: next, mods: nextMods });
  };
  const setMod = (i: number, id: string) => {
    const next = [...build.mods];
    while (next.length <= i) next.push("");
    next[i] = id;
    set({ mods: next });
  };
  const addSystem = (id: string) => { if (id) set({ systems: [...build.systems, id] }); };
  const removeSystem = (i: number) => set({ systems: build.systems.filter((_, j) => j !== i) });

  const spUsed = sheet ? systemsSpUsed(build.systems, LANCER_SYSTEMS) + modsSpUsed(build.mods, LANCER_MODS) : 0;
  const spBudget = sheet ? sheet.mech.sp : 0;
  const spOver = spUsed > spBudget;

  // Pilot progression: talents (3 + level points) and license ranks (level ranks), rank cap 3 each.
  const talentAvail = talentPointsAvailable(build.level);
  const talentSpent = ranksSpent(build.talents);
  const licAvail = licenseRanksAvailable(build.level);
  const licSpent = ranksSpent(build.licenses);
  const setTalentRank = (id: string, rank: number) => set({ talents: setRank(build.talents, id, rank, MAX_TALENT_RANK) });
  const dropTalent = (id: string) => set({ talents: removeRank(build.talents, id) });
  const setLicenseRank = (id: string, rank: number) => set({ licenses: setRank(build.licenses, id, rank, MAX_LICENSE_RANK) });
  const dropLicense = (id: string) => set({ licenses: removeRank(build.licenses, id) });

  // Pilot skill triggers: 4 points at LL0, +1 per level; a point takes a new trigger (+2) or raises one
  // a step (+2 -> +4 -> +6). Same ranked-map shape as talents; rank N shows as +2N.
  const skillTriggers = build.skillTriggers ?? {};
  const skillAvail = skillPointsAvailable(build.level);
  const skillSpent = ranksSpent(skillTriggers);
  const setSkillTrigRank = (id: string, rank: number) => set({ skillTriggers: setRank(skillTriggers, id, rank, MAX_SKILL_RANK) });
  const dropSkillTrig = (id: string) => set({ skillTriggers: removeRank(skillTriggers, id) });

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
            <select value={build.frameId} onChange={(e) => set({ frameId: e.target.value, weapons: [] })} style={selStyle}>
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

      {/* Weapons: one per frame mount, filtered to the sizes that mount accepts. Weapons cost no SP. */}
      {sheet && (
        <div style={stonePanel()}>
          <div style={forgeLabel}>Weapons</div>
          <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 10px" }}>
            Each mount holds a weapon that fits its size; weapons cost no System Points. A Flex mount can
            instead carry two Auxiliary weapons, and a Superheavy weapon needs bracing, both tracked by
            hand for now.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            {sheet.frame.mounts.map((mount, i) => {
              const options = LANCER_WEAPONS.filter((w) => fitsMount(w.size, mount));
              const selId = build.weapons[i] || "";
              const sel = LANCER_WEAPONS.find((w) => w.id === selId);
              return (
                <div key={`${mount}-${i}`}>
                  <Field label={`${mount} mount`}>
                    <select value={selId} onChange={(e) => setWeapon(i, e.target.value)} style={selStyle}>
                      <option value="">Empty</option>
                      {WEAPON_LICENSES.map((lic) => {
                        const opts = options.filter((w) => licenseOf(w.license) === lic);
                        if (!opts.length) return null;
                        return (
                          <optgroup key={lic} label={lic}>
                            {opts.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.size})</option>)}
                          </optgroup>
                        );
                      })}
                    </select>
                  </Field>
                  {sel && (<>
                    <p style={{ color: STONE.inkDim, fontSize: 11.5, margin: "4px 0 0" }}>
                      {sel.type}
                      {sel.damage.length ? ` · ${sel.damage.join(", ")}` : ""}
                      {sel.range.length ? ` · ${sel.range.join(", ")}` : ""}
                      {sel.tags.length ? ` · ${sel.tags.join(", ")}` : ""}
                    </p>
                    {(() => {
                      const modOpts = LANCER_MODS.filter((m) => modFits(m, sel));
                      if (!modOpts.length) return null;
                      const modId = build.mods[i] || "";
                      const mod = LANCER_MODS.find((m) => m.id === modId);
                      return (
                        <div style={{ marginTop: 6 }}>
                          <select value={modId} onChange={(e) => setMod(i, e.target.value)} style={{ ...selStyle, fontSize: 13 }}>
                            <option value="">No mod</option>
                            {modOpts.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.sp} SP)</option>)}
                          </select>
                          {mod && (
                            <p style={{ color: STONE.inkDim, fontSize: 11, margin: "3px 0 0" }}>
                              Mod: {mod.name} · {mod.sp} SP
                              {mod.addedTags.length ? ` · +${mod.addedTags.join(", ")}` : ""}
                              {mod.addedRange.length ? ` · +${mod.addedRange.join(", ")}` : ""}
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </>)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Systems: bought against the mech's System Points. The SP total also includes weapon mods
          (applied above). Unique/limited caps are not enforced yet; the running total is the useful part. */}
      {sheet && (
        <div style={stonePanel()}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div style={forgeLabel}>Systems</div>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 13, color: spOver ? "#d66" : STONE.ink }}>
              {spUsed} / {spBudget} SP
            </span>
          </div>
          {spOver && (
            <p style={{ color: "#d66", fontSize: 12, margin: "4px 0 0" }}>
              Over budget by {spUsed - spBudget} SP. Remove a system or raise Systems / license level.
            </p>
          )}
          <div style={{ marginTop: 10 }}>
            <Field label="Add a system">
              <select value="" onChange={(e) => { addSystem(e.target.value); e.currentTarget.selectedIndex = 0; }} style={selStyle}>
                <option value="">Choose...</option>
                {SYSTEM_LICENSES.map((lic) => (
                  <optgroup key={lic} label={lic}>
                    {LANCER_SYSTEMS.filter((s) => licenseOf(s.license) === lic).map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.sp} SP)</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {build.systems.length === 0 && (
              <p style={{ color: STONE.inkDim, fontSize: 12.5, fontStyle: "italic" }}>No systems equipped.</p>
            )}
            {build.systems.map((id, i) => {
              const s = LANCER_SYSTEMS.find((x) => x.id === id);
              if (!s) return null;
              return (
                <div key={`${id}-${i}`} style={{ display: "flex", gap: 10, alignItems: "baseline", borderLeft: `2px solid ${STONE.inkFaint}`, paddingLeft: 12 }}>
                  <span style={{ color: STONE.ink, fontSize: 14, flex: 1 }}>
                    {s.name}
                    <span style={{ color: STONE.inkDim, fontSize: 11.5 }}>
                      {"  "}{s.type}{s.tags.length ? ` · ${s.tags.join(", ")}` : ""}
                    </span>
                  </span>
                  <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 12, color: STONE.inkDim }}>{s.sp} SP</span>
                  <button type="button" onClick={() => removeSystem(i)}
                    style={{ background: "none", border: "none", color: STONE.inkDim, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pilot skill triggers: ranked +2/+4/+6, 4 + level points. */}
      <div style={stonePanel()}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={forgeLabel}>Skill triggers</div>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 13, color: skillSpent > skillAvail ? "#d66" : STONE.ink }}>
            {skillSpent} / {skillAvail}
          </span>
        </div>
        <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 0" }}>
          Four points at LL0, one more each level. Each point takes a new trigger at +2 or raises one to +4, then +6.
          {skillSpent > skillAvail ? ` Over by ${skillSpent - skillAvail}.` : ""}
        </p>
        <div style={{ marginTop: 10 }}>
          <Field label="Add a skill trigger">
            <select value="" onChange={(e) => { if (e.target.value) setSkillTrigRank(e.target.value, 1); e.currentTarget.selectedIndex = 0; }} style={selStyle}>
              <option value="">Choose...</option>
              {LANCER_SKILL_TRIGGERS.filter((t) => !(t.id in skillTriggers)).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {Object.keys(skillTriggers).length === 0 && (
            <p style={{ color: STONE.inkDim, fontSize: 12.5, fontStyle: "italic" }}>No skill triggers taken.</p>
          )}
          {Object.entries(skillTriggers).map(([id, rank]) => {
            const t = LANCER_SKILL_TRIGGERS.find((x) => x.id === id);
            if (!t) return null;
            return (
              <div key={id} style={{ display: "flex", gap: 10, alignItems: "center", borderLeft: `2px solid ${STONE.inkFaint}`, paddingLeft: 12 }}>
                <span style={{ color: STONE.ink, fontSize: 14, flex: 1 }}>{t.name}</span>
                <select value={rank} onChange={(e) => setSkillTrigRank(id, parseInt(e.target.value, 10))} style={{ ...selStyle, width: "auto", padding: "4px 8px", fontSize: 13 }}>
                  {[1, 2, 3].map((r) => <option key={r} value={r}>{sign(skillBonusForRank(r))}</option>)}
                </select>
                <button type="button" onClick={() => dropSkillTrig(id)} style={{ background: "none", border: "none", color: STONE.inkDim, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pilot progression: talents (ranked I to III, 3 + level points) and license ranks (level ranks). */}
      <div style={stonePanel()}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={forgeLabel}>Talents</div>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 13, color: talentSpent > talentAvail ? "#d66" : STONE.ink }}>
            {talentSpent} / {talentAvail}
          </span>
        </div>
        {talentSpent > talentAvail && (
          <p style={{ color: "#d66", fontSize: 12, margin: "4px 0 0" }}>Over by {talentSpent - talentAvail}. Drop a rank or raise license level.</p>
        )}
        <div style={{ marginTop: 10 }}>
          <Field label="Add a talent">
            <select value="" onChange={(e) => { if (e.target.value) setTalentRank(e.target.value, 1); e.currentTarget.selectedIndex = 0; }} style={selStyle}>
              <option value="">Choose...</option>
              {LANCER_TALENTS.filter((t) => !(t.id in build.talents)).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {Object.keys(build.talents).length === 0 && (
            <p style={{ color: STONE.inkDim, fontSize: 12.5, fontStyle: "italic" }}>No talents taken.</p>
          )}
          {Object.entries(build.talents).map(([id, rank]) => {
            const t = LANCER_TALENTS.find((x) => x.id === id);
            if (!t) return null;
            return (
              <div key={id} style={{ display: "flex", gap: 10, alignItems: "center", borderLeft: `2px solid ${STONE.inkFaint}`, paddingLeft: 12 }}>
                <span style={{ color: STONE.ink, fontSize: 14, flex: 1 }}>{t.name}</span>
                <select value={rank} onChange={(e) => setTalentRank(id, parseInt(e.target.value, 10))} style={{ ...selStyle, width: "auto", padding: "4px 8px", fontSize: 13 }}>
                  {[1, 2, 3].map((r) => <option key={r} value={r}>Rank {ROMAN[r]}</option>)}
                </select>
                <button type="button" onClick={() => dropTalent(id)} style={{ background: "none", border: "none", color: STONE.inkDim, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={stonePanel()}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={forgeLabel}>Licenses</div>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: FORGE_FONTS.mono, fontSize: 13, color: licSpent > licAvail ? "#d66" : STONE.ink }}>
            {licSpent} / {licAvail}
          </span>
        </div>
        <p style={{ color: STONE.inkDim, fontSize: 12, margin: "4px 0 0" }}>
          Every non-GMS frame is its own license line, ranked I to III; GMS gear needs no license.
          {licSpent > licAvail ? ` Over by ${licSpent - licAvail}.` : ""}
        </p>
        <div style={{ marginTop: 10 }}>
          <Field label="Add a license">
            <select value="" onChange={(e) => { if (e.target.value) setLicenseRank(e.target.value, 1); e.currentTarget.selectedIndex = 0; }} style={selStyle}>
              <option value="">Choose...</option>
              {LICENSE_MANUFACTURERS.map((man) => {
                const opts = LICENSE_LINES.filter((f) => f.manufacturer === man && !(f.id in build.licenses));
                if (!opts.length) return null;
                return <optgroup key={man} label={man}>{opts.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>;
              })}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {Object.keys(build.licenses).length === 0 && (
            <p style={{ color: STONE.inkDim, fontSize: 12.5, fontStyle: "italic" }}>No licenses taken.</p>
          )}
          {Object.entries(build.licenses).map(([id, rank]) => {
            const f = LICENSE_LINES.find((x) => x.id === id);
            if (!f) return null;
            return (
              <div key={id} style={{ display: "flex", gap: 10, alignItems: "center", borderLeft: `2px solid ${STONE.inkFaint}`, paddingLeft: 12 }}>
                <span style={{ color: STONE.ink, fontSize: 14, flex: 1 }}>
                  {f.name}<span style={{ color: STONE.inkDim, fontSize: 11.5 }}>{"  "}{f.manufacturer}</span>
                </span>
                <select value={rank} onChange={(e) => setLicenseRank(id, parseInt(e.target.value, 10))} style={{ ...selStyle, width: "auto", padding: "4px 8px", fontSize: 13 }}>
                  {[1, 2, 3].map((r) => <option key={r} value={r}>Rank {ROMAN[r]}</option>)}
                </select>
                <button type="button" onClick={() => dropLicense(id)} style={{ background: "none", border: "none", color: STONE.inkDim, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>
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
