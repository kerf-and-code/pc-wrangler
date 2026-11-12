import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeCampaign } from "@/lib/campaign/purge";
import { opsAlert } from "@/lib/ops-alert";

// app/api/cron/campaign-purge/route.ts (2026-11-09)
//
// Push 2 (audit F4): daily (vercel.json). Erases campaigns that have been in the trash for more than 30
// days (p139), rows and files, the same way "Delete forever now" does (lib/campaign/purge.ts). A few per
// run, so one large campaign cannot run the job out of time; the rest go on the next run. Any failure
// alerts and fails the run (audit T1).

export const maxDuration = 60;
const PER_RUN = 5;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: due, error } = await admin.from("campaigns").select("id").not("deleted_at", "is", null).lt("deleted_at", cutoff).limit(PER_RUN);
  if (error) {
    await opsAlert("cron campaign-purge", "could not list campaigns due for erasing (has p139 run?)", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const erased: string[] = [];
  const problems: { id: string; detail: string }[] = [];
  for (const { id } of (due as { id: string }[] | null) ?? []) {
    const r = await purgeCampaign(admin, id, async () => {
      // Re-checked at delete time, so a campaign restored a moment ago is never erased.
      const { error: e } = await admin.from("campaigns").delete().eq("id", id).not("deleted_at", "is", null).lt("deleted_at", cutoff);
      return e ? e.message : null;
    });
    if (!r.ok) { problems.push({ id, detail: `${r.stage}: ${r.error}` }); continue; }
    erased.push(id);
    if (r.failures.length) problems.push({ id, detail: `files left: ${r.failures.slice(0, 3).join("; ")}` });
  }

  // Push 48 (audit round 2, T16): the tables that only grew. prune_growing_tables (p170) removes rate-limit
  // hits (IP addresses) after 2 days, finished webhook deliveries after 14, old notifications, used
  // Discord setup codes and finished invites and handover offers. A failure alerts but does not stop the
  // erasing above, which matters more.
  const { data: pruned, error: pErr } = await admin.rpc("prune_growing_tables");
  if (pErr) await opsAlert("cron campaign-purge", "prune_growing_tables failed (has p170 run?)", pErr.message);

  if (problems.length) {
    await opsAlert("cron campaign-purge", `${problems.length} problem(s) erasing trashed campaigns`, problems.slice(0, 5));
  }
  return NextResponse.json({ erased: erased.length, problems, more: ((due as unknown[] | null) ?? []).length === PER_RUN, pruned: pErr ? null : pruned }, { status: problems.length ? 500 : 200 });
}
