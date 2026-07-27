"use client";

/**
 * A clean, ink-saving printable character sheet. This is a SEPARATE artifact from the on-screen
 * Forge editor: the editor is full of pickers and buttons; a printed sheet is a read-only document.
 * It renders black-on-white with hairline rules for legibility and low ink use, and is laid out to
 * fit Letter/A4 with print-safe page breaks.
 *
 * Print flow: this component is hidden on screen (.sheet-print-root { display: none }) and revealed
 * only inside @media print, where the editor chrome is hidden instead. The "Download PDF" button
 * calls window.print(); the user picks "Save as PDF" in the browser dialog. No server, no library.
 */

import { SKILLS, type Ability } from "@/lib/srd/derive-sheet";

// The derived sheet shape (mirrors deriveSheet's return; kept structural to avoid a hard import
// cycle on the return type).
export type PrintSheet = {
  abilities: Record<Ability, number>;
  mods: Record<Ability, number>;
  ac: number;
  acFormula: string;
  hpMax: number;
  proficiencyBonus: number;
  initiative: number;
  speed: number;
  speedLabel?: string;
  saves: Record<Ability, number>;
  skills: Record<string, { abil: Ability; rank: number; val: number; fromEpic: boolean }>;
  resist: string[];
  isCaster?: boolean;
  spellDC?: number;
  spellAttack?: number;
  sneakDice?: number;
  martialArts?: number;
};

export type PrintFeature = { level: number; name: string; desc?: string; category?: string };
export type PrintTrait = { name: string; desc: string };

export type CharacterSheetPrintProps = {
  name: string;
  species: string;
  variantName?: string;
  className: string;
  subclass?: string;
  background?: string;
  level: number;
  sheet: PrintSheet;
  speciesTraits: PrintTrait[];
  variantTraits: PrintTrait[];
  classFeatures: { level: number; names: string[] }[];
  feats: PrintFeature[];
  gear: { name: string; detail?: string }[];
};

const ABIL_LABEL: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
const ABIL_ORDER: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

function mod(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

export function CharacterSheetPrint(props: CharacterSheetPrintProps) {
  const { name, species, variantName, className, subclass, background, level, sheet } = props;
  const trained = SKILLS.filter(([k]) => sheet.skills[k]?.rank > 0);

  const lineage = [species, variantName].filter(Boolean).join(" · ");
  const classLine = [className, subclass].filter(Boolean).join(" — ");

  const combatStats: [string, string, string?][] = [
    ["Armor Class", String(sheet.ac), sheet.acFormula || undefined],
    ["Hit Points", String(sheet.hpMax)],
    ["Proficiency", mod(sheet.proficiencyBonus)],
    ["Initiative", mod(sheet.initiative)],
    ["Speed", `${sheet.speed} ft`, sheet.speedLabel || undefined],
  ];
  if (sheet.isCaster) {
    combatStats.push(["Spell save DC", String(sheet.spellDC ?? "")]);
    combatStats.push(["Spell attack", mod(sheet.spellAttack ?? 0)]);
  }
  if (sheet.sneakDice) combatStats.push(["Sneak Attack", `${sheet.sneakDice}d6`]);
  if (sheet.martialArts) combatStats.push(["Martial Arts", `d${sheet.martialArts}`]);

  return (
    <div className="sheet-print-root">
      <style>{PRINT_CSS}</style>

      {/* Header */}
      <header className="cs-head">
        <h1 className="cs-name">{name || "Unnamed Character"}</h1>
        <div className="cs-subline">
          <span>{lineage || "—"}</span>
          <span className="cs-dot">•</span>
          <span>{classLine || "—"}</span>
          <span className="cs-dot">•</span>
          <span>Level {level}</span>
          {background ? <><span className="cs-dot">•</span><span>{background}</span></> : null}
        </div>
      </header>

      {/* Top band: abilities + combat callouts */}
      <div className="cs-top">
        <section className="cs-abilities">
          {ABIL_ORDER.map((a) => (
            <div key={a} className="cs-abil">
              <div className="cs-abil-label">{ABIL_LABEL[a]}</div>
              <div className="cs-abil-mod">{mod(sheet.mods[a])}</div>
              <div className="cs-abil-score">{sheet.abilities[a]}</div>
            </div>
          ))}
        </section>

        <section className="cs-combat">
          {combatStats.map(([label, value, note]) => (
            <div key={label} className="cs-stat">
              <div className="cs-stat-value">{value}</div>
              <div className="cs-stat-label">{label}</div>
              {note ? <div className="cs-stat-note">{note}</div> : null}
            </div>
          ))}
        </section>
      </div>

      {/* Saves + skills */}
      <div className="cs-cols">
        <section className="cs-block cs-saves">
          <h2 className="cs-h2">Saving Throws</h2>
          <ul className="cs-list">
            {ABIL_ORDER.map((a) => (
              <li key={a}><span>{ABIL_LABEL[a]}</span><span className="cs-num">{mod(sheet.saves[a])}</span></li>
            ))}
          </ul>
          {sheet.resist.length > 0 && (
            <>
              <h2 className="cs-h2" style={{ marginTop: 12 }}>Resistances</h2>
              <p className="cs-prose">{sheet.resist.join(", ")}</p>
            </>
          )}
        </section>

        <section className="cs-block cs-skills">
          <h2 className="cs-h2">Skills</h2>
          {trained.length > 0 ? (
            <ul className="cs-list cs-skill-list">
              {trained.map(([k, label]) => (
                <li key={k}>
                  <span>{label}{sheet.skills[k].rank === 2 ? " (expertise)" : ""}</span>
                  <span className="cs-num">{mod(sheet.skills[k].val)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="cs-prose cs-muted">No trained skills.</p>}
        </section>
      </div>

      {/* Features & traits */}
      <section className="cs-block cs-features">
        <h2 className="cs-h2">Features &amp; Traits</h2>

        {props.speciesTraits.length > 0 && (
          <div className="cs-fgroup">
            <h3 className="cs-h3">{species}</h3>
            {props.speciesTraits.map((t, i) => (
              <p key={i} className="cs-prose"><b>{t.name ? `${t.name}. ` : ""}</b>{t.desc}</p>
            ))}
          </div>
        )}

        {variantName && props.variantTraits.length > 0 && (
          <div className="cs-fgroup">
            <h3 className="cs-h3">{variantName}</h3>
            {props.variantTraits.map((t, i) => (
              <p key={i} className="cs-prose"><b>{t.name ? `${t.name}. ` : ""}</b>{t.desc}</p>
            ))}
          </div>
        )}

        {props.classFeatures.length > 0 && (
          <div className="cs-fgroup">
            <h3 className="cs-h3">{className} Features</h3>
            <ul className="cs-flist">
              {props.classFeatures.map((g) => (
                <li key={g.level}><span className="cs-flevel">L{g.level}</span> {g.names.join(", ")}</li>
              ))}
            </ul>
          </div>
        )}

        {props.feats.length > 0 && (
          <div className="cs-fgroup">
            <h3 className="cs-h3">Feats &amp; Boons</h3>
            {props.feats.map((f, i) => (
              <p key={i} className="cs-prose">
                <b>{f.name}</b> <span className="cs-muted">(L{f.level}{f.category && f.category !== "Feat" ? `, ${f.category}` : ""})</span>
                {f.desc ? <> — {f.desc}</> : null}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* Gear */}
      {props.gear.length > 0 && (
        <section className="cs-block cs-gear">
          <h2 className="cs-h2">Equipment</h2>
          <ul className="cs-flist">
            {props.gear.map((g, i) => (
              <li key={i}><b>{g.name}</b>{g.detail ? <span className="cs-muted"> — {g.detail}</span> : null}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="cs-foot">Generated by the Forge · Six Axes</footer>
    </div>
  );
}

// Print CSS. On screen the root is hidden; @media print reveals it and hides everything else on the
// page (the editor). Black on white, hairline rules, tight spacing, page-break-safe sections.
const PRINT_CSS = `
.sheet-print-root { display: none; }

@media print {
  /* Hide the editor; show only the sheet. */
  body * { visibility: hidden; }
  .sheet-print-root, .sheet-print-root * { visibility: visible; }
  .sheet-print-root {
    display: block; position: absolute; left: 0; top: 0; width: 100%;
    background: #fff; color: #111;
    font-family: Georgia, "Times New Roman", serif;
    padding: 0; margin: 0;
  }

  @page { size: auto; margin: 14mm; }

  .cs-head { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  .cs-name {
    font-family: "Cinzel", Georgia, serif; font-size: 26pt; font-weight: 700;
    margin: 0 0 4px; letter-spacing: 0.5px; line-height: 1.05;
  }
  .cs-subline { font-size: 10.5pt; color: #333; }
  .cs-dot { margin: 0 7px; color: #999; }

  .cs-top { display: flex; gap: 16px; margin-bottom: 16px; page-break-inside: avoid; }

  .cs-abilities {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; flex: 1 1 55%;
  }
  .cs-abil { border: 1px solid #111; border-radius: 3px; padding: 6px 4px; text-align: center; }
  .cs-abil-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.5px; color: #444; }
  .cs-abil-mod { font-size: 20pt; font-weight: 700; line-height: 1.1; }
  .cs-abil-score {
    font-size: 8.5pt; color: #333; border-top: 1px solid #ccc; margin-top: 3px; padding-top: 2px;
  }

  .cs-combat { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; flex: 1 1 45%; align-content: start; }
  .cs-stat { border: 1px solid #666; border-radius: 3px; padding: 5px 8px; text-align: center; }
  .cs-stat-value { font-size: 15pt; font-weight: 700; line-height: 1.1; }
  .cs-stat-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.4px; color: #444; }
  .cs-stat-note { font-size: 7pt; color: #777; font-style: italic; }

  .cs-cols { display: flex; gap: 16px; margin-bottom: 16px; }
  .cs-saves { flex: 1 1 40%; }
  .cs-skills { flex: 1 1 60%; }

  .cs-block { page-break-inside: avoid; }
  .cs-h2 {
    font-family: "Cinzel", Georgia, serif; font-size: 12pt; font-weight: 700;
    border-bottom: 1px solid #111; padding-bottom: 3px; margin: 0 0 8px; text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .cs-h3 { font-size: 10.5pt; font-weight: 700; margin: 10px 0 4px; }

  .cs-list { list-style: none; margin: 0; padding: 0; }
  .cs-list li {
    display: flex; justify-content: space-between; font-size: 9.5pt;
    padding: 2px 0; border-bottom: 1px dotted #ccc;
  }
  .cs-skill-list { columns: 2; column-gap: 18px; }
  .cs-skill-list li { break-inside: avoid; }
  .cs-num { font-variant-numeric: tabular-nums; font-weight: 700; }

  .cs-prose { font-size: 9.5pt; line-height: 1.4; margin: 0 0 5px; }
  .cs-muted { color: #777; }
  .cs-fgroup { margin-bottom: 10px; page-break-inside: avoid; }
  .cs-flist { list-style: none; margin: 0; padding: 0; }
  .cs-flist li { font-size: 9.5pt; padding: 2px 0; }
  .cs-flevel { font-weight: 700; display: inline-block; min-width: 26px; }

  .cs-features, .cs-gear { margin-bottom: 14px; }

  .cs-foot {
    margin-top: 18px; padding-top: 6px; border-top: 1px solid #ccc;
    font-size: 7.5pt; color: #999; text-align: center;
  }
}
`;
