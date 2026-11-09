import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { EVENTS, makeSecret, type HookEvent } from "@/lib/addons/keys";
import { hookUrlUnsafe } from "@/lib/addons/safe-url";

// app/api/addon/hooks/route.ts (2026-11-09)
//
// Phase 6b (p131): the GM adds a webhook (POST) or changes its address (PATCH). The address is
// checked here (https, public, the name looked up) and again before every send; the signing secret is
// made here. The rest (events, on or off, delete) the GM changes directly through row level security.

type Body = { campaignId?: string; hookId?: string; name?: string; url?: string; events?: string[]; includeSecret?: boolean };
const cleanEvents = (e: unknown) => [...new Set((Array.isArray(e) ? e : []).filter((x): x is HookEvent => (EVENTS as readonly string[]).includes(x)))];

export async function POST(req: Request) {
  let b: Body = {};
  try { b = await req.json(); } catch { /* checked below */ }
  const name = (typeof b.name === "string" ? b.name : "").trim().slice(0, 40);
  const url = (typeof b.url === "string" ? b.url : "").trim();
  const events = cleanEvents(b.events);
  if (!name) return NextResponse.json({ error: "Give the webhook a name." }, { status: 400 });
  if (!events.length) return NextResponse.json({ error: "Pick at least one thing to send." }, { status: 400 });
  const bad = await hookUrlUnsafe(url);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  // row level security lets only the campaign's GM insert
  const { data, error } = await supabase.from("addon_hooks")
    .insert({ campaign_id: b.campaignId, name, url, secret: makeSecret(), events, include_secret: !!b.includeSecret, created_by: user.id })
    .select("*").single();
  if (error) return NextResponse.json({ error: /row-level security/.test(error.message) ? "Only the GM adds webhooks." : /addon_hooks/.test(error.message) ? "Add-ons are not set up yet (the p131 migration)." : error.message }, { status: 403 });
  return NextResponse.json({ hook: data });
}

export async function PATCH(req: Request) {
  let b: Body = {};
  try { b = await req.json(); } catch { /* checked below */ }
  const url = (typeof b.url === "string" ? b.url : "").trim();
  const bad = await hookUrlUnsafe(url);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data, error } = await supabase.from("addon_hooks").update({ url, fail_count: 0, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", b.hookId ?? "").select("*").maybeSingle();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Only the GM changes webhooks." }, { status: 403 });
  return NextResponse.json({ hook: data });
}
