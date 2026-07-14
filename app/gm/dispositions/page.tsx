"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { PlayerDisposition } from "@/components/player-disposition";
import { SAX, surfaces, ui } from "@/lib/theme";

/* Palette mapped onto the shared cellar theme. The radar reads on a dark slate
   panel, so the chart colors are unchanged; only the page frame and surfaces
   moved to Six Axes. */
const C = {
  bg: SAX.ink, surface: SAX.slateBg, surface2: "rgba(11,7,18,0.7)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, sun: SAX.sun, sunSoft: "#FFD75E",
  plum: SAX.plum, warn: SAX.warn, good: SAX.good,
};

const AXES = ["N", "T", "O", "S", "E", "I"] as const;
type Axis = typeof AXES[number];
// Player-facing TAVERN labels, aligned with the TPDI inventory (components/tpdi.jsx).
// Internal keys stay N/T/O/S/E/I (CESTWP); the disposition model is unchanged.
const AXIS_LABEL: Record<Axis, string> = {
  N: "Voice", T: "Tactics", O: "Arcana",
  S: "Rapport", E: "Exploration", I: "Nerve",
};
const AXIS_SUB: Record<Axis, string> = {
  N: "The Character", T: "The Encounter", O: "The System",
  S: "The Table", E: "The World", I: "Presence",
};
const AXIS_TAVERN_LETTER: Record<Axis, string> = {
  N: "V", T: "T", O: "A", S: "R", E: "E", I: "N",
};
const AXIS_COLOR: Record<Axis, string> = {
  N: "#B7615A", T: "#C8A24B", O: "#4E8077", S: "#CE8A42", E: "#6C76B0", I: "#9A93B0",
};

// TPDI item map (1-5 Likert; *4 items reverse-scored as 6 - raw; axis = mean)
const ITEM_AXIS: Record<string, Axis> = {};
const ITEM_REV: Record<string, boolean> = {};
for (const ax of AXES) for (let k = 1; k <= 4; k++) {
  const id = `${ax.toLowerCase()}${k}`; ITEM_AXIS[id] = ax; ITEM_REV[id] = k === 4;
}
const invLogit = (x: number) => 1 / (1 + Math.exp(-x));

type Campaign = { id: string; name: string };
type Char = { id: string; name: string };
type Disp = { character_id: string | null; axis_scores: Record<string, number>; weights: Record<string, { lo: number; hi: number }>; as_of: string; model_version: string };
type Tpdi = { assigned_character_id: string | null; answers: Record<string, number | string> };

type Built = {
  char: Char;
  prior: Partial<Record<Axis, number>> | null;   // 0-1 (normalized self-report)
  post: Partial<Record<Axis, number>> | null;    // 0-1 (modeled engagement)
  ci: Partial<Record<Axis, { lo: number; hi: number }>> | null;
  asOf: string | null;
  modelVersion: string | null;
};

function scorePrior(answers: Record<string, number | string>): Partial<Record<Axis, number>> {
  const buckets: Record<Axis, number[]> = { N: [], T: [], O: [], S: [], E: [], I: [] };
  for (const [id, raw] of Object.entries(answers)) {
    const ax = ITEM_AXIS[id]; if (!ax) continue;
    if (raw === "NB" || raw == null) continue;
    const v = Number(raw); if (Number.isNaN(v)) continue;
    buckets[ax].push(ITEM_REV[id] ? 6 - v : v);
  }
  const out: Partial<Record<Axis, number>> = {};
  for (const ax of AXES) {
    if (buckets[ax].length) {
      const mean = buckets[ax].reduce((a, b) => a + b, 0) / buckets[ax].length;
      out[ax] = (mean - 1) / 4;   // 1-5 -> 0-1, midpoint 3 -> 0.5
    }
  }
  return out;
}

// ---- radar geometry ----
const SIZE = 264, CEN = 132, R = 92;
const angleOf = (i: number) => (-90 + i * 60) * (Math.PI / 180);
const pt = (val: number, i: number) => {
  const a = angleOf(i);
  return [CEN + R * val * Math.cos(a), CEN + R * val * Math.sin(a)] as const;
};
const polygon = (vals: number[]) => vals.map((v, i) => pt(v, i).join(",")).join(" ");

function Radar({ d }: { d: Built }) {
  const rings = [0.25, 0.5, 0.75, 1];
  const priorVals = AXES.map((ax) => d.prior?.[ax] ?? null);
  const postVals = AXES.map((ax) => d.post?.[ax] ?? null);
  const hasPrior = priorVals.some((v) => v != null);
  const hasPost = postVals.some((v) => v != null);

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: "100%", maxWidth: 300, display: "block", margin: "0 auto" }}>
      {/* rings */}
      {rings.map((r) => (
        <polygon key={r} points={polygon(AXES.map(() => r))} fill="none"
          stroke={r === 0.5 ? C.muted : C.line} strokeWidth={r === 0.5 ? 1 : 0.7}
          strokeDasharray={r === 0.5 ? "3 3" : undefined} opacity={r === 0.5 ? 0.55 : 0.4} />
      ))}
      {/* spokes + labels */}
      {AXES.map((ax, i) => {
        const [sx, sy] = pt(1, i);
        const [lx, ly] = pt(1.2, i);
        return (
          <g key={ax}>
            <line x1={CEN} y1={CEN} x2={sx} y2={sy} stroke={C.line} strokeWidth={0.7} opacity={0.5} />
            <text x={lx} y={ly} fill={AXIS_COLOR[ax]} fontSize={13} fontWeight={700}
              textAnchor="middle" dominantBaseline="middle" fontFamily="ui-monospace, monospace">{AXIS_TAVERN_LETTER[ax]}</text>
          </g>
        );
      })}
      {/* credible-interval radial bars (posterior) */}
      {hasPost && AXES.map((ax, i) => {
        const c = d.ci?.[ax]; if (!c) return null;
        const [lx, ly] = pt(Math.max(0, c.lo), i);
        const [hx, hy] = pt(Math.min(1, c.hi), i);
        return <line key={ax} x1={lx} y1={ly} x2={hx} y2={hy} stroke={C.sun} strokeWidth={2} opacity={0.28} strokeLinecap="round" />;
      })}
      {/* prior polygon (self-report) */}
      {hasPrior && (
        <polygon points={polygon(priorVals.map((v) => v ?? 0))} fill={C.plum} fillOpacity={0.12}
          stroke={C.plum} strokeWidth={1.6} strokeOpacity={0.85} />
      )}
      {/* posterior polygon (behavior) */}
      {hasPost && (
        <polygon points={polygon(postVals.map((v) => v ?? 0))} fill={C.sun} fillOpacity={0.14}
          stroke={C.sun} strokeWidth={2} />
      )}
      {hasPost && postVals.map((v, i) => v == null ? null : <circle key={i} cx={pt(v, i)[0]} cy={pt(v, i)[1]} r={2.6} fill={C.sun} />)}
    </svg>
  );
}

function divergences(d: Built): { ax: Axis; dir: "above" | "below" }[] {
  if (!d.prior || !d.post || !d.ci) return [];
  const out: { ax: Axis; dir: "above" | "below" }[] = [];
  for (const ax of AXES) {
    const p = d.prior[ax], c = d.ci[ax];
    if (p == null || !c) continue;
    if (c.lo > p) out.push({ ax, dir: "above" });
    else if (c.hi < p) out.push({ ax, dir: "below" });
  }
  return out;
}

export default function DispositionsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [rows, setRows] = useState<Built[]>([]);
  // The people behind the characters. A player-level disposition belongs to a PERSON,
  // not to a campaign, so these rows are fetched by profile and carry no campaign_id.
  // Names come from profiles_public (never the base table, which is self-only now).
  const [players, setPlayers] = useState<Array<{ profile_id: string; name: string | null }>>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at", { ascending: true });
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      setLoading(true);
      const [{ data: ch }, { data: dp }, { data: tp }, { data: owned }] = await Promise.all([
        supabase.from("characters").select("id, name").eq("campaign_id", campaignId).eq("kind", "pc").order("name", { ascending: true }),
        supabase.from("dispositions").select("character_id, axis_scores, weights, as_of, model_version").eq("campaign_id", campaignId).eq("source", "posterior").order("as_of", { ascending: false }),
        supabase.from("tpdi_responses").select("assigned_character_id, answers").eq("campaign_id", campaignId).not("assigned_character_id", "is", null),
        supabase.from("characters").select("profile_id").eq("campaign_id", campaignId).eq("kind", "pc").not("profile_id", "is", null),
      ]);

      // Distinct owners of the PCs in this campaign, with their display names.
      const ownerIds = [...new Set(((owned as Array<{ profile_id: string }>) || []).map((o) => o.profile_id))];
      if (ownerIds.length) {
        const { data: profs } = await supabase
          .from("profiles_public")
          .select("id, display_name")
          .in("id", ownerIds);
        const nameOf = new Map(((profs as Array<{ id: string; display_name: string | null }>) || []).map((p) => [p.id, p.display_name]));
        setPlayers(ownerIds.map((id) => ({ profile_id: id, name: nameOf.get(id) ?? null })));
      } else {
        setPlayers([]);
      }

      const chars = (ch as Char[]) || [];
      const posts = (dp as Disp[]) || [];
      const tpdis = (tp as Tpdi[]) || [];

      const latestPost = new Map<string, Disp>();
      for (const p of posts) { if (p.character_id && !latestPost.has(p.character_id)) latestPost.set(p.character_id, p); }
      const priorByChar = new Map<string, Partial<Record<Axis, number>>>();
      for (const t of tpdis) { if (t.assigned_character_id && t.answers) priorByChar.set(t.assigned_character_id, scorePrior(t.answers)); }

      const built: Built[] = chars.map((c) => {
        const p = latestPost.get(c.id) || null;
        const prior = priorByChar.get(c.id) || null;
        let post: Partial<Record<Axis, number>> | null = null;
        let ci: Partial<Record<Axis, { lo: number; hi: number }>> | null = null;
        if (p) {
          post = {}; ci = {};
          for (const ax of AXES) {
            if (typeof p.axis_scores?.[ax] === "number") post[ax] = p.axis_scores[ax];
            const w = p.weights?.[ax];
            if (w && typeof w.lo === "number" && typeof w.hi === "number") ci[ax] = { lo: invLogit(w.lo), hi: invLogit(w.hi) };
          }
        }
        return { char: c, prior, post, ci, asOf: p?.as_of ?? null, modelVersion: p?.model_version ?? null };
      });
      setRows(built);
      setLoading(false);
    })();
  }, [campaignId, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = { ...surfaces.slate, padding: 20, marginBottom: 18 } as const;
  const swatch = (color: string) => ({ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: color, marginRight: 6, verticalAlign: "middle" });

  return (
    <PageShell width={980}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Dispositions</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 16px", maxWidth: 720, lineHeight: 1.6 }}>
        What each player said about how they like to play (their self-report), against how they actually played (modeled from logged events). The faint bars are the model&apos;s 90% credible interval: wide bars mean thin data, so read the overlap, not the exact points. The 0.5 ring is table-typical engagement.
      </p>

      <div style={{ ...box, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div>
          <span style={swatch(C.plum)} /><span style={{ fontSize: 13 }}>Self-report (prior)</span>
        </div>
        <div>
          <span style={swatch(C.sun)} /><span style={{ fontSize: 13 }}>Behavior (posterior)</span>
        </div>
        <div style={{ color: C.muted, fontSize: 12.5 }}>T Tactics · A Arcana · V Voice · E Exploration · R Rapport · N Nerve</div>
      </div>

      <div style={box}>
        <label style={{ ...ui.label, fontSize: 12 }}>CAMPAIGN</label>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
          style={{ display: "block", width: "100%", marginTop: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 15 }}>
          {campaigns.length === 0 && <option value="">No campaigns yet</option>}
          {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </div>

      {loading ? (
        <div style={{ ...box, color: C.muted, fontSize: 14 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ ...box, color: C.muted, fontSize: 14 }}>No player characters in this campaign yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {rows.map((d) => {
            const divs = divergences(d);
            return (
              <div key={d.char.id} style={{ ...box, marginBottom: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontFamily: SAX.serif, fontSize: 19 }}>{d.char.name}</div>
                  {d.asOf && <div style={{ fontSize: 11, color: C.muted }}>as of {new Date(d.asOf).toLocaleDateString()}</div>}
                </div>

                <Radar d={d} />

                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, marginTop: 6 }}>
                  {!d.prior && !d.post && "No data yet."}
                  {d.prior && !d.post && "Self-report only. Run the disposition model to add the behavioral estimate."}
                  {!d.prior && d.post && "Behavioral estimate only. Send this player their invite link so their inventory binds a self-report prior."}
                  {d.prior && d.post && (
                    divs.length === 0
                      ? "Behavior is consistent with self-report so far, within the model's uncertainty."
                      : (<>Behavior credibly differs from self-report on {divs.map((x, k) => (
                          <span key={x.ax}>
                            <span style={{ color: AXIS_COLOR[x.ax], fontWeight: 700 }}>{AXIS_LABEL[x.ax]}</span>
                            <span style={{ color: C.muted }}> ({AXIS_SUB[x.ax].replace("The ", "")})</span>
                            <span> ({x.dir === "above" ? "more" : "less"} than reported)</span>
                            {k < divs.length - 1 ? ", " : "."}
                          </span>
                        ))}</>)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PLAYER-LEVEL dispositions. A claim about the PERSON rather than the
          character, so it is gated: the GM opens it, and the player still has to
          look. The character posteriors above stay open, as they always have been. */}
      {!loading && players.length > 0 && (
        <div style={{ marginTop: 34 }}>
          <div style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 6 }}>
            The players behind them
          </div>
          <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, margin: "0 0 16px", maxWidth: 620 }}>
            How each person tends to play across every character they have, pooled. This is
            about the player, not the mask, which is why they do not see it unless you share
            it. Sharing is reversible and they still choose whether to look.
          </p>
          {players.map((p) => (
            <PlayerDisposition
              key={p.profile_id}
              profileId={p.profile_id}
              mode="gm"
              playerName={p.name}
              campaignId={campaignId}
            />
          ))}
        </div>
      )}

      {!loading && rows.some((r) => r.modelVersion) && (
        <div style={{ color: C.muted, fontSize: 11.5, marginTop: 16 }}>
          Model: {rows.find((r) => r.modelVersion)?.modelVersion}. Posterior engagement is on a 0–1 scale (0.5 = table-typical given opportunity); the self-report polygon is the 1–5 inventory normalized to the same scale.
        </div>
      )}
    </PageShell>
  );
}
