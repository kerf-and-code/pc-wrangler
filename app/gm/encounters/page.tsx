"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { SAX } from "@/lib/theme";
import { C, FORGE_RADIUS, stoneField, stonePanel, stoneButton } from "@/lib/forge-theme";
import { loadSrd } from "@/lib/srd/srd";
import { listStatBlocks, type StatBlockRow } from "@/lib/stat-blocks";
import { getModule } from "@/lib/systems/registry";
import { pf2Budget, pf2EncounterXp, pf2Threat, PF2_THREATS, PF2_THREAT_LABEL } from "@/lib/pf2e/encounter";
import { dhBattlePoints, dhAdjustedBudget, dhSpend, DH_ADJUSTMENTS, DH_BP_COST, type DHAdjustment } from "@/lib/daggerheart/encounter";
import { DH_ADVERSARY_TYPES, type DHAdversaryType } from "@/lib/daggerheart/adversary";
import { setActiveCampaign } from "@/lib/active-campaign";

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

// 2014 DMG "Adventuring Day XP": roughly how much a character can absorb between
// long rests. NONE of the competing calculators do this, and it is the question that
// actually decides whether a fight is dangerous: this encounter is fine, but it is
// your fourth one today and the cleric is dry.
//
// The 2024 DMG dropped the table but kept the guidance (6-8 medium-ish encounters per
// day). The 2014 numbers remain the best available proxy, so they are used for both
// methods and labelled as such rather than silently attributed to 2024.
const ADVENTURING_DAY: Record<number, number> = {
  1: 300, 2: 600, 3: 1200, 4: 1700, 5: 3500, 6: 4000, 7: 5000, 8: 6000,
  9: 7500, 10: 9000, 11: 10500, 12: 11500, 13: 13500, 14: 15000, 15: 18000,
  16: 20000, 17: 25000, 18: 27000, 19: 30000, 20: 40000,
};

// The 12 capability tags on class_capabilities. What a party can actually DO.
const CAP_LABEL: Record<string, string> = {
  single_target: "single-target damage", aoe: "area damage", melee: "melee",
  ranged: "ranged", tank: "a front line", control: "crowd control",
  support: "support", healing: "healing", utility: "utility",
  face: "a face", stealth: "stealth", detect_magic: "magic detection",
};
// The gaps that actually change how dangerous a fight is. Missing "face" does not
// make an ogre hit harder; missing healing very much does.
const COMBAT_CRITICAL = ["healing", "ranged", "tank", "control", "aoe"];

type Char = { id: string; name: string; level: number | null; class: string | null; subclass: string | null };
type Foe = { id: string; name: string; cr: string; count: number };
type Method = "2024" | "2014";
// A pickable monster from either source: the GM's own saved stat blocks or the SRD library.
type MonsterSource = { name: string; cr: string; origin: "mine" | "srd" };
type SrdMode = "2024" | "2014" | "both";

let seq = 0;
const uid = () => `f${++seq}`;

export default function EncountersPage() {
  const supabase = createClient();
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; system: string | null }>>([]);
  const [campaignId, setCampaignId] = useState("");
  const [chars, setChars] = useState<Char[]>([]);
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<Method>("2024");
  const [foes, setFoes] = useState<Foe[]>([{ id: uid(), name: "", cr: "1", count: 1 }]);
  const [loading, setLoading] = useState(true);
  // What this party can DO. Deterministic, straight from class_capabilities: no model,
  // no inference. "This party has no healing" is a fact, and it moves a fight's real
  // difficulty further than any multiplier on this page.
  const [caps, setCaps] = useState<Array<{ class: string; subclass: string | null; capabilities: string[] }>>([]);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Monster sources for the picker: the GM's own saved stat blocks (from the stat-block builder)
  // and the SRD monster library. Both feed the same Foe model, so the whole calc downstream is
  // unchanged, this only replaces hand-typing a name and CR.
  const [statBlocks, setStatBlocks] = useState<StatBlockRow[]>([]);
  const [pfLevel, setPfLevel] = useState(1);
  const [pfSize, setPfSize] = useState(4);
  const [pfoes, setPfoes] = useState<{ id: string; name: string; level: number; count: number }[]>([]);
  const [dhSize, setDhSize] = useState(4);
  const [dhAdj, setDhAdj] = useState<DHAdjustment[]>([]);
  const [dhRoster, setDhRoster] = useState<{ id: string; type: DHAdversaryType; count: number }[]>([]);
  const [srdMode, setSrdMode] = useState<SrdMode>("2014");
  const [pickerOpen, setPickerOpen] = useState(false);

  // "The module assumes N characters of level L." This is the thing you actually
  // wanted: a published encounter is written for a party that is not yours.
  const [modOn, setModOn] = useState(false);
  const [modSize, setModSize] = useState(4);
  const [modLevel, setModLevel] = useState(5);

  useEffect(() => {
    (async () => {
      const [{ data }, { data: cp }, blocks] = await Promise.all([
        supabase.from("campaigns").select("id, name, system").order("created_at", { ascending: false }),
        supabase.from("class_capabilities").select("class, subclass, capabilities"),
        listStatBlocks(supabase).catch(() => [] as StatBlockRow[]),
      ]);
      const list = (data as Array<{ id: string; name: string; system: string | null }>) || [];
      setCampaigns(list);
      setCaps((cp as Array<{ class: string; subclass: string | null; capabilities: string[] }>) || []);
      setStatBlocks(blocks);
      if (list.length) setCampaignId(list[0].id);
      setLoading(false);
    })();
  }, [supabase]);

  const loadChars = useCallback(async (cid: string) => {
    const { data } = await supabase
      .from("characters")
      .select("id, name, level, class, subclass")
      .eq("campaign_id", cid).eq("kind", "pc").eq("active", true)
      // An ALTER EGO is a second sheet for a player who already has one at the table, not a second
      // body in the fight. Counting both inflates the XP budget and the party size, so a four-player
      // party whose rogue has an alter would be balanced as five. Excluded here rather than in the
      // schema, because the Roster and the Forge should still show them.
      .is("alter_ego_of", null)
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

  // PF2e wants one party level + a size. Derive from the present, levelled party (most common level),
  // and keep it in sync so switching campaigns/toggling PCs updates it; the GM can still override.
  const pf2Derived = useMemo(() => {
    const lvls = levelled.map((c) => c.level as number);
    if (!lvls.length) return { level: 1, size: 4 };
    const counts = new Map<number, number>();
    for (const l of lvls) counts.set(l, (counts.get(l) ?? 0) + 1);
    let level = lvls[0], best = 0;
    for (const [l, c] of counts) if (c > best || (c === best && l > level)) { best = c; level = l; }
    return { level, size: lvls.length };
  }, [levelled]);
  useEffect(() => { setPfLevel(pf2Derived.level); setPfSize(pf2Derived.size); }, [pf2Derived]);
  useEffect(() => { setDhSize(levelled.length || 4); }, [levelled.length]);

  // ---- the party's budget / thresholds ------------------------------------
  useEffect(() => {
    const c = campaigns.find((x) => x.id === campaignId);
    if (c) setActiveCampaign({ id: c.id, name: c.name, system: c.system });
  }, [campaignId, campaigns]);

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

  // ---- what this party CAN DO ---------------------------------------------
  // The union of every present character's class baseline and subclass capabilities.
  // This is the thing no other calculator can tell you, because no other calculator
  // knows your party.
  const coverage = useMemo(() => {
    if (caps.length === 0 || levelled.length === 0) return null;
    const index = new Map<string, string[]>();
    for (const r of caps) {
      index.set(r.subclass ? `${r.class}|${r.subclass}` : r.class, r.capabilities || []);
    }
    const have = new Set<string>();
    const unknown: string[] = [];
    for (const c of levelled) {
      const base = c.class ? index.get(c.class) : undefined;
      const sub  = c.class && c.subclass ? index.get(`${c.class}|${c.subclass}`) : undefined;
      if (!base && !sub) { unknown.push(c.name); continue; }
      for (const b of [...(base || []), ...(sub || [])]) have.add(b);
    }
    const missing = COMBAT_CRITICAL.filter((b) => !have.has(b));
    return { have: [...have].sort(), missing, unknown };
  }, [caps, levelled]);

  // The pickable monster catalog: the GM's saved stat blocks first (their own creations, CR already
  // denormalized), then the SRD library for the chosen ruleset. Only entries with a usable CR are
  // offered, since the whole calc keys on CR.
  const monsterCatalog = useMemo<MonsterSource[]>(() => {
    const mine: MonsterSource[] = statBlocks
      .filter((b) => b.cr && CR_XP[b.cr] != null)
      .map((b) => ({ name: b.name, cr: b.cr as string, origin: "mine" }));
    const srd = (loadSrd("monsters", srdMode) as unknown as Array<{ name: string; cr?: string | number }>)
      .map((m) => ({ name: m.name, cr: String(m.cr ?? ""), origin: "srd" as const }))
      .filter((m) => m.cr && CR_XP[m.cr] != null);
    return [...mine, ...srd];
  }, [statBlocks, srdMode]);

  // Append a monster from the catalog as a new foe row (or bump its count if already present at the
  // same CR). Everything downstream reads Foe, so no other change is needed.
  const addFoeFromCatalog = useCallback((m: MonsterSource) => {
    setFoes((fs) => {
      const existing = fs.find((f) => f.name === m.name && f.cr === m.cr);
      if (existing) return fs.map((f) => f === existing ? { ...f, count: f.count + 1 } : f);
      // Drop a single empty placeholder row if that's all there is.
      const seeded = fs.length === 1 && !fs[0].name.trim() ? [] : fs;
      return [...seeded, { id: uid(), name: m.name, cr: m.cr, count: 1 }];
    });
  }, []);

  // XP to award after the fight. Always RAW xp, never adjusted: the multiplier is a
  // difficulty device, not an experience award. Several calculators get this right and
  // it is worth being explicit, because getting it wrong inflates every level-up.
  const xpPerPlayer = levelled.length > 0 ? Math.floor(rawXp / levelled.length) : 0;

  // How much of the day this fight eats.
  const dayBudget = useMemo(
    () => levelled.reduce((n, c) => n + (ADVENTURING_DAY[c.level as number] ?? 0), 0),
    [levelled],
  );
  const dayShare = dayBudget > 0 ? effectiveXp / dayBudget : 0;

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

  // Drop the encounter straight into tonight's plan. session_plan_items already has a
  // `difficulty` column that nothing was writing to.
  async function saveToPlan() {
    if (!campaignId || !verdict) return;
    setSavedMsg(null);
    const named = foes.filter((f) => f.name.trim() || f.count > 0);
    const title = named.length
      ? named.map((f) => `${f.count}x ${f.name.trim() || `CR ${f.cr}`}`).join(", ")
      : "Encounter";
    const note = [
      `${method === "2024" ? "2024 XP budget" : "2014 thresholds"}: ${verdict.label}.`,
      method === "2014"
        ? `${rawXp.toLocaleString()} xp x${mult} = ${effectiveXp.toLocaleString()} adjusted.`
        : `${rawXp.toLocaleString()} xp.`,
      `${levelled.length} characters. ${xpPerPlayer.toLocaleString()} xp each.`,
      coverage && coverage.missing.length
        ? `Party has no ${coverage.missing.map((m) => CAP_LABEL[m] ?? m).join(", ")}.`
        : "",
    ].filter(Boolean).join(" ");

    const { error } = await supabase.from("session_plan_items").insert({
      campaign_id: campaignId,
      title: title.slice(0, 180),
      note,
      kind: "encounter",
      difficulty: verdict.label,
      source: "gm",
    });
    setSavedMsg(error ? "Could not save to the plan." : "Added to your session plan.");
  }

  // ---- rendering -----------------------------------------------------------
  const box: React.CSSProperties = {
    background: C.panel, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
    padding: "16px 18px", marginBottom: 14,
  };
  const inputStyle: React.CSSProperties = {
    ...stoneField(), padding: "8px 10px", fontSize: 14,
  };
  const eyebrow: React.CSSProperties = {
    fontFamily: SAX.mono, fontSize: 11, letterSpacing: "0.2em",
    textTransform: "uppercase", color: C.muted, marginBottom: 10,
  };
  const ghostBtn: React.CSSProperties = {
    background: "transparent", border: `1px solid ${C.line}`, color: C.text,
    borderRadius: 8, padding: "8px 12px", fontSize: 13, cursor: "pointer",
  };

  // The campaign's rules module decides whether encounter budgets even apply. For D&D
  // (adversary.hasEncounterMath) the balancer shows as-is; a system without CR/XP budgets, like
  // Call of Cthulhu, says so instead of presenting maths that mean nothing there.
  const adversary = getModule(campaigns.find((c) => c.id === campaignId)?.system).adversary;
  const hasEncounterMath = adversary?.hasEncounterMath ?? false;
  const encMethod = adversary?.encounterMethod ?? "dnd5e";
  const pfLevels = pfoes.flatMap((f) => Array(Math.max(0, f.count)).fill(f.level) as number[]);
  const pfTotal = pf2EncounterXp(pfLevels, pfLevel);
  const pfThreat = pf2Threat(pfTotal, pfSize);
  const pfBudget = pf2Budget(pfSize);
  const dhBase = dhBattlePoints(dhSize);
  const dhBudget = dhAdjustedBudget(dhSize, dhAdj);
  const dhSpent = dhSpend(dhRoster);
  const dhBalance = dhBudget - dhSpent;
  const dhVerdict = dhSpent === 0
    ? { label: "Empty", tone: C.muted }
    : dhBalance > 0 ? { label: `${dhBalance} under`, tone: C.good }
    : dhBalance === 0 ? { label: "On budget", tone: C.brass }
    : { label: `${-dhBalance} over`, tone: C.warn };

  return (
    <PageShell width={980}>
      <div style={{ fontFamily: SAX.serif, fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 4 }}>
        Encounter balancer
      </div>
      <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 660 }}>
        Built against the party actually sitting at your table tonight, not the one the
        module assumed.
      </p>

      {campaignId && !hasEncounterMath && (
        <div style={box}>
          <div style={eyebrow}>Not for this system</div>
          <p style={{ color: C.muted, fontSize: 13, margin: "0 0 12px", lineHeight: 1.6 }}>
            This campaign&apos;s system doesn&apos;t use encounter budgets, so the CR and XP balancer is
            hidden here, its maths wouldn&apos;t mean anything. Switch to a D&amp;D campaign to use it.
          </p>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {hasEncounterMath && encMethod !== "pf2e" && encMethod !== "daggerheart" && (<>
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setFoes((fs) => [...fs, { id: uid(), name: "", cr: "1", count: 1 }])}
            style={{
              background: "transparent", color: C.text, border: `1px solid ${C.line}`,
              borderRadius: FORGE_RADIUS, padding: "7px 14px", fontSize: 12.5, fontWeight: 700,
              fontFamily: SAX.mono, cursor: "pointer",
            }}
          >
            Add monster
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            style={{
              background: pickerOpen ? C.brass : "transparent", color: pickerOpen ? C.ink : C.text,
              border: `1px solid ${pickerOpen ? C.brass : C.line}`,
              borderRadius: FORGE_RADIUS, padding: "7px 14px", fontSize: 12.5, fontWeight: 700,
              fontFamily: SAX.mono, cursor: "pointer",
            }}
          >
            Import from library
          </button>
        </div>

        {pickerOpen && (
          <MonsterPicker
            catalog={monsterCatalog} srdMode={srdMode} onSrdMode={setSrdMode}
            hasOwn={statBlocks.length > 0} onAdd={addFoeFromCatalog}
            C={C} inputStyle={inputStyle}
          />
        )}
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

          {/* The gauge. A "Hard" one xp over the line is a different fight from a
              "Hard" that is nearly Deadly, and a label alone hides that. */}
          <div style={{ margin: "4px 0 14px" }}>
            <div style={{ position: "relative", height: 10, background: "rgba(255,255,255,0.05)", borderRadius: FORGE_RADIUS, overflow: "hidden" }}>
              {(() => {
                const t = budget.tiers as number[];
                const top = t[t.length - 1] * 1.5; // headroom above the top tier
                const pct = (v: number) => Math.min(100, (v / top) * 100);
                return (
                  <>
                    {t.map((v, i) => (
                      <div key={i} style={{
                        position: "absolute", left: `${pct(v)}%`, top: 0, bottom: 0,
                        width: 1, background: C.line,
                      }} />
                    ))}
                    <div style={{
                      position: "absolute", left: 0, top: 0, bottom: 0,
                      width: `${pct(effectiveXp)}%`, background: verdict.tone, opacity: 0.55,
                    }} />
                  </>
                );
              })()}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
              {(budget.tiers as number[]).map((v, i) => (
                <span key={i} style={{ fontFamily: SAX.mono, fontSize: 10, color: C.muted, letterSpacing: "0.06em" }}>
                  {budget.labels[i]} {v.toLocaleString()}
                </span>
              ))}
            </div>
          </div>

          {method === "2014" && (
            <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.6, margin: "0 0 12px" }}>
              {monsterCount} monster{monsterCount === 1 ? "" : "s"} against {levelled.length} character
              {levelled.length === 1 ? "" : "s"} gives a &times;{mult} multiplier.
              {levelled.length > 0 && levelled.length < 3 && " Your party is small, so the multiplier steps up a rung."}
              {levelled.length > 5 && " Your party is large, so the multiplier steps down a rung."}
            </p>
          )}

          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
            <div>
              <div style={{ fontFamily: SAX.mono, fontSize: 10.5, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                XP each
              </div>
              <div style={{ fontFamily: SAX.mono, fontSize: 16, color: C.text, fontWeight: 700 }}>
                {xpPerPlayer.toLocaleString()}
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                raw, not adjusted
              </div>
            </div>
            {dayBudget > 0 && (
              <div>
                <div style={{ fontFamily: SAX.mono, fontSize: 10.5, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Of today
                </div>
                <div style={{
                  fontFamily: SAX.mono, fontSize: 16, fontWeight: 700,
                  color: dayShare > 0.5 ? C.warn : dayShare > 0.3 ? C.brass : C.text,
                }}>
                  {Math.round(dayShare * 100)}%
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                  of a full adventuring day
                </div>
              </div>
            )}
            <div style={{ marginLeft: "auto", alignSelf: "flex-end" }}>
              <button type="button" onClick={saveToPlan} style={{
                background: "transparent", color: C.text, border: `1px solid ${C.line}`,
                borderRadius: FORGE_RADIUS, padding: "7px 14px", fontSize: 12.5, fontWeight: 700,
                fontFamily: SAX.mono, cursor: "pointer",
              }}>
                Add to session plan
              </button>
              {savedMsg && (
                <div style={{ color: savedMsg.startsWith("Could") ? C.warn : C.good, fontSize: 11.5, marginTop: 6, textAlign: "right" }}>
                  {savedMsg}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WHAT THIS PARTY CANNOT DO.
          No other encounter calculator can show you this, because no other calculator
          knows your party. It is not a model and not a guess: it is a join against
          class_capabilities. "This party has no healing" moves a fight's real danger
          further than any multiplier on this page. */}
      {coverage && (coverage.missing.length > 0 || coverage.unknown.length > 0) && effectiveXp > 0 && (
        <div style={{ ...box, borderColor: coverage.missing.length ? C.warn : C.line }}>
          <div style={eyebrow}>What this party cannot do</div>

          {coverage.missing.length > 0 && (
            <>
              <p style={{ color: C.text, fontSize: 14, lineHeight: 1.65, margin: "0 0 8px" }}>
                No <strong style={{ color: C.warn }}>
                  {coverage.missing.map((m) => CAP_LABEL[m] ?? m).join(", ")}
                </strong>.
              </p>
              <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
                The XP tables assume a party that can do all the usual things. They do not
                know that yours cannot.
                {coverage.missing.includes("healing") && " With no healing, a character who drops stays down."}
                {coverage.missing.includes("ranged") && " With no ranged option, a flying or entrenched enemy is far worse than its CR suggests."}
                {coverage.missing.includes("tank") && " With no front line, whatever the monsters want to reach, they will reach."}
                {" "}Treat the verdict above as optimistic.
              </p>
            </>
          )}

          {coverage.unknown.length > 0 && (
            <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.6, margin: coverage.missing.length ? "12px 0 0" : 0 }}>
              {coverage.unknown.join(", ")} {coverage.unknown.length === 1 ? "has" : "have"} no
              recorded class or subclass, so {coverage.unknown.length === 1 ? "its" : "their"} capabilities
              are unknown and not counted here. Set them on the Workspace roster.
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
      </>)}

      {hasEncounterMath && encMethod === "pf2e" && (<>
        <div style={box}>
          <div style={eyebrow}>Party</div>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: C.muted }}>Party level</span>
              <input type="number" value={pfLevel} onChange={(e) => setPfLevel(parseInt(e.target.value, 10) || 1)} style={{ ...inputStyle, maxWidth: 100 }} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: C.muted }}>Party size</span>
              <input type="number" value={pfSize} onChange={(e) => setPfSize(Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ ...inputStyle, maxWidth: 100 }} />
            </label>
          </div>
          {levelled.length > 0 && (
            <p style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>From the present party: {levelled.length} at level {pf2Derived.level}.</p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {PF2_THREATS.map((t) => (
              <div key={t} style={{ flex: 1, minWidth: 88, textAlign: "center", padding: "8px 6px", border: `1px solid ${C.line}`, borderRadius: 8 }}>
                <div style={{ fontSize: 10.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{PF2_THREAT_LABEL[t]}</div>
                <div style={{ fontFamily: SAX.mono, fontSize: 16, color: C.text }}>{pfBudget[t]}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={box}>
          <div style={eyebrow}>The encounter</div>
          {pfoes.length === 0 && <p style={{ color: C.muted, fontSize: 13, margin: "0 0 10px" }}>Add creatures by level to price the fight.</p>}
          {pfoes.map((f) => (
            <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <input value={f.name} placeholder="Creature" onChange={(e) => setPfoes((xs) => xs.map((x) => (x.id === f.id ? { ...x, name: e.target.value } : x)))} style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
              <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, color: C.muted }}>Lvl
                <input type="number" value={f.level} onChange={(e) => setPfoes((xs) => xs.map((x) => (x.id === f.id ? { ...x, level: parseInt(e.target.value, 10) || 0 } : x)))} style={{ ...inputStyle, width: 64 }} />
              </label>
              <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, color: C.muted }}>&times;
                <input type="number" value={f.count} onChange={(e) => setPfoes((xs) => xs.map((x) => (x.id === f.id ? { ...x, count: Math.max(1, parseInt(e.target.value, 10) || 1) } : x)))} style={{ ...inputStyle, width: 56 }} />
              </label>
              <span style={{ fontFamily: SAX.mono, fontSize: 12, color: C.muted, minWidth: 62, textAlign: "right" }}>{pf2EncounterXp(Array(Math.max(0, f.count)).fill(f.level) as number[], pfLevel)} XP</span>
              <button onClick={() => setPfoes((xs) => xs.filter((x) => x.id !== f.id))} style={ghostBtn}>Remove</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => setPfoes((xs) => [...xs, { id: uid(), name: "", level: pfLevel, count: 1 }])} style={ghostBtn}>Add creature</button>
            {statBlocks.filter((r) => r.system === "pf2e" && r.level != null).length > 0 && (
              <select value="" onChange={(e) => { const r = statBlocks.find((x) => x.id === e.target.value); if (r) setPfoes((xs) => [...xs, { id: uid(), name: r.name, level: r.level ?? pfLevel, count: 1 }]); }} style={{ ...inputStyle, maxWidth: 220 }}>
                <option value="">Add from library…</option>
                {statBlocks.filter((r) => r.system === "pf2e" && r.level != null).map((r) => <option key={r.id} value={r.id}>{r.name} (Lvl {r.level})</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total</div>
              <div style={{ fontFamily: SAX.mono, fontSize: 22, color: C.text }}>{pfTotal} XP</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Threat</div>
              <div style={{ fontFamily: SAX.mono, fontSize: 22, fontWeight: 700, color: pfThreat === "extreme" || pfThreat === "severe" ? SAX.warn : (pfThreat === "trivial" || pfThreat === null ? C.muted : SAX.good) }}>
                {pfThreat ? PF2_THREAT_LABEL[pfThreat] : "Below Trivial"}
              </div>
            </div>
          </div>
        </div>
      </>)}

      {hasEncounterMath && encMethod === "daggerheart" && (<>
        <div style={box}>
          <div style={eyebrow}>Party</div>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: C.muted }}>PCs in combat</span>
              <input type="number" value={dhSize} onChange={(e) => setDhSize(Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ ...inputStyle, maxWidth: 100 }} />
            </label>
            <div>
              <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Battle Points</div>
              <div style={{ fontFamily: SAX.mono, fontSize: 22, color: C.text }}>{dhBudget}</div>
              <div style={{ fontSize: 10.5, color: C.muted }}>base {dhBase} = (3 &times; {dhSize}) + 2</div>
            </div>
          </div>
          {levelled.length > 0 && (
            <p style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>From the present party: {levelled.length} in combat.</p>
          )}
          <div style={{ marginTop: 14 }}>
            <div style={{ ...eyebrow, marginBottom: 8 }}>Adjustments</div>
            <div style={{ display: "grid", gap: 6 }}>
              {DH_ADJUSTMENTS.map((a) => {
                const on = dhAdj.includes(a.id);
                return (
                  <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.text, cursor: "pointer" }}>
                    <input type="checkbox" checked={on} onChange={() => setDhAdj((xs) => on ? xs.filter((x) => x !== a.id) : [...xs, a.id])} />
                    <span style={{ flex: 1 }}>{a.label}</span>
                    <span style={{ fontFamily: SAX.mono, fontSize: 11, color: a.delta > 0 ? C.warn : C.muted }}>{a.delta > 0 ? `+${a.delta}` : a.delta}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div style={box}>
          <div style={eyebrow}>The encounter</div>
          {dhRoster.length === 0 && <p style={{ color: C.muted, fontSize: 13, margin: "0 0 10px" }}>Add adversaries by type to spend your Battle Points.</p>}
          {dhRoster.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <select value={r.type} onChange={(e) => setDhRoster((xs) => xs.map((x) => (x.id === r.id ? { ...x, type: e.target.value as DHAdversaryType } : x)))} style={{ ...inputStyle, flex: 1, minWidth: 150 }}>
                {DH_ADVERSARY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12, color: C.muted }}>
                {r.type === "minion" ? "groups" : "\u00D7"}
                <input type="number" value={r.count} onChange={(e) => setDhRoster((xs) => xs.map((x) => (x.id === r.id ? { ...x, count: Math.max(1, parseInt(e.target.value, 10) || 1) } : x)))} style={{ ...inputStyle, width: 64 }} />
              </label>
              <span style={{ fontFamily: SAX.mono, fontSize: 12, color: C.muted, minWidth: 60, textAlign: "right" }}>{DH_BP_COST[r.type] * r.count} pts</span>
              <button onClick={() => setDhRoster((xs) => xs.filter((x) => x.id !== r.id))} style={ghostBtn}>Remove</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => setDhRoster((xs) => [...xs, { id: uid(), type: "standard", count: 1 }])} style={ghostBtn}>Add adversary</button>
            {statBlocks.filter((r) => r.system === "daggerheart").length > 0 && (
              <select value="" onChange={(e) => { const r = statBlocks.find((x) => x.id === e.target.value); if (r) setDhRoster((xs) => [...xs, { id: uid(), type: ((r.type as DHAdversaryType) || "standard"), count: 1 }]); }} style={{ ...inputStyle, maxWidth: 220 }}>
                <option value="">Add from library&hellip;</option>
                {statBlocks.filter((r) => r.system === "daggerheart").map((r) => <option key={r.id} value={r.id}>{r.name}{r.type ? ` (${r.type})` : ""}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Spent</div>
              <div style={{ fontFamily: SAX.mono, fontSize: 22, color: C.text }}>{dhSpent} / {dhBudget}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Balance</div>
              <div style={{ fontFamily: SAX.mono, fontSize: 22, fontWeight: 700, color: dhVerdict.tone }}>{dhVerdict.label}</div>
            </div>
          </div>
          <p style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.6, marginTop: 12 }}>
            Minions cost 1 point per group equal to the party size; Social and Support cost 1; Horde, Ranged, Skulk, and Standard cost 2; Leader 3; Bruiser 4; Solo 5.
          </p>
        </div>
      </>)}
    </PageShell>
  );
}

// The monster import picker: search across the GM's own stat blocks and the SRD library, click to
// add. The GM's creations are grouped first and labelled, since those are the point, this is where
// "import current monsters AND allow the GM to create their own" both land in the same place.
function MonsterPicker({ catalog, srdMode, onSrdMode, hasOwn, onAdd, C, inputStyle }: {
  catalog: MonsterSource[];
  srdMode: SrdMode;
  onSrdMode: (m: SrdMode) => void;
  hasOwn: boolean;
  onAdd: (m: MonsterSource) => void;
  C: Record<string, string>;
  inputStyle: React.CSSProperties;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? catalog.filter((m) => m.name.toLowerCase().includes(s)) : catalog;
    // Keep the GM's own creations at the top, then cap the SRD list so the panel stays usable.
    const mine = base.filter((m) => m.origin === "mine");
    const srd = base.filter((m) => m.origin === "srd").slice(0, s ? 40 : 40);
    return [...mine, ...srd];
  }, [q, catalog]);

  return (
    <div style={{
      marginTop: 12, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: 12,
      background: "rgba(255,255,255,0.02)",
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search monsters…"
          style={{ ...inputStyle, flex: "1 1 200px" }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {(["2024", "2014", "both"] as const).map((m) => (
            <button
              key={m} type="button" onClick={() => onSrdMode(m)}
              style={{
                background: srdMode === m ? C.brass : "transparent", color: srdMode === m ? C.ink : C.muted,
                border: `1px solid ${srdMode === m ? C.brass : C.line}`, borderRadius: 999,
                padding: "5px 11px", fontSize: 11.5, fontFamily: SAX.mono, fontWeight: 700, cursor: "pointer",
              }}
            >
              {m === "both" ? "Both" : m}
            </button>
          ))}
        </div>
      </div>

      {hasOwn && (
        <p style={{ color: C.muted, fontSize: 11.5, margin: "0 0 8px" }}>
          Your own stat blocks are listed first. The rest are SRD monsters for the chosen ruleset.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6, maxHeight: 280, overflowY: "auto" }}>
        {filtered.map((m, i) => (
          <button
            key={`${m.origin}-${m.name}-${i}`} type="button" onClick={() => onAdd(m)}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
              background: "transparent", color: C.text, border: `1px solid ${C.line}`,
              borderRadius: FORGE_RADIUS, padding: "7px 10px", fontSize: 13, cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              {m.origin === "mine" && (
                <span style={{ fontSize: 9, fontFamily: SAX.mono, color: C.brass, border: `1px solid ${C.brass}`, borderRadius: 4, padding: "1px 4px", flexShrink: 0 }}>
                  yours
                </span>
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
            </span>
            <span style={{ fontFamily: SAX.mono, fontSize: 11, color: C.muted, flexShrink: 0 }}>CR {m.cr}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p style={{ color: C.muted, fontSize: 12.5, gridColumn: "1 / -1", margin: 0 }}>No monsters match.</p>
        )}
      </div>
    </div>
  );
}
