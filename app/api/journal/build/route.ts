import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildJournal } from "@/lib/journal/build";

// One model call, but now with an 8000-token chronicle over a whole campaign's recaps,
// which is comfortably past the platform default. The recap route needed the same change
// for the same reason and reported the timeout as a generic "could not generate".
export const maxDuration = 300;

// POST /api/journal/build  { campaignId }
// Assembles the campaign journal and stores it, returning the public share code.
export async function POST(req: NextRequest) {
  let body: { campaignId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const campaignId = (body.campaignId || "").trim();
  if (!campaignId) return NextResponse.json({ error: "Missing campaignId" }, { status: 400 });

  const supa = await createClient();
  const { data: claimsData } = await supa.auth.getClaims();
  const uid = claimsData?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the campaign GM can build the journal." }, { status: 403 });

  const admin = createAdminClient();
  const result = await buildJournal(admin, campaignId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const { error: upErr } = await admin
    .from("campaign_journals")
    .upsert({ campaign_id: campaignId, content: result.content, generated_at: result.content.generated_at }, { onConflict: "campaign_id" });
  if (upErr) return NextResponse.json({ error: `Could not save the journal: ${upErr.message}` }, { status: 500 });

  const { data: camp } = await admin.from("campaigns").select("share_code").eq("id", campaignId).maybeSingle();
  const shareCode = (camp as { share_code: string | null } | null)?.share_code || null;

  return NextResponse.json({
    ok: true,
    shareCode,
    sessions: result.content.sessions,
    trimmedSessions: result.content.trimmed_sessions,
  });
}
