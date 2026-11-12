import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/owner";

// app/api/admin/users/route.ts (push 17, audit F10)
//
// The owner console's data. GET lists every account with its pilot access, the campaigns it runs, when
// it last signed in, and what its campaigns used in the last 30 days (usage_events, p147). POST changes
// one account's access: "gm" or "player" grants it (the same flags the GM_EMAILS list sets,
// lib/gm-allowlist.ts), "revoke" takes it away (an account still on GM_EMAILS gets GM access back on
// its next visit, so take it off the list too). Both check OWNER_IDS on every call and use the service role, so a
// signed-in non-owner gets 403 and nothing else.

type Profile = { id: string; display_name: string | null; email: string | null; is_anonymous: boolean; access_granted: boolean; access_role: string | null; created_at: string };

async function owner(): Promise<string | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
  return user.id;
}

export async function GET() {
  const me = await owner();
  if (me instanceof NextResponse) return me;
  const admin = createAdminClient();

  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const [profiles, campaigns, usage] = await Promise.all([
    admin.from("profiles").select("id, display_name, email, is_anonymous, access_granted, access_role, created_at").order("created_at", { ascending: false }).limit(5000),
    admin.from("campaigns").select("id, gm_id").is("deleted_at", null).limit(10000),
    admin.from("usage_events").select("campaign_id, kind, input_tokens, output_tokens, images, audio_seconds").gte("created_at", since).limit(50000),
  ]);
  if (profiles.error) return NextResponse.json({ error: "Could not read the accounts." }, { status: 500 });

  // Last sign-in lives in auth, not in profiles. Pages of 1,000; a pilot has far fewer.
  const lastSeen = new Map<string, string | null>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) lastSeen.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 1000) break;
  }

  const ownerOf = new Map<string, string>();
  const runs = new Map<string, number>();
  for (const c of (campaigns.data as { id: string; gm_id: string }[] | null) ?? []) {
    ownerOf.set(c.id, c.gm_id);
    runs.set(c.gm_id, (runs.get(c.gm_id) ?? 0) + 1);
  }
  type U = { minutes: number; aiCalls: number; tokens: number; images: number };
  const used = new Map<string, U>();
  // usage_events is new (p147): before it runs, the read errors and every account shows nothing used.
  for (const r of (usage.error ? [] : (usage.data as { campaign_id: string | null; kind: string; input_tokens: number | null; output_tokens: number | null; images: number | null; audio_seconds: number | null }[] | null) ?? [])) {
    const who = r.campaign_id ? ownerOf.get(r.campaign_id) : undefined;
    if (!who) continue;
    const u = used.get(who) ?? { minutes: 0, aiCalls: 0, tokens: 0, images: 0 };
    if (r.kind === "transcription") u.minutes += Number(r.audio_seconds ?? 0) / 60;
    if (r.kind === "ai") u.aiCalls += 1;
    if (r.kind === "image") u.images += r.images ?? 1;
    u.tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
    used.set(who, u);
  }

  const accounts = ((profiles.data as Profile[] | null) ?? []).map((p) => ({
    ...p,
    is_owner: isOwner(p.id),
    last_sign_in_at: lastSeen.get(p.id) ?? null,
    campaigns_run: runs.get(p.id) ?? 0,
    usage30: used.get(p.id) ?? null,
  }));
  return NextResponse.json({ accounts, usageReady: !usage.error });
}

export async function POST(req: Request) {
  const me = await owner();
  if (me instanceof NextResponse) return me;
  const body = (await req.json().catch(() => ({}))) as { userId?: string; action?: string };
  const userId = (body.userId ?? "").trim();
  const action = body.action;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "Which account?" }, { status: 400 });
  if (action !== "gm" && action !== "player" && action !== "revoke") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (userId === me && action !== "gm") return NextResponse.json({ error: "You cannot take GM access away from yourself here." }, { status: 400 });

  const admin = createAdminClient();
  const patch = action === "revoke" ? { access_granted: false, access_role: null } : { access_granted: true, access_role: action };
  const { data, error } = await admin.from("profiles").update(patch).eq("id", userId).select("id, access_granted, access_role");
  if (error) return NextResponse.json({ error: "Could not save that." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "No such account." }, { status: 404 });
  return NextResponse.json({ ok: true, account: data[0] });
}
