import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// OAuth (PKCE) sends the user back here with a ?code=...
// We exchange it for a session cookie, then send them on.
//
// TWO CALLERS NOW.
//
// 1. SIGN IN (a GM logging in with Google or Discord). Unchanged: exchange, then
//    route to /gm, or to /gm/start if they have no campaigns yet.
//
// 2. UPGRADE (?upgrade=1). A guest who linked a durable identity via
//    supabase.auth.linkIdentity(). The auth user id is UNCHANGED by linking, so
//    there is nothing to migrate: their characters, TPDI responses, and
//    dispositions all still resolve through the same auth.uid(). All that remains
//    is to refresh the profile row from the provider's metadata and record the
//    upgrade, which is what upgrade_profile_from_auth() does.
//
//    The upgrade call is best-effort. If it fails, the identity is still linked and
//    the account still works; only display_name / avatar / is_anonymous would be
//    stale, and the next call fixes them. Failing the whole redirect over that
//    would be worse than the bug.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const isUpgrade = searchParams.get("upgrade") === "1";
  // A player returning from "sign in with Discord" to claim their characters. The button
  // sends ?claim=1, and the callback runs claim_by_discord once the session exists.
  const isClaim = searchParams.get("claim") === "1";
  const next = searchParams.get("next") ?? (isUpgrade ? "/me" : isClaim ? "/me" : "/gm");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      let dest = next;

      if (isUpgrade) {
        // Flip the profile from guest to durable. Idempotent, and it raises if the
        // user is somehow still anonymous, which we swallow: the redirect matters
        // more than the bookkeeping.
        try {
          await supabase.rpc("upgrade_profile_from_auth");
        } catch {
          // Left intentionally silent. See the note above.
        }
      } else if (isClaim) {
        // Bind every character linked to this Discord account to the profile they just
        // signed in as. Full transfer: the Discord identity is the source of truth, so a
        // character stranded on an old anonymous or Google profile is re-pointed here.
        //
        // Best-effort like the upgrade above: if it fails, the player is still signed in
        // with Discord and lands on /me, where a claim can be retried, rather than being
        // dumped on the GM login page. Route to the claimed character's table when there
        // is exactly one, so the common case is a clean one-click landing.
        try {
          const { data: claimed } = await supabase.rpc("claim_by_discord");
          const rows = (claimed as { campaign_share_code: string | null }[] | null) || [];
          const shares = Array.from(new Set(rows.map((r) => r.campaign_share_code).filter(Boolean)));
          if (shares.length === 1 && next === "/me") {
            dest = `/play?share=${encodeURIComponent(shares[0] as string)}`;
          }
        } catch {
          // Silent: they are signed in, /me will show whatever resolved.
        }
      } else if (next === "/gm") {
        // First-time GMs (no campaigns yet) land on the getting-started checklist
        // instead of the workspace. Only override the default target, never an
        // explicit ?next= (e.g. a page they were bounced from before signing in).
        const { count } = await supabase.from("campaigns").select("id", { count: "exact", head: true });
        if (!count) dest = "/gm/start";
      }

      return NextResponse.redirect(`${origin}${dest}`);
    }

    // The exchange failed. For an upgrade, do NOT dump the player on the GM login
    // page: they were mid-game, they are still signed in as a guest, and their
    // characters are fine. Send them back where they came from with a flag.
    if (isUpgrade) {
      const sep = next.includes("?") ? "&" : "?";
      return NextResponse.redirect(`${origin}${next}${sep}upgrade=failed`);
    }
  }

  // Code missing, or a sign-in exchange failed.
  if (isUpgrade) {
    const sep = next.includes("?") ? "&" : "?";
    return NextResponse.redirect(`${origin}${next}${sep}upgrade=failed`);
  }
  return NextResponse.redirect(`${origin}/auth/login?error=oauth`);
}
