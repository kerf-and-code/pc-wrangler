import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// Deletes an EMPTY session. The scope is deliberately narrow: this exists to undo an
// accidental session (one created before the prior session was closed), and nothing
// more.
//
// WHY EMPTY-ONLY, AND WHY IT IS SAFE
//
// "Empty" means: no saved recap, and no rows in capture_jobs, events, proposed_events,
// or gm_proposed_events for this session. A session that fails any of those is refused
// with a specific reason. Two things fall out of that:
//
//   1. Audio can never be stranded. Audio files live in the session-audio storage
//      bucket, not in Postgres, so a row cascade would never remove them. But a session
//      with audio necessarily has a capture_job, and this route refuses on capture_jobs.
//      So a deletable session has no audio, and the 60-day retention promise is never
//      at risk here.
//
//   2. No no-action foreign key can block us by surprise. loot_grants, dispositions,
//      arc_touches, and the two arcs references are ON DELETE NO ACTION, meaning they
//      would raise rather than cascade. None of them can exist on a session that has no
//      capture_job and no events, so the emptiness gate keeps us clear of them. The
//      delete still catches a constraint error as a last-resort backstop.
//
// The cheap children (attendance, capture_control, session_polls, per-session consents)
// are ON DELETE CASCADE or SET NULL and are handled automatically.
//
// GM ownership is checked explicitly against the admin client, the same pattern the
// finalize and recap routes use.
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
      .select("id, campaign_id, recap")
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

    // Emptiness gate: a saved recap.
    if (session.recap && String(session.recap).trim()) {
      return NextResponse.json(
        { error: "This session has a saved recap. Only empty sessions can be deleted." },
        { status: 409 },
      );
    }

    // Emptiness gate: any capture or event content.
    const checks: Array<{ table: string; label: string }> = [
      { table: "capture_jobs", label: "a recording" },
      { table: "events", label: "logged events" },
      { table: "proposed_events", label: "proposed events" },
      { table: "gm_proposed_events", label: "proposed events" },
    ];
    for (const c of checks) {
      const { count, error } = await admin
        .from(c.table)
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);
      if (error) {
        return NextResponse.json({ error: error.message, stage: c.table }, { status: 500 });
      }
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: `This session has ${c.label} and can't be deleted. Only empty sessions can be removed.` },
          { status: 409 },
        );
      }
    }

    // Delete. Cascade and set-null handle the cheap children. The emptiness gate above
    // means no no-action child should exist; if one somehow does, the FK raises and we
    // surface it cleanly rather than returning a 500.
    const { error: dErr } = await admin.from("sessions").delete().eq("id", sessionId);
    if (dErr) {
      return NextResponse.json(
        { error: "This session has linked records and can't be deleted." },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, deleted: sessionId });
  } catch {
    return NextResponse.json({ error: "Could not delete session." }, { status: 500 });
  }
}
