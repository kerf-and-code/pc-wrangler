import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

const REMINDER_FROM = "Six Axes <recaps@send.kerfandcode.com>";
const UNSUBSCRIBE_MAILTO = "mailto:unsubscribe@send.kerfandcode.com";
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

function reminderHtml(campaignName: string, sessionNumber: number | null, whenText: string) {
  const heading = sessionNumber != null ? `${campaignName} — Session ${sessionNumber}` : campaignName;
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:24px;font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e3dbc9;border-radius:12px;padding:28px 30px;">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a7b2e;margin-bottom:6px;">Session reminder</div>
    <div style="font-size:20px;font-weight:700;color:#1c1a22;margin-bottom:14px;">${heading}</div>
    <p style="margin:0;line-height:1.7;color:#23202b;">Your next session is coming up: <strong>${whenText}</strong>. See you at the table.</p>
  </div>
  <div style="max-width:560px;margin:14px auto 0;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#8a8597;line-height:1.5;">
    You're receiving this because you RSVP'd through Six Axes.<br/>To stop, reply to this email or contact your GM.
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
  const now = new Date();
  const until = new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000);

  const { data: due, error } = await sb
    .from("sessions")
    .select("id, campaign_id, session_number, scheduled_at")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", until.toISOString())
    .is("reminder_sent_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let processed = 0, emailed = 0;

  for (const s of due || []) {
    const { data: rsvps } = await sb
      .from("attendance")
      .select("profile_id, status")
      .eq("session_id", s.id)
      .in("status", ["going", "maybe"]);

    const profileIds = Array.from(
      new Set((rsvps || []).map((r: any) => r.profile_id).filter(Boolean)),
    );

    // Resolve emails. Assumes attendance.profile_id === the auth user id.
    const emails: string[] = [];
    for (const pid of profileIds) {
      try {
        const { data } = await sb.auth.admin.getUserById(pid as string);
        const em = data?.user?.email;
        if (em) emails.push(em);
      } catch { /* skip */ }
    }

    const { data: campaign } = await sb
      .from("campaigns").select("name").eq("id", s.campaign_id).single();
    const campaignName = campaign?.name || "Your campaign";
    const whenText = s.scheduled_at ? new Date(s.scheduled_at).toUTCString() : "soon";

    if (emails.length) {
      const subject = `Reminder: ${campaignName}${s.session_number != null ? `, Session ${s.session_number}` : ""}`;
      const html = reminderHtml(campaignName, s.session_number, whenText);
      await Promise.all(emails.map((to) =>
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: REMINDER_FROM, to: [to], subject, html,
            headers: { "List-Unsubscribe": `<${UNSUBSCRIBE_MAILTO}>` },
          }),
        }).then((r) => { if (r.ok) emailed++; }).catch(() => {})));
    }

    // Mark reminded regardless, so we never re-process this session.
    await sb.from("sessions").update({ reminder_sent_at: new Date().toISOString() }).eq("id", s.id);
    processed++;
  }

  return NextResponse.json({ processed, emailed });
}
