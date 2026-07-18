import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// Reopens a closed session and makes it live again, so the table can record more into it
// rather than being forced into a new session number.
//
// WHY THIS HAS TO EXIST
//
// /api/session/delete refuses any session that has a capture_job. That is the right call
// (it keeps audio from being stranded and the 60-day retention promise intact), but it
// means that once a session has recorded ANYTHING, delete is off the table. Without
// reopen there is no way to correct a session that was closed too early: the GM's only
// option is a new session, which splits one evening's play across two rows and two
// recaps.
//
// THE ONE-OPEN-SESSION RULE
//
// This is the important guard, and it is not obvious. /api/vtt/ingest resolves a
// campaign's session by taking every session with ended_at IS NULL and picking the
// MOST RECENTLY STARTED one. So two open sessions in a campaign is not a harmless
// duplicate: it silently sends every incoming dice roll to whichever happens to sort
// first, and the GM has no way to see that happening. So a reopen is refused while
// another session in the same campaign is already open. Close that one first.
//
// THE INVARIANT
//
// status and ended_at move together, always. chat_locked() reads status = 'live';
// ingest reads ended_at IS NULL. Setting one without the other leaves party chat locked
// after the game, or leaks rolls into a finished session. This route and
// /api/session/close are the only two places that should touch either column.
//
// started_at is deliberately NOT reset. It records when play actually began, and
// overwriting it would corrupt session duration and reorder ingest's most-recently-
// started tiebreak against other campaigns.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = body?.sessionId;

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
      .select("id, campaign_id, session_number, status, started_at, ended_at, processed_at")
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

    // Already open. No-op rather than an error.
    if (!session.ended_at && session.status === "live") {
      return NextResponse.json({ ok: true, alreadyOpen: true, sessionId });
    }

    // A cancelled session is not a session that ended early; it is one that never
    // happened. Reopening it would put a session with no start into the live slot.
    if (session.status === "cancelled") {
      return NextResponse.json(
        { error: "This session was cancelled. Create a new session instead of reopening it." },
        { status: 409 },
      );
    }

    // The one-open-session rule. See the header: ingest picks the most recently started
    // open session, so a second one silently steals the campaign's incoming rolls.
    //
    // "Open" here means UNDERWAY, not merely un-ended: started_at set and ended_at null.
    // A scheduled future session also has ended_at null (it just has not happened yet),
    // and blocking on those would refuse the reopen for any campaign with a recurring
    // schedule queued up. This matches how /record picks a session to record into.
    const { data: alreadyOpen, error: oErr } = await admin
      .from("sessions")
      .select("id, session_number")
      .eq("campaign_id", session.campaign_id)
      .not("started_at", "is", null)
      .is("ended_at", null)
      .neq("id", sessionId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (oErr) {
      return NextResponse.json(
        { error: "Could not check for other open sessions. Try again in a moment." },
        { status: 500 },
      );
    }

    if (alreadyOpen) {
      const label =
        alreadyOpen.session_number != null ? `Session ${alreadyOpen.session_number}` : "another session";
      return NextResponse.json(
        {
          error: `${label} is still open in this campaign. Close it before reopening this one, or dice rolls will land in the wrong session.`,
          blockedBy: alreadyOpen.id,
        },
        { status: 409 },
      );
    }

    // Reopen. status and ended_at together. started_at is preserved; if this session
    // never had one (closed straight from 'scheduled'), stamp it now, because /record
    // only reuses sessions that have started_at set and ingest sorts on it.
    const patch: { status: string; ended_at: null; started_at?: string } = {
      status: "live",
      ended_at: null,
    };
    if (!session.started_at) {
      patch.started_at = new Date().toISOString();
    }

    const { error: uErr } = await admin
      .from("sessions")
      .update(patch)
      .eq("id", sessionId);

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      reopened: true,
      sessionId,
      sessionNumber: session.session_number,
      // The pipeline already ran on this session, so anything recorded from here is a
      // SECOND capture job against it and the existing recap is now incomplete. The UI
      // should say so rather than letting the GM assume the recap will update itself.
      pipelineHadRun: session.status === "processed" || Boolean(session.processed_at),
      startedAtStamped: Boolean(patch.started_at),
    });
  } catch {
    return NextResponse.json({ error: "Could not reopen session." }, { status: 500 });
  }
}
