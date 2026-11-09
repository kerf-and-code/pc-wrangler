import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SCOPES, makeKey, type Scope } from "@/lib/addons/keys";

// app/api/addon/keys/route.ts (2026-11-09)
//
// Phase 6b (p131): the GM makes an add-on key. The key is made here, returned once, and only its hash
// is stored, so nobody (the GM included) can read it back later. Revoking and deleting are plain
// updates the GM makes through row level security.

export async function POST(req: Request) {
  let b: { campaignId?: string; name?: string; scopes?: string[] } = {};
  try { b = await req.json(); } catch { /* checked below */ }
  const campaignId = typeof b.campaignId === "string" ? b.campaignId : "";
  const name = (typeof b.name === "string" ? b.name : "").trim().slice(0, 40);
  const scopes = [...new Set((Array.isArray(b.scopes) ? b.scopes : []).filter((s): s is Scope => (SCOPES as readonly string[]).includes(s)))];
  if (!name) return NextResponse.json({ error: "Give the key a name, such as the add-on it is for." }, { status: 400 });
  if (!scopes.length) return NextResponse.json({ error: "Pick at least one thing the key may do." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the GM makes add-on keys." }, { status: 403 });

  const { token, prefix, hash } = makeKey();
  const { data, error } = await createAdminClient().from("addon_keys")
    .insert({ campaign_id: campaignId, name, prefix, key_hash: hash, scopes, created_by: user.id })
    .select("id, name, prefix, scopes, created_at, last_used_at, revoked_at").single();
  if (error) return NextResponse.json({ error: /addon_keys/.test(error.message) ? "Add-ons are not set up yet (the p131 migration)." : error.message }, { status: 500 });
  return NextResponse.json({ token, key: data });
}
