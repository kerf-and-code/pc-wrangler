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

  // Push 19: notifications (p150) are added here rather than in export_my_data, from the person's own
  // rows (RLS: own rows only). Absent before p150 runs, so a failed read just leaves them out.
  const { data: notes, error: nErr } = await supabase.from("notifications")
    .select("kind, title, link, data, created_at, read_at, emailed_at").order("created_at", { ascending: false }).limit(5000);
  const out = data && typeof data === "object" && !Array.isArray(data) && !nErr
    ? { ...(data as Record<string, unknown>), notifications: notes ?? [] }
    : data;

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(out, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="six-axes-my-data-${stamp}.json"`,
      // An export of someone's own personal data should never sit in a shared cache.
      "Cache-Control": "no-store, private",
    },
  });
}
