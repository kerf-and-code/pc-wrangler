// lib/gm-allowlist.ts (2026-11-12, push 41.5: GM access by email, no access code)
//
// GM access in the pilot used to need a shared code typed at /enter (SITE_ACCESS_CODE). It is now an
// allowlist: GM_EMAILS in the server environment, a comma-separated list of addresses (case does not
// matter). An account whose verified email is on the list is given GM access the first time it reaches
// the GM tools (lib/supabase/proxy.ts) or /enter (app/api/gate/route.ts), using the same flags the code
// used to set (profiles.access_granted and access_role = "gm"), so everything that checks those flags
// keeps working. The owner console (/admin) can still grant and revoke by hand; note that a revoked
// account still on the list gets GM access back on its next visit, so take it off the list first.
//
// WHICH EMAILS COUNT: only ones a sign-in provider has verified. The account's own email counts once it
// is confirmed (Google, a magic link, a confirmed email sign-up); each linked sign-in (Google, Discord)
// counts by its own email when that provider marks it verified. So an account with Google and Discord
// linked qualifies if EITHER verified address is on the list. Someone cannot get in by typing a listed
// address into a new, unconfirmed account. Anonymous accounts have no email and never match.

import type { SupabaseClient } from "@supabase/supabase-js";

type Identity = { identity_data?: Record<string, unknown> | null };
export type AllowlistUser = {
  email?: string | null;
  email_confirmed_at?: string | null;
  is_anonymous?: boolean | null;
  identities?: Identity[] | null;
};

/** The GM_EMAILS setting as a set of lower-case addresses. Blank entries are ignored. */
export function parseAllowlist(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")),
  );
}

/** Every email on this account that a provider has verified, lower-cased. */
export function verifiedEmails(user: AllowlistUser | null | undefined): string[] {
  if (!user || user.is_anonymous) return [];
  const out = new Set<string>();
  if (user.email && user.email_confirmed_at) out.add(user.email.trim().toLowerCase());
  for (const id of user.identities ?? []) {
    const d = id.identity_data ?? {};
    const email = typeof d.email === "string" ? d.email : null;
    if (email && d.email_verified === true) out.add(email.trim().toLowerCase());
  }
  return [...out];
}

/** Whether any verified email on the account is on the list. */
export function onAllowlist(user: AllowlistUser | null | undefined, list: Set<string>): boolean {
  if (list.size === 0) return false;
  return verifiedEmails(user).some((e) => list.has(e));
}

/**
 * If this account is on GM_EMAILS and does not have GM access yet, give it. Returns true when the account
 * has GM access after the call. `admin` must be a service-role client: it reads the account's verified
 * emails and writes the flag, which no signed-in user may write for themselves (p148, p164).
 */
export async function grantFromAllowlist(admin: SupabaseClient, userId: string): Promise<boolean> {
  const list = parseAllowlist(process.env.GM_EMAILS);
  if (list.size === 0) return false;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return false;
  if (!onAllowlist(data.user as AllowlistUser, list)) return false;
  const { error: upErr } = await admin.from("profiles")
    .update({ access_granted: true, access_role: "gm" }).eq("id", userId);
  return !upErr;
}
