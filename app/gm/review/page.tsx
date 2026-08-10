"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import { useMomentPlayer, MomentButton } from "@/components/moment-player";
import { surfaces, ui, AXES, type AxisKey } from "@/lib/theme";
import { C, FORGE_RADIUS } from "@/lib/forge-theme";

type Campaign = { id: string; name: string };
type JobRow = { id: string; status: string; extract_cursor: number; session_id: string; session: { session_number: number | null } | null };
type Prop = {
  id: string; event_type: string; axis: string | null; frame: string | null; target: string | null;
  confidence: number | null; rationale: string | null; status: string;
  character: { name: string } | null;
  segment: { text: string; start_ms: number | null } | null;
};
type GmProp = {
  id: string; kind: string; summary: string; detail: string | null; quote: string | null;
  npc_name: string | null; location_name: string | null; faction_name: string | null; target_character_id: string | null;
  confidence: number | null; t_start_seconds: number | null; status: string;
  audio_track_id: string | null;
};
type GmKind = { kind: string; category: string; label: string; sort: number };

const fmtTime = (ms: number | null): string => {
  if (ms === null || ms === undefined) return "";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function ReviewPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [props, setProps] = useState<Prop[]>([]);
  const [counts, setCounts] = useState<{ accepted: number; rejected: number }>({ accepted: 0, rejected: 0 });
  const [running, setRunning] = useState<boolean>(false);
  const [createSel, setCreateSel] = useState<Record<string, Record<string, boolean>>>({});
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [gmProposed, setGmProposed] = useState<number | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // GM narration tab
  const [tab, setTab] = useState<"player" | "gm">("player");
  const [gmProps, setGmProps] = useState<GmProp[]>([]);
  const [gmKinds, setGmKinds] = useState<GmKind[]>([]);
  const [gmCounts, setGmCounts] = useState<{ approved: number; rejected: number }>({ approved: 0, rejected: 0 });
  const [showMeta, setShowMeta] = useState<boolean>(false);
  const [edits, setEdits] = useState<Record<string, { summary?: string; kind?: string }>>({});
  const [threshold, setThreshold] = useState<number>(80);
  // Category grouping for the GM queue: which category groups are expanded, and whether a
  // bulk accept should also create+link the entities a beat identifies (NPC, place, etc).
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [bulkCreates, setBulkCreates] = useState<boolean>(true);
  const [recapMsg, setRecapMsg] = useState<string | null>(null);
  // Undecided proposals left on this job, as counted by the server (not by the
  // filtered lists on this page). null means not yet known.
  const [remaining, setRemaining] = useState<number | null>(null);
  const gmPlayer = useMomentPlayer();
  const autoStarted = useRef<Set<string>>(new Set());

  const job = jobs.find((j) => j.id === jobId) || null;

  useEffect(() => {
    (async () => {
      const [{ data: camps }, { data: ets }, { data: gks }] = await Promise.all([
        supabase.from("campaigns").select("id, name").order("created_at", { ascending: true }),
        supabase.from("event_types").select("key, label"),
        supabase.from("gm_event_kinds").select("kind, category, label, sort").order("sort", { ascending: true }),
      ]);
      const list = (camps as Campaign[]) || [];
      setCampaigns(list);
      const lab: Record<string, string> = {};
      ((ets as { key: string; label: string }[]) || []).forEach((e) => { lab[e.key] = e.label; });
      setLabels(lab);
      setGmKinds((gks as GmKind[]) || []);
      if (list.length) setCampaignId(list[0].id);
    })();
  }, [supabase]);

  async function loadJobs(cid: string) {
    const { data } = await supabase
      .from("capture_jobs")
      .select("id, status, extract_cursor, session_id, session:sessions(session_number)")
      .eq("campaign_id", cid)
      .in("status", ["extracting", "review", "done"])
      .order("created_at", { ascending: false });
    const list = (data as unknown as JobRow[]) || [];
    setJobs(list);
    setJobId(list.length ? list[0].id : "");
  }

  useEffect(() => { if (campaignId) loadJobs(campaignId); }, [campaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  // PAGED. PostgREST caps an unbounded select at db-max-rows, 1000 here, so a job with
  // more than 1000 proposals would render a queue that silently omits the rest.
  //
  // That is worse than a display bug. /api/review/finalize only fires when zero rows remain
  // at status 'proposed', counted in the DATABASE. If the page cannot show a proposal, the
  // GM cannot decide it, the count never reaches zero, and the job sits in review forever
  // with no recap and no way forward from the UI.
  //
  // confidence is not unique, so the id tiebreak is what stops rows shuffling between pages
  // and being skipped or shown twice.
  async function loadProps(jid: string) {
    const PAGE = 1000;
    const all: Prop[] = [];
    for (let page = 0; page < 50; page++) {
      const from = page * PAGE;
      const { data, error } = await supabase
        .from("proposed_events")
        .select("id, event_type, axis, frame, target, confidence, rationale, status, character:characters(name), segment:transcript_segments(text, start_ms)")
        .eq("job_id", jid)
        .order("confidence", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) break;
      const rows = (data as unknown as Prop[]) || [];
      all.push(...rows);
      if (rows.length < PAGE) break;
    }
    setProps(all.filter((p) => p.status === "proposed"));
    setCounts({
      accepted: all.filter((p) => p.status === "accepted").length,
      rejected: all.filter((p) => p.status === "rejected").length,
    });
  }

  // Paged for the same reason as loadProps above: an undecidable proposal the page cannot
  // render still counts against finalize.
  async function loadGmProps(jid: string) {
    const PAGE = 1000;
    const all: GmProp[] = [];
    for (let page = 0; page < 50; page++) {
      const from = page * PAGE;
      const { data, error } = await supabase
        .from("gm_proposed_events")
        .select("id, kind, summary, detail, quote, npc_name, location_name, faction_name, target_character_id, confidence, t_start_seconds, status, audio_track_id")
        .eq("job_id", jid)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) break;
      const rows = (data as GmProp[]) || [];
      all.push(...rows);
      if (rows.length < PAGE) break;
    }
    setGmProps(all.filter((p) => p.status === "proposed"));
    setGmCounts({
      approved: all.filter((p) => p.status === "approved").length,
      rejected: all.filter((p) => p.status === "rejected").length,
    });
  }

  useEffect(() => {
    if (jobId) {
      loadProps(jobId);
      loadGmProps(jobId);
      // Seed the server-side undecided count on load. This does two things: it
      // populates the escape-hatch button for a GM who arrives at a part-reviewed
      // job, and it finalizes a job whose last proposal was decided in a previous
      // visit (for example if the tab was closed mid-review before the auto-call
      // could land). Safe to call: it is idempotent and no-ops unless complete.
      finalize(false);
    } else {
      setProps([]); setGmProps([]);
      setCounts({ accepted: 0, rejected: 0 }); setGmCounts({ approved: 0, rejected: 0 });
      setRemaining(null);
    }
    setEdits({});
    setRecapMsg(null);
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kick extraction off automatically the first time a job is opened while it is
  // still extracting, so there's no button to hunt for and events just start
  // appearing. Guarded per job id so a failed run doesn't retry-storm; the Retry
  // control covers the error case.
  useEffect(() => {
    if (jobId && job?.status === "extracting" && !running && !autoStarted.current.has(jobId)) {
      autoStarted.current.add(jobId);
      runExtraction();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, job?.status, running]);

  async function runExtraction() {
    if (!jobId) return;
    setRunning(true); setError(null); setProgress(null); setGmProposed(null);
    // Player extractor first, then the GM extractor. The job flips to "review"
    // only once both have finished their portion (the routes coordinate that).
    let done = false;
    while (!done) {
      const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setError(out.error || "Extraction failed."); setRunning(false); return; }
      setProgress({ processed: out.processed, total: out.total });
      done = Boolean(out.done);
    }
    let gmDone = false;
    let gmCount = 0;
    while (!gmDone) {
      const res = await fetch("/api/extract-gm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setError(out.error || "GM extraction failed."); break; }
      if (Number(out.total) > 0) setProgress({ processed: out.processed, total: out.total });
      gmCount += Number(out.proposed || 0);
      gmDone = Boolean(out.done);
    }
    setGmProposed(gmCount);
    setRunning(false);
    await loadProps(jobId);
    await loadGmProps(jobId);
    await loadJobs(campaignId);
  }

  async function review(id: string, accept: boolean) {
    setBusy(true);
    const { error: e } = await supabase.rpc("review_proposed_event", { p_id: id, p_accept: accept });
    if (e) setError(e.message);
    else {
      setProps((prev) => prev.filter((p) => p.id !== id));
      setCounts((c) => ({ accepted: c.accepted + (accept ? 1 : 0), rejected: c.rejected + (accept ? 0 : 1) }));
      await finalize(false);
    }
    setBusy(false);
  }

  async function acceptAbove() {
    setBusy(true); setError(null);
    const targets = props.filter((p) => Math.round((p.confidence || 0) * 100) >= threshold);
    for (const p of targets) {
      const { error: e } = await supabase.rpc("review_proposed_event", { p_id: p.id, p_accept: true });
      if (e) { setError(e.message); break; }
    }
    setBusy(false);
    await loadProps(jobId);
    await finalize(false);
  }


  // Approve one GM beat via the same route reviewGm uses, honouring per-beat summary/kind
  // edits. When createEntities is true, the beat's identified entities (NPC, place, faction,
  // item, lore) are created and linked; the route dedupes by name, so re-accepting an
  // existing entity just links it rather than duplicating. Returns the error text or null.
  async function approveBeat(p: GmProp, createEntities: boolean): Promise<string | null> {
    const e = edits[p.id];
    const payload: Record<string, unknown> = {
      action: "approve", id: p.id, summary: e?.summary ?? p.summary, kind: e?.kind ?? p.kind,
    };
    if (createEntities) {
      if (p.npc_name) { payload.createNpc = true; payload.npcName = p.npc_name; }
      if (p.location_name) { payload.createLocation = true; payload.locationName = p.location_name; }
      if (p.faction_name) { payload.createFaction = true; payload.factionName = p.faction_name; }
      if ((e?.kind ?? p.kind) === "item_introduced") payload.createItem = true;
      if ((e?.kind ?? p.kind) === "lore") payload.createLore = true;
    }
    const res = await fetch("/api/gm-review", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!res.ok) { const out = await res.json().catch(() => ({})); return out.error || "Bulk approve failed."; }
    return null;
  }

  // Accept a set of GM beats in sequence, then reload + finalize once. Used by both the
  // top-level "Accept all" and the per-category accept buttons. createEntities follows the
  // toggle. Stops on the first error so a failure is visible rather than silent.
  async function acceptGmSet(targets: GmProp[], createEntities: boolean) {
    if (targets.length === 0) return;
    setBusy(true); setError(null);
    let approved = 0;
    for (const p of targets) {
      const err = await approveBeat(p, createEntities);
      if (err) { setError(err); break; }
      approved += 1;
    }
    if (approved > 0) {
      setGmProps((prev) => prev.filter((x) => !targets.slice(0, approved).some((t) => t.id === x.id)));
      setGmCounts((c) => ({ ...c, approved: c.approved + approved }));
    }
    setBusy(false);
    await loadGmProps(jobId);
    await finalize(false);
  }

  // Finalize the review job. Server-side, in /api/review/finalize:
  // the job flips to done, the recap auto-drafts, and the disposition fit kicks.
  //
  // Called speculatively after EVERY decision (see review, reviewGm, acceptAbove,
  // acceptGmSet). It no-ops until the last proposal is decided, so the normal
  // path finalizes itself with zero extra clicks.
  //
  // The route counts undecided rows in the DATABASE across both proposed_events
  // and gm_proposed_events. It never trusts this page's filtered lists, because a
  // queue can render empty mid-review.
  //
  // force=true is the escape hatch for a GM who deliberately leaves rows undecided.
  // The undecided rows, read straight from the database rather than from what the page managed to
  // render. That distinction is the point: a proposal the renderer cannot show still counts against
  // finalization, so a GM looking at an empty-looking queue has no way to know what is holding the
  // recap. Reading the tables directly means Show cannot lie by omission.
  const [showUndecided, setShowUndecided] = useState(false);
  const [undecided, setUndecided] = useState<
    { id: string; table: "player" | "gm"; label: string }[] | null>(null);

  async function loadUndecided(jobId: string) {
    const [pe, ge] = await Promise.all([
      supabase.from("proposed_events")
        .select("id, event_type, axis, frame, rationale").eq("job_id", jobId).eq("status", "proposed"),
      supabase.from("gm_proposed_events")
        .select("id, kind, summary, npc_name, location_name").eq("job_id", jobId).eq("status", "proposed"),
    ]);
    const rows: { id: string; table: "player" | "gm"; label: string }[] = [];
    for (const r of ((pe.data as Record<string, unknown>[]) || [])) {
      rows.push({
        id: String(r.id), table: "player",
        label: [r.event_type, r.axis, r.frame].filter(Boolean).join(" \u00b7 ")
          || String(r.rationale || "an unlabelled proposal"),
      });
    }
    for (const r of ((ge.data as Record<string, unknown>[]) || [])) {
      rows.push({
        id: String(r.id), table: "gm",
        label: String(r.summary || r.npc_name || r.location_name || r.kind || "an unlabelled proposal"),
      });
    }
    setUndecided(rows);
  }

  async function finalize(force: boolean) {
    if (!job) return;
    if (force) { setBusy(true); setRecapMsg(null); }
    try {
      const res = await fetch("/api/review/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, force }),
      });
      const out = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (force) setError(out.error || "Could not finish the review.");
        return;
      }

      // Not finalized yet: proposals remain. Track how many, so the escape-hatch
      // button can show an honest count.
      if (out.finalized !== true) {
        setRemaining(typeof out.remaining === "number" ? out.remaining : null);
        return;
      }

      setRemaining(0);

      let note = out.recapSkipped
        ? "A recap draft already exists for this session."
        : out.recapDrafted
          ? "Review complete. Recap drafted, edit and send it from the Session Log."
          : "Review complete. The recap draft did not generate; you can create it on the Session Log.";
      if (out.dispositionsRunning) note = `${note} Dispositions are refreshing.`;
      setRecapMsg(note);

      loadJobs(campaignId);
    } catch {
      if (force) setError("Could not finish the review.");
    } finally {
      if (force) setBusy(false);
    }
  }

  const setEdit = (id: string, patch: { summary?: string; kind?: string }) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  async function reviewGm(p: GmProp, action: "approve" | "reject", creates?: Record<string, boolean>) {
    setBusy(true); setError(null);
    const e = edits[p.id];
    const payload: Record<string, unknown> = { action, id: p.id };
    if (action === "approve") {
      payload.summary = e?.summary ?? p.summary;
      payload.kind = e?.kind ?? p.kind;
      const c = creates || {};
      if (c.npc && p.npc_name) { payload.createNpc = true; payload.npcName = p.npc_name; }
      if (c.location && p.location_name) { payload.createLocation = true; payload.locationName = p.location_name; }
      if (c.faction && p.faction_name) { payload.createFaction = true; payload.factionName = p.faction_name; }
      if (c.item) payload.createItem = true;
      if (c.lore) payload.createLore = true;
    }
    const res = await fetch("/api/gm-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) setError(out.error || "Could not update the event.");
    else {
      setGmProps((prev) => prev.filter((x) => x.id !== p.id));
      setGmCounts((c) => ({ approved: c.approved + (action === "approve" ? 1 : 0), rejected: c.rejected + (action === "reject" ? 1 : 0) }));
      await finalize(false);
    }
    setBusy(false);
  }

  // Which createable entities a beat identifies, and per-beat selection (default all on).
  function availEntities(p: GmProp): { k: string; label: string }[] {
    const a: { k: string; label: string }[] = [];
    if (p.npc_name) a.push({ k: "npc", label: `NPC: ${p.npc_name}` });
    if (p.location_name) a.push({ k: "location", label: `Place: ${p.location_name}` });
    if (p.faction_name) a.push({ k: "faction", label: `Faction: ${p.faction_name}` });
    if (p.kind === "item_introduced") a.push({ k: "item", label: "Item" });
    if (p.kind === "lore") a.push({ k: "lore", label: "Lore" });
    return a;
  }
  const isSel = (p: GmProp, k: string) => createSel[p.id]?.[k] !== false;
  const toggleSel = (p: GmProp, k: string) =>
    setCreateSel((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] || {}), [k]: !(prev[p.id]?.[k] !== false) } }));
  const selObj = (p: GmProp): Record<string, boolean> => {
    const o: Record<string, boolean> = {};
    for (const { k } of availEntities(p)) o[k] = isSel(p, k);
    return o;
  };

  const gmView = gmProps.filter((p) => showMeta || p.kind !== "meta");
  const playerEligible = props.filter((p) => Math.round((p.confidence || 0) * 100) >= threshold).length;

  // Group the GM queue by the category each kind belongs to (from gm_event_kinds). This
  // lets the GM scan and clear a whole category at once, or expand one to review row by row.
  const catOf = (kind: string): string => gmKinds.find((k) => k.kind === kind)?.category || "other";
  const catSort = (cat: string): number => {
    const ks = gmKinds.filter((k) => k.category === cat);
    return ks.length ? Math.min(...ks.map((k) => k.sort)) : 999;
  };
  const gmGroups: { category: string; rows: GmProp[] }[] = (() => {
    const by: Record<string, GmProp[]> = {};
    for (const p of gmView) { const c = catOf(p.kind); (by[c] ||= []).push(p); }
    return Object.entries(by)
      .map(([category, rows]) => ({ category, rows }))
      .sort((a, b) => catSort(a.category) - catSort(b.category));
  })();
  const catLabel = (cat: string): string => cat.charAt(0).toUpperCase() + cat.slice(1);
  const threshLabel = threshold === 0 ? "all" : `\u2265 ${threshold}%`;

  const box = { ...surfaces.slate, padding: 20, marginBottom: 18 } as const;
  const btn = (bg: string, fg: string) => ({ background: bg, color: fg, border: "none", borderRadius: FORGE_RADIUS, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" } as const);
  const tabBtn = (on: boolean) => ({ background: on ? C.plum : "transparent", color: on ? C.ink : C.muted, border: `1px solid ${on ? C.plum : C.line}`, borderRadius: FORGE_RADIUS, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" } as const);
  const thresholdSelect = (
    <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}
      style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "8px 10px", fontSize: 12.5, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
      <option value={90}>{"\u2265 90%"}</option>
      <option value={80}>{"\u2265 80%"}</option>
      <option value={70}>{"\u2265 70%"}</option>
      <option value={0}>All</option>
    </select>
  );

  return (
    <PageShell width={900}>
      <h1 style={{ ...ui.h1, fontSize: 28, margin: "4px 0 4px" }}>Review</h1>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 20px" }}>
        Claude reads the transcript and proposes events. Nothing counts until you accept it into the spine.
      </p>

        <div style={box}>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAMPAIGN</label>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, marginBottom: 14, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "10px 12px", fontSize: 15, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>CAPTURE JOB</label>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "10px 12px", fontSize: 15, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
            {jobs.length === 0 && <option value="">No transcribed jobs yet</option>}
            {jobs.map((j) => (<option key={j.id} value={j.id}>Session {j.session?.session_number ?? "?"} ({j.status})</option>))}
          </select>
        </div>

        {job && (
          <>
            {/* job-level: extraction + status, shared by both tabs */}
            <div style={box}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, color: C.muted }}>
                  Session {job.session?.session_number ?? "?"} · <span style={{ fontFamily: "ui-monospace, monospace" }}>{job.status}</span>
                </div>
                {job.status === "extracting" && (
                  !running && error ? (
                    <button type="button" onClick={runExtraction} style={btn(C.plum, C.ink)}>Retry extraction</button>
                  ) : (
                    <span style={{ fontSize: 13, color: C.plum, fontWeight: 700 }}>Extracting…</span>
                  )
                )}
              </div>
              {running && progress && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ height: 6, background: C.surface2, borderRadius: FORGE_RADIUS, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}%`, background: C.plum, transition: "width .3s" }} />
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{progress.processed} / {progress.total} transcript lines</div>
                </div>
              )}
              {error && <p style={{ color: C.warn, fontSize: 13, marginTop: 12 }}>{error}</p>}
              {gmProposed !== null && (
                <p style={{ color: C.muted, fontSize: 12.5, marginTop: 10 }}>
                  {gmProposed} GM narration event{gmProposed === 1 ? "" : "s"} captured. Review them in the GM narration tab.
                </p>
              )}
              {recapMsg && <p style={{ color: C.good, fontSize: 12.5, marginTop: 10 }}>{recapMsg}</p>}
            </div>

            {/* tab switcher */}
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              <button type="button" onClick={() => setTab("player")} style={tabBtn(tab === "player")}>Player events ({props.length})</button>
              <button type="button" onClick={() => setTab("gm")} style={tabBtn(tab === "gm")}>GM narration ({gmView.length})</button>
            </div>

            {tab === "player" ? (
              <>
                <div style={box}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 14, color: C.muted }}>
                      <span style={{ color: C.good, fontWeight: 700 }}>{counts.accepted}</span> accepted ·{" "}
                      <span style={{ color: C.warn, fontWeight: 700 }}>{counts.rejected}</span> rejected ·{" "}
                      <span style={{ color: C.sun, fontWeight: 700 }}>{props.length}</span> awaiting review
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {props.length > 0 && (
                        <>
                          {thresholdSelect}
                          <button type="button" onClick={acceptAbove} disabled={busy || playerEligible === 0}
                            style={{ ...btn(C.good, C.ink), opacity: busy || playerEligible === 0 ? 0.55 : 1, cursor: busy || playerEligible === 0 ? "default" : "pointer" }}>
                            Accept {playerEligible} {threshLabel}
                          </button>
                        </>
                      )}
                      {job.status === "review" && remaining !== null && remaining > 0 && (
                        <button type="button"
                          onClick={() => { setShowUndecided(true); void loadUndecided(job.id); }}
                          style={btn(C.sun, C.ink)}>
                          Show {remaining} undecided
                        </button>
                      )}
                    </div>
                  </div>
                </div>


                {/* THE RECAP IS BEING WITHHELD AND NOTHING SAID SO. Three CandleKeep sessions sat
                    at review on one, three and seven undecided rows - a GM who has worked through
                    the queue sees it looking finished and has no reason to think anything is
                    outstanding. The escape hatch existed but it is a lever for someone who already
                    knows; this is the part that tells them. */}
                {job.status === "review" && remaining !== null && remaining > 0 && (
                  <div style={{
                    background: "rgba(200,162,75,0.10)", border: `1px solid ${C.sun}`,
                    borderRadius: FORGE_RADIUS, padding: "12px 14px", marginBottom: 14,
                  }}>
                    <div style={{ fontSize: 14, color: C.text, marginBottom: 4 }}>
                      {remaining === 1
                        ? "One proposal is still undecided, so this session has no recap yet."
                        : `${remaining} proposals are still undecided, so this session has no recap yet.`}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55 }}>
                      The recap writes itself once every proposal has been accepted or rejected.
                      Decide the rest, or finish anyway and leave them undecided.
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      <button type="button"
                        onClick={() => { setShowUndecided((v) => !v); if (!undecided) void loadUndecided(job.id); }}
                        style={btn(C.sun, C.ink)}>
                        {showUndecided ? "Hide" : "Show"} {remaining} undecided
                      </button>
                      <button type="button" onClick={() => finalize(true)} disabled={busy}
                        style={{ background: "transparent", color: C.muted,
                          border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS,
                          padding: "9px 16px", fontWeight: 700, fontSize: 13,
                          cursor: busy ? "default" : "pointer", opacity: busy ? 0.55 : 1 }}>
                        Finish anyway
                      </button>
                    </div>

                    {showUndecided && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
                        {undecided === null ? (
                          <span style={{ fontSize: 12.5, color: C.muted }}>Loading&hellip;</span>
                        ) : undecided.length === 0 ? (
                          // The count and the rows disagree, which is worth saying rather than
                          // rendering an empty box: it means something was decided elsewhere since
                          // the count was taken, and a reload will clear it.
                          <span style={{ fontSize: 12.5, color: C.muted }}>
                            Nothing outstanding now. Reload to refresh the count.
                          </span>
                        ) : (
                          undecided.map((u) => (
                            <div key={u.id} style={{
                              display: "flex", gap: 10, alignItems: "baseline",
                              padding: "5px 0", fontSize: 13, color: C.text,
                            }}>
                              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: C.muted,
                                minWidth: 44 }}>
                                {u.table === "gm" ? "story" : "player"}
                              </span>
                              <span style={{ minWidth: 0 }}>{u.label}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {props.length === 0 ? (
                  <div style={{ ...box, color: C.muted, fontSize: 14 }}>
                    {job.status === "extracting" ? "Extracting… proposed events will appear here as they're found." : "Nothing left to review for this job."}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {props.map((p) => {
                      const ax = p.axis ? AXES[p.axis as AxisKey] : null;
                      const conf = p.confidence !== null ? Math.round((p.confidence || 0) * 100) : null;
                      return (
                        <div key={p.id} style={box}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 15, fontWeight: 700 }}>{p.character?.name || "GM / Narrator"}</span>
                              <span style={{ fontSize: 13, color: C.muted }}>{labels[p.event_type] || p.event_type}</span>
                              {ax && <span style={{ fontSize: 11, fontWeight: 700, color: C.ink, background: ax.color, padding: "2px 8px", borderRadius: 999 }}>{ax.tavernName}</span>}
                              {p.frame && <span style={{ fontSize: 11, color: C.muted, fontFamily: "ui-monospace, monospace" }}>{p.frame}</span>}
                            </div>
                            {conf !== null && <span style={{ fontSize: 13, fontWeight: 700, color: conf >= 70 ? C.good : conf >= 40 ? C.sun : C.warn }}>{conf}%</span>}
                          </div>

                          {p.segment?.text && (
                            <div style={{ marginTop: 10, padding: "10px 12px", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, fontSize: 13, color: C.text, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
                              <span style={{ color: C.muted, fontFamily: "ui-monospace, monospace", fontSize: 11, marginRight: 8 }}>{fmtTime(p.segment.start_ms)}</span>
                              {"\u201c"}{p.segment.text}{"\u201d"}
                            </div>
                          )}
                          {p.rationale && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8, fontStyle: "italic" }}>{p.rationale}</div>}

                          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                            <button type="button" onClick={() => review(p.id, true)} disabled={busy} style={btn(C.good, C.ink)}>Accept</button>
                            <button type="button" onClick={() => review(p.id, false)} disabled={busy} style={{ background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Reject</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={box}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 14, color: C.muted }}>
                      <span style={{ color: C.good, fontWeight: 700 }}>{gmCounts.approved}</span> approved ·{" "}
                      <span style={{ color: C.warn, fontWeight: 700 }}>{gmCounts.rejected}</span> rejected ·{" "}
                      <span style={{ color: C.sun, fontWeight: 700 }}>{gmView.length}</span> awaiting review
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      {gmView.length > 0 && (
                        <>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.text, cursor: "pointer" }}
                            title="When on, accepting also creates and links the NPCs, places, factions, items, and lore each beat names. Existing entities are matched by name, not duplicated.">
                            <input type="checkbox" checked={bulkCreates} onChange={(e) => setBulkCreates(e.target.checked)} style={{ width: 15, height: 15, accentColor: C.sun, cursor: "pointer" }} />
                            Create entities
                          </label>
                          <button type="button" onClick={() => acceptGmSet(gmView, bulkCreates)} disabled={busy}
                            title={bulkCreates ? "Accept every beat below and create the entities they name" : "Accept every beat below without creating entities"}
                            style={{ ...btn(C.sun, C.ink), opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}>
                            Accept all {gmView.length}
                          </button>
                        </>
                      )}
                      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.muted, cursor: "pointer" }}>
                        <input type="checkbox" checked={showMeta} onChange={(e) => setShowMeta(e.target.checked)} style={{ width: 15, height: 15, accentColor: C.plum, cursor: "pointer" }} />
                        Show table-talk
                      </label>
                    </div>
                  </div>
                </div>

                {gmPlayer.error && <p style={{ color: C.warn, fontSize: 12.5, marginBottom: 10 }}>{gmPlayer.error}</p>}

                {gmView.length === 0 ? (
                  <div style={{ ...box, color: C.muted, fontSize: 14 }}>
                    {job.status === "extracting" ? "Extracting… GM narration will appear here." : "No GM narration events awaiting review."}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {gmGroups.map(({ category, rows }) => {
                      const open = openCats[category] === true;
                      return (
                      <div key={category} style={{ display: "grid", gap: 12 }}>
                        <div style={{ ...box, marginBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", cursor: "pointer" }}
                          onClick={() => setOpenCats((prev) => ({ ...prev, [category]: !open }))}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 12, color: C.muted, width: 12, display: "inline-block" }}>{open ? "\u25be" : "\u25b8"}</span>
                            <span style={{ fontSize: 15, fontWeight: 700 }}>{catLabel(category)}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.ink, background: C.sun, padding: "2px 9px", borderRadius: 999 }}>{rows.length}</span>
                          </div>
                          <button type="button" onClick={(ev) => { ev.stopPropagation(); acceptGmSet(rows, bulkCreates); }} disabled={busy}
                            title={bulkCreates ? `Accept all ${rows.length} in ${catLabel(category)} and create the entities they name` : `Accept all ${rows.length} in ${catLabel(category)} without creating entities`}
                            style={{ ...btn(C.good, C.ink), opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}>
                            Accept {rows.length}
                          </button>
                        </div>
                        {open && rows.map((p) => {
                      const eKind = edits[p.id]?.kind ?? p.kind;
                      const eSummary = edits[p.id]?.summary ?? p.summary;
                      const conf = p.confidence !== null ? Math.round((p.confidence || 0) * 100) : null;
                      return (
                        <div key={p.id} style={box}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <select value={eKind} onChange={(ev) => setEdit(p.id, { kind: ev.target.value })}
                              style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "6px 10px", fontSize: 12.5, boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
                              {gmKinds.map((k) => (<option key={k.kind} value={k.kind}>{k.label}</option>))}
                            </select>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              {p.audio_track_id ? (
                                <MomentButton active={gmPlayer.activeId === p.id} loading={gmPlayer.loadingId === p.id} tStart={p.t_start_seconds}
                                  onClick={() => gmPlayer.play(p.id, p.audio_track_id, p.t_start_seconds)} />
                              ) : (p.t_start_seconds !== null && (
                                <span style={{ color: C.muted, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{fmtTime(Math.round((p.t_start_seconds || 0) * 1000))}</span>
                              ))}
                              {conf !== null && <span style={{ fontSize: 13, fontWeight: 700, color: conf >= 70 ? C.good : conf >= 40 ? C.sun : C.warn }}>{conf}%</span>}
                            </div>
                          </div>

                          <textarea value={eSummary} onChange={(ev) => setEdit(p.id, { summary: ev.target.value })} rows={2}
                            style={{ display: "block", width: "100%", marginTop: 10, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "9px 11px", fontSize: 14, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }} />

                          {availEntities(p).length > 0 && (
                            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                              <span style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Create &amp; link:</span>
                              {availEntities(p).map(({ k, label }) => (
                                <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.text, cursor: "pointer" }}>
                                  <input type="checkbox" checked={isSel(p, k)} onChange={() => toggleSel(p, k)} />
                                  {label}
                                </label>
                              ))}
                            </div>
                          )}

                          {p.quote && (
                            <div style={{ marginTop: 10, padding: "10px 12px", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, fontSize: 13, color: C.text, fontStyle: "italic", boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), inset 0 0 34px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.5)" }}>
                              {"\u201c"}{p.quote}{"\u201d"}
                            </div>
                          )}
                          {p.detail && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>{p.detail}</div>}

                          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                            {availEntities(p).length > 0 ? (
                              <>
                                <button type="button" onClick={() => reviewGm(p, "approve", selObj(p))} disabled={busy} style={btn(C.sun, C.ink)}>Accept &amp; create</button>
                                <button type="button" onClick={() => reviewGm(p, "approve")} disabled={busy} style={btn(C.good, C.ink)}>Accept only</button>
                              </>
                            ) : (
                              <button type="button" onClick={() => reviewGm(p, "approve")} disabled={busy} style={btn(C.good, C.ink)}>Accept</button>
                            )}
                            <button type="button" onClick={() => reviewGm(p, "reject")} disabled={busy} style={{ background: "transparent", color: C.warn, border: `1px solid ${C.line}`, borderRadius: FORGE_RADIUS, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Reject</button>
                          </div>
                        </div>
                      );
                        })}
                      </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
    </PageShell>
  );
}
