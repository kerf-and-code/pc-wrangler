import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drain } from "@/lib/addons/deliver";

// app/api/addon/kick/route.ts (2026-11-09)
//
// Phase 6b (p131): someone at the table just did something (a line of chat, a roll, the next turn),
// so send this campaign's waiting webhooks now rather than at the next minute. Only a browser at the
// table may ask, and only one sender gets each delivery (addon_claim), so asking twice is harmless.

export const maxDuration = 15;

export async function POST(req: Request) {
  let b: { campaignId?: string } = {};
  try { b = await req.json(); } catch { /* checked below */ }
  const campaignId = typeof b.campaignId === "string" ? b.campaignId : "";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: has } = await supabase.rpc("tabletop_has_hooks", { p_campaign: campaignId });
  if (!has) return NextResponse.json({ sent: 0, failed: 0 });
  const r = await drain(createAdminClient(), campaignId, 12000);
  return NextResponse.json(r);
}
