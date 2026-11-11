"use client";

// components/system-play.tsx (2026-11-10, push 22, audit G5)
//
// The at-the-table numbers for characters outside D&D 5e, on the character sheet page: hit points and
// the system's own resources, with - and + and a reset. Before this the sheet page told a PF2e,
// Daggerheart, Draw Steel or Lancer player to go back to the Forge, and nothing tracked damage, stress
// or Hope during a session. The maximums come from the system's derived sheet; the current values are
// saved in the character's build as `play` (the Forge autosaves it like any other edit). The tracks
// and their limits live in lib/play/system-tracks.ts.

import React from "react";
import { playTracks, playValue, type PlaySheet, type PlayTrack, type SystemPlayState } from "@/lib/play/system-tracks";
import { STONE, FORGE_FONTS, stonePanel, stoneField, forgeLabel, stoneButton } from "@/lib/forge-theme";
import { askConfirm } from "@/lib/confirm";

export type { PlaySheet, SystemPlayState } from "@/lib/play/system-tracks";

const btn: React.CSSProperties = { ...stoneButton("stone"), fontSize: 15, padding: "4px 12px", minWidth: 40, minHeight: "var(--sax-tap, 32px)" };

export default function SystemPlay({ play, state, onChange }: {
  play: PlaySheet; state: SystemPlayState | undefined; onChange: (s: SystemPlayState) => void;
}) {
  const tracks = playTracks(play);
  const set = (t: PlayTrack, n: number) => {
    const v = Math.max(t.min, Math.min(t.max, n));
    onChange({ ...state, values: { ...(state?.values ?? {}), [t.key]: v } });
  };
  const reset = async () => {
    if (!await askConfirm("Reset every track to its starting value? Use this after a full rest or at the start of a session.", { confirmLabel: "Reset" })) return;
    onChange({ ...state, values: Object.fromEntries(tracks.map((t) => [t.key, t.start])) });
  };
  return (
    <section aria-label="At the table" style={stonePanel()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ ...forgeLabel, margin: 0 }}>At the table</h2>
        <button type="button" className="forge-btn" onClick={() => void reset()} style={{ ...btn, fontSize: 12.5 }}>Reset to start</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginTop: 10 }}>
        {tracks.map((t) => {
          const v = playValue(t, state);
          const capped = t.max < 99;
          return (
            <div key={t.key} style={{ background: "rgba(0,0,0,0.24)", borderRadius: 4, padding: "10px 12px", display: "grid", gap: 6 }}>
              <div style={{ fontSize: 13, color: STONE.ink }}>{t.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" className="forge-btn" onClick={() => set(t, v - 1)} disabled={v <= t.min} aria-label={`${t.label} down one`} style={btn}>-</button>
                <span aria-live="polite" style={{ fontFamily: FORGE_FONTS.display, fontSize: 22, color: STONE.ink, minWidth: 70, textAlign: "center" }}>
                  {v}{capped ? <span style={{ fontSize: 13, color: STONE.inkDim }}> / {t.max}</span> : null}
                </span>
                <button type="button" className="forge-btn" onClick={() => set(t, v + 1)} disabled={v >= t.max} aria-label={`${t.label} up one`} style={btn}>+</button>
              </div>
              {t.hint && <div style={{ fontSize: 11.5, color: STONE.inkDim }}>{t.hint}</div>}
            </div>
          );
        })}
      </div>
      <label style={{ display: "grid", gap: 4, marginTop: 12 }}>
        <span style={forgeLabel}>Conditions and notes</span>
        <textarea value={state?.conditions ?? ""} maxLength={1000} rows={2}
          onChange={(e) => onChange({ ...state, conditions: e.target.value })}
          placeholder="Frightened 1, Off-guard, concentrating on..." style={{ ...stoneField(), cursor: "text", resize: "vertical" }} />
      </label>
    </section>
  );
}
