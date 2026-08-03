"use client";

// components/dice-picker.tsx
//
// Build a roll by tapping dice instead of typing notation.
//
// WHY BOTH THIS AND THE TEXT FIELD
//   Typing "2d4+2d8+1d20+16" is fast if you already think in notation, and completely opaque if you
//   do not. Most GMs reaching for a roller mid-combat want three d6 and a plus four, and should not
//   have to spell that out. So this is the primary control and the text field stays underneath as
//   the escape hatch: they edit the SAME notation, in both directions, so neither is a lesser mode.
//
//   The notation is always visible. A roller whose maths you cannot check is a roller you cannot
//   trust, and the number this produces is going into the encounter-calibration record.
//
// THE SHAPES ARE THE REAL POLYHEDRA
//   d4 tetrahedron, d6 cube, d8 octahedron, d10 pentagonal trapezohedron, d12 dodecahedron,
//   d20 icosahedron, drawn as the silhouette each solid actually presents. A GM recognises the
//   outline of their own dice faster than they read a label, which is the whole point of the tiles.

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { C, FORGE_RADIUS, STONE } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";

export type DiceCounts = Record<number, number>;

const DICE: { sides: number; label: string; path: ReactNode }[] = [
  {
    sides: 20, label: "d20",
    path: (
      <>
        <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" />
        <polygon points="20,9 30,26 10,26" />
        <path d="M20 2 L20 9 M36 11 L30 26 M36 29 L30 26 M4 11 L10 26 M4 29 L10 26 M20 38 L10 26 M20 38 L30 26" />
      </>
    ),
  },
  {
    sides: 12, label: "d12",
    path: (
      <>
        <polygon points="20,2 36,13 30,32 10,32 4,13" />
        <polygon points="20,11 28,17 25,27 15,27 12,17" />
        <path d="M20 2 L20 11 M36 13 L28 17 M30 32 L25 27 M10 32 L15 27 M4 13 L12 17" />
      </>
    ),
  },
  {
    sides: 100, label: "d100",
    path: (
      <>
        <polygon points="14,3 25,15 14,37 3,15" />
        <path d="M3 15 L14 20 L25 15" />
        <polygon points="26,3 37,15 26,37 15,15" opacity="0.55" />
      </>
    ),
  },
  {
    sides: 10, label: "d10",
    path: (
      <>
        <polygon points="20,2 36,16 20,38 4,16" />
        <path d="M4 16 L20 23 L36 16 M20 2 L20 23" />
      </>
    ),
  },
  {
    sides: 8, label: "d8",
    path: (
      <>
        <polygon points="20,2 36,20 20,38 4,20" />
        <path d="M4 20 L36 20 M20 2 L20 38" opacity="0.6" />
      </>
    ),
  },
  {
    sides: 6, label: "d6",
    path: (
      <>
        <polygon points="8,13 20,6 32,13 32,27 20,34 8,27" />
        <path d="M8 13 L20 20 L32 13 M20 20 L20 34" />
      </>
    ),
  },
  {
    sides: 4, label: "d4",
    path: (
      <>
        <polygon points="20,3 37,34 3,34" />
        <path d="M20 3 L20 34 M20 34 L11 19 M20 34 L29 19" opacity="0.6" />
      </>
    ),
  },
];

/** Counts + modifier to notation. Empty counts give an empty string, never "0d6". */
export function countsToNotation(counts: DiceCounts, mod: number): string {
  const parts = DICE
    .map((d) => d.sides)
    .filter((s) => (counts[s] ?? 0) > 0)
    .map((s) => `${counts[s]}d${s}`);
  if (parts.length === 0) return mod ? `${mod > 0 ? "+" : "-"}${Math.abs(mod)}`.replace(/^\+/, "") : "";
  return parts.join("+") + (mod ? (mod > 0 ? `+${mod}` : `${mod}`) : "");
}

/**
 * Notation back to counts, so typing in the text field updates the tiles.
 *
 * Lenient on purpose: anything it cannot represent as tiles (keep rules, dice this picker does not
 * offer) is simply not reflected, and the text stays authoritative. The alternative - refusing to
 * show tiles at all for an unusual roll - would make the two controls feel like they disagree.
 */
export function notationToCounts(notation: string): { counts: DiceCounts; mod: number } {
  const counts: DiceCounts = {};
  let mod = 0;
  const src = (notation || "").toLowerCase().replace(/\s+/g, "");
  let leftover = src;
  const re = /(\d*)d(\d+)(k[hl]\d+)?/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const sides = Number(m[2]);
    const n = m[1] === "" ? 1 : Number(m[1]);
    if (DICE.some((d) => d.sides === sides) && !m[3]) counts[sides] = (counts[sides] ?? 0) + n;
    leftover = leftover.replace(m[0], "\u0000");
  }
  const flat = /([+-])(\d+)/g;
  for (let m = flat.exec(leftover); m; m = flat.exec(leftover)) {
    mod += m[1] === "-" ? -Number(m[2]) : Number(m[2]);
  }
  return { counts, mod };
}

export default function DicePicker(
  { notation, onChange }: { notation: string; onChange: (n: string) => void },
) {
  const parsed = useMemo(() => notationToCounts(notation), [notation]);
  const [counts, setCounts] = useState<DiceCounts>(parsed.counts);
  const [mod, setMod] = useState(parsed.mod);

  // Re-sync when the text field is edited directly. Guarded so the picker does not fight the user
  // mid-type: only adopt outside changes that do not match what the picker itself just produced.
  useEffect(() => {
    if (countsToNotation(counts, mod) !== notation) {
      const p = notationToCounts(notation);
      setCounts(p.counts);
      setMod(p.mod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notation]);

  const emit = useCallback((c: DiceCounts, m: number) => {
    setCounts(c); setMod(m);
    onChange(countsToNotation(c, m));
  }, [onChange]);

  const bump = (sides: number, by: number) => {
    const next = Math.max(0, Math.min(100, (counts[sides] ?? 0) + by));
    emit({ ...counts, [sides]: next }, mod);
  };
  const setExact = (sides: number, v: string) => {
    const n = Math.max(0, Math.min(100, Number(v.replace(/\D/g, "")) || 0));
    emit({ ...counts, [sides]: n }, mod);
  };

  // Annotated rather than inferred: Object.values on a Record<number, number> widens to unknown[]
  // under some lib configurations, and a silently-unknown accumulator here would only surface as a
  // build failure on someone else's machine.
  const total: number = Object.values(counts).reduce<number>((a, b) => a + (Number(b) || 0), 0);

  return (
    <div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(86px, 1fr))",
        gap: 8, marginBottom: 12,
      }}>
        {DICE.map((d) => {
          const n = counts[d.sides] ?? 0;
          const on = n > 0;
          return (
            <div key={d.sides} style={{
              border: `1px solid ${on ? C.sun : C.line}`,
              borderRadius: FORGE_RADIUS,
              background: on ? "rgba(200,162,75,0.10)" : "rgba(0,0,0,0.22)",
              padding: "10px 8px 8px", textAlign: "center",
            }}>
              {/* The tile itself adds one. Tapping a die to roll one more of it is the gesture a
                  GM already has in their hands. */}
              <button onClick={() => bump(d.sides, 1)} aria-label={`Add a ${d.label}`}
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, width: "100%" }}>
                <svg viewBox="0 0 40 40" width={40} height={40} aria-hidden
                  style={{ fill: "none", stroke: on ? C.sun : STONE.inkDim, strokeWidth: 1.4,
                    strokeLinejoin: "round", strokeLinecap: "round" }}>
                  {d.path}
                </svg>
                <div style={{
                  fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.08em",
                  color: on ? C.sun : C.muted, marginTop: 2,
                }}>{d.label}</div>
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, justifyContent: "center" }}>
                <button onClick={() => bump(d.sides, -1)} disabled={n === 0}
                  aria-label={`One fewer ${d.label}`} style={step}>-</button>
                <input value={n} onChange={(e) => setExact(d.sides, e.target.value)}
                  inputMode="numeric" aria-label={`How many ${d.label}`}
                  style={{
                    width: 34, textAlign: "center", padding: "3px 0", fontSize: 14,
                    fontFamily: SAX.mono, color: C.text,
                  }} />
                <button onClick={() => bump(d.sides, 1)} aria-label={`One more ${d.label}`} style={step}>+</button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: SAX.mono, fontSize: 10, letterSpacing: "0.16em",
          textTransform: "uppercase", color: C.muted }}>Modifier</span>
        <button onClick={() => emit(counts, mod - 1)} style={step}>-</button>
        <input type="number" value={mod} onChange={(e) => emit(counts, Number(e.target.value) || 0)}
          aria-label="Flat modifier"
          style={{ width: 78, textAlign: "center", padding: "6px 0", fontSize: 15, fontFamily: SAX.mono }} />
        <button onClick={() => emit(counts, mod + 1)} style={step}>+</button>

        {total > 0 && (
          <button onClick={() => emit({}, 0)} style={{ ...step, width: "auto", padding: "6px 12px" }}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

const step: CSSProperties = {
  background: "transparent", color: C.text, border: `1px solid ${C.line}`,
  borderRadius: FORGE_RADIUS, width: 26, height: 26, lineHeight: "1",
  fontFamily: SAX.mono, fontSize: 14, cursor: "pointer", padding: 0,
};
