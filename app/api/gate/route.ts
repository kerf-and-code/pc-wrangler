import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Verify the pilot access code and, if it matches, set profiles.access_granted for the signed-in user.
//
// WHY THE CODE IS CHECKED HERE, NOT IN THE DATABASE
//   The code lives in the SITE_ACCESS_CODE env var, so only the server can read it. The browser sends
//   an attempt; the server decides. The grant is written with the SERVICE ROLE, not the user's own
//   client, so a user cannot flip their own access_granted by calling the table directly, they can
//   only get it set by presenting the correct code to this route.
export async function POST(request: Request) {
  const { code } = (await request.json().catch(() => ({ code: "" }))) as { code?: string };

  // Who is asking (their session cookies).
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }

  // Two codes: a GM code and a player code. Either one is a valid key to the pilot, so you can hand
  // them out and rotate them separately. Both grant the same access_granted flag.
  const gmCode = process.env.SITE_ACCESS_CODE;
  const playerCode = process.env.PLAYER_ACCESS_CODE;
  if (!gmCode && !playerCode) {
    // Misconfigured: fail closed rather than letting everyone through.
    return NextResponse.json({ ok: false, error: "The gate isn't configured yet." }, { status: 500 });
  }
  const attempt = (code || "").trim();
  let role: "gm" | "player" | null = null;
  if (gmCode && attempt === gmCode) role = "gm";
  else if (playerCode && attempt === playerCode) role = "player";
  if (!role) {
    return NextResponse.json({ ok: false, error: "That code isn't right." });
  }

  // Grant with the service role so the write can't be forged from the client.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await admin.from("profiles").update({ access_granted: true, access_role: role }).eq("id", user.id);
  if (error) {
    return NextResponse.json({ ok: false, error: "Couldn't save that. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
