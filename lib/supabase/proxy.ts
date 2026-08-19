import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });
  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }
  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.
  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  if (
    !user &&
    // Public legal pages. These MUST be reachable by a logged-out visitor: the Chrome
    // Web Store reviewer opens /privacy with no session, and if it redirects to
    // /auth/login the extension is rejected (violation "Purple Nickel": privacy policy
    // not accessible). They are also linked from the Discord consent message, which
    // players follow before they have any account.
    !request.nextUrl.pathname.startsWith("/privacy") &&
    !request.nextUrl.pathname.startsWith("/terms") &&
    !request.nextUrl.pathname.startsWith("/ai-recording") &&
    // The extension setup page: a player clicks it to link their campaign before login.
    !request.nextUrl.pathname.startsWith("/x/") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !request.nextUrl.pathname.startsWith("/play") &&
    !request.nextUrl.pathname.startsWith("/vibe") &&
    !request.nextUrl.pathname.startsWith("/chat") &&
    !request.nextUrl.pathname.startsWith("/record") &&
    !request.nextUrl.pathname.startsWith("/join") &&
    !request.nextUrl.pathname.startsWith("/setup") &&
    !request.nextUrl.pathname.startsWith("/lore") &&
    !request.nextUrl.pathname.startsWith("/map") &&
    !request.nextUrl.pathname.startsWith("/journal") &&
    !request.nextUrl.pathname.startsWith("/me") &&
    !request.nextUrl.pathname.startsWith("/api/transcribe") &&
    !request.nextUrl.pathname.startsWith("/api/extract") &&
    !request.nextUrl.pathname.startsWith("/api/discord") &&
    !request.nextUrl.pathname.startsWith("/api/vtt") &&
    !request.nextUrl.pathname.startsWith("/api/cron") &&
    !request.nextUrl.pathname.startsWith("/table") &&
    // ---- everything below added 2026-08-03, after a 307 to /auth/login was traced back here ----
    //
    // THE LANDING PAGE. Exact match, because startsWith("/") would exempt the entire site. Without
    // this, a logged-out visitor - which is every visitor arriving from a search result, a Reddit
    // post or a published codex footer - is bounced to a login form for a product they have not
    // signed up for. It went unnoticed because everyone testing it was already signed in.
    request.nextUrl.pathname !== "/" &&
    !request.nextUrl.pathname.startsWith("/enter") &&
    //
    // THE PILOT APPLICATION PAGE + its form endpoint (added 2026-08). Public by design: a logged-out
    // visitor arriving from the landing page applies here without an account. /api/pilot-request only
    // emails the admin (no session), so it must accept a POST with no auth, or the form silently 307s
    // to /auth/login and the application is lost.
    !request.nextUrl.pathname.startsWith("/pilot") &&
    !request.nextUrl.pathname.startsWith("/api/pilot-request") &&
    //
    // THE FREE TOOLS HUB (added 2026-08). The no-login SEO tools live under /tools and store nothing;
    // they must be public or the search traffic they exist to catch is bounced to a login form. Their
    // API endpoints (metered renders, generators) live under /api/tools and are exempted alongside.
    !request.nextUrl.pathname.startsWith("/tools") &&
    !request.nextUrl.pathname.startsWith("/api/tools") &&
    //
    // PUBLISHED CODEXES. The whole point of /c/ is that a stranger can read it with no account, and
    // p23 already decides what a stranger may see. This middleware was silently overriding that:
    // the read gate said "published and marked public", the redirect said "sign in first", and the
    // redirect won.
    !request.nextUrl.pathname.startsWith("/c/") &&
    //
    // THE FOUNDRY MODULE. Foundry fetches the manifest server-side with no session, gets the login
    // page as HTML, and reports "Unexpected token '<'". The install page is public documentation.
    !request.nextUrl.pathname.startsWith("/foundry") &&
    //
    // CRAWLER FILES. A robots.txt behind a login is worse than none: the crawler cannot read the
    // rules and cannot reach the sitemap that lists the pages we want indexed.
    request.nextUrl.pathname !== "/robots.txt" &&
    request.nextUrl.pathname !== "/sitemap.xml" &&
    !request.nextUrl.pathname.startsWith("/opengraph-image") &&
    !request.nextUrl.pathname.startsWith("/twitter-image") &&
    !request.nextUrl.pathname.startsWith("/icon")
  ) {
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // ---- Secondary access gate (private pilot) ----
  // An authenticated user who has not entered the pilot code is held at /enter. Only the private app
  // (/gm, /me) is gated; the published wiki, share links, auth and legal pages stay open via the
  // allowlist above, and /enter itself is never gated (it starts with neither prefix). The flag lives
  // on profiles.access_granted and is set ONLY by /api/gate, after the code is verified server-side,
  // so a user cannot grant themselves by calling the database directly.
  if (user) {
    const path = request.nextUrl.pathname;
    if (path.startsWith("/gm") || path.startsWith("/me")) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("access_granted, access_role")
        .eq("id", user.sub as string)
        .maybeSingle();
      if (!profile?.access_granted) {
        // Not in the pilot at all: send to the code screen.
        const url = request.nextUrl.clone();
        url.pathname = "/enter";
        return NextResponse.redirect(url);
      }
      if (path.startsWith("/gm") && profile.access_role !== "gm") {
        // In the pilot on a player code: the GM tools are off-limits, send them to their own area.
        const url = request.nextUrl.clone();
        url.pathname = "/me";
        return NextResponse.redirect(url);
      }
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!
  return supabaseResponse;
}
