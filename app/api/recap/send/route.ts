import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

// Must be an address on your Resend-verified sending domain.
const RECAP_FROM = "Six Axes <recaps@send.kerfandcode.com>";
const UNSUBSCRIBE_MAILTO = "mailto:unsubscribe@send.kerfandcode.com";
const MAX_RECIPIENTS = 50;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function recapHtml(campaignName: string, sessionNumber: number | null, recap: string) {
  const paragraphs = esc(recap)
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.7;color:#23202b;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const heading = sessionNumber != null
    ? `${esc(campaignName)} — Session ${sessionNumber}`
    : esc(campaignName);
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:24px;font-family:Georgia,'Iowan Old Style',serif;">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e3dbc9;border-radius:12px;padding:28px 30px;">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a7b2e;margin-bottom:6px;">Previously on…</div>
    <div style="font-size:20px;font-weight:700;color:#1c1a22;margin-bottom:18px;">${heading}</div>
    ${paragraphs}
  </div>
  <div style="max-width:560px;margin:14px auto 0;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#8a8597;line-height:1.5;">
    You're receiving this because your GM shares Six Axes recaps with your table.<br/>
    To stop, reply to this email or contact your GM.
  </div>
</body></html>`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = body?.sessionId;
    const rawEmails: string[] = Array.isArray(body?.emails) ? body.emails : [];
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId." }, { status: 400 });
    }

    const emails = Array.from(new Set(
      rawEmails.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)),
    )).slice(0, MAX_RECIPIENTS);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    }

    // RLS ensures the user can only read their own session.
    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .select("id, campaign_id, session_number, recap")
      .eq("id", sessionId)
      .single();
    if (sErr || !session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    if (!session.recap || !session.recap.trim()) {
      return NextResponse.json({ error: "Save a recap before sending." }, { status: 422 });
    }

    const { data: campaign } = await supabase
      .from("campaigns").select("name, discord_channel_id").eq("id", session.campaign_id).single();
    const campaignName = campaign?.name || "Your campaign";

    // Email-only route: require at least one valid email. Discord posting has its
    // own button (/api/recap/post-discord).
    if (!emails.length) {
      return NextResponse.json(
        { error: "Add at least one valid email address." },
        { status: 400 },
      );
    }

    let sent = 0;
    let failed: string[] = [];

    if (emails.length) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "Email service is not configured." }, { status: 500 });
      }

      const subject = session.session_number != null
        ? `Recap — ${campaignName}, Session ${session.session_number}`
        : `Recap — ${campaignName}`;
      const html = recapHtml(campaignName, session.session_number, session.recap);

      const results = await Promise.all(emails.map(async (to) => {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              from: RECAP_FROM,
              to: [to],
              subject,
              html,
              headers: { "List-Unsubscribe": `<${UNSUBSCRIBE_MAILTO}>` },
            }),
          });
          return res.ok ? { to, ok: true } : { to, ok: false };
        } catch {
          return { to, ok: false };
        }
      }));

      sent = results.filter((r) => r.ok).length;
      failed = results.filter((r) => !r.ok).map((r) => r.to);
    }

    // Discord posting is a separate action (see /api/recap/post-discord), so this
    // route no longer side-posts to Discord. Email only.
    return NextResponse.json({ sent, failed });
  } catch {
    return NextResponse.json({ error: "Could not send recap." }, { status: 500 });
  }
}
