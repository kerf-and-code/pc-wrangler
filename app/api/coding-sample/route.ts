import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// /api/coding-sample: the human second coder for reliability (2026-11-03, replaces the LLM recode).
//
// GET  ?jobId=...             the blind coding queue: each sampled line with two lines of context
//                             either side, the speaker, and the human's own code so far. Never the
//                             extractor's code and never the stratum.
// GET  ?jobId=...&results=1   only once EVERY sampled line is coded: per line, the extractor's top
//                             event, the human's event, the stratum and its inclusion probability, so
//                             the Reliability page can compute weighted agreement. Refused while coding
//                             is unfinished, so peeking cannot break the blind.
// POST { jobId, action: "create", perStratum }  draws the sample (if none exists for this job).
// POST { jobId, action: "reset" }               deletes this job's sample so a new one can be drawn.
// POST { jobId, action: "code", id, event }      saves one code; event is a key, or null for "nothing".
//
// SAMPLING. Lines are split by the extractor's own call: "flagged" (it proposed at least one event on
// the line) and "unflagged". Up to perStratum lines are drawn at random from each, so a session where
// only one line in twelve is eventful still yields enough eventful lines to measure. Each row stores
// its stratum size and inclusion probability; the page weights by them, so the detection kappa still
// describes the whole session, not the 50/50 sample.
//
// coding_samples has RLS with no policies: only this route (service role) touches it, after checking
// the caller is the campaign's GM. Every table that grows with play is read in pages of 1000 with an id
// tiebreak, because PostgREST silently truncates at 1000 rows.

const PAGE = 1000;
const CONTEXT = 2;
const SIZES = new Set([25, 40, 60]);

type Seg = { id: string; character_id: string | null; start_ms: number | null; text: string };
type PeRow = { id: string; segment_id: string | null; event_type: string | null; confidence: number | null };
type Sample = {
  id: string; segment_id: string; stratum: string; stratum_size: number; inclusion_prob: number;
  sort_key: number; human_event: string | null; coded_at: string | null;
};

type Admin = ReturnType<typeof createAdminClient>;

async function allSegments(admin: Admin, jobId: string): Promise<Seg[]> {
  const out: Seg[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("transcript_segments")
      .select("id, character_id, start_ms, text")
      .eq("job_id", jobId)
      .order("start_ms", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read the transcript: ${error.message}`);
    const rows = (data as Seg[]) || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function allProposals(admin: Admin, jobId: string): Promise<PeRow[]> {
  const out: PeRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("proposed_events")
      .select("id, segment_id, event_type, confidence")
      .eq("job_id", jobId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read the extractor's events: ${error.message}`);
    const rows = (data as PeRow[]) || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function allSamples(admin: Admin, jobId: string): Promise<Sample[]> {
  const out: Sample[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("coding_samples")
      .select("id, segment_id, stratum, stratum_size, inclusion_prob, sort_key, human_event, coded_at")
      .eq("job_id", jobId)
      .order("sort_key", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message.includes("does not exist") ? "Run migration p102 in Supabase first." : `Could not read the sample: ${error.message}`);
    const rows = (data as Sample[]) || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// The extractor's single top event per line, highest confidence wins. This is the same rule the
// Reliability page has always used, so the human is compared against exactly what was compared before.
function topEventBySegment(rows: PeRow[]): Map<string, string> {
  const ev = new Map<string, string>();
  const conf = new Map<string, number>();
  for (const r of rows) {
    if (!r.segment_id || !r.event_type) continue;
    const c = r.confidence ?? 0;
    if (!ev.has(r.segment_id) || c > (conf.get(r.segment_id) ?? -1)) { ev.set(r.segment_id, r.event_type); conf.set(r.segment_id, c); }
  }
  return ev;
}

// Uniform random sample of k from arr (partial Fisher-Yates, crypto randomness).
function sample<T>(arr: T[], k: number): T[] {
  const a = arr.slice();
  const n = Math.min(k, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

async function gate(jobId: string): Promise<{ ok: true; uid: string; campaignId: string; admin: Admin } | { ok: false; res: NextResponse }> {
  const supa = await createClient();
  const { data: claimsData } = await supa.auth.getClaims();
  const uid = claimsData?.claims?.sub as string | undefined;
  if (!uid) return { ok: false, res: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  const admin = createAdminClient();
  const { data: job } = await admin.from("capture_jobs").select("id, campaign_id").eq("id", jobId).maybeSingle();
  const campaignId = (job as { campaign_id: string } | null)?.campaign_id;
  if (!campaignId) return { ok: false, res: NextResponse.json({ error: "Session not found." }, { status: 404 }) };
  const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return { ok: false, res: NextResponse.json({ error: "Only the campaign GM can code this session." }, { status: 403 }) };
  return { ok: true, uid, campaignId, admin };
}

export async function GET(req: NextRequest) {
  const jobId = (req.nextUrl.searchParams.get("jobId") || "").trim();
  const wantResults = req.nextUrl.searchParams.get("results") === "1";
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  const g = await gate(jobId);
  if (!g.ok) return g.res;
  const { admin, campaignId } = g;

  try {
    const samples = await allSamples(admin, jobId);
    const coded = samples.filter((s) => s.coded_at).length;

    if (wantResults) {
      if (samples.length === 0) return NextResponse.json({ error: "No sample for this session yet." }, { status: 404 });
      if (coded < samples.length) {
        return NextResponse.json({ error: `Coding is not finished (${coded} of ${samples.length}). Results stay hidden until every line is coded, so the coding stays blind.` }, { status: 409 });
      }
      const top = topEventBySegment(await allProposals(admin, jobId));
      return NextResponse.json({
        items: samples.map((s) => ({
          a: top.get(s.segment_id) ?? null,
          b: s.human_event,
          stratum: s.stratum,
          stratum_size: s.stratum_size,
          inclusion_prob: s.inclusion_prob,
        })),
      });
    }

    const [{ data: et }, { data: ch }, { data: job }] = await Promise.all([
      admin.from("event_types").select("key, label, category").order("category").order("label"),
      admin.from("characters").select("id, name").eq("campaign_id", campaignId),
      admin.from("capture_jobs").select("status, session:sessions(session_number)").eq("id", jobId).maybeSingle(),
    ]);
    const nameOf = new Map(((ch as { id: string; name: string }[]) || []).map((c) => [c.id, c.name]));
    const speaker = (s: Seg) => (s.character_id ? nameOf.get(s.character_id) || "Player" : "GM / narrator");

    let items: unknown[] = [];
    if (samples.length) {
      const segs = await allSegments(admin, jobId);
      const pos = new Map(segs.map((s, i) => [s.id, i]));
      items = samples.map((s, order) => {
        const i = pos.get(s.segment_id);
        const line = (k: number) => ({ speaker: speaker(segs[k]), text: segs[k].text, start_ms: segs[k].start_ms });
        return {
          id: s.id,
          order,
          line: i === undefined ? null : line(i),
          before: i === undefined ? [] : segs.slice(Math.max(0, i - CONTEXT), i).map((_, j) => line(Math.max(0, i - CONTEXT) + j)),
          after: i === undefined ? [] : segs.slice(i + 1, i + 1 + CONTEXT).map((_, j) => line(i + 1 + j)),
          human_event: s.human_event,
          coded: Boolean(s.coded_at),
        };
      });
    }
    const j = job as { status: string; session: { session_number: number | null } | null } | null;
    return NextResponse.json({
      session: j?.session?.session_number ?? null,
      status: j?.status ?? null,
      total: samples.length,
      coded,
      items,
      eventTypes: (et as { key: string; label: string; category: string }[]) || [],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load the sample." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { jobId?: string; action?: string; perStratum?: number; id?: string; event?: string | null };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const jobId = (body.jobId || "").trim();
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  const g = await gate(jobId);
  if (!g.ok) return g.res;
  const { admin, campaignId, uid } = g;

  try {
    if (body.action === "create") {
      const per = SIZES.has(Number(body.perStratum)) ? Number(body.perStratum) : 40;
      const existing = await allSamples(admin, jobId);
      if (existing.length) return NextResponse.json({ ok: true, created: 0, total: existing.length, note: "A sample already exists for this session." });

      const segs = await allSegments(admin, jobId);
      if (segs.length === 0) return NextResponse.json({ error: "This session has no transcript lines to code." }, { status: 400 });
      const flaggedIds = new Set(topEventBySegment(await allProposals(admin, jobId)).keys());
      const flagged = segs.filter((s) => flaggedIds.has(s.id));
      const unflagged = segs.filter((s) => !flaggedIds.has(s.id));

      const rows: Record<string, unknown>[] = [];
      for (const [stratum, pool] of [["flagged", flagged], ["unflagged", unflagged]] as const) {
        if (pool.length === 0) continue;
        const picked = sample(pool, per);
        for (const s of picked) {
          rows.push({
            job_id: jobId, campaign_id: campaignId, segment_id: s.id, stratum,
            stratum_size: pool.length, inclusion_prob: picked.length / pool.length,
            sort_key: randomInt(2 ** 31) / 2 ** 31,
          });
        }
      }
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("coding_samples").insert(rows.slice(i, i + 500));
        if (error) throw new Error(error.message.includes("does not exist") ? "Run migration p102 in Supabase first." : `Could not save the sample: ${error.message}`);
      }
      return NextResponse.json({ ok: true, created: rows.length, total: rows.length });
    }

    if (body.action === "reset") {
      const { error } = await admin.from("coding_samples").delete().eq("job_id", jobId);
      if (error) throw new Error(`Could not clear the sample: ${error.message}`);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "code") {
      const id = (body.id || "").trim();
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
      let event: string | null = null;
      if (typeof body.event === "string" && body.event.trim()) {
        const { data: et } = await admin.from("event_types").select("key").eq("key", body.event.trim()).maybeSingle();
        if (!et) return NextResponse.json({ error: "Unknown event type." }, { status: 400 });
        event = body.event.trim();
      }
      const { data, error } = await admin
        .from("coding_samples")
        .update({ human_event: event, coded_by: uid, coded_at: new Date().toISOString() })
        .eq("id", id).eq("job_id", jobId)
        .select("id");
      if (error) throw new Error(`Could not save the code: ${error.message}`);
      if (!data || data.length === 0) return NextResponse.json({ error: "That line is not in this session's sample." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
