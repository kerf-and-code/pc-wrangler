import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Google (PKCE) sends the user back here with a ?code=...
// We exchange it for a session cookie, then send them on to the workspace.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/gm";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      let dest = next;
      // First-time GMs (no campaigns yet) land on the getting-started checklist
      // instead of the workspace. Only override the default target, never an
      // explicit ?next= (e.g. a page they were bounced from before signing in).
      if (next === "/gm") {
        const { count } = await supabase.from("campaigns").select("id", { count: "exact", head: true });
        if (!count) dest = "/gm/start";
      }
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }

  // code missing or exchange failed
  return NextResponse.redirect(`${origin}/auth/login?error=oauth`);
}
