import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribe, type EmailKind } from "@/lib/email/unsubscribe";

// /api/email/unsubscribe?e=<address>&k=reminders|recaps|digest|all&s=<signature> (2026-11-09; digest push 19)
//
// Audit T12 / F7: the unsubscribe link in every Six Axes email. No sign-in needed (the signature proves
// the link was ours, for this address). Opening the link shows a button rather than unsubscribing at once,
// because mail scanners open links on their own; the button, and the one-click POST a mail app sends
// (List-Unsubscribe-Post), do the unsubscribe. It is in the logged-out allowlist in lib/supabase/proxy.ts.

const WHAT: Record<EmailKind, string> = {
  reminders: "session reminders and RSVP requests",
  recaps: "session recap emails",
  digest: "the daily digest",
  all: "all Six Axes emails",
};

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#14121a;color:#ece6d8;font-family:Georgia,serif;padding:16px">
<main style="max-width:440px;text-align:center"><div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#c9a44c;margin-bottom:10px">Six Axes</div>
<h1 style="font-size:22px;margin:0 0 12px">${title}</h1>${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function read(url: URL) {
  const email = (url.searchParams.get("e") || "").trim().toLowerCase();
  const kind = url.searchParams.get("k") || "";
  const sig = url.searchParams.get("s") || "";
  return { email, kind, ok: verifyUnsubscribe(email, kind, sig) };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { email, kind, ok } = read(url);
  if (!ok) return page("This link does not work", `<p style="line-height:1.6;color:#bdb5a6">It may have been cut short by your mail app. Open it again from the email, or change your email settings on your Settings page after signing in.</p>`, 400);
  return page("Unsubscribe?", `<p style="line-height:1.6;color:#bdb5a6">Stop ${WHAT[kind as EmailKind]} to <strong style="color:#ece6d8">${esc(email)}</strong>?</p>
<form method="post" action="${esc(url.pathname + url.search)}"><button type="submit" style="background:#c9a44c;color:#14121a;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer">Unsubscribe</button></form>`);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const { email, kind, ok } = read(url);
  if (!ok) return page("This link does not work", `<p style="color:#bdb5a6">Nothing was changed.</p>`, 400);
  const admin = createAdminClient();
  const { data: cur } = await admin.from("email_prefs").select("reminders, recaps, digest").eq("email", email).maybeSingle();
  const prev = (cur as { reminders: boolean; recaps: boolean; digest: boolean } | null) ?? { reminders: true, recaps: true, digest: false };
  const next = {
    email,
    reminders: kind === "reminders" || kind === "all" ? false : prev.reminders,
    recaps: kind === "recaps" || kind === "all" ? false : prev.recaps,
    digest: kind === "digest" || kind === "all" ? false : prev.digest,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("email_prefs").upsert(next, { onConflict: "email" });
  if (error) {
    console.error("email/unsubscribe: could not save", error.message);
    return page("That did not work", `<p style="color:#bdb5a6">Please try the link again in a few minutes.</p>`, 500);
  }
  return page("You are unsubscribed", `<p style="line-height:1.6;color:#bdb5a6">No more ${WHAT[kind as EmailKind]} to ${esc(email)}. You can turn them back on from your Settings page.</p>`);
}
