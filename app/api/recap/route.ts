import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRecap } from "@/lib/recap/build";

// buildRecap chunks the transcript at CHUNK_SIZE characters and makes ONE sequential
// model call per chunk, plus a final call to write the recap. 60 seconds was enough while
// the transcript was being silently truncated to 1000 segments (~5 chunks). Once paging
// landed and it started seeing whole sessions, a 3146-segment transcript became ~14 chunks
// and the function was killed mid-run, which the catch below then reported as a generic
// "could not generate". The work did not get slower; it started doing all of it.
//
// 300 is the platform ceiling. REDUCE_THRESHOLD in the builder caps the fan-out before
// that becomes a problem again.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = body?.sessionId;
    // Manual generate overwrites (default). The Mark-done auto-draft passes
    // overwrite:false so it never clobbers an existing draft or the GM's edits.
    const overwrite = body?.overwrite !== false;
    // Recap length mode. Anything other than an explicit "complete" is brief.
    const mode = body?.mode === "complete" ? "complete" : "brief";
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }

    // RLS confirms the caller owns this session and gives us the current draft.
    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .select("id, recap")
      .eq("id", sessionId)
      .single();
    if (sErr || !session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    if (!overwrite && session.recap && session.recap.trim()) {
      return NextResponse.json({ recap: session.recap, skipped: true });
    }

    const result = await buildRecap(supabase, sessionId, mode);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Persist the draft. Ownership was confirmed by the RLS read above; the admin
    // write avoids depending on a sessions UPDATE policy.
    const admin = createAdminClient();
    const { error: wErr } = await admin.from("sessions").update({ recap: result.recap }).eq("id", sessionId);
    if (wErr) {
      return NextResponse.json({ error: "Could not save the recap draft." }, { status: 500 });
    }

    return NextResponse.json({ recap: result.recap });
  } catch (e) {
    // The old form was a bare `catch {}`: it did not bind the error, did not log it, and
    // replaced every possible failure with one sentence. A timeout, a bad API key, a
    // database error, and a bug in the builder were all indistinguishable from the GM's
    // side and left nothing in the logs to read afterwards.
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/recap] unhandled failure:", detail, e);
    // The route is authenticated and ownership-checked above, so the caller is the GM of
    // this campaign. Showing them the actual reason is worth far more than hiding it.
    return NextResponse.json(
      { error: `Could not generate recap: ${detail.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
