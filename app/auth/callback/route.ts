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
  const next = searchParams.get("next") ?? (isUpgrade ? "/me" : "/gm");

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
