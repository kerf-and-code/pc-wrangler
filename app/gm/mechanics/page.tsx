"use client";

// Insight > Mechanics: descriptive statistics over captured table rolls
// (vtt_events) for one session. Reads with the GM's own client; the
// "gm reads vtt events" RLS policy scopes rows to campaigns they run.
//
// Push 44 (audit round 2):
//   T6   The dice tab counts dice that advantage or disadvantage dropped. Roll20 keeps the dropped d20 in
//        `dropped`, not in `dice`, so a fairness read saw only the higher of each pair and read high.
//        (Beyond20 sends each d20 of an advantage roll as its own row, and that tab always counted both.)
//   G12, T9, B14  Roll20 names: every name rolled under in Roll20 this session, where its rolls went
//        (matched by full name, by first name, by your choice, or nowhere), and a picker to send it to a
//        character or mark it as not a player character. Saved through /api/vtt/name-link (p167); later
//        rolls follow the choice and the earlier ones in the campaign move with it.
//   Push 46 (T6): filters for the source, verified rolls only, and rolls matched to a character, so
//        a fairness read can be limited to dice the app rolled or a sheet vouched for.

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";
import { initialCampaignId, useRememberCampaign, initialSessionId, useRememberSession } from "@/lib/campaign-context";
import { fmtDate } from "@/lib/format";
import { SAX } from "@/lib/theme";
import { LoadingState } from "@/components/ui-forge/States";
import CampaignPicker from "@/components/ui-forge/CampaignPicker";
import { matchKind, normName } from "@/lib/vtt/name-route";

type Campaign = { id: string; name: string };
type Session = { id: string; session_number: number | null; created_at: string; scheduled_at: string | null };
type DiceGroup = { faces: number | null; results: number[] };
type Rolls = {
  total?: number | null;
  dice?: DiceGroup[];
  dropped?: { faces: number | null; value: number }[];
  advantage?: number;
  discarded?: boolean;
  critical_success?: boolean | null;
  critical_failure?: boolean | null;
  damage_type?: string | null;
};
type VttEvent = {
  id: string;
  character_id: string | null;
  source: string | null;
  actor_name: string | null;
  event_type: string;
  name: string | null;
  rolls: Rolls | null;
  state: { hp?: number | null; max_hp?: number | null } | null;
  fidelity: string;
  rolled_at: string | null;
  received_at: string;
};

// push 46: what each roll source is called in the filter
const SOURCE_LABEL: Record<string, string> = { beyond20: "D&D Beyond", roll20: "Roll20", foundry: "Foundry", owlbear: "Owlbear", six_axes_tabletop: "Six Axes tabletop", six_axes_roller: "GM roller", spoken: "Said aloud", demo: "Demo" };

const D20_TYPES = new Set(["to-hit", "saving-throw", "skill", "ability", "initiative", "death-save"]);

type CharStats = {
  key: string;
  label: string;
  linked: boolean;
  d20Count: number;
  natSum: number;
  natCount: number;
  nat20s: number;
  nat1s: number;
  advantage: number;
  damage: number;
  hpSeries: { t: number; hp: number }[];
  maxHp: number | null;
};

// EVERY d20 face in the roll, not just the first.
//
// This used to return results[0], which was right while every roll arrived from Beyond20 carrying a
// single d20: one attack, one die. The built-in roller can send twenty in one event, and the old
// version counted that as one roll and put one face into the distribution - so a GM who rolled
// forty d20s saw "2 d20 rolls" and an average taken from two of them.
//
// It also disagreed with the dice tab on the same page, which has always counted every result. Two
// numbers on one screen describing the same rolls and not matching is worse than either being
// wrong on its own.
function allD20(r: Rolls | null): number[] {
  return (r?.dice ?? [])
    .filter((g) => g.faces === 20)
    .flatMap((g) => (g.results ?? []).filter((v): v is number => typeof v === "number"))
    .filter((v) => v >= 1 && v <= 20);
}

function Spark({ series, maxHp }: { series: { t: number; hp: number }[]; maxHp: number | null }) {
  if (series.length < 2) return <span style={{ color: C.muted, fontSize: 12 }}>{series.length === 1 ? `${series[0].hp} hp` : "no data"}</span>;
  const w = 120, h = 26, pad = 2;
  const t0 = series[0].t, t1 = series[series.length - 1].t;
  const top = maxHp ?? Math.max(...series.map((p) => p.hp), 1);
  const x = (t: number) => (t1 === t0 ? pad : pad + ((t - t0) / (t1 - t0)) * (w - pad * 2));
  const y = (hp: number) => h - pad - (Math.max(0, Math.min(hp, top)) / top) * (h - pad * 2);
  const pts = series.map((p) => `${x(p.t).toFixed(1)},${y(p.hp).toFixed(1)}`).join(" ");
  const minHp = Math.min(...series.map((p) => p.hp));
  const last = series[series.length - 1].hp;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg width={w} height={h} style={{ display: "block" }}>
        <polyline points={pts} fill="none" stroke={minHp <= top * 0.25 ? C.warn : C.good} strokeWidth={1.6} />
      </svg>
      <span style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace" }}>
        min {minHp}{maxHp ? `/${maxHp}` : ""} {"\u00b7"} now {last}
      </span>
    </span>
  );
}

export default function MechanicsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  useRememberCampaign(campaignId, campaigns);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  useRememberSession(campaignId, sessionId);
  const [events, setEvents] = useState<VttEvent[]>([]);
  const [charNames, setCharNames] = useState<Record<string, string>>({});
  // push 44: the GM's choices for Roll20 names in this campaign (vtt_name_links, p167), by normName
  const [nameLinks, setNameLinks] = useState<Record<string, string | null>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [linkMsg, setLinkMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name, system").order("created_at", { ascending: true });
      const list = (data as Campaign[]) || [];
      setCampaigns(list);
      if (list.length) setCampaignId(initialCampaignId(list));
      else setLoading(false);
    })();
  }, [supabase]);

  useEffect(() => {
    if (!campaignId) return;
    (async () => {
      setLoading(true);
      const [{ data: sess }, { data: chars }] = await Promise.all([
        supabase.from("sessions").select("id, session_number, created_at, scheduled_at, status").eq("campaign_id", campaignId).order("created_at", { ascending: false }),
        supabase.from("characters").select("id, name").eq("campaign_id", campaignId),
      ]);
      const list = (sess as Session[]) || [];
      setSessions(list);
      const names: Record<string, string> = {};
      ((chars as { id: string; name: string }[]) || []).forEach((c) => { names[c.id] = c.name; });
      setCharNames(names);
      // Not list[0]: newest-created is often the empty future session weekly recurrence adds.
      setSessionId(initialSessionId(campaignId, list));
      if (!list.length) { setEvents([]); setLoading(false); }
    })();
  }, [campaignId, supabase]);

  // push 44: before p167 the table is missing and this reads as no choices
  useEffect(() => {
    if (!campaignId) return;
    let live = true;
    void supabase.from("vtt_name_links").select("name_norm, character_id").eq("campaign_id", campaignId).eq("source", "roll20")
      .then(({ data, error }) => {
        if (!live) return;
        const m: Record<string, string | null> = {};
        if (!error) for (const l of (data ?? []) as { name_norm: string; character_id: string | null }[]) m[l.name_norm] = l.character_id;
        setNameLinks(m);
      });
    return () => { live = false; };
  }, [campaignId, supabase, reloadKey]);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      setLoading(true); setLoadErr(null);
      // Paged: an unbounded select stops at PostgREST's 1000-row cap, so a long session's dice
      // stats were computed from its first 1000 rolls and presented as the whole night. Ordered by
      // rolled_at then id so paging is stable when two rolls share a timestamp.
      const PAGE = 1000;
      const all: VttEvent[] = [];
      for (let page = 0; page < 100; page++) {
        const from = page * PAGE;
        const { data, error } = await supabase
          .from("vtt_events")
          .select("id, character_id, actor_name, event_type, name, rolls, state, fidelity, rolled_at, received_at, source")
          .eq("session_id", sessionId)
          .order("rolled_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) { setLoadErr(`Only ${all.length} rolls loaded (${error.message}). The numbers below cover part of the session.`); break; }
        const rows = (data as VttEvent[]) || [];
        all.push(...rows);
        if (rows.length < PAGE) break;
      }
      setEvents(all);
      setLoading(false);
    })();
  }, [sessionId, supabase, reloadKey]);

  const [tab, setTab] = useState<"table" | "dice">("table");
  // push 46 (audit round 2, T6): which rolls the numbers are drawn from. Every source and every roll
  // used to be pooled, so typed-in totals, a GM's monster rolls and unverified rolls all fed the
  // fairness read and the averages.
  const [srcFilter, setSrcFilter] = useState<string>("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [matchedOnly, setMatchedOnly] = useState(false);
  const sources = useMemo(() => [...new Set(events.map((e) => e.source ?? "unknown"))].sort(), [events]);
  const shown = useMemo(() => events.filter((e) =>
    (srcFilter === "all" || (e.source ?? "unknown") === srcFilter)
    && (!verifiedOnly || e.fidelity === "canonical")
    && (!matchedOnly || !!e.character_id)), [events, srcFilter, verifiedOnly, matchedOnly]);

  const stats = useMemo(() => {
    const per: Record<string, CharStats> = {};
    const dist: number[] = new Array(21).fill(0);
    let d20Total = 0, dmgTotal = 0, canonical = 0;
    const typeCounts: Record<string, number> = {};
    const dmgByType: Record<string, number> = {};

    for (const e of shown) {
      typeCounts[e.event_type] = (typeCounts[e.event_type] || 0) + 1;
      if (e.fidelity === "canonical") canonical += 1;
      const key = e.character_id ?? `${e.source ?? "?"}:${e.actor_name ?? "unknown"}`;
      if (!per[key]) {
        per[key] = {
          key,
          // "(unlinked)" means a Beyond20 roll whose D&D Beyond id has not been matched to a
          // character - a real problem the GM should fix. A monster or a GM roll from the built-in
          // roller has no character BY DESIGN, so labelling it the same way reports a fault that
          // does not exist and buries the row among ones that do.
          label: e.character_id
            ? (charNames[e.character_id] ?? "Character")
            : e.source === "six_axes_roller"
              ? (e.actor_name ?? "The GM")
              : e.source === "roll20" && nameLinks[normName(e.actor_name)] === null
                ? `${e.actor_name ?? "Unknown"} (not a player character)`
                : `${e.actor_name ?? "Unknown"} (unlinked)`,
          linked: Boolean(e.character_id),
          d20Count: 0, natSum: 0, natCount: 0, nat20s: 0, nat1s: 0, advantage: 0, damage: 0,
          hpSeries: [], maxHp: null,
        };
      }
      const s = per[key];
      const t = new Date(e.rolled_at ?? e.received_at).getTime();
      const hp = e.state?.hp;
      if (typeof hp === "number") {
        s.hpSeries.push({ t, hp });
        if (typeof e.state?.max_hp === "number") s.maxHp = e.state.max_hp;
      }
      const r = e.rolls;
      if (D20_TYPES.has(e.event_type) && r && r.discarded !== true) {
        const faces = allD20(r);
        // Count DICE, not events, so the header "d20s" means what it says.
        s.d20Count += faces.length;
        d20Total += faces.length;
        for (const nat of faces) {
          s.natSum += nat; s.natCount += 1; dist[nat] += 1;
          if (nat === 20) s.nat20s += 1;
          if (nat === 1) s.nat1s += 1;
        }
        // The crit flags describe THE roll, not a die, so they only mean anything when the roll had
        // exactly one d20 in it. On a twenty-dice roll there is no single result they could refer
        // to, and honouring them would count one crit for a roll that contained several or none.
        if (faces.length === 1) {
          if (r.critical_success === true && faces[0] !== 20) s.nat20s += 1;
          if (r.critical_failure === true && faces[0] !== 1) s.nat1s += 1;
        }
        // Advantage is a property of the roll either way.
        if ((r.advantage ?? 0) !== 0) s.advantage += 1;
      }
      if (e.event_type === "damage" && r && typeof r.total === "number") {
        s.damage += r.total;
        dmgTotal += r.total;
        const dt = r.damage_type ?? "Untyped";
        dmgByType[dt] = (dmgByType[dt] || 0) + r.total;
      }
    }

    // EVERY die, not just the d20.
    //
    // The page grew up around Beyond20, where a roll is always a character action and the d20 is
    // the one that decides things - so d20 got a distribution and everything else got a tally. A GM
    // roller makes arbitrary rolls first-class: 2d10 for a wild magic table, 4d6 down the line, a
    // d100 for loot. Those had nowhere to be looked at.
    //
    // Recorded per die SIZE rather than per roll, because that is the unit a fairness question is
    // asked about. "Is my d20 cursed" is answerable; "is my 2d6+3 cursed" is not.
    const byDie: Record<number, { n: number; sum: number; faces: Record<number, number> }> = {};
    for (const e of shown) {
      for (const g of e.rolls?.dice ?? []) {
        const faces = Number(g?.faces);
        if (!Number.isFinite(faces) || faces < 2) continue;
        const b = byDie[faces] ?? { n: 0, sum: 0, faces: {} };
        for (const v of g?.results ?? []) {
          if (typeof v !== "number") continue;
          b.n += 1; b.sum += v;
          b.faces[v] = (b.faces[v] || 0) + 1;
        }
        byDie[faces] = b;
      }
      // push 44 (T6): the die advantage or disadvantage dropped was rolled too, and a fairness read
      // needs it (Roll20 keeps it here; Beyond20 sends it as its own row, counted above)
      for (const d of e.rolls?.dropped ?? []) {
        const faces = Number(d?.faces);
        if (!Number.isFinite(faces) || faces < 2 || typeof d?.value !== "number") continue;
        const b = byDie[faces] ?? { n: 0, sum: 0, faces: {} };
        b.n += 1; b.sum += d.value;
        b.faces[d.value] = (b.faces[d.value] || 0) + 1;
        byDie[faces] = b;
      }
    }
    const dieRows = Object.entries(byDie).map(([k, v]) => {
      const sides = Number(k);
      const expected = (sides + 1) / 2;
      const mean = v.n ? v.sum / v.n : 0;
      // Standard error of the mean for a uniform die, so "is this high" has an answer rather than a
      // vibe. sigma^2 of a fair d-sided die is (d^2 - 1) / 12.
      const sigma = Math.sqrt((sides * sides - 1) / 12);
      const se = v.n ? sigma / Math.sqrt(v.n) : 0;
      const z = se ? (mean - expected) / se : 0;
      return { sides, n: v.n, mean, expected, z, faces: v.faces };
    }).sort((a, b) => b.n - a.n);

    const rows = Object.values(per).sort((a, b) => b.d20Count - a.d20Count || b.damage - a.damage);
    const distMax = Math.max(1, ...dist);
    return { rows, dist, distMax, d20Total, dmgTotal, canonical, total: shown.length, typeCounts, dmgByType, dieRows };
  }, [shown, charNames, nameLinks]);

  // push 44: every name rolled under in Roll20 this session, and where its rolls went
  const roll20Names = useMemo(() => {
    const m = new Map<string, { norm: string; shown: string; n: number; chars: Set<string>; unmatched: number }>();
    for (const e of events) {
      if (e.source !== "roll20") continue;
      const norm = normName(e.actor_name);
      if (!norm) continue;
      const row = m.get(norm) ?? { norm, shown: (e.actor_name ?? "").replace(/\s*\(gm\)\s*$/i, "").trim() || norm, n: 0, chars: new Set<string>(), unmatched: 0 };
      row.n += 1;
      if (e.character_id) row.chars.add(e.character_id); else row.unmatched += 1;
      m.set(norm, row);
    }
    return [...m.values()].sort((a, b) => (b.unmatched - a.unmatched) || (b.n - a.n));
  }, [events]);
  const charList = useMemo(() => Object.entries(charNames).sort((a, b) => a[1].localeCompare(b[1])), [charNames]);
  const whereItWent = (r: { norm: string; shown: string; chars: Set<string>; unmatched: number }) => {
    if (r.norm in nameLinks) {
      const to = nameLinks[r.norm];
      return to ? `Your choice: ${charNames[to] ?? "a character"}` : "Your choice: not a player character";
    }
    const names = [...r.chars].map((id) => charNames[id] ?? "a character");
    if (!names.length) return "Not matched to anyone";
    const partial = [...r.chars].some((id) => matchKind(r.shown, charNames[id]) === "partial");
    const to = names.join(", ");
    return `${partial ? "Matched by first name to" : "Matched to"} ${to}${r.unmatched ? ` (${r.unmatched} not matched)` : ""}`;
  };
  const saveLink = async (norm: string, shown: string, clear: boolean) => {
    const choice = pick[norm] ?? "";
    if (!clear && !choice) return;
    setLinkBusy(norm); setLinkMsg(null);
    try {
      const res = await fetch("/api/vtt/name-link", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, actorName: shown, characterId: clear || choice === "__none" ? null : choice, clear }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; moved?: number };
      if (!res.ok) { setLinkMsg({ text: j.error ?? "Could not save that. Try again.", bad: true }); return; }
      setLinkMsg({ text: clear ? `Cleared your choice for ${shown}. Later rolls go by name again.`
        : `Saved. Later Roll20 rolls by ${shown} follow it${j.moved ? `, and ${j.moved} earlier roll${j.moved === 1 ? "" : "s"} moved` : ""}.`, bad: false });
      setPick((p) => { const n = { ...p }; delete n[norm]; return n; });
      setReloadKey((k) => k + 1);
    } catch {
      setLinkMsg({ text: "Network error. Try again.", bad: true });
    } finally {
      setLinkBusy(null);
    }
  };

  const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "16px 18px", marginBottom: 14 } as const;
  const sel = { background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "9px 12px", fontSize: 14 } as const;
  const sessionLabel = (s: Session) =>
    `Session ${s.session_number ?? "?"} ${"\u00b7"} ${fmtDate(s.scheduled_at ?? s.created_at)}`;

  return (
    <PageShell width={900}>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>
        Insight
      </div>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Mechanics</h1>
      <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 18px", maxWidth: 640 }}>
        Descriptive stats from rolls captured at the table: who rolled, how the dice treated them, damage dealt, and hit points over the session. A roll is marked unverified when its sender has not connected Six Axes Capture to their account (they open the player setup link while signed in and press Connect the extension to me), or when Beyond20 sent a formula instead of a result (turn on D&amp;D Beyond digital dice in Beyond20).
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {([["table", "The table"], ["dice", "The dice"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: tab === k ? C.sun : "transparent",
            color: tab === k ? "#241a0d" : C.text,
            border: tab === k ? "none" : `1px solid ${C.line}`,
            borderRadius: FORGE_RADIUS, padding: "8px 16px",
            fontFamily: "ui-monospace, monospace", fontSize: 12,
            letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ ...box, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <CampaignPicker campaigns={campaigns} value={campaignId} onChange={setCampaignId} label={null} selectStyle={sel} />
        <select aria-label="Session" value={sessionId} onChange={(e: any) => setSessionId(e.target.value)} style={sel}>
          {sessions.length === 0 && <option value="">No sessions yet</option>}
          {sessions.map((s) => (<option key={s.id} value={s.id}>{sessionLabel(s)}</option>))}
        </select>
        <select aria-label="Which rolls" value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)} style={sel}>
          <option value="all">Every source</option>
          {sources.map((k) => <option key={k} value={k}>{SOURCE_LABEL[k] ?? k}</option>)}
        </select>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: C.text }}>
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Verified rolls only
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: C.text }}>
          <input type="checkbox" checked={matchedOnly} onChange={(e) => setMatchedOnly(e.target.checked)} /> Characters only
        </label>
      </div>
      {events.length > 0 && shown.length !== events.length && (
        <p role="status" style={{ color: C.muted, fontSize: 12.5, margin: "-6px 0 12px" }}>Showing {shown.length.toLocaleString()} of {events.length.toLocaleString()} rolls.</p>
      )}

      {loadErr && !loading && <p role="alert" style={{ color: C.warn, fontSize: 13, margin: "0 0 12px" }}>{loadErr}</p>}
      {loading ? (
        <LoadingState />
      ) : events.length === 0 ? (
        <div style={{ ...box, color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
          No captured rolls for this session. Send players the player setup link from the Roster; their rolls on D&amp;D Beyond or in Roll20 arrive while a session is open.
        </div>
      ) : tab === "dice" ? (
        <>
          <div style={{ ...box }}>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.16em",
              textTransform: "uppercase", color: C.muted, marginBottom: 8 }}>Every die rolled</div>
            <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 14px" }}>
              One row per die SIZE, because that is the unit a fairness question has an answer for.
              &ldquo;Is my d20 cursed&rdquo; is answerable; &ldquo;is my 2d6+3 cursed&rdquo; is not.
              Every die counts, including the one advantage or disadvantage dropped.
            </p>
            {stats.dieRows.length === 0 ? (
              <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>
                No individual die faces recorded for this session yet.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr style={{ color: C.muted, textAlign: "left" }}>
                    <th style={{ padding: "6px 10px" }}>Die</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>Rolled</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>Average</th>
                    <th style={{ padding: "6px 10px", textAlign: "right" }}>Expected</th>
                    <th style={{ padding: "6px 10px" }}>Reading</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.dieRows.map((d) => {
                    // Two standard errors is the usual "worth a second look" line. Below about 30
                    // rolls the estimate is too noisy to say anything, and saying so is more honest
                    // than printing a z-score that invites over-reading.
                    const thin = d.n < 30;
                    const off = Math.abs(d.z) >= 2;
                    return (
                      <tr key={d.sides} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ padding: "9px 10px", fontWeight: 600 }}>d{d.sides}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.n}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: !thin && off ? C.warn : C.text }}>
                          {d.mean.toFixed(2)}
                        </td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.muted }}>{d.expected.toFixed(2)}</td>
                        <td style={{ padding: "9px 10px", color: C.muted, fontSize: 12.5 }}>
                          {thin
                            ? "too few rolls to say"
                            : off
                              ? `running ${d.mean > d.expected ? "high" : "low"}, ${Math.abs(d.z).toFixed(1)} standard errors out`
                              : "nothing unusual"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p style={{ color: C.muted, fontSize: 12.5, lineHeight: 1.6, margin: "14px 0 0" }}>
              Expected is the mean of a fair die, (sides + 1) / 2. The reading compares the observed
              average against that, in standard errors. Over a campaign one die in twenty will drift
              two errors out by chance alone, so treat a single flagged row as interesting rather
              than as evidence.
            </p>
          </div>

          {stats.dieRows.filter((d) => d.n >= 20).map((d) => {
            const maxCount = Math.max(1, ...Object.values(d.faces));
            return (
              <div key={d.sides} style={box}>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.16em",
                  textTransform: "uppercase", color: C.muted, marginBottom: 10 }}>
                  d{d.sides} faces {"\u00b7"} {d.n} rolls
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 90 }}>
                  {Array.from({ length: d.sides }, (_, i) => i + 1).map((face) => {
                    const n = d.faces[face] || 0;
                    return (
                      <div key={face} style={{ flex: 1, textAlign: "center" }} title={`${face}: ${n}`}>
                        <div style={{
                          height: Math.round((n / maxCount) * 70), background: C.plum,
                          borderRadius: "2px 2px 0 0", minHeight: n ? 2 : 0,
                        }} />
                        {d.sides <= 20 && (
                          <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{face}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
            {[
              { label: "events captured", value: String(stats.total) },
              { label: "d20 rolls", value: String(stats.d20Total) },
              { label: "nat 20s / nat 1s", value: `${stats.rows.reduce((a, r) => a + r.nat20s, 0)} / ${stats.rows.reduce((a, r) => a + r.nat1s, 0)}` },
              { label: "damage dealt", value: String(stats.dmgTotal) },
              { label: "verified numbers", value: `${stats.total ? Math.round((stats.canonical / stats.total) * 100) : 0}%` },
            ].map((k) => (
              <div key={k.label} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "14px 16px" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: C.sun }}>{k.value}</div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>{k.label}</div>
              </div>
            ))}
          </div>

          <div style={box}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>d20 distribution</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56 }}>
              {stats.dist.slice(1).map((n, i) => (
                <div key={i} title={`${i + 1}: ${n}`} style={{ flex: 1, minWidth: 6, height: `${(n / stats.distMax) * 100}%`, minHeight: n > 0 ? 4 : 1, background: i + 1 === 20 ? C.good : i + 1 === 1 ? C.warn : C.plum, borderRadius: 3, opacity: n > 0 ? 1 : 0.25 }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.muted, fontFamily: "ui-monospace, monospace", marginTop: 4 }}>
              <span>1</span><span>10</span><span>20</span>
            </div>
          </div>

          <div style={{ ...box, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: C.muted, fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {["character", "d20s", "avg d20", "nat 20", "nat 1", "adv", "damage", "hit points"].map((h) => {
                    const numeric = h !== "character" && h !== "hit points";
                    return (
                      <th key={h} style={{ textAlign: numeric ? "right" : "left", padding: "6px 10px", borderBottom: `1px solid ${C.line}` }}>{h}</th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ padding: "9px 10px", fontWeight: 600, color: r.linked ? C.text : C.muted }}>{r.label}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.d20Count}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.natCount ? (r.natSum / r.natCount).toFixed(1) : "-"}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.nat20s ? C.good : C.muted }}>{r.nat20s}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.nat1s ? C.warn : C.muted }}>{r.nat1s}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.advantage}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.damage}</td>
                    <td style={{ padding: "9px 10px" }}><Spark series={r.hpSeries} maxHp={r.maxHp} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {Object.keys(stats.dmgByType).length > 0 && (
            <div style={box}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Damage by type</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(stats.dmgByType).sort((a, b) => b[1] - a[1]).map(([t, v]) => (
                  <span key={t} style={{ fontSize: 13, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 12px" }}>
                    {t}: <b style={{ color: C.sun }}>{v}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          {roll20Names.length > 0 && (
            <div style={box}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Roll20 names</div>
              <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.55, margin: "0 0 10px" }}>
                Roll20 rolls go to the character with the same name, or the same first name when only one character has it.
                Change where a name goes here; later rolls follow your choice, and earlier ones in this campaign move with it.
                Mark a monster or an NPC as not a player character so its rolls never land on one.
              </p>
              {linkMsg && <p role={linkMsg.bad ? "alert" : "status"} style={{ fontSize: 13, color: linkMsg.bad ? C.warn : C.good, margin: "0 0 10px" }}>{linkMsg.text}</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {roll20Names.map((r) => {
                  const chosen = r.norm in nameLinks;
                  const value = pick[r.norm] ?? "";
                  return (
                    <div key={r.norm} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
                      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{r.shown} <span style={{ color: C.muted, fontWeight: 400, fontSize: 12.5 }}>{r.n} roll{r.n === 1 ? "" : "s"}</span></div>
                        <div style={{ fontSize: 12.5, color: r.unmatched && !chosen ? C.warn : C.muted }}>{whereItWent(r)}</div>
                      </div>
                      <select aria-label={`Where ${r.shown}'s Roll20 rolls go`} value={value} onChange={(e) => setPick((p) => ({ ...p, [r.norm]: e.target.value }))} style={{ ...sel, padding: "6px 9px", fontSize: 13 }}>
                        <option value="">Send to…</option>
                        {charList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                        <option value="__none">Not a player character</option>
                      </select>
                      <button type="button" disabled={!value || linkBusy === r.norm} title={!value ? "Pick where this name goes first" : undefined} onClick={() => void saveLink(r.norm, r.shown, false)}
                        style={{ background: C.sun, color: "#241a0d", border: "none", borderRadius: FORGE_RADIUS, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: value ? "pointer" : "default", opacity: value ? 1 : 0.6 }}>
                        {linkBusy === r.norm ? "Saving…" : "Save"}
                      </button>
                      {chosen && (
                        <button type="button" disabled={linkBusy === r.norm} onClick={() => void saveLink(r.norm, r.shown, true)}
                          style={{ background: "transparent", color: C.muted, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}>
                          Clear my choice
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
