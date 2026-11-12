import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/fetch-all";

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
  // Push 48 (audit round 2, G15, R9): what was added since p145 and is yours: your email choices (p138,
  // p150), the stat blocks and card decks in your own library (p159) and the campaigns you run or co-GM
  // (p149). Each read is your own rows under row level security; one that fails (a feature never migrated) is left out.
  const extra: Record<string, unknown> = {};
  if (!nErr) extra.notifications = notes ?? [];
  const { data: prefs, error: pErr } = await supabase.rpc("my_email_prefs");
  if (!pErr) extra.email_preferences = prefs ?? null;
  const all = async <T,>(page: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const r = await fetchAll<T>(page);
    return r.error ? null : r.data;
  };
  const blocks = await all<Record<string, unknown>>((f, t) => supabase.from("stat_blocks")
    .select("name, system, source_edition, block, campaign_id, created_at, updated_at").eq("gm_id", user.id).order("id").range(f, t));
  if (blocks) extra.stat_blocks = blocks;
  const decks = await all<Record<string, unknown>>((f, t) => supabase.from("gm_card_decks")
    .select("*").eq("owner", user.id).order("id").range(f, t));
  if (decks) extra.card_deck_library = decks.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "owner" && k !== "id")));
  const cogm = await all<Record<string, unknown>>((f, t) => supabase.from("memberships")
    .select("role, active, campaign:campaigns(name)").eq("profile_id", user.id).in("role", ["gm", "co-gm"]).order("campaign_id").range(f, t));
  const nameOf = (c: unknown) => (Array.isArray(c) ? c[0] : c) as { name?: string } | null | undefined;
  if (cogm) extra.campaigns_you_run = cogm.map((m) => ({ campaign: nameOf(m.campaign)?.name ?? null, role: m.role, active: m.active }));
  const out = data && typeof data === "object" && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>), ...extra }
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
