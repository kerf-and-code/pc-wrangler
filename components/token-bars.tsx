"use client";

import React, { useState } from "react";
import { C } from "@/lib/forge-theme";
import type { createClient } from "@/lib/supabase/client";

// components/token-bars.tsx (2026-11-09)
//
// Phase 5y (p129): a token's resource bars besides hit points (ki, rage, spell slots, a fuse), up to two,
// each with who sees it: everyone, the owner and the GM, or the GM only. The GM adds, edits and removes
// them (vtt_token_bars, GM only); the token's owner moves the value of the bars they can see
// (tabletop_set_bar_value). For a creature, the GM can also let players see how it is doing (healthy,
// bloodied, down; tabletop_combat), never its hit points.

type Supa = ReturnType<typeof createClient>;
export type Bar = { tokenId: string; slot: number; label: string; value: number; most: number; color: string; visibility: "all" | "owner" | "gm" };
export const MAX_BARS = 2;
export const BAR_COLORS = ["#7fc4ea", "#d9a43a", "#c79be0", "#7fcf7a", "#e07a70"];
export const BAR_SEEN: { key: Bar["visibility"]; label: string }[] = [
  { key: "all", label: "Everyone" }, { key: "owner", label: "Owner and GM" }, { key: "gm", label: "GM only" },
];
export const HEALTH_LABEL: Record<string, string> = { healthy: "healthy", bloodied: "bloodied", down: "down" };
export const HEALTH_COLOR: Record<string, string> = { healthy: "#5fae5a", bloodied: "#d98a3a", down: "#6b6259" };

const box: React.CSSProperties = { background: "rgba(28,24,20,0.98)", border: `1px solid ${C.line}`, borderRadius: 10, padding: 12, color: C.text, fontSize: 12.5, boxShadow: "0 8px 30px rgba(0,0,0,0.5)", width: "min(420px, calc(100vw - 40px))", maxHeight: "60vh", overflowY: "auto", textAlign: "left" };
const field: React.CSSProperties = { padding: "5px 7px", background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5 };
const small: React.CSSProperties = { padding: "4px 9px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12.5, cursor: "pointer" };

export default function TokenBars({ tokenId, tokenName, isCreature, isGm, bars, healthToPlayers, campaignId, supabase, onChanged, onHealthToPlayers, onClose }: {
  tokenId: string; tokenName: string; isCreature: boolean; isGm: boolean;
  bars: Bar[]; healthToPlayers: boolean; campaignId: string; supabase: Supa;
  /** after any change, with the error if there was one (the table reloads the bars and tells everyone) */
  onChanged: (error: string | null) => void;
  onHealthToPlayers: (on: boolean) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (job: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    const { error } = await job();
    setBusy(false);
    onChanged(error ? error.message : null);
  };
  const setValue = (b: Bar, v: number) => run(() => supabase.rpc("tabletop_set_bar_value", { p_token: tokenId, p_slot: b.slot, p_value: Math.max(0, Math.min(b.most, v)) }));
  const patch = (b: Bar, p: Partial<Pick<Bar, "label" | "most" | "color" | "visibility">>) => {
    const most = p.most !== undefined ? Math.max(1, Math.min(9999, Math.round(p.most))) : b.most;
    return run(() => supabase.from("vtt_token_bars").update({ ...p, most, value: Math.min(b.value, most), updated_at: new Date().toISOString() }).eq("token_id", tokenId).eq("slot", b.slot));
  };
  const add = () => {
    const slot = [1, 2].find((s) => !bars.some((b) => b.slot === s)); if (!slot) return;
    return run(() => supabase.from("vtt_token_bars").insert({ token_id: tokenId, slot, campaign_id: campaignId, label: slot === 1 ? "Uses" : "Charges", value: 3, most: 3, color: BAR_COLORS[slot - 1], visibility: "owner" }));
  };
  const remove = (b: Bar) => run(() => supabase.from("vtt_token_bars").delete().eq("token_id", tokenId).eq("slot", b.slot));

  const mine = bars.filter((b) => isGm || b.visibility !== "gm");
  return (
    <div role="dialog" aria-label={`Bars on ${tokenName}`} style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong style={{ flex: 1, fontSize: 13 }}>Bars on {tokenName}</strong>
        <button type="button" onClick={onClose} style={small}>Done</button>
      </div>
      {mine.length === 0 && <p style={{ color: C.muted, margin: "0 0 8px" }}>{isGm ? "No bars yet. Hit points show on their own in a fight." : "No bars on this token yet. The GM can add them."}</p>}
      {mine.map((b) => (
        <div key={b.slot} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {isGm
              ? <input aria-label="Bar name" defaultValue={b.label} maxLength={24} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== b.label) void patch(b, { label: v }); }} style={{ ...field, flex: 1, minWidth: 0 }} />
              : <span style={{ flex: 1 }}>{b.label}</span>}
            <button type="button" disabled={busy || b.value <= 0} aria-label={`${b.label} down one`} onClick={() => void setValue(b, b.value - 1)} style={small}>-</button>
            <span aria-live="polite" style={{ minWidth: 54, textAlign: "center", fontWeight: 600 }}>{b.value} / {b.most}</span>
            <button type="button" disabled={busy || b.value >= b.most} aria-label={`${b.label} up one`} onClick={() => void setValue(b, b.value + 1)} style={small}>+</button>
          </div>
          <div aria-hidden style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, marginTop: 6, overflow: "hidden" }}>
            <div style={{ width: `${(b.value / b.most) * 100}%`, height: "100%", background: b.color }} />
          </div>
          {isGm && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <label style={{ display: "flex", gap: 4, alignItems: "center", color: C.muted }}>Most
                <input type="number" min={1} max={9999} defaultValue={b.most} aria-label={`Most ${b.label}`} onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v !== b.most) void patch(b, { most: v }); }} style={{ ...field, width: 64 }} />
              </label>
              <select aria-label={`Who sees ${b.label}`} value={b.visibility} onChange={(e) => void patch(b, { visibility: e.target.value as Bar["visibility"] })} style={field}>
                {BAR_SEEN.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </select>
              <span role="group" aria-label="Colour" style={{ display: "inline-flex", gap: 4 }}>
                {BAR_COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={b.color === c} onClick={() => void patch(b, { color: c })} style={{ width: 18, height: 18, borderRadius: 999, background: c, border: b.color === c ? "2px solid #fff" : `1px solid ${C.line}`, cursor: "pointer" }} />)}
              </span>
              <button type="button" onClick={() => void remove(b)} style={{ ...small, color: "#e07a70", marginLeft: "auto" }}>Remove</button>
            </div>
          )}
        </div>
      ))}
      {isGm && bars.length < MAX_BARS && <button type="button" disabled={busy} onClick={() => void add()} style={small}>Add a bar</button>}
      {isGm && isCreature && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}>
          <input type="checkbox" checked={healthToPlayers} onChange={(e) => onHealthToPlayers(e.target.checked)} />
          <span>Players see how it is doing in a fight <span style={{ color: C.muted }}>(healthy, bloodied at half or below, down; never its hit points)</span></span>
        </label>
      )}
    </div>
  );
}
