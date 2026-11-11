"use client";

// components/codex-graph.tsx (2026-11-11, push 33, audit P3: the campaign graph)
//
// The Codex's connections as a graph (lib/codex-graph.ts does the data and the layout). Used on the
// GM's Codex (Graph tab: a click opens the item there) and on the published codex
// (/c/[slug]/graph: each item is a link to its page). Filter by kind, show or hide items with no
// connections, hover or focus an item to light up its neighbours and read the relations, drag to
// pan, and zoom with the buttons. The same connections are listed as text below for screen readers
// and for anyone who prefers a list.

import React, { useMemo, useRef, useState } from "react";
import { GROUPS, groupColor, layoutGraph, neighboursOf, type GraphEdge, type GraphGroup, type GraphNode } from "@/lib/codex-graph";

const W = 1000, H = 640;

export type GraphColors = { text: string; muted: string; line: string; panel: string; accent: string };

export default function CodexGraph({ nodes, edges, onOpen, hrefs, colors, emptyText }: {
  nodes: GraphNode[];                       // every item, linked or not (degree tells which)
  edges: GraphEdge[];
  onOpen?: (n: GraphNode) => void;          // the GM's Codex opens the item in place
  hrefs?: Record<string, string>;            // the public codex links each item to its page (by id)
  colors: GraphColors;
  emptyText: string;
}) {
  const present = useMemo(() => new Set(nodes.map((n) => n.group)), [nodes]);
  const [hidden, setHidden] = useState<Set<GraphGroup>>(new Set());
  const [unlinked, setUnlinked] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, s: 1 });
  const drag = useRef<{ px: number; py: number; vx: number; vy: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const shown = useMemo(() => {
    const keep = nodes.filter((n) => !hidden.has(n.group));
    const ids = new Set(keep.map((n) => n.id));
    const es = edges.filter((e) => ids.has(e.a) && ids.has(e.b));
    const deg = new Map<string, number>();
    for (const e of es) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
    const ns = keep.filter((n) => unlinked || (deg.get(n.id) ?? 0) > 0).map((n) => ({ ...n, degree: deg.get(n.id) ?? 0 }));
    return { nodes: ns, edges: es };
  }, [nodes, edges, hidden, unlinked]);
  const placed = useMemo(() => layoutGraph(shown.nodes, shown.edges, W, H), [shown]);
  const at = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const lit = hover ? neighboursOf(hover, shown.edges) : null;
  const labelsAll = placed.length <= 60;

  const toWorldDelta = (dxPx: number, dyPx: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    const k = r && r.width ? W / r.width : 1;
    return { x: (dxPx * k) / view.s, y: (dyPx * k) / view.s };
  };
  const zoom = (f: number) => setView((v) => {
    const s = Math.max(0.4, Math.min(4, v.s * f));
    // keep the middle of the view where it is
    const mx = W / 2, my = H / 2;
    return { s, x: mx - ((mx - v.x) * s) / v.s, y: my - ((my - v.y) * s) / v.s };
  });

  const btn: React.CSSProperties = { background: "transparent", color: colors.text, border: `1px solid ${colors.line}`, borderRadius: 8, padding: "4px 10px", fontSize: 12.5, cursor: "pointer" };
  const nameOf = (id: string) => at.get(id)?.label ?? nodes.find((n) => n.id === id)?.label ?? "";

  if (!edges.length) return <p style={{ color: colors.muted, fontSize: 14, lineHeight: 1.6 }}>{emptyText}</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }} role="group" aria-label="Show or hide each kind">
        {GROUPS.filter((g) => present.has(g.key)).map((g) => {
          const on = !hidden.has(g.key);
          return (
            <button key={g.key} type="button" aria-pressed={on} style={{ ...btn, opacity: on ? 1 : 0.5, display: "inline-flex", gap: 6, alignItems: "center" }}
              onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 10, background: g.color, display: "inline-block" }} />{g.label}
            </button>
          );
        })}
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5, color: colors.muted, marginLeft: 4 }}>
          <input type="checkbox" checked={unlinked} onChange={(e) => setUnlinked(e.target.checked)} /> Items with no connections
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn} aria-label="Zoom in" onClick={() => zoom(1.25)}>+</button>
        <button type="button" style={btn} aria-label="Zoom out" onClick={() => zoom(0.8)}>&minus;</button>
        <button type="button" style={btn} onClick={() => setView({ x: 0, y: 0, s: 1 })}>Fit</button>
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Connections between ${placed.length} items`}
        style={{ width: "100%", height: "auto", background: colors.panel, border: `1px solid ${colors.line}`, borderRadius: 12, touchAction: "none", cursor: "grab", display: "block" }}
        onPointerDown={(e) => { drag.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y, moved: false }; }}
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          const w = toWorldDelta(e.clientX - d.px, e.clientY - d.py);
          if (Math.abs(w.x) + Math.abs(w.y) > 2) d.moved = true;
          if (d.moved) setView((v) => ({ ...v, x: d.vx + w.x * v.s, y: d.vy + w.y * v.s }));
        }}
        onPointerUp={() => { window.setTimeout(() => { drag.current = null; }, 0); }}
        onPointerLeave={() => { drag.current = null; }}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>
          {shown.edges.map((e, i) => {
            const a = at.get(e.a), b = at.get(e.b); if (!a || !b) return null;
            const on = !!lit && lit.has(e.a) && lit.has(e.b) && (e.a === hover || e.b === hover);
            return (
              <g key={i} opacity={lit ? (on ? 1 : 0.12) : 0.55}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: on ? colors.accent : colors.muted }} strokeWidth={on ? 2 / view.s : 1.2 / view.s} />
                {on && e.relation && (
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4 / view.s} textAnchor="middle" fontSize={12 / view.s}
                    style={{ fill: colors.text, stroke: colors.panel }} strokeWidth={3 / view.s} paintOrder="stroke">{e.relation}</text>
                )}
              </g>
            );
          })}
          {placed.map((p) => {
            const r = (6 + Math.min(10, p.degree * 1.5)) / Math.sqrt(view.s);
            const dim = !!lit && !lit.has(p.id);
            const label = p.label.length > 24 ? `${p.label.slice(0, 23)}...` : p.label;
            const showLabel = labelsAll || (lit ? lit.has(p.id) : p.degree >= 3);
            const href = hrefs?.[p.id] ?? null;
            const body = (
              <g opacity={dim ? 0.2 : 1} style={{ cursor: href || onOpen ? "pointer" : "default" }}
                tabIndex={0} role={href ? undefined : "button"} aria-label={`${p.label}, ${p.degree} connection${p.degree === 1 ? "" : "s"}`}
                onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(p.id)} onBlur={() => setHover(null)}
                onClick={(ev) => { if (drag.current?.moved) { ev.preventDefault(); return; } if (!href && onOpen) onOpen(p); }}
                onKeyDown={(ev) => { if (ev.key === "Enter" && !href && onOpen) onOpen(p); }}>
                <circle cx={p.x} cy={p.y} r={r} fill={groupColor(p.group)} style={{ stroke: hover === p.id ? colors.text : colors.panel }} strokeWidth={2 / view.s} />
                {showLabel && (
                  <text x={p.x} y={p.y + r + 13 / view.s} textAnchor="middle" fontSize={12.5 / view.s}
                    style={{ fill: colors.text, stroke: colors.panel }} strokeWidth={3 / view.s} paintOrder="stroke">{label}</text>
                )}
              </g>
            );
            return href ? <a key={p.id} href={href}>{body}</a> : <React.Fragment key={p.id}>{body}</React.Fragment>;
          })}
        </g>
      </svg>
      <p style={{ color: colors.muted, fontSize: 12, margin: "6px 0 0" }}>
        Hover or tab to an item to light up what it is connected to; {hrefs ? "click it to open its page" : "click it to open it"}. Drag to move around.
      </p>

      <details style={{ marginTop: 10 }}>
        <summary style={{ color: colors.muted, fontSize: 13, cursor: "pointer" }}>All {shown.edges.length} connection{shown.edges.length === 1 ? "" : "s"} as a list</summary>
        <ul style={{ color: colors.text, fontSize: 13.5, lineHeight: 1.7, margin: "8px 0 0", paddingLeft: 18 }}>
          {shown.edges.map((e, i) => (
            <li key={i}>{nameOf(e.a)} and {nameOf(e.b)}{e.relation ? ` (${e.relation})` : ""}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
