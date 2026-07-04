import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED = new Set(["open", "resolved", "dropped"]);

export async function POST(req: NextRequest) {
  let body: { id?: string; status?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const id = (body.id || "").trim();
  const status = (body.status || "").trim();
  if (!id || !ALLOWED.has(status)) {
    return NextResponse.json({ error: "Missing id or invalid status." }, { status: 400 });
  }

  const supa = await createClient();
  const { data: auth } = await supa.auth.getUser();
  const user = auth?.user;
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("gm_events")
    .select("id, campaign_id, thread_status")
    .eq("id", id)
    .maybeSingle();
  const ev = row as { id: string; campaign_id: string; thread_status: string | null } | null;
  if (!ev) return NextResponse.json({ error: "Event not found." }, { status: 404 });

  // Owner gate.
  const { data: camp } = await supa
    .from("campaigns")
    .select("gm_id")
    .eq("id", ev.campaign_id)
    .maybeSingle();
  if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  // Only thread-bearing events have a lifecycle; don't turn an n/a event into one.
  if (ev.thread_status === null || ev.thread_status === "n/a") {
    return NextResponse.json({ error: "This event is not a thread." }, { status: 409 });
  }

  const { error } = await admin.from("gm_events").update({ thread_status: status }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
