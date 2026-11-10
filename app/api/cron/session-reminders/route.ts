import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { opsAlert } from "@/lib/ops-alert";
import { allowedRecipients } from "@/lib/email/prefs";
import { formatSessionTime } from "@/lib/email/time";
import { unsubscribeHeaders, unsubscribeUrl } from "@/lib/email/unsubscribe";

export const maxDuration = 60;

// Daily (vercel.json). For each session scheduled in the next ~30 hours:
//   - players who RSVP'd going or maybe get a reminder;
//   - players with a character in the campaign who have not answered at all get an RSVP request
//     ("are you in?"), which used to be skipped entirely (audit F7);
//   - the time is printed in the campaign's time zone, named, with a link to see it in their own (audit
//     U2: it printed GMT);
//   - anyone who switched reminders off (email_prefs, p138) is skipped, and every email carries a signed
//     one-click unsubscribe link (audit T12; the old mailto went to an address nobody reads);
//   - the session is marked reminded only when at least one email went out or there was no one to email,
//     so a run where every send failed is tried again (it used to be marked sent regardless).
//   - a campaign in the trash (push 2) sends nothing.

const REMINDER_FROM = "Six Axes <recaps@send.kerfandcode.com>";
const WINDOW_HOURS = 30; // remind for sessions scheduled within the next ~30h

// Service-role client: bypasses RLS so the job can read across campaigns and
// resolve player emails. Server-only; never import this key on the client.
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function emailHtml(o: {
  kind: "reminder" | "rsvp"; campaignName: string; sessionNumber: number | null; whenText: string;
  scheduleUrl: string | null; unsubscribe: string;
}) {
  const heading = o.sessionNumber != null ? `${esc(o.campaignName)}, Session ${o.sessionNumber}` : esc(o.campaignName);
  const line = o.kind === "reminder"
    ? `Your next session is coming up: <strong>${esc(o.whenText)}</strong>. See you at the table.`
    : `Your table plays <strong>${esc(o.whenText)}</strong>. Are you in? Let your GM know.`;
  const button = o.scheduleUrl
    ? `<p style="margin:18px 0 0;"><a href="${esc(o.scheduleUrl)}" style="display:inline-block;background:#9a7b2e;color:#fffdf8;text-decoration:none;padding:10px 16px;border-radius:8px;font-family:Arial,sans-serif;font-size:14px;">${o.kind === "rsvp" ? "Answer: going, maybe or not" : "See it in your own time zone"}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:24px;font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e3dbc9;border-radius:12px;padding:28px 30px;">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a7b2e;margin-bottom:6px;">${o.kind === "rsvp" ? "Are you in?" : "Session reminder"}</div>
    <div style="font-size:20px;font-weight:700;color:#1c1a22;margin-bottom:14px;">${heading}</div>
    <p style="margin:0;line-height:1.7;color:#23202b;">${line}</p>
    ${button}
  </div>
  <div style="max-width:560px;margin:14px auto 0;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#8a8597;line-height:1.5;">
    You're receiving this because you play in a Six Axes campaign.<br/>
    <a href="${esc(o.unsubscribe)}" style="color:#8a8597;">Stop session reminders</a>
  </div>
</body></html>`;
}

export async function GET(request: Request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "Email not configured" }, { status: 500 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Service role not configured" }, { status: 500 });
  }

  const sb = admin();
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const now = new Date();
  const until = new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000);

  const { data: due, error } = await sb
    .from("sessions")
    .select("id, campaign_id, session_number, scheduled_at")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", until.toISOString())
    .is("reminder_sent_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let processed = 0, emailed = 0, failed = 0, skipped = 0, retried = 0;
  const emailOf = new Map<string, string | null>();
  const resolveEmail = async (pid: string) => {
    if (!emailOf.has(pid)) {
      try {
        const { data } = await sb.auth.admin.getUserById(pid);
        emailOf.set(pid, data?.user?.email ?? null);
      } catch { emailOf.set(pid, null); }
    }
    return emailOf.get(pid) ?? null;
  };

  for (const s of due || []) {
    const [{ data: rsvps }, { data: party }, { data: campaign }] = await Promise.all([
      sb.from("attendance").select("profile_id, status").eq("session_id", s.id),
      sb.from("characters").select("profile_id").eq("campaign_id", s.campaign_id).eq("kind", "pc").eq("active", true).not("profile_id", "is", null),
      sb.from("campaigns").select("name, share_code, time_zone, gm_id, deleted_at").eq("id", s.campaign_id).single(),
    ]);
    // A campaign in the trash (p139) sends nothing; it is not marked, so a restore before the session
    // still gets its reminder on the next run.
    if ((campaign as { deleted_at?: string | null } | null)?.deleted_at) continue;
    const rows = (rsvps as { profile_id: string | null; status: string }[] | null) ?? [];
    const answered = new Set(rows.map((r) => r.profile_id).filter((p): p is string => !!p));
    const going = new Set(rows.filter((r) => r.status === "going" || r.status === "maybe").map((r) => r.profile_id).filter((p): p is string => !!p));
    const gmId = (campaign as { gm_id?: string } | null)?.gm_id;
    const unanswered = new Set(((party as { profile_id: string }[] | null) ?? []).map((r) => r.profile_id).filter((p) => p && p !== gmId && !answered.has(p)));

    const c = campaign as { name: string | null; share_code: string | null; time_zone: string | null } | null;
    const campaignName = c?.name || "Your campaign";
    const whenText = s.scheduled_at ? formatSessionTime(s.scheduled_at, c?.time_zone) : "soon";
    const scheduleUrl = c?.share_code ? `${origin}/schedule?share=${encodeURIComponent(c.share_code)}` : null;

    const targets: { email: string; kind: "reminder" | "rsvp" }[] = [];
    for (const pid of going) { const e = await resolveEmail(pid); if (e) targets.push({ email: e.toLowerCase(), kind: "reminder" }); }
    for (const pid of unanswered) { const e = await resolveEmail(pid); if (e) targets.push({ email: e.toLowerCase(), kind: "rsvp" }); }

    const prefs = await allowedRecipients(sb, targets.map((t) => t.email), "reminders");
    if (!prefs.ok) {
      // Never mail people who may have said no: leave the session for the next run and say so.
      await opsAlert("cron session-reminders", "email_prefs unreadable (has p138 run?); no reminders sent", prefs.error);
      return NextResponse.json({ error: "email preferences unreadable" }, { status: 500 });
    }
    const allowed = new Set(prefs.allowed);
    skipped += prefs.optedOut.length;
    const send = targets.filter((t, i, a) => allowed.has(t.email) && a.findIndex((x) => x.email === t.email) === i);

    let ok = 0, bad = 0;
    const subjectBase = `${campaignName}${s.session_number != null ? `, Session ${s.session_number}` : ""}`;
    await Promise.all(send.map(async (t) => {
      const unsub = unsubscribeUrl(origin, t.email, "reminders");
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: REMINDER_FROM, to: [t.email],
            subject: t.kind === "rsvp" ? `Are you in? ${subjectBase}` : `Reminder: ${subjectBase}`,
            html: emailHtml({ kind: t.kind, campaignName, sessionNumber: s.session_number, whenText, scheduleUrl, unsubscribe: unsub }),
            headers: unsubscribeHeaders(unsub),
          }),
        });
        if (r.ok) ok++; else bad++;
      } catch { bad++; }
    }));
    emailed += ok; failed += bad;

    if (ok > 0 || send.length === 0) {
      await sb.from("sessions").update({ reminder_sent_at: new Date().toISOString() }).eq("id", s.id);
      processed++;
    } else {
      retried++; // every send failed: left unmarked so the next run tries again
    }
  }

  // Audit T1: failed sends alert and fail the run rather than vanishing.
  if (failed) await opsAlert("cron session-reminders", `${failed} reminder email(s) failed to send, ${emailed} sent, ${retried} session(s) left for the next run`);
  return NextResponse.json({ processed, emailed, failed, skipped, retried }, { status: failed ? 500 : 200 });
}
