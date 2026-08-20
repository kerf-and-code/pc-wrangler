import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// app/api/import/decide/route.ts
//
// Backfill, step 2 (review): the small mutation endpoint the review screen drives. Sets a decision on
// candidates or sessions, and lets the GM edit a candidate's name / body / kind before commit. Kept
// server-side so the ownership guard lives on the server, matching the lore routes.
//
// Body (any subset):
//   { jobId, candidateIds:[...], decision } -> set decision on those candidates
//   { jobId, sessionIds:[...],  decision } -> set decision on those sessions
//   { jobId, edit:{ id, name?, body?, kind? } } -> edit one candidate
// decision in approved|rejected|pending|merged; kind in npc|location|faction|item|lore|pc.

const DECISIONS = new Set(["approved", "rejected", "pending", "merged"]);
const KINDS = new Set(["npc", "location", "faction", "item", "lore", "pc"]);

type Edit = { id?: string; name?: string; body?: string; kind?: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      jobId?: string; candidateIds?: string[]; sessionIds?: string[]; decision?: string; edit?: Edit;
    };
    const jobId = (body.jobId || "").trim();
    if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const admin = createAdminClient();
    const { data: jobRow } = await admin.from("import_jobs").select("campaign_id").eq("id", jobId).maybeSingle();
    const campaignId = (jobRow as { campaign_id: string } | null)?.campaign_id;
    if (!campaignId) return NextResponse.json({ error: "Import not found." }, { status: 404 });

    const { data: campRow } = await supa.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
    if ((campRow as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    // Edit one candidate's fields.
    if (body.edit && body.edit.id) {
      const patch: Record<string, string> = {};
      if (typeof body.edit.name === "string") patch.name = body.edit.name.trim().slice(0, 200);
      if (typeof body.edit.body === "string") patch.body = body.edit.body.slice(0, 8000);
      if (typeof body.edit.kind === "string" && KINDS.has(body.edit.kind)) patch.kind = body.edit.kind;
      if (Object.keys(patch).length) {
        const { error } = await admin.from("import_candidates").update(patch).eq("id", body.edit.id).eq("job_id", jobId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    // Set a decision on candidates and/or sessions.
    const decision = body.decision;
    if (decision && DECISIONS.has(decision)) {
      if (Array.isArray(body.candidateIds) && body.candidateIds.length) {
        const { error } = await admin.from("import_candidates").update({ decision }).in("id", body.candidateIds).eq("job_id", jobId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (Array.isArray(body.sessionIds) && body.sessionIds.length) {
        // sessions only carry approved|rejected|pending
        const sDec = decision === "merged" ? "approved" : decision;
        const { error } = await admin.from("import_sessions").update({ decision: sDec }).in("id", body.sessionIds).eq("job_id", jobId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else if (decision) {
      return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/import/decide] unhandled:", detail);
    return NextResponse.json({ error: `Could not update: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
