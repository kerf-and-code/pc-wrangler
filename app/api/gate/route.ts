import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { grantFromAllowlist } from "@/lib/gm-allowlist";
import { coGmsAnything } from "@/lib/campaign-gm";

// Where the signed-in account stands with GM access, for /enter.
//
// Push 41.5 (2026-11-12): the pilot's shared access codes (SITE_ACCESS_CODE, PLAYER_ACCESS_CODE) are
// retired. GM access now comes from GM_EMAILS (lib/gm-allowlist.ts) or the owner console. This route
// takes no code: it answers whether the caller is a GM, giving GM access first if their verified email
// is on the list. The grant is written with the SERVICE ROLE, never the caller's own client, so nobody
// can set their own flag.
export async function POST() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ signedIn: false, gm: false });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ signedIn: true, gm: false, error: "The server is not set up to check access." }, { status: 500 });
  }
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: profile } = await admin.from("profiles").select("access_granted, access_role").eq("id", user.id).maybeSingle();
  const p = profile as { access_granted: boolean | null; access_role: string | null } | null;
  let gm = !!p?.access_granted && p?.access_role === "gm";
  if (!gm) gm = await grantFromAllowlist(admin, user.id);
  // A co-GM may open the GM tools for the campaigns they co-GM (p149), without account-wide GM access.
  const coGm = gm ? false : await coGmsAnything(admin, user.id);
  return NextResponse.json({ signedIn: true, gm, coGm, anonymous: !!user.is_anonymous, email: user.is_anonymous ? null : (user.email ?? null) });
}
