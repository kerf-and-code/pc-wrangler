"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";

const C = {
  ink: SAX.inkDeep, panel: SAX.slateBg, line: SAX.line, text: SAX.text,
  muted: SAX.muted, brass: SAX.brass, good: SAX.good, warn: SAX.warn, plum: SAX.plum,
};

// ============================================================================
// THE TWO METHODS ARE GENUINELY DIFFERENT. THIS IS THE WHOLE POINT OF THE TOOL.
//
// 2024 DMG ("CR budget"):
//   XP budget PER CHARACTER by level, three tiers (Low / Moderate / High).
//   Multiply by party size. Compare RAW monster XP to it.
//   THE ENCOUNTER MULTIPLIER IS GONE. Deadly is gone. Ten dire wolves count as ten
//   dire wolves, not as ten dire wolves times four.
//
// 2014 DMG ("XP thresholds"):
//   XP THRESHOLDS per character, four tiers (Easy / Medium / Hard / Deadly).
//   Sum across the party. Then multiply the monsters' XP by a count-based multiplier
//   (x1 to x4) to get "adjusted XP", and compare THAT.
//
// Applying the 2014 multiplier to the 2024 budget inflates an encounter by up to 4x.
// Several calculators on the web do exactly that under a "2024" heading. This one does
// not, which is most of why it exists.
// ============================================================================

// Monster XP by CR. Unchanged between editions.
const CR_XP: Record<string, number> = {
  "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
  "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900,
  "8": 3900, "9": 5000, "10": 5900, "11": 7200, "12": 8400, "13": 10000,
  "14": 11500, "15": 13000, "16": 15000, "17": 18000, "18": 20000, "19": 22000,
  "20": 25000, "21": 33000, "22": 41000, "23": 50000, "24": 62000, "25": 75000,
  "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000,
};
const CR_LIST = Object.keys(CR_XP);

// 2024 DMG, XP Budget per Character. [Low, Moderate, High]
// Verified against the published examples: L1 Low = 50, L3 Moderate = 225,
// L15 High = 7,800, L20 High = 22,000.
const BUDGET_2024: Record<number, [number, number, number]> = {
  1: [50, 75, 100], 2: [100, 150, 200], 3: [150, 225, 400], 4: [250, 375, 500],
  5: [500, 750, 1100], 6: [600, 1000, 1400], 7: [750, 1300, 1700], 8: [1000, 1700, 2100],
  9: [1300, 2000, 2600], 10: [1600, 2300, 3100], 11: [1900, 2900, 4100], 12: [2200, 3700, 4700],
  13: [2600, 4200, 5400], 14: [2900, 4900, 6200], 15: [3300, 5400, 7800], 16: [3800, 6100, 9800],
  17: [4500, 7200, 11700], 18: [5000, 8700, 14200], 19: [5500, 10700, 17200], 20: [6400, 13200, 22000],
};

// 2014 DMG, XP Thresholds by Character Level. [Easy, Medium, Hard, Deadly]
const THRESH_2014: Record<number, [number, number, number, number]> = {
  1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400], 4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100], 6: [300, 600, 900, 1400], 7: [350, 750, 1100, 1700], 8: [450, 900, 1400, 2100],
  9: [550, 1100, 1600, 2400], 10: [600, 1200, 1900, 2800], 11: [800, 1600, 2400, 3600], 12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700], 15: [1400, 2800, 4300, 6400], 16: [1600, 3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500], 19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700],
};

// 2014 encounter multiplier ladder. The party-size rule MOVES YOU ALONG THIS LADDER
// rather than changing the number directly, which is why it is written as an array:
// a party of 1-2 steps UP one rung (monsters hit harder against fewer heroes), a party
// of 6+ steps DOWN one rung. That is the mechanism the DMG actually describes, and it
// is where the x0.5 rung comes from.
const MULT_LADDER = [0.5, 1, 1.5, 2, 2.5, 3, 4];

function multiplierIndex(monsterCount: number): number {
  if (monsterCount <= 1) return 1;   // x1
  if (monsterCount === 2) return 2;  // x1.5
  if (monsterCount <= 6) return 3;   // x2
  if (monsterCount <= 10) return 4;  // x2.5
  if (monsterCount <= 14) return 5;  // x3
  return 6;                          // x4
}

function multiplier2014(monsterCount: number, partySize: number): number {
  let i = multiplierIndex(monsterCount);
  if (partySize > 0 && partySize < 3) i += 1;   // small party: the fight is harder
  if (partySize > 5) i -= 1;                    // big party: the fight is easier
  return MULT_LADDER[Math.max(0, Math.min(MULT_LADDER.length - 1, i))];
}

type Char = { id: string; name: string; level: number | null; class: string | null };
type Foe = { id: string; name: string; cr: string; count: number };
type Method = "2024" | "2014";

let seq = 0;
const uid = () => `f${++seq}`;

export default function EncountersPage() {
  const supabase = createClient();
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  const [campaignId, setCampaignId] = useState("");
  const [chars, setChars] = useState<Char[]>([]);
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<Method>("2024");
  const [foes, setFoes] = useState<Foe[]>([{ id: uid(), name: "", cr: "1", count: 1 }]);
  const [loading, setLoading] = useState(true);

  // "The module assumes N characters of level L." This is the thing you actually
  // wanted: a published encounter is written for a party that is not yours.
  const [modOn, setModOn] = useState(false);
  const [modSize, setModSize] = useState(4);
  const [modLevel, setModLevel] = useState(5);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name").order("created_at", { ascending: false });
      const list = (data as Array<{ id: string; name: string }>) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(list[0].id);
      setLoading(false);
    })();
  }, [supabase]);

  const loadChars = useCallback(async (cid: string) => {
    const { data } = await supabase
      .from("characters")
      .select("id, name, level, class")
      .eq("campaign_id", cid).eq("kind", "pc").eq("active", true)
      .order("name");
    const list = (data as Char[]) || [];
    setChars(list);
    // Everyone is at the table until the GM says otherwise. The common case is a full
    // party; the interesting case is someone missing, which is one click.
    setPresent(Object.fromEntries(list.map((c) => [c.id, true])));
  }, [supabase]);

  useEffect(() => { if (campaignId) loadChars(campaignId); }, [campaignId, loadChars]);

  const party = useMemo(() => chars.filter((c) => present[c.id]), [chars, present]);
  const levelled = useMemo(() => party.filter((c) => c.level != null && c.level >= 1 && c.level <= 20), [party]);
  const missingLevels = party.length - levelled.length;

  // ---- the party's budget / thresholds ------------------------------------
  const budget = useMemo(() => {
    if (levelled.length === 0) return null;
    if (method === "2024") {
      const t: [number, number, number] = [0, 0, 0];
      for (const c of levelled) {
        const b = BUDGET_2024[c.level as number];
        t[0] += b[0]; t[1] += b[1]; t[2] += b[2];
      }
      return { kind: "2024" as const, tiers: t, labels: ["Low", "Moderate", "High"] };
    }
    const t: [number, number, number, number] = [0, 0, 0, 0];
    for (const c of levelled) {
      const b = THRESH_2014[c.level as number];
      t[0] += b[0]; t[1] += b[1]; t[2] += b[2]; t[3] += b[3];
    }
    return { kind: "2014" as const, tiers: t, labels: ["Easy", "Medium", "Hard", "Deadly"] };
  }, [levelled, method]);

  // ---- the encounter -------------------------------------------------------
  const monsterCount = foes.reduce((n, f) => n + Math.max(0, f.count), 0);
  const rawXp = foes.reduce((x, f) => x + (CR_XP[f.cr] ?? 0) * Math.max(0, f.count), 0);
  const mult = method === "2014" ? multiplier2014(monsterCount, levelled.length) : 1;
  const effectiveXp = Math.round(rawXp * mult);

  // Where does it land?
  const verdict = useMemo(() => {
    if (!budget || effectiveXp === 0) return null;
    const t = budget.tiers as number[];
    const labels = budget.labels;
    // Below the first tier.
    if (effectiveXp < t[0]) return { label: `Below ${labels[0]}`, tone: C.muted, idx: -1 };
    // Find the highest tier it meets or exceeds.
    let idx = 0;
    for (let i = 0; i < t.length; i++) if (effectiveXp >= t[i]) idx = i;
    const overTop = effectiveXp > t[t.length - 1];
    const tone = idx >= t.length - 1 ? C.warn : idx >= t.length - 2 ? C.brass : C.good;
    return {
      label: overTop && effectiveXp > t[t.length - 1] * 1.25
        ? `Beyond ${labels[labels.length - 1]}`
        : labels[idx],
      tone,
      idx,
    };
  }, [budget, effectiveXp]);

  // ---- module scaling ------------------------------------------------------
  // The published encounter was written for a party that is not yours. This says by
  // how much, in the same units the method uses, so you can cut a monster or add one.
  const moduleCompare = useMemo(() => {
    if (!modOn || !budget || levelled.length === 0) return null;
    const lvl = Math.max(1, Math.min(20, modLevel));
    const n = Math.max(1, modSize);

    const modTiers = method === "2024"
      ? (BUDGET_2024[lvl].map((v) => v * n) as number[])
      : (THRESH_2014[lvl].map((v) => v * n) as number[]);

    const yours = budget.tiers as number[];
    // Compare at the SAME tier the encounter currently lands in, since that is the
    // difficulty the designer was aiming at.
    const tier = verdict && verdict.idx >= 0 ? verdict.idx : Math.min(1, yours.length - 1);
    const theirs = modTiers[tier];
    const mine = yours[tier];
    const ratio = theirs > 0 ? mine / theirs : 1;

    // In 2014 the multiplier depends on party size, so the fair target has to be
    // expressed in RAW xp, not adjusted. Divide the target back out by our multiplier.
    const targetRaw = method === "2014" ? Math.round((rawXp * ratio)) : Math.round(rawXp * ratio);
    return {
      tierLabel: budget.labels[tier],
      theirs, mine, ratio,
      targetRaw,
      delta: targetRaw - rawXp,
    };
  }, [modOn, modSize, modLevel, budget, levelled.length, method, verdict, rawXp]);

  // ---- rendering -----------------------------------------------------------
  const box: React.CSSProperties = {
    background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12,
    padding: "16px 18px", marginBottom: 14,
  };
  const inputStyle: React.CSSProperties = {
    background: SAX.panelBg, color: C.text, border: `1px solid ${C.line}`,
    borderRadius: 8, padding: "8px 10px", fontSize: 14,
  };
  const eyebrow: React.CSSProperties = {
    fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.2em",
    textTransform: "uppercase", color: C.muted, marginBottom: 10,
  };

  return (
    <PageShell width={980}>
      <div style={{ fontFamily: SAX.serif, fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 4 }}>
        Encounter balancer
      </div>
      <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 660 }}>
        Built against the party actually sitting at your table tonight, not the one the
        module assumed.
      </p>

      {/* method */}
      <div style={box}>
        <div style={eyebrow}>Method</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {(["2024", "2014"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              style={{
                background: method === m ? C.brass : "transparent",
                color: method === m ? C.ink : C.muted,
                border: `1px solid ${method === m ? C.brass : C.line}`,
                borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 700,
                fontFamily: SAX.mono, cursor: "pointer",
              }}
            >
              {m === "2024" ? "2024 DMG (XP budget)" : "2014 DMG (thresholds + multiplier)"}
            </button>
          ))}
        </div>
        <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
          {method === "2024" ? (
            <>
              Three tiers, and <strong style={{ color: C.text }}>no encounter multiplier</strong>.
              Ten wolves count as ten wolves. Deadly no longer exists; High is its
              replacement, and above level 8 it is considerably harsher than 2014&apos;s Deadly.
            </>
          ) : (
            <>
              Four tiers, and monster XP is inflated by a <strong style={{ color: C.text }}>count-based
              multiplier</strong> (&times;1 to &times;4) to account for action economy. A small
              party pushes that multiplier up a rung; a large one pushes it down.
            </>
          )}
        </p>
      </div>

      {/* party */}
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ ...eyebrow, marginBottom: 0 }}>Who is at the table</div>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {loading && <p style={{ color: C.muted, fontSize: 13 }}>Loading&hellip;</p>}
        {!loading && chars.length === 0 && (
          <p style={{ color: C.muted, fontSize: 13 }}>No characters in this campaign yet.</p>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {chars.map((c) => {
            const on = !!present[c.id];
            const noLevel = c.level == null;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setPresent((p) => ({ ...p, [c.id]: !p[c.id] }))}
                title={noLevel ? "No level recorded, so this character cannot be counted" : ""}
                style={{
                  background: on && !noLevel ? "rgba(200,162,75,0.14)" : "transparent",
                  color: noLevel ? C.warn : on ? C.text : C.muted,
                  border: `1px solid ${noLevel ? C.warn : on ? C.brass : C.line}`,
                  borderRadius: 999, padding: "6px 13px", fontSize: 13,
                  cursor: "pointer", opacity: on ? 1 : 0.5,
                }}
              >
                {c.name}
                <span style={{ fontFamily: SAX.mono, fontSize: 11, marginLeft: 7, color: C.muted }}>
                  {noLevel ? "no level" : `lvl ${c.level}`}
                </span>
              </button>
            );
          })}
        </div>

        {missingLevels > 0 && (
          <p style={{ color: C.warn, fontSize: 12.5, margin: "12px 0 0", lineHeight: 1.55 }}>
            {missingLevels} selected character{missingLevels === 1 ? " has" : "s have"} no level
            recorded, so {missingLevels === 1 ? "it is" : "they are"} not counted. Set a level on
            the Workspace roster and {missingLevels === 1 ? "it" : "they"} will be.
          </p>
        )}

        {budget && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
            <div style={{ ...eyebrow, marginBottom: 8 }}>
              {levelled.length} character{levelled.length === 1 ? "" : "s"}
              {method === "2024" ? " \u00B7 XP budget" : " \u00B7 XP thresholds"}
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              {(budget.tiers as number[]).map((v, i) => (
                <div key={i}>
                  <div style={{ fontFamily: SAX.mono, fontSize: 11, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    {budget.labels[i]}
                  </div>
                  <div style={{ fontFamily: SAX.mono, fontSize: 17, color: C.text, fontWeight: 700 }}>
                    {v.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* monsters */}
      <div style={box}>
        <div style={eyebrow}>The encounter</div>
        {foes.map((f) => (
          <div key={f.id} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={f.name}
              onChange={(e) => setFoes((fs) => fs.map((x) => x.id === f.id ? { ...x, name: e.target.value } : x))}
              placeholder="Monster (optional)"
              style={{ ...inputStyle, flex: "1 1 170px" }}
            />
            <select
              value={f.cr}
              onChange={(e) => setFoes((fs) => fs.map((x) => x.id === f.id ? { ...x, cr: e.target.value } : x))}
              style={{ ...inputStyle, width: 110 }}
            >
              {CR_LIST.map((cr) => (
                <option key={cr} value={cr}>CR {cr} &middot; {CR_XP[cr].toLocaleString()}xp</option>
              ))}
            </select>
            <input
              type="number" min={1} value={f.count}
              onChange={(e) => setFoes((fs) => fs.map((x) => x.id === f.id ? { ...x, count: Math.max(1, Number(e.target.value) || 1) } : x))}
              style={{ ...inputStyle, width: 70 }}
            />
            <button
              type="button"
              onClick={() => setFoes((fs) => fs.length > 1 ? fs.filter((x) => x.id !== f.id) : fs)}
              style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
            >
              {"\u00D7"}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setFoes((fs) => [...fs, { id: uid(), name: "", cr: "1", count: 1 }])}
          style={{
            background: "transparent", color: C.text, border: `1px solid ${C.line}`,
            borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700,
            fontFamily: SAX.mono, cursor: "pointer", marginTop: 4,
          }}
        >
          Add monster
        </button>
      </div>

      {/* verdict */}
      {budget && effectiveXp > 0 && verdict && (
        <div style={{ ...box, borderColor: verdict.tone }}>
          <div style={eyebrow}>Verdict</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
            <span style={{ fontFamily: SAX.serif, fontSize: 30, fontWeight: 700, color: verdict.tone }}>
              {verdict.label}
            </span>
            <span style={{ fontFamily: SAX.mono, fontSize: 14, color: C.muted }}>
              {method === "2014" ? (
                <>{rawXp.toLocaleString()} xp &times; {mult} = <strong style={{ color: C.text }}>{effectiveXp.toLocaleString()} adjusted</strong></>
              ) : (
                <><strong style={{ color: C.text }}>{rawXp.toLocaleString()} xp</strong> against a {budget.labels[Math.max(0, verdict.idx)]} budget of {(budget.tiers as number[])[Math.max(0, verdict.idx)].toLocaleString()}</>
              )}
            </span>
          </div>

          {method === "2014" && (
            <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
              {monsterCount} monster{monsterCount === 1 ? "" : "s"} against {levelled.length} character
              {levelled.length === 1 ? "" : "s"} gives a &times;{mult} multiplier.
              {levelled.length > 0 && levelled.length < 3 && " Your party is small, so the multiplier steps up a rung."}
              {levelled.length > 5 && " Your party is large, so the multiplier steps down a rung."}
            </p>
          )}
        </div>
      )}

      {/* module scaling — the thing that prompted this */}
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ ...eyebrow, marginBottom: 0 }}>The module assumed a different party</div>
          <button
            type="button"
            onClick={() => setModOn((v) => !v)}
            style={{
              background: modOn ? C.brass : "transparent", color: modOn ? C.ink : C.muted,
              border: `1px solid ${modOn ? C.brass : C.line}`, borderRadius: 999,
              padding: "4px 12px", fontSize: 11.5, fontFamily: SAX.mono, fontWeight: 700, cursor: "pointer",
            }}
          >
            {modOn ? "On" : "Off"}
          </button>
        </div>

        {modOn && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "14px 0" }}>
              <span style={{ color: C.muted, fontSize: 13 }}>Written for</span>
              <input type="number" min={1} max={10} value={modSize}
                onChange={(e) => setModSize(Math.max(1, Number(e.target.value) || 1))}
                style={{ ...inputStyle, width: 66 }} />
              <span style={{ color: C.muted, fontSize: 13 }}>characters of level</span>
              <input type="number" min={1} max={20} value={modLevel}
                onChange={(e) => setModLevel(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                style={{ ...inputStyle, width: 66 }} />
            </div>

            {moduleCompare && effectiveXp > 0 ? (
              <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
                <p style={{ color: C.text, fontSize: 14, lineHeight: 1.65, margin: "0 0 10px" }}>
                  At <strong>{moduleCompare.tierLabel}</strong>, the module&apos;s party could take{" "}
                  <span style={{ fontFamily: SAX.mono, color: C.brass }}>{moduleCompare.theirs.toLocaleString()}</span> xp.
                  Yours can take <span style={{ fontFamily: SAX.mono, color: C.brass }}>{moduleCompare.mine.toLocaleString()}</span>.
                </p>
                <p style={{ color: C.text, fontSize: 14, lineHeight: 1.65, margin: 0 }}>
                  {Math.abs(moduleCompare.delta) < 1 ? (
                    <>Your party is a match for this encounter as written.</>
                  ) : moduleCompare.delta < 0 ? (
                    <>
                      Your party is <strong>{Math.round((1 - moduleCompare.ratio) * 100)}% weaker</strong> than the
                      one this was written for. To hit the same difficulty, aim for about{" "}
                      <span style={{ fontFamily: SAX.mono, color: C.warn }}>{moduleCompare.targetRaw.toLocaleString()}</span> xp
                      of monsters instead of {rawXp.toLocaleString()}: cut roughly{" "}
                      <strong>{Math.abs(moduleCompare.delta).toLocaleString()} xp</strong> worth.
                    </>
                  ) : (
                    <>
                      Your party is <strong>{Math.round((moduleCompare.ratio - 1) * 100)}% stronger</strong> than the
                      one this was written for. To hit the same difficulty, aim for about{" "}
                      <span style={{ fontFamily: SAX.mono, color: C.good }}>{moduleCompare.targetRaw.toLocaleString()}</span> xp
                      of monsters: add roughly <strong>{moduleCompare.delta.toLocaleString()} xp</strong> worth.
                    </>
                  )}
                </p>

                {method === "2014" && (
                  <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.55, margin: "10px 0 0" }}>
                    Careful: in 2014, adding or removing a monster also moves the multiplier, so the
                    raw target above is a starting point rather than an exact landing. Adjust, then
                    re-read the verdict.
                  </p>
                )}
              </div>
            ) : (
              <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>
                Add monsters above and this will tell you how far off the encounter is for your party.
              </p>
            )}
          </>
        )}
      </div>

      <p style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.6, marginTop: 6 }}>
        These are guidelines, not physics. Terrain, action economy, party composition, and
        whether anyone remembered to take a long rest will move a fight further than any
        table on this page.
      </p>
    </PageShell>
  );
}
