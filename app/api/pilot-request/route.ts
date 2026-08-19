import { NextResponse } from "next/server";

// app/api/pilot-request/route.ts
//
// Receives the pilot application form (app/pilot -> components/pilot-form) and emails it to the admin.
// PUBLIC and unauthenticated by design: it must be on the logged-out allowlist in proxy.ts, or the
// middleware 307s the POST to /auth/login and the form silently fails.
//
// Uses the same Resend-over-fetch pattern as app/api/recap/send: RESEND_API_KEY, a from-address on the
// verified send.kerfandcode.com domain, and reply_to set to the applicant so the admin can just reply.
//
// Abuse: no login means no per-user identity, so this leans on a honeypot field (`company`, hidden in
// the form) plus length caps and required-field validation. A pilot form is low volume; that is enough.

export const maxDuration = 20;

const TO = "kncadmin@kerfandcode.com";
const FROM = "Six Axes Pilot <pilot@send.kerfandcode.com>";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Trim + hard cap so a giant paste cannot bloat the email or the request.
function clip(v: unknown, max: number) {
  return String(v ?? "").trim().slice(0, max);
}

function applicationHtml(f: {
  name: string; email: string; system: string; setting: string; tables: string; description: string;
}) {
  const row = (label: string, value: string) =>
    `<tr>
      <td style="padding:6px 14px 6px 0;color:#8a7b55;font:12px/1.4 Arial,sans-serif;text-transform:uppercase;letter-spacing:0.08em;vertical-align:top;white-space:nowrap;">${esc(label)}</td>
      <td style="padding:6px 0;color:#23202b;font:15px/1.55 Georgia,serif;">${esc(value) || "(none)"}</td>
    </tr>`;
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:24px;font-family:Georgia,'Iowan Old Style',serif;">
  <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e3dbc9;border-radius:12px;padding:26px 28px;">
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a7b2e;margin-bottom:6px;">New pilot application</div>
    <div style="font-size:20px;font-weight:700;color:#1c1a22;margin-bottom:16px;">${esc(f.name) || "Unnamed applicant"}</div>
    <table style="border-collapse:collapse;width:100%;">
      ${row("Email", f.email)}
      ${row("System", f.system)}
      ${row("Setting", f.setting)}
      ${row("Tables", f.tables)}
    </table>
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid #eee3cc;">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a7b55;margin-bottom:6px;font-family:Arial,sans-serif;">Their table</div>
      <div style="font-size:15px;line-height:1.6;color:#23202b;white-space:pre-wrap;">${esc(f.description) || "(none)"}</div>
    </div>
  </div>
  <div style="max-width:560px;margin:12px auto 0;text-align:center;font:11px/1.5 Arial,sans-serif;color:#8a8597;">
    Reply to this email to answer the applicant directly.
  </div>
</body></html>`;
}

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => ({}));

    // Honeypot: a bot filled the hidden field. Accept silently, send nothing.
    if (clip(raw?.company, 100)) {
      return NextResponse.json({ ok: true });
    }

    const f = {
      name: clip(raw?.name, 120),
      email: clip(raw?.email, 200).toLowerCase(),
      system: clip(raw?.system, 80),
      setting: clip(raw?.setting, 80),
      tables: clip(raw?.tables, 20),
      description: clip(raw?.description, 2000),
    };

    if (!f.name || !f.email) {
      return NextResponse.json({ error: "Please add your name and email." }, { status: 400 });
    }
    if (!EMAIL_RE.test(f.email)) {
      return NextResponse.json({ error: "That email does not look right." }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Email service is not configured." }, { status: 500 });
    }

    const subject = `Pilot application: ${f.name}${f.system ? ` (${f.system})` : ""}`;
    const html = applicationHtml(f);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: f.email,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Could not send your application. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not send your application. Please try again." }, { status: 500 });
  }
}
