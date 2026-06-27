import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleAuth } from "google-auth-library";

// POST /api/dispositions/run  { campaignId }
// Starts a cloud fit for the campaign and records a 'fitting' run row.
export async function POST(req: NextRequest) {
  let campaignId: string | undefined;
  try {
    campaignId = (await req.json())?.campaignId;
  } catch {
    /* fall through to the missing-id guard */
  }
  if (!campaignId) return NextResponse.json({ error: "Missing campaignId" }, { status: 400 });

  // Who is calling, and are they the GM of this campaign?
  const supa = await createClient();
  const { data: claimsData } = await supa.auth.getClaims();
  const uid = claimsData?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the campaign GM can run a fit." }, { status: 403 });

  const admin = createAdminClient();

  // Don't stack fits: if one is already running for this campaign, return it.
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: active } = await admin
    .from("disposition_runs")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("status", "fitting")
    .gte("created_at", since)
    .limit(1);
  if (active && active.length) {
    return NextResponse.json({ runId: (active[0] as { id: string }).id, status: "fitting", already: true });
  }

  // Cloud config (set in Vercel from step 1).
  const b64 = process.env.GCP_SA_KEY_B64;
  const project = process.env.GCP_PROJECT_ID;
  const region = process.env.GCP_REGION;
  const job = process.env.GCP_DISPOSITION_JOB;
  if (!b64 || !project || !region || !job) {
    return NextResponse.json({ error: "Server is missing cloud-run configuration." }, { status: 500 });
  }

  // Create the run row first so its id can be handed to the worker.
  const { data: runRow, error: insErr } = await admin
    .from("disposition_runs")
    .insert({ campaign_id: campaignId, status: "fitting", triggered_by: uid })
    .select("id")
    .single();
  if (insErr || !runRow) {
    return NextResponse.json({ error: "Could not create the run record." }, { status: 500 });
  }
  const runId = (runRow as { id: string }).id;

  // Authenticate to GCP as the scoped service account.
  let token: string | null | undefined;
  try {
    const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const auth = new GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    token = (await client.getAccessToken()).token;
    if (!token) throw new Error("no token");
  } catch {
    await admin.from("disposition_runs")
      .update({ status: "error", error: "Cloud authentication failed." })
      .eq("id", runId);
    return NextResponse.json({ error: "Cloud authentication failed." }, { status: 500 });
  }

  // Start the job, overriding the container args with [campaign, runId].
  // run.R reads arg 1 as the campaign; step 3 will read arg 2 as the run id.
  const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      overrides: { containerOverrides: [{ args: [campaignId, runId] }] },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    await admin.from("disposition_runs")
      .update({ status: "error", error: `Launch failed (${res.status}).` })
      .eq("id", runId);
    return NextResponse.json(
      { error: "Could not start the fit.", status: res.status, detail },
      { status: 502 },
    );
  }

  // The run job call returns a long-running operation; keep its name for tracing.
  const op = await res.json().catch(() => null);
  const execution: string | null = op?.metadata?.name || op?.name || null;
  if (execution) {
    await admin.from("disposition_runs").update({ execution }).eq("id", runId);
  }

  return NextResponse.json({ runId, status: "fitting" });
}
