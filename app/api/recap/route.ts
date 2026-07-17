import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRecap } from "@/lib/recap/build";

export const maxDuration = 60;

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
  } catch {
    return NextResponse.json({ error: "Could not generate recap." }, { status: 500 });
  }
}
