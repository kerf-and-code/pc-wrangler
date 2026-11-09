import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drain } from "@/lib/addons/deliver";

// app/api/addon/hooks/test/route.ts (2026-11-09)
//
// Phase 6b (p131): "Send a test" sends a ping to one webhook now and reports how it went.

export const maxDuration = 20;

export async function POST(req: Request) {
  let b: { hookId?: string } = {};
  try { b = await req.json(); } catch { /* checked below */ }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  // only the GM can see the hook through row level security
  const { data: hook } = await supabase.from("addon_hooks").select("id, campaign_id, enabled").eq("id", b.hookId ?? "").maybeSingle();
  const h = hook as { id: string; campaign_id: string; enabled: boolean } | null;
  if (!h) return NextResponse.json({ error: "Only the GM tests webhooks." }, { status: 403 });
  if (!h.enabled) return NextResponse.json({ error: "Switch the webhook on first." }, { status: 409 });
  const admin = createAdminClient();
  const { error } = await admin.rpc("addon_ping", { p_hook: h.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await drain(admin, h.campaign_id, 14000);
  const { data: after } = await supabase.from("addon_hooks").select("last_status, last_error, last_ok_at, fail_count").eq("id", h.id).maybeSingle();
  return NextResponse.json({ hook: after });
}
