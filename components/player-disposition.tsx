"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SAX } from "@/lib/theme";

// The PLAYER-level disposition: how a person tends to play, across every character
// they have ever played. Distinct from the character posterior, which /me has shown
// openly since before the pilot and which we are NOT taking away.
//
// WHY THIS ONE IS GATED AND THAT ONE IS NOT.
//
// A character posterior is a claim about a character: a mask the person chose, and
// can take off. A PLAYER posterior is a claim about the PERSON. "This is how you
// behave, across every mask you have worn." That is a different thing to hand
// someone unasked, and it is the one people can be hurt by.
//
// So: the GM opens the door, and the player still has to walk through it. Two yeses.
// Gating something at birth is honest; retracting it later would not be, which is
// exactly why the character-level view stays open.
//
// THE GATE IS IN RLS, NOT HERE. `dispositions` already carried a policy letting a
// player read any row where profile_id = auth.uid(), so a gate that lived only in
// this component would be a display preference wearing a permission's clothes. The
// player-scope policy requires a `disposition_reveals` row to exist. In player mode
// the query below simply returns nothing until it does; this component cannot leak
// what the database will not hand it.

const AXES = ["N", "T", "O", "S", "E", "I"] as const;
type Axis = typeof AXES[number];
const TAVERN: Record<Axis, string> = {
  N: "Voice", T: "Tactics", O: "Arcana", S: "Rapport", E: "Exploration", I: "Nerve",
};
const AXIS_COLOR: Record<Axis, string> = {
  N: "#B7615A", T: "#C8A24B", O: "#4E8077", S: "#CE8A42", E: "#6C76B0", I: "#9A93B0",
};

type Weights = Record<string, { lo?: number; hi?: number; theta_sd?: number }> & {
  _evidence?: { characters?: number; self_report?: number };
};
type PlayerDisp = {
  profile_id: string;
  axis_scores: Partial<Record<Axis, number>>;
  weights: Weights;
  as_of: string;
  model_version: string;
};

export function PlayerDisposition({
  profileId,
  mode,
  playerName,
  campaignId,
}: {
  profileId: string;
  mode: "gm" | "player";
  playerName?: string | null;
  // Required in gm mode: recorded on the reveal so it is auditable who opened it.
  campaignId?: string | null;
}) {
  const supabase = createClient();
  const [disp, setDisp] = useState<PlayerDisp | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: d }, { data: r }] = await Promise.all([
      supabase
        .from("dispositions")
        .select("profile_id, axis_scores, weights, as_of, model_version")
        .eq("profile_id", profileId)
        .eq("scope", "player")
        .eq("source", "posterior")
        .order("as_of", { ascending: false })
        .limit(1),
      supabase
        .from("disposition_reveals")
        .select("profile_id")
        .eq("profile_id", profileId)
        .limit(1),
    ]);
    setDisp(((d as PlayerDisp[]) || [])[0] || null);
    setRevealed((((r as unknown[]) || []).length > 0));
    setLoading(false);
  }, [supabase, profileId]);

  useEffect(() => { load(); }, [load]);

  async function toggleReveal() {
    setBusy(true); setError(null);
    if (revealed) {
      const { error: e } = await supabase.from("disposition_reveals").delete().eq("profile_id", profileId);
      if (e) setError("Could not close it again.");
      else setRevealed(false);
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setBusy(false); setError("Please sign in."); return; }
      const { error: e } = await supabase.from("disposition_reveals").insert({
        profile_id: profileId,
        revealed_by: user.id,
        campaign_id: campaignId ?? null,
      });
      if (e) setError("Could not share it. You can only share with players in your own campaigns.");
      else setRevealed(true);
    }
    setBusy(false);
  }

  if (loading) return null;

  // PLAYER MODE. RLS returns nothing until a reveal exists, so an empty result here
  // means "your GM has not shared this", not "it does not exist". Say nothing rather
  // than dangle something the player cannot have.
  if (mode === "player" && !disp) return null;

  // GM MODE with no fit yet.
  if (!disp) {
    return (
      <Card>
        <Eyebrow>{playerName || "This player"}</Eyebrow>
        <p style={{ color: SAX.muted, fontSize: 13, margin: "6px 0 0", lineHeight: 1.6 }}>
          No player-level fit yet. It appears after the next disposition run, once this
          person has played at least one recorded session.
        </p>
      </Card>
    );
  }

  const ev = disp.weights?._evidence;
  const nChars = ev?.characters ?? 0;
  const hasSelfReport = Boolean(ev?.self_report);

  // The honesty line. With one character and no inventory, this "posterior" is very
  // largely its prior, and whoever is reading it deserves to know that before they
  // draw a conclusion about a person from it.
  const thin = nChars <= 1 && !hasSelfReport;

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <Eyebrow>
          {mode === "gm" ? (playerName || "Player") : "How you tend to play"}
        </Eyebrow>
        {mode === "gm" && (
          <button
            type="button"
            onClick={toggleReveal}
            disabled={busy}
            style={{
              background: revealed ? SAX.brass : "transparent",
              color: revealed ? SAX.inkDeep : SAX.muted,
              border: `1px solid ${revealed ? SAX.brass : SAX.line}`,
              borderRadius: 999, padding: "4px 12px", fontSize: 11.5, fontWeight: 700,
              fontFamily: SAX.mono, letterSpacing: "0.04em", cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? "..." : revealed ? "Shared with them" : "Share with them"}
          </button>
        )}
      </div>

      <p style={{ color: SAX.muted, fontSize: 12.5, lineHeight: 1.6, margin: "8px 0 14px" }}>
        {mode === "player"
          ? "Drawn from every character you have played, not from any one of them. This is the pattern underneath the masks."
          : "This person's tendency across every character they play, pooled. Distinct from any single character's posterior."}
      </p>

      {thin && (
        <p style={{
          color: SAX.warn, fontSize: 12, lineHeight: 1.55, margin: "0 0 14px",
          background: "rgba(224,122,95,0.10)", border: `1px solid ${SAX.warn}`,
          borderRadius: 8, padding: "8px 11px",
        }}>
          Based on {nChars === 1 ? "one character" : "no characters"} and no self-report,
          so this is mostly the model&apos;s prior rather than evidence about this person.
          The intervals are wide for a reason. It sharpens as they play more characters.
        </p>
      )}

      {AXES.map((ax) => {
        const v = disp.axis_scores?.[ax];
        const w = disp.weights?.[ax];
        const lo = typeof w?.lo === "number" ? sig(w.lo) : null;
        const hi = typeof w?.hi === "number" ? sig(w.hi) : null;
        return (
          <div key={ax} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: SAX.text }}>{TAVERN[ax]}</span>
              <span style={{ fontFamily: SAX.mono, color: SAX.muted, fontSize: 12 }}>
                {typeof v === "number" ? Math.round(v * 100) : "\u2014"}
              </span>
            </div>
            <div style={{ position: "relative", height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 6, overflow: "hidden" }}>
              {/* The credible interval, drawn UNDER the point estimate. A number
                  without its uncertainty is a lie of omission, and this one is about
                  a person. */}
              {lo !== null && hi !== null && (
                <div style={{
                  position: "absolute", left: `${lo * 100}%`, width: `${Math.max(0, hi - lo) * 100}%`,
                  top: 0, bottom: 0, background: AXIS_COLOR[ax], opacity: 0.22,
                }} />
              )}
              {typeof v === "number" && (
                <div style={{
                  position: "absolute", left: `calc(${Math.min(1, Math.max(0, v)) * 100}% - 1px)`,
                  top: 0, bottom: 0, width: 2, background: AXIS_COLOR[ax],
                }} />
              )}
            </div>
          </div>
        );
      })}

      <p style={{ color: SAX.muted, fontSize: 11, fontFamily: SAX.mono, margin: "12px 0 0", letterSpacing: "0.04em" }}>
        {nChars} character{nChars === 1 ? "" : "s"}
        {hasSelfReport ? " \u00B7 self-report on file" : " \u00B7 no self-report"}
        {" \u00B7 "}{new Date(disp.as_of).toLocaleDateString()}
      </p>

      {error && <p style={{ color: SAX.warn, fontSize: 12.5, margin: "10px 0 0" }}>{error}</p>}
    </Card>
  );
}

// The model works on a log-rate scale; axis_scores are already inv-logit'd to 0..1,
// but the interval bounds in `weights` are raw theta. Map them the same way so the
// band and the point live on the same axis.
const sig = (x: number) => 1 / (1 + Math.exp(-x));

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: SAX.slateBg, border: `1px solid ${SAX.line}`,
      borderRadius: 12, padding: "16px 18px", marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.2em",
      textTransform: "uppercase", color: SAX.muted,
    }}>
      {children}
    </span>
  );
}
