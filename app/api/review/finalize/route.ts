import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Finalizes a review job: flips the capture job to "done", auto-drafts the recap,
// and kicks the disposition fit.
//
// WHY THIS IS A ROUTE AND NOT A BUTTON HANDLER
//
// The pilot asked for the recap to fire on approval-complete with no extra GM
// click. The hazard flagged in the handoff was inferring completion from an empty
// review QUEUE, because a queue can read empty mid-review (a filter is applied, a
// tab is not open, the extractor is still writing rows). So this route never looks
// at the UI. It infers from the database:
//
//   1. the capture job is in "review" (both extractor cursors finished, so no more
//      proposals are arriving), AND
//   2. zero rows remain with status "proposed" across BOTH proposed_events and
//      gm_proposed_events for this job.
//
// A queue that merely renders empty triggers nothing. Only a real, complete set of
// decisions does.
//
// THE ESCAPE HATCH
//
// Pure inference has one dead end: a GM who deliberately skips a proposal (leaves
// it undecided rather than rejecting it) would never reach zero, so the job would
// never finalize and no recap would ever generate, silently. `force: true` is the
// escape hatch for that case, surfaced in the UI only when undecided rows remain.
//
// IDEMPOTENT. Safe to call after every single review decision; it no-ops until the
// last one lands, and no-ops again if the job is already done.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const jobId = body?.jobId;
    const force = body?.force === true;

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: job, error: jErr } = await admin
      .from("capture_jobs")
      .select("id, campaign_id, session_id, status")
      .eq("id", jobId)
      .single();

    if (jErr || !job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    // GM gate. The admin client bypasses RLS, so ownership is checked explicitly.
    const { data: campaign } = await admin
      .from("campaigns")
      .select("id, gm_id")
      .eq("id", job.campaign_id)
      .single();

    if (!campaign || campaign.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    // Already finalized. No-op, not an error: this route is called speculatively
    // after every decision, so re-entry is the normal case.
    if (job.status === "done") {
      return NextResponse.json({ ok: true, alreadyDone: true });
    }

    // Extraction is still running, so more proposals are still arriving. An empty
    // count right now would be a false zero. This is the guard that makes
    // inference safe.
    if (job.status !== "review") {
      return NextResponse.json({ ok: true, notReady: true, status: job.status });
    }

    // Count undecided proposals across BOTH tables. Counting in the database (not
    // from the client's filtered view) is the whole point.
    const { count: playerLeft, error: pErr } = await admin
      .from("proposed_events")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "proposed");

    const { count: gmLeft, error: gErr } = await admin
      .from("gm_proposed_events")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "proposed");

    if (pErr || gErr) {
      return NextResponse.json(
        { error: (pErr || gErr)?.message ?? "Could not count proposals." },
        { status: 500 },
      );
    }

    const remaining = (playerLeft ?? 0) + (gmLeft ?? 0);

    if (remaining > 0 && !force) {
      return NextResponse.json({ ok: true, finalized: false, remaining });
    }

    // Finalize.
    const { error: uErr } = await admin
      .from("capture_jobs")
      .update({ status: "done" })
      .eq("id", jobId)
      .eq("status", "review"); // concurrency guard: only one caller wins

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    // Auto-draft the recap. overwrite:false so it never clobbers an existing draft
    // or the GM's edits. Best-effort: the job is done regardless.
    let recapDrafted = false;
    let recapSkipped = false;
    if (job.session_id) {
      try {
        const base = new URL(request.url).origin;
        const res = await fetch(`${base}/api/recap`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Forward the caller's session so /api/recap sees the same GM.
            cookie: request.headers.get("cookie") ?? "",
          },
          body: JSON.stringify({ sessionId: job.session_id, overwrite: false }),
        });
        const out = await res.json().catch(() => ({}));
        recapDrafted = res.ok;
        recapSkipped = Boolean(out?.skipped);
      } catch {
        // Leave recapDrafted false; the GM can draft from the Session Log.
      }
    }

    // Refresh the disposition model. The route guards against stacking, so firing
    // this each time is safe.
    let dispositionsRunning = false;
    try {
      const base = new URL(request.url).origin;
      const res = await fetch(`${base}/api/dispositions/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") ?? "",
        },
        body: JSON.stringify({ campaignId: job.campaign_id }),
      });
      dispositionsRunning = res.ok;
    } catch {
      // Best-effort; a fit can still be run later from the Power switch.
    }

    return NextResponse.json({
      ok: true,
      finalized: true,
      forced: force && remaining > 0,
      remaining,
      recapDrafted,
      recapSkipped,
      dispositionsRunning,
    });
  } catch {
    return NextResponse.json({ error: "Could not finalize review." }, { status: 500 });
  }
}
