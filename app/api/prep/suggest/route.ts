import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/prep/suggest  { campaignId, dryRun? }
//
// Rule-based prep suggestions (2026-11-03). This used to phrase its signals through Claude; now every
// suggestion is computed from data the app already stores, and each one says WHY it was suggested,
// with its numbers, so the GM can judge it at a glance. No AI call.
//
// Rules, in priority order (Terry's ruling), each capped so one rule cannot crowd out the rest:
//   1. Stale threads: open threads (hooks, decisions, quests) opened RECENT_WINDOW or more sessions ago.
//   2. Quiet players: characters under half an even spotlight share in the latest session played.
//   3. NPCs gone quiet: NPCs seen in 2+ sessions but not in the last RECENT_WINDOW sessions, and whose
//      last appearance was not a departure. Linked to their Codex NPC when exactly one matches by name.
//   4. Places left behind: locations seen in 2+ sessions but not in the last RECENT_WINDOW sessions.
//
// "Latest session" is the highest-numbered session that has GM events, NOT the highest session number,
// because a future session scheduled ahead of time has a number but nothing in it, and counting from it
// would make everything look stale.
//
// Writes session_plan_items with source 'suggested' (the shape the Prep page already reads), and skips
// anything already on the plan and not done, so pressing the button twice does not duplicate items.
// dryRun: true returns the suggestions without writing, for testing.
//
// The response keeps the old shape: { ok, suggested, reason? }, plus `items` (the suggestions).
//
// gm_events is read in pages of 1000 with an id tiebreak, because PostgREST silently caps a select at
// 1000 rows and a busy campaign has more GM events than that.

const RECENT_WINDOW = 3;
const MIN_SESSIONS_SEEN = 2;
const CAPS = { thread: 4, quiet: 3, npc: 3, place: 2 } as const;
const TOTAL_CAP = 10;
const PAGE = 1000;

const NPC_KINDS = new Set(["npc_introduced", "npc_voice", "npc_action", "npc_departed"]);
const THREAD_LABEL: Record<string, string> = {
  hook: "A plot hook",
  framing: "A decision put to the party",
  quest_update: "A quest",
};

type Ev = {
  id: string; session_id: string | null; kind: string; summary: string | null;
  npc_name: string | null; location_name: string | null; thread_status: string | null; created_at: string;
};

type Suggestion = {
  rule: "thread" | "quiet" | "npc" | "place";
  title: string; note: string; kind: string;
  linked_event_id: string | null; linked_character_id: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function POST(req: NextRequest) {
  let body: { campaignId?: string; dryRun?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const campaignId = (body.campaignId || "").trim();
  const dryRun = body.dryRun === true;
  if (!campaignId) return NextResponse.json({ error: "Missing campaignId" }, { status: 400 });

  const supa = await createClient();
  const { data: claimsData } = await supa.auth.getClaims();
  const uid = claimsData?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the campaign GM can suggest prep." }, { status: 403 });

  const admin = createAdminClient();

  // Session numbers.
  const { data: sessRows, error: sessErr } = await admin.from("sessions").select("id, session_number").eq("campaign_id", campaignId);
  if (sessErr) return NextResponse.json({ error: `Could not read sessions: ${sessErr.message}` }, { status: 500 });
  const numOf = new Map<string, number>();
  for (const s of (sessRows as { id: string; session_number: number | null }[]) || []) {
    if (s.session_number != null) numOf.set(s.id, s.session_number);
  }

  // Every GM event for the campaign, paged.
  const events: Ev[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("gm_events")
      .select("id, session_id, kind, summary, npc_name, location_name, thread_status, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: `Could not read GM events: ${error.message}` }, { status: 500 });
    const rows = (data as Ev[]) || [];
    events.push(...rows);
    if (rows.length < PAGE) break;
  }

  // The latest session PLAYED: the highest-numbered session that has events.
  let latestNum = -Infinity;
  let latestId: string | null = null;
  for (const e of events) {
    const n = e.session_id ? numOf.get(e.session_id) : undefined;
    if (n !== undefined && n > latestNum) { latestNum = n; latestId = e.session_id; }
  }
  if (latestId === null) {
    return NextResponse.json({ ok: true, suggested: 0, items: [], reason: "No reviewed sessions yet, so there is nothing to suggest from." });
  }
  const sessionOf = (e: Ev) => (e.session_id ? numOf.get(e.session_id) : undefined);

  const out: Suggestion[] = [];

  // 1. Stale threads.
  const stale = events
    .filter((e) => e.thread_status === "open")
    .map((e) => ({ e, n: sessionOf(e) }))
    .filter((x): x is { e: Ev; n: number } => x.n !== undefined && latestNum - x.n >= RECENT_WINDOW)
    .sort((a, b) => a.n - b.n)
    .slice(0, CAPS.thread);
  for (const { e, n } of stale) {
    const summary = (e.summary || "").trim();
    if (!summary) continue;
    const what = THREAD_LABEL[e.kind] || "A thread";
    out.push({
      rule: "thread",
      title: `Pay off: ${clip(summary, 90)}`,
      note: `${what} from session ${n}, still open. The latest session played is ${latestNum}, so it has waited ${plural(latestNum - n, "session", "sessions")}.`,
      kind: "scene",
      linked_event_id: e.id,
      linked_character_id: null,
    });
  }

  // 2. Quiet players, from the latest session's spotlight.
  const { data: spot, error: spotErr } = await admin
    .from("v_session_spotlight")
    .select("character_name, share, equal_share")
    .eq("session_id", latestId);
  if (spotErr) return NextResponse.json({ error: `Could not read the spotlight: ${spotErr.message}` }, { status: 500 });
  const spotRows = (spot as { character_name: string | null; share: number | null; equal_share: number | null }[]) || [];
  if (spotRows.length) {
    const even = spotRows[0].equal_share || 1 / spotRows.length;
    spotRows
      .filter((r) => r.character_name && (r.share || 0) < even * 0.5)
      .sort((a, b) => (a.share || 0) - (b.share || 0))
      .slice(0, CAPS.quiet)
      .forEach((r) => {
        out.push({
          rule: "quiet",
          title: `Give ${r.character_name} a scene`,
          note: `${pct(r.share || 0)} of the spotlight in session ${latestNum}, against an even share of ${pct(even)}.`,
          kind: "social",
          linked_event_id: null,
          linked_character_id: null,
        });
      });
  }

  // 3 and 4. Names seen in 2+ sessions, absent from the recent window.
  type Seen = { display: string; sessions: Set<number>; last: number; lastKind: string };
  const tally = (pick: (e: Ev) => string | null) => {
    const m = new Map<string, Seen>();
    for (const e of events) {
      const raw = (pick(e) || "").trim();
      const n = sessionOf(e);
      if (!raw || n === undefined) continue;
      const key = raw.toLowerCase();
      const cur = m.get(key) || { display: raw, sessions: new Set<number>(), last: -Infinity, lastKind: e.kind };
      cur.sessions.add(n);
      if (n >= cur.last) { cur.last = n; cur.lastKind = e.kind; }
      m.set(key, cur);
    }
    return Array.from(m.values())
      .filter((s) => s.sessions.size >= MIN_SESSIONS_SEEN && latestNum - s.last >= RECENT_WINDOW)
      .sort((a, b) => b.sessions.size - a.sessions.size || b.last - a.last);
  };

  const { data: npcRows, error: npcErr } = await admin
    .from("characters").select("id, name").eq("campaign_id", campaignId).eq("kind", "npc");
  if (npcErr) return NextResponse.json({ error: `Could not read NPCs: ${npcErr.message}` }, { status: 500 });
  const npcIdsByName = new Map<string, string[]>();
  for (const c of (npcRows as { id: string; name: string }[]) || []) {
    const k = c.name.trim().toLowerCase();
    npcIdsByName.set(k, [...(npcIdsByName.get(k) || []), c.id]);
  }

  tally((e) => (NPC_KINDS.has(e.kind) ? e.npc_name : null))
    .filter((s) => s.lastKind !== "npc_departed")
    .slice(0, CAPS.npc)
    .forEach((s) => {
      const ids = npcIdsByName.get(s.display.toLowerCase()) || [];
      out.push({
        rule: "npc",
        title: `Bring back ${s.display}`,
        note: `Appeared in ${plural(s.sessions.size, "session", "sessions")}, last in session ${s.last}; not seen in the ${plural(latestNum - s.last, "session", "sessions")} since.`,
        kind: "social",
        linked_event_id: null,
        linked_character_id: ids.length === 1 ? ids[0] : null,
      });
    });

  tally((e) => e.location_name)
    .slice(0, CAPS.place)
    .forEach((s) => {
      out.push({
        rule: "place",
        title: `Return to ${s.display}`,
        note: `Visited in ${plural(s.sessions.size, "session", "sessions")}, last in session ${s.last}; the party has not been back in the ${plural(latestNum - s.last, "session", "sessions")} since.`,
        kind: "scene",
        linked_event_id: null,
        linked_character_id: null,
      });
    });

  if (out.length === 0) {
    return NextResponse.json({ ok: true, suggested: 0, items: [], reason: "Nothing stale or quiet enough to suggest yet." });
  }

  // Skip anything already on the plan and not done (same thread, or same title).
  const { data: planRows, error: planErr } = await admin
    .from("session_plan_items")
    .select("title, linked_event_id, done, position")
    .eq("campaign_id", campaignId);
  if (planErr) return NextResponse.json({ error: `Could not read the plan: ${planErr.message}` }, { status: 500 });
  const plan = (planRows as { title: string; linked_event_id: string | null; done: boolean; position: number }[]) || [];
  const openTitles = new Set(plan.filter((p) => !p.done).map((p) => p.title.trim().toLowerCase()));
  const openThreads = new Set(plan.filter((p) => !p.done && p.linked_event_id).map((p) => p.linked_event_id as string));
  const fresh = out
    .filter((s) => !openTitles.has(s.title.toLowerCase()) && !(s.linked_event_id && openThreads.has(s.linked_event_id)))
    .slice(0, TOTAL_CAP);

  if (fresh.length === 0) {
    return NextResponse.json({ ok: true, suggested: 0, items: [], reason: "Everything worth suggesting is already on your plan." });
  }
  if (dryRun) return NextResponse.json({ ok: true, suggested: 0, dryRun: true, items: fresh });

  let pos = plan.reduce((m, p) => Math.max(m, p.position), -1) + 1;
  const rows = fresh.map((s) => ({
    campaign_id: campaignId,
    title: s.title.slice(0, 200),
    note: s.note.slice(0, 1000),
    kind: s.kind,
    difficulty: null,
    linked_event_id: s.linked_event_id,
    linked_character_id: s.linked_character_id,
    position: pos++,
    done: false,
    source: "suggested",
  }));
  const { error: insErr } = await admin.from("session_plan_items").insert(rows);
  if (insErr) return NextResponse.json({ error: `Could not add the suggestions: ${insErr.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, suggested: rows.length, items: fresh });
}
