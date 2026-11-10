import { createHmac, timingSafeEqual } from "node:crypto";

// lib/email/unsubscribe.ts (2026-11-09)
//
// Audit T12 / F7: every email carries a one-click unsubscribe link that works without signing in. The
// link names the address and what to stop (reminders, recaps or all) and is signed, so nobody can switch
// off someone else's email by editing the URL. Server only: the key is EMAIL_LINK_SECRET, or failing that
// the service-role key, which never leaves the server.

export type EmailKind = "reminders" | "recaps" | "all";
const KINDS: EmailKind[] = ["reminders", "recaps", "all"];

function key(): string {
  const k = process.env.EMAIL_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("no email link key (EMAIL_LINK_SECRET or SUPABASE_SERVICE_ROLE_KEY)");
  return k;
}

export function signUnsubscribe(email: string, kind: EmailKind, secret = key()): string {
  return createHmac("sha256", secret).update(`unsubscribe|${email.trim().toLowerCase()}|${kind}`).digest("base64url");
}

export function verifyUnsubscribe(email: string, kind: string, sig: string, secret = key()): kind is EmailKind {
  if (!KINDS.includes(kind as EmailKind) || !email || !sig) return false;
  const want = Buffer.from(signUnsubscribe(email, kind as EmailKind, secret));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The unsubscribe page for one address and kind of email. */
export function unsubscribeUrl(origin: string, email: string, kind: EmailKind, secret?: string): string {
  const e = email.trim().toLowerCase();
  const q = new URLSearchParams({ e, k: kind, s: signUnsubscribe(e, kind, secret) });
  return `${origin.replace(/\/$/, "")}/api/email/unsubscribe?${q.toString()}`;
}

/** Headers for one-click unsubscribe in mail apps (RFC 8058). */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
