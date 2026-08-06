"use client";

// components/character-sheet-peek.tsx
//
// A read-only look at a player's character, for the GM's roster.
//
// WHY NOT JUST LINK TO THE FORGE
//   /me/forge?c=<id> already renders any character and the GM can read it, so a link would have
//   been one line. But the Forge is an EDITOR: it autosaves about a second after any change, so a
//   GM who opened a player's sheet to check their AC and brushed a dropdown would silently alter
//   someone else's character. Looking at a thing and being able to change it should not be the same
//   gesture.
//
// WHAT IT SHOWS, AND WHAT IT DELIBERATELY DOES NOT
//   Exactly what is stored on characters.build - the choices the player made. It does NOT re-derive
//   armour class, hit points or spell slots. Derivation needs the whole rules context, and a second
//   implementation of it here would be a second thing to keep in step with the engine; when they
//   drifted, the GM's copy would be the wrong one and nobody would know which. The Forge link at
//   the bottom is there for the derived sheet.
//
// VISIBILITY
//   characters is readable by is_campaign_member, so nothing here widens what a GM can see. It is
//   already theirs to read the moment a player launches a build into the campaign - which is the
//   part worth being explicit about with players, and the note at the foot of this panel says so.

import { useMemo } from "react";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

type GearEntry = { n: string; mod?: number; variant?: string };
export type Build = {
  level?: number;
  abilities?: Record<string, number>;
  meta?: { species?: string; className?: string; subclass?: string; background?: string; speciesVariant?: string };
  saveProf?: string[];
  skillProf?: string[];
  skillExpert?: string[];
  gear?: { items?: GearEntry[]; attuned?: string[] };
  spells?: { cantrips?: string[]; known?: string[] };
  epicChoices?: Record<string, { feat?: string; ability?: string } | null>;
  imported?: { abilitiesArePrinted?: boolean };
} | null;

const ABIL: [string, string][] = [
  ["str", "STR"], ["dex", "DEX"], ["con", "CON"],
  ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"],
];

const mod = (score: number) => {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
};

const gearLabel = (g: GearEntry) =>
  `${g.n}${g.mod ? ` +${g.mod}` : ""}${g.variant ? ` (${g.variant})` : ""}`;

export default function CharacterSheetPeek({ build, characterId }: { build: Build; characterId: string }) {
  const feats = useMemo(() => {
    const out: string[] = [];
    for (const v of Object.values(build?.epicChoices ?? {})) {
      if (v?.feat) out.push(v.feat);
      else if (v?.ability) out.push(`+1 ${v.ability.toUpperCase()}`);
    }
    return out;
  }, [build]);

  if (!build || Object.keys(build).length === 0) {
    return (
      <div style={{ ...panel, color: C.muted, fontSize: 13.5 }}>
        This character has no sheet stored. That is normal for one you typed straight into the
        Workspace: a full sheet arrives when a player builds one or imports it from D&amp;D Beyond.
      </div>
    );
  }

  const m = build.meta ?? {};
  const gear = build.gear?.items ?? [];
  const attuned = build.gear?.attuned ?? [];
  const cantrips = build.spells?.cantrips ?? [];
  const known = build.spells?.known ?? [];

  return (
    <div style={panel}>
      <div style={{ fontSize: 13.5, color: C.text, marginBottom: 10 }}>
        {[
          m.speciesVariant ? `${m.speciesVariant} ${m.species ?? ""}`.trim() : m.species,
          m.className && `${m.className}${m.subclass ? ` (${m.subclass})` : ""}`,
          build.level && `level ${build.level}`,
          m.background,
        ].filter(Boolean).join(" \u00B7 ")}
      </div>

      {build.abilities && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {ABIL.map(([k, label]) => {
            const score = build.abilities?.[k];
            if (typeof score !== "number") return null;
            return (
              <div key={k} style={stat}>
                <div style={{ fontSize: 9.5, letterSpacing: "0.12em", color: C.muted }}>{label}</div>
                <div style={{ fontSize: 17, color: C.text, lineHeight: 1.2 }}>{score}</div>
                <div style={{ fontSize: 11, color: C.plum }}>{mod(score)}</div>
              </div>
            );
          })}
        </div>
      )}

      <Row label="Saves" items={(build.saveProf ?? []).map((s) => s.toUpperCase())} />
      <Row label="Skills" items={[
        ...(build.skillProf ?? []),
        ...(build.skillExpert ?? []).map((s) => `${s} (expertise)`),
      ]} />
      <Row label="Feats" items={feats} />
      <Row label="Gear" items={gear.map((g) => `${gearLabel(g)}${attuned.includes(g.n) ? " \u2726" : ""}`)} />
      <Row label="Cantrips" items={cantrips} />
      <Row label="Spells" items={known} />

      {attuned.length > 0 && (
        <p style={{ ...foot, marginBottom: 4 }}>&#10022; attuned</p>
      )}
      {build.imported?.abilitiesArePrinted && (
        <p style={{ ...foot, marginBottom: 4 }}>
          Imported from D&amp;D Beyond. The ability scores are as printed there, so anything an item
          already granted is baked in rather than added again.
        </p>
      )}

      <p style={foot}>
        These are the choices on the sheet, not the derived numbers.{" "}
        <a href={`/me/forge?c=${characterId}`} style={{ color: C.plum }}>Open the full sheet</a>
        {" "}for armour class, hit points and slots. That view can be edited, so treat it as the
        player&apos;s.
      </p>
    </div>
  );
}

function Row({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 7, alignItems: "baseline" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
        color: C.muted, minWidth: 66, flexShrink: 0 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{items.join(", ")}</div>
    </div>
  );
}

const panel: React.CSSProperties = {
  marginTop: 10, padding: "12px 14px", borderRadius: FORGE_RADIUS,
  background: "rgba(0,0,0,0.26)", width: "100%",
};
const stat: React.CSSProperties = {
  textAlign: "center", minWidth: 52, padding: "5px 8px",
  borderRadius: FORGE_RADIUS, background: "rgba(0,0,0,0.28)",
};
const foot: React.CSSProperties = {
  fontSize: 12, color: C.muted, lineHeight: 1.55, margin: "10px 0 0",
};
