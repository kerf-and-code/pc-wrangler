import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// Closes a session. This is the GM's deliberate "the game is over" action.
//
// WHY THIS IS NOW A ROUTE, AND LOAD-BEARING
//
// Closing used to be a side effect of /stop. That was correct while /stop meant "the
// session is finished", but the sidecar can lose its voice connection (or its whole
// process, as it did on 2026-07-18) and the GM then needs to run /record again and keep
// recording into the SAME session. So /stop now ends the RECORDING and leaves the
// session open, and closing became an explicit act. This route is that act.
//
// THE INVARIANT THIS EXISTS TO PROTECT
//
// Two places disagree about what "open" means, and they must never diverge:
//
//   chat_locked(code)     asks whether any session has status = 'live'
//   /api/vtt/ingest       asks whether any session has ended_at IS NULL
//
// A session closed in one sense but not the other either leaves party chat locked after
// the game, or keeps accepting idle D&D Beyond rolls into a finished session. So status
// and ended_at ALWAYS move together, here and in the reopen route, and nowhere else
// should touch either one.
//
// THE RECORDING GUARD
//
// Closing while the sidecar still holds the recording would strand it: the session it is
// finalizing into would already be closed, and the /record that follows would open a new
// one. So an open capture_control row for this session refuses the close.
//
// `force: true` is the escape hatch for the orphan case (the process died holding the
// row, so it will never reach 'done' on its own). The UI should only offer it once the
// refusal has been shown, which is the same pattern /api/review/finalize uses for
// undecided proposals.
//
// IDEMPOTENT. Closing an already-closed session is a no-op, not an error.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = body?.sessionId;
    const force = body?.force === true;
    // "End and process" is the same close, plus marking the session ready for player
    // check-in. It shares this route rather than updating the row from the client so it
    // inherits the recording guard and the status/ended_at pairing. The old Run-the-
    // session card set 'processed' WITHOUT ended_at, which is why 5 of your 8 processed
    // sessions are still open ingest targets.
    const process = body?.process === true;

    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: session, error: sErr } = await admin
      .from("sessions")
      .select("id, campaign_id, session_number, status, ended_at")
      .eq("id", sessionId)
      .single();
    if (sErr || !session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    // GM gate. The admin client bypasses RLS, so ownership is checked explicitly.
    const { data: campaign } = await admin
      .from("campaigns")
      .select("id, gm_id")
      .eq("id", session.campaign_id)
      .single();
    if (!campaign || campaign.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    // Already closed. No-op rather than an error: the button can be clicked twice, and
    // the auto-close backstop may race a GM doing it by hand.
    if (session.ended_at) {
      return NextResponse.json({ ok: true, alreadyClosed: true, sessionId });
    }

    // Recording guard.
    const { data: openCapture, error: ccErr } = await admin
      .from("capture_control")
      .select("id, status, updated_at")
      .eq("session_id", sessionId)
      .in("status", ["requested", "active", "stopping"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ccErr) {
      return NextResponse.json(
        { error: "Could not check the recording state. Try again in a moment." },
        { status: 500 },
      );
    }

    if (openCapture && !force) {
      return NextResponse.json(
        {
          ok: true,
          closed: false,
          recording: true,
          captureStatus: openCapture.status,
          captureUpdatedAt: openCapture.updated_at,
          error:
            "Six Axes is still recording this session. Run /stop in Discord first. " +
            "If the bot has crashed and will never finish, close it anyway.",
        },
        { status: 409 },
      );
    }

    // Force path: the row is an orphan, so retire it rather than leaving it holding the
    // guild lock. capture_control_one_open_per_guild is a unique index over the open
    // statuses, so an abandoned row blocks every future /record in that guild.
    let orphanCleared = false;
    if (openCapture && force) {
      const { error: clrErr } = await admin
        .from("capture_control")
        .update({
          status: "done",
          error: "closed by GM while orphaned",
          updated_at: new Date().toISOString(),
        })
        .eq("id", openCapture.id)
        .in("status", ["requested", "active", "stopping"]);
      orphanCleared = !clrErr;
    }

    // Close. status and ended_at together, always. The `is("ended_at", null)` predicate
    // makes this safe against a concurrent close.
    const now = new Date().toISOString();
    const patch: { status: string; ended_at: string; processed_at?: string } = process
      ? { status: "processed", ended_at: now, processed_at: now }
      : { status: "completed", ended_at: now };

    const { error: uErr } = await admin
      .from("sessions")
      .update(patch)
      .eq("id", sessionId)
      .is("ended_at", null);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      closed: true,
      processed: process,
      forced: force && Boolean(openCapture),
      orphanCleared,
      sessionId,
      sessionNumber: session.session_number,
    });
  } catch {
    return NextResponse.json({ error: "Could not close session." }, { status: 500 });
  }
}
