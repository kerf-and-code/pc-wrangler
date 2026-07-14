import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

// GET /api/me/export
//
// Everything Six Axes holds that is linked to you, as one JSON file.
//
// The privacy policy has promised this in production for some time. It was not true.
// It is now.
//
// Reads through export_my_data(), which is SECURITY DEFINER and resolves entirely
// through auth.uid(), so there is no way to ask it for anyone else's data: it does
// not take a subject parameter at all.
export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("export_my_data");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="six-axes-my-data-${stamp}.json"`,
      // An export of someone's own personal data should never sit in a shared cache.
      "Cache-Control": "no-store, private",
    },
  });
}
