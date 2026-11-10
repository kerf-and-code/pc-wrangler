import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

// POST /api/gm/campaign/transfer   body: { campaignId, email } (2026-11-09)
//
// Audit F2: the campaign's owner offers it to another GM. offer_campaign_transfer (p140) checks the
// caller owns it and records the offer; this route then emails the accept link (/gm/transfer?t=...) and
// also returns it, so the owner can send it another way if the email does not arrive. The offer lasts 7
// days; the recipient must accept while signed in as that address, with GM access.

const FROM = "Six Axes <recaps@send.kerfandcode.com>";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { campaignId?: string; email?: string };
  const campaignId = (body.campaignId || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  if (!UUID.test(campaignId) || !email) return NextResponse.json({ error: "Missing campaign or email address." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const { data: offer, error } = await supabase.rpc("offer_campaign_transfer", { p_campaign: campaignId, p_email: email });
  if (error || !offer) return NextResponse.json({ error: error?.message || "Could not create the handover." }, { status: 400 });
  const { token, expiresAt } = offer as { token: string; expiresAt: string };

  const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const link = `${origin}/gm/transfer?t=${encodeURIComponent(token)}`;
  const { data: camp } = await supabase.from("campaigns").select("name").eq("id", campaignId).single();
  const name = (camp as { name?: string } | null)?.name || "a campaign";
  const { data: me } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const from = (me as { display_name?: string | null } | null)?.display_name || "A GM";

  let emailed = false;
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:24px;font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e3dbc9;border-radius:12px;padding:28px 30px;">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a7b2e;margin-bottom:6px;">Campaign handover</div>
    <div style="font-size:20px;font-weight:700;color:#1c1a22;margin-bottom:14px;">${esc(from)} wants you to run ${esc(name)}</div>
    <p style="margin:0 0 16px;line-height:1.7;color:#23202b;">Accepting makes you the campaign's GM on Six Axes, with its sessions, codex, maps and table. Sign in with this email address to accept. You need GM access on Six Axes. The link works for 7 days.</p>
    <p style="margin:0;"><a href="${esc(link)}" style="display:inline-block;background:#9a7b2e;color:#fffdf8;text-decoration:none;padding:10px 16px;border-radius:8px;font-family:Arial,sans-serif;font-size:14px;">Review the handover</a></p>
  </div>
  <div style="max-width:560px;margin:14px auto 0;text-align:center;font-family:Arial,sans-serif;font-size:11px;color:#8a8597;line-height:1.5;">
    You're receiving this one email because a Six Axes GM entered your address. If you don't know them, ignore it.
  </div>
</body></html>`;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [email], subject: `${from} wants you to run ${name} on Six Axes`, html }),
      });
      emailed = r.ok;
    } catch { emailed = false; }
  }
  return NextResponse.json({ link, emailed, expiresAt });
}
