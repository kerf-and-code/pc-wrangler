import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { opsAlert } from "@/lib/ops-alert";
import { digestEmail, type NotificationRow } from "@/lib/notifications";
import { unsubscribeHeaders, unsubscribeUrl } from "@/lib/email/unsubscribe";
import { withCronBeat } from "@/lib/cron-beat";

export const maxDuration = 60;

// app/api/cron/notification-digest/route.ts (2026-11-10, push 19)
//
// Daily (vercel.json). One email per person who turned the digest on (email_prefs.digest, p150; off until
// they choose, Terry 2026-11-10) listing their unread notifications from the last two days that no
// digest has carried yet. digest_batch() does the choosing; after a send succeeds, exactly those ids get
// emailed_at, so a failed send is tried again tomorrow and nothing is mailed twice. Items read in the app
// first are skipped. Every email has a signed one-click unsubscribe for the digest alone.
// Also clears notifications older than 90 days, read or not.

const FROM = "Six Axes <recaps@send.kerfandcode.com>";
const BATCH = 300;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

type Batch = { profile_id: string; email: string; items: NotificationRow[] };

async function run(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "Email not configured" }, { status: 500 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Service role not configured" }, { status: 500 });

  const sb = admin();
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");

  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const { error: purgeErr } = await sb.from("notifications").delete().lt("created_at", cutoff);
  if (purgeErr) console.error("notification-digest: purge failed", purgeErr.message);

  const { data, error } = await sb.rpc("digest_batch", { p_limit: BATCH });
  if (error) {
    await opsAlert("cron notification-digest", "digest_batch failed (has p150 run?); no digests sent", error.message);
    return NextResponse.json({ error: "digest_batch failed" }, { status: 500 });
  }
  const batch = (data ?? []) as Batch[];

  let sent = 0, failed = 0, unmarked = 0;
  for (const b of batch) {
    const items = Array.isArray(b.items) ? b.items : [];
    if (!b.email || !items.length) continue;
    const unsub = unsubscribeUrl(origin, b.email, "digest");
    const mail = digestEmail(items, origin, unsub);
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [b.email], subject: mail.subject, html: mail.html, text: mail.text, headers: unsubscribeHeaders(unsub) }),
      });
      if (!r.ok) { failed++; continue; }
      sent++;
      const { error: mErr } = await sb.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", items.map((n) => n.id));
      if (mErr) unmarked++;
    } catch {
      failed++;
    }
  }

  if (failed || unmarked) {
    await opsAlert("cron notification-digest", `${failed} digest email(s) failed, ${sent} sent, ${unmarked} sent but not marked (may repeat tomorrow)`);
  }
  return NextResponse.json({ ok: true, people: batch.length, sent, failed, unmarked, more: batch.length >= BATCH });
}

// Push 50 (audit round 2, T15): every run is stamped in cron_runs (lib/cron-beat.ts), so a job that
// stops is noticed.
export const GET = withCronBeat("notification-digest", run);
