import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowedRecipients } from "@/lib/email/prefs";
import { unsubscribeHeaders, unsubscribeUrl } from "@/lib/email/unsubscribe";

export const maxDuration = 30;

// Audit B22 / T2 (2026-11-09): this route used to mail the recap to any 50 addresses, as often as it was
// called, gated only by whatever the sessions row rules allowed. Now: the caller must be the campaign's
// GM (checked here, not left to RLS), at most 20 addresses per send, at most 3 sends per session and 60
// recipients per GM in any 24 hours (recap_sends, p134). Each email links to the campaign's recap page.
// Push 1 (audit T12): addresses that switched recaps off (email_prefs, p138) are skipped, and each email
// carries its own signed one-click unsubscribe link instead of a mailto nobody reads.

// Must be an address on your Resend-verified sending domain.
const RECAP_FROM = "Six Axes <recaps@send.kerfandcode.com>";
const MAX_RECIPIENTS = 20;
const MAX_SENDS_PER_SESSION_PER_DAY = 3;
const MAX_RECIPIENTS_PER_GM_PER_DAY = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function recapHtml(campaignName: string, sessionNumber: number | null, recap: string, link: string | null, unsubscribe: string) {
  const paragraphs = esc(recap)
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.7;color:#23202b;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const heading = sessionNumber != null
    ? `${esc(campaignName)}, Session ${sessionNumber}`
    : esc(campaignName);
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:24px;font-family:Georgia,'Iowan Old Style',serif;">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e3dbc9;border-radius:12px;padding:28px 30px;">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a7b2e;margin-bottom:6px;">Previously on…</div>
    <div style="font-size:20px;font-weight:700;color:#1c1a22;margin-bottom:18px;">${heading}</div>
    ${paragraphs}
    ${link ? `<p style="margin:22px 0 0;"><a href="${esc(link)}" style="display:inline-block;background:#9a7b2e;color:#fffdf8;text-decoration:none;padding:10px 16px;border-radius:8px;font-family:Arial,sans-serif;font-size:14px;">Read every recap for ${esc(campaignName)}</a></p>` : ""}
  </div>
  <div style="max-width:560px;margin:14px auto 0;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#8a8597;line-height:1.5;">
    You're receiving this because your GM shares Six Axes recaps with your table.<br/>
    <a href="${esc(unsubscribe)}" style="color:#8a8597;">Stop recap emails</a>
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

    // RLS decides which sessions the caller can read; being the GM is checked below as well.
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

    const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: session.campaign_id });
    if (!isGm) {
      return NextResponse.json({ error: "Only the campaign's GM sends recaps." }, { status: 403 });
    }

    const { data: campaign } = await supabase
      .from("campaigns").select("name, share_code").eq("id", session.campaign_id).single();
    const campaignName = campaign?.name || "Your campaign";
    const origin = new URL(request.url).origin;
    const link = campaign?.share_code ? `${origin}/recaps?share=${encodeURIComponent(campaign.share_code)}` : null;

    // Email-only route: require at least one valid email. Discord posting has its
    // own button (/api/recap/post-discord).
    if (!emails.length) {
      return NextResponse.json(
        { error: "Add at least one valid email address." },
        { status: 400 },
      );
    }

    // The daily limits, from the log of earlier sends.
    const admin = createAdminClient();
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent, error: logErr } = await admin
      .from("recap_sends").select("session_id, recipients").eq("sent_by", user.id).gte("created_at", since);
    if (logErr) {
      console.error("recap/send: recap_sends unreadable (has p134 run?)", logErr.message);
      return NextResponse.json({ error: "Recap email is not available right now. Try again later." }, { status: 503 });
    }
    const rows = (recent ?? []) as { session_id: string; recipients: number }[];
    if (rows.filter((r) => r.session_id === session.id).length >= MAX_SENDS_PER_SESSION_PER_DAY) {
      return NextResponse.json({ error: `This recap has already been emailed ${MAX_SENDS_PER_SESSION_PER_DAY} times today. Try again tomorrow, or share the recap link instead.` }, { status: 429 });
    }
    const usedToday = rows.reduce((a, r) => a + (r.recipients || 0), 0);
    if (usedToday + emails.length > MAX_RECIPIENTS_PER_GM_PER_DAY) {
      return NextResponse.json({ error: `That would pass today's limit of ${MAX_RECIPIENTS_PER_GM_PER_DAY} recap emails. Share the recap link instead, or try again tomorrow.` }, { status: 429 });
    }

    let sent = 0;
    let failed: string[] = [];
    let optedOut: string[] = [];

    const prefs = await allowedRecipients(admin, emails, "recaps");
    if (!prefs.ok) {
      console.error("recap/send: email_prefs unreadable (has p138 run?)", prefs.error);
      return NextResponse.json({ error: "Recap email is not available right now. Try again later." }, { status: 503 });
    }
    optedOut = prefs.optedOut;
    const toSend = prefs.allowed;

    if (toSend.length) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "Email service is not configured." }, { status: 500 });
      }

      const subject = session.session_number != null
        ? `Recap: ${campaignName}, Session ${session.session_number}`
        : `Recap: ${campaignName}`;
      const results = await Promise.all(toSend.map(async (to) => {
        const unsub = unsubscribeUrl(origin, to, "recaps");
        const html = recapHtml(campaignName, session.session_number, session.recap, link, unsub);
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              from: RECAP_FROM,
              to: [to],
              subject,
              html,
              headers: unsubscribeHeaders(unsub),
            }),
          });
          return res.ok ? { to, ok: true } : { to, ok: false };
        } catch {
          return { to, ok: false };
        }
      }));

      sent = results.filter((r) => r.ok).length;
      failed = results.filter((r) => !r.ok).map((r) => r.to);
      // Logged after sending, counting what was attempted, so failures still count toward the limits.
      await admin.from("recap_sends").insert({ campaign_id: session.campaign_id, session_id: session.id, sent_by: user.id, recipients: toSend.length });
    }

    // Discord posting is a separate action (see /api/recap/post-discord), so this
    // route no longer side-posts to Discord. Email only.
    return NextResponse.json({ sent, failed, optedOut });
  } catch {
    return NextResponse.json({ error: "Could not send recap." }, { status: 500 });
  }
}
