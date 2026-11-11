"use client";

import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/forge-theme";
import {
  badgeColors, iconFor, markerLabel, readMarkerStyle, saveMarkerStyle,
  MARKER_CATS, MARKER_STYLES, MAX_TOKEN_MARKERS, TOKEN_MARKERS,
  type MarkerStyle, type TokenMarker,
} from "@/lib/tabletop/markers";

// components/marker-icon.tsx (2026-11-08)
//
// The marker icons from lib/tabletop/markers.ts as inline SVG: glyphs for chips, badges as drawn on a
// token, the per-viewer choice between coloured and black-and-white icons (shared with the tabletop
// canvas), and the picker for a token's own markers.

const EVENT = "sixaxes:marker-style";

/** The viewer's chosen look, kept in step across every component on the page. */
export function useMarkerStyle(): [MarkerStyle, (s: MarkerStyle) => void] {
  const [style, setStyle] = useState<MarkerStyle>("color");
  useEffect(() => {
    setStyle(readMarkerStyle());
    const on = () => setStyle(readMarkerStyle());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const set = (s: MarkerStyle) => { saveMarkerStyle(s); setStyle(s); window.dispatchEvent(new Event(EVENT)); };
  return [style, set];
}

/** The glyph alone, in the current text colour unless `color` is given. Decorative: label the parent. */
export function MarkerGlyph({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  const icon = iconFor(name), c = color ?? "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ flex: "0 0 auto", display: "block" }}>
      {icon.swatch && <circle cx={12} cy={12} r={8} fill={icon.color} />}
      {icon.parts.map((p, i) => p.fill
        ? <path key={i} d={p.d} fill={c} fillRule={p.evenodd ? "evenodd" : undefined} />
        : <path key={i} d={p.d} fill="none" stroke={c} strokeWidth={p.w ?? 2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.dash ? "2.2 2.4" : undefined} />)}
    </svg>
  );
}

/** A round badge, as drawn on a token, with its number when it has one. */
export function MarkerBadge({ name, size = 20, style, n = null }: { name: string; size?: number; style: MarkerStyle; n?: number | null }) {
  const c = badgeColors(name, style), swatch = !!iconFor(name).swatch;
  return (
    <span aria-hidden="true" style={{ position: "relative", width: size, height: size, borderRadius: 999, background: c.bg, border: `${Math.max(1, Math.round(size * 0.08))}px solid ${c.ring}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", boxSizing: "border-box" }}>
      {name === "num"
        ? <span style={{ fontSize: size * 0.5, fontWeight: 800, color: n != null && n < 0 ? "#ff8a80" : "#fff3d6", lineHeight: 1 }}>{n ?? 0}</span>
        : !swatch && <MarkerGlyph name={name} size={Math.round(size * 0.68)} color={c.glyph} />}
      {n != null && name !== "num" && (
        <span style={{ position: "absolute", right: -size * 0.2, bottom: -size * 0.2, minWidth: size * 0.55, height: size * 0.55, borderRadius: 999, background: "#fff3d6", border: "1px solid #111", color: n < 0 ? "#b01818" : "#111", fontSize: size * 0.36, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: "0 2px", boxSizing: "border-box" }}>{n}</span>
      )}
    </span>
  );
}

/** Two buttons to pick the look of marker icons. */
export function MarkerStylePicker({ style, onChange }: { style: MarkerStyle; onChange: (s: MarkerStyle) => void }) {
  return (
    <span role="group" aria-label="Marker icons" style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 11.5 }}>
      <span style={{ opacity: 0.75 }}>Icons</span>
      {MARKER_STYLES.map((s) => (
        <button key={s.key} type="button" aria-pressed={style === s.key} onClick={() => onChange(s.key)}
          style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 999, cursor: "pointer", background: style === s.key ? "rgba(217,164,58,0.18)" : "transparent", color: "inherit", border: `1px solid ${style === s.key ? "#d9a43a" : "rgba(255,255,255,0.18)"}` }}>
          {s.label}
        </button>
      ))}
    </span>
  );
}

const MUTED = "#a89a84", LINE = "rgba(255,255,255,0.14)", SUN = "#d9a43a";
const mini: React.CSSProperties = { width: 22, height: 22, borderRadius: 6, border: `1px solid ${LINE}`, background: "transparent", color: "#f2e6c9", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 };

/**
 * The markers on one token: what is on it now (each with an optional number), then every marker in the
 * library by group, searchable. Clicking a marker in the library adds or removes it.
 */
export function TokenMarkerPicker({ value, onChange, busy, style, onStyle }: {
  value: TokenMarker[]; onChange: (next: TokenMarker[]) => void; busy?: boolean;
  style: MarkerStyle; onStyle?: (s: MarkerStyle) => void;
}) {
  const [q, setQ] = useState("");
  const on = useMemo(() => new Set(value.map((m) => m.id)), [value]);
  const full = value.length >= MAX_TOKEN_MARKERS;
  const ql = q.trim().toLowerCase();
  const list = ql ? TOKEN_MARKERS.filter((m) => m.label.toLowerCase().includes(ql) || m.cat.includes(ql)) : TOKEN_MARKERS;

  const toggle = (id: string) => {
    if (on.has(id)) onChange(value.filter((m) => m.id !== id));
    else if (!full) onChange([...value, { id, n: id === "num" ? 1 : null }]);
  };
  const setN = (id: string, n: number | null) => onChange(value.map((m) => (m.id === id ? { ...m, n: n == null ? null : Math.max(-99, Math.min(99, n)) } : m)));

  return (
    <div style={{ display: "grid", gap: 8, color: "#f2e6c9" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input aria-label="Search markers" placeholder="Search markers" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 160px", minWidth: 0, padding: "5px 8px", borderRadius: 7, border: `1px solid ${LINE}`, background: "#1e1a16", color: "#f2e6c9", fontSize: 13 }} />
        <button title={!value.length ? "Nothing to clear" : undefined} type="button" disabled={busy || !value.length} onClick={() => onChange([])}
          style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${C.warn}`, background: "transparent", color: C.warn, fontSize: 12.5, cursor: value.length ? "pointer" : "default", opacity: value.length ? 1 : 0.5 }}>Clear all</button>
        {onStyle && <MarkerStylePicker style={style} onChange={onStyle} />}
      </div>

      <div>
        <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, marginBottom: 4 }}>On this token ({value.length}/{MAX_TOKEN_MARKERS})</div>
        {!value.length && <div style={{ fontSize: 12.5, color: MUTED }}>None yet. Pick from the groups below.</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {value.map((m) => {
            const label = markerLabel(m.id);
            return (
              <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${LINE}`, borderRadius: 999, padding: "2px 4px 2px 3px", fontSize: 12 }}>
                <MarkerBadge name={m.id} size={20} style={style} n={m.n} />
                <span>{label}</span>
                {m.n == null
                  ? <button type="button" disabled={busy} onClick={() => setN(m.id, 1)} title={`Put a number on ${label}`} style={{ ...mini, width: "auto", padding: "0 6px", fontSize: 11.5 }}>Add number</button>
                  : (
                    <span role="group" aria-label={`Number on ${label}`} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                      <button type="button" disabled={busy} aria-label={`Lower the number on ${label}`} onClick={() => setN(m.id, (m.n ?? 0) - 1)} style={mini}>&minus;</button>
                      <span style={{ minWidth: 20, textAlign: "center", fontWeight: 700 }}>{m.n}</span>
                      <button type="button" disabled={busy} aria-label={`Raise the number on ${label}`} onClick={() => setN(m.id, (m.n ?? 0) + 1)} style={mini}>+</button>
                      {m.id !== "num" && <button type="button" disabled={busy} title="Remove the number" onClick={() => setN(m.id, null)} style={{ ...mini, width: "auto", padding: "0 6px", fontSize: 11.5 }}>No number</button>}
                    </span>
                  )}
                <button type="button" disabled={busy} aria-label={`Remove ${label}`} title={`Remove ${label}`} onClick={() => toggle(m.id)} style={{ ...mini, border: "none", fontSize: 15 }}>&times;</button>
              </span>
            );
          })}
        </div>
        {full && <div role="status" style={{ fontSize: 12, color: "#d9a43a", marginTop: 4 }}>A token holds up to {MAX_TOKEN_MARKERS} markers. Remove one to add another.</div>}
      </div>

      {MARKER_CATS.map((cat) => {
        const items = list.filter((m) => m.cat === cat.key);
        if (!items.length) return null;
        return (
          <div key={cat.key}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, marginBottom: 4 }}>{cat.label}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {items.map((m) => {
                const sel = on.has(m.id);
                return (
                  <button key={m.id} type="button" disabled={busy || (!sel && full)} aria-pressed={sel} aria-label={m.label} title={m.label} onClick={() => toggle(m.id)}
                    style={{ width: 34, height: 34, borderRadius: 8, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: sel ? "rgba(217,164,58,0.2)" : "transparent", border: `1px solid ${sel ? SUN : "transparent"}`, opacity: !sel && full ? 0.4 : 1 }}>
                    <MarkerBadge name={m.id} size={26} style={style} n={m.id === "num" ? 1 : null} />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {ql && !list.length && <div style={{ fontSize: 12.5, color: MUTED }}>No marker matches &ldquo;{q}&rdquo;.</div>}
    </div>
  );
}
