import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwner } from "@/lib/owner";
import { fetchAll } from "@/lib/fetch-all";
import { estimateCost } from "@/lib/costing";

// app/api/admin/users/route.ts (push 17, audit F10)
//
// The owner console's data. GET lists every account with its pilot access, the campaigns it runs, when
// it last signed in, and what its campaigns used in the last 30 days (usage_events, p147). POST changes
// one account's access: "gm" or "player" grants it (the same flags the GM_EMAILS list sets,
// lib/gm-allowlist.ts), "revoke" takes it away (an account still on GM_EMAILS gets GM access back on
// its next visit, so take it off the list too). Both check OWNER_IDS on every call and use the service role, so a
// signed-in non-owner gets 403 and nothing else.
//
// Push 46 (audit round 2, R1): accounts and campaigns are read in pages, and usage is totalled in the
// database (usage_by_campaign, p169). Every read used to stop at 1,000 rows, so usage past the first
// 1,000 records in 30 days was missing. Each account also gets an estimated cost at the settled
// costing-model rates (lib/costing.ts).

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
    fetchAll<Profile>((f, t) => admin.from("profiles").select("id, display_name, email, is_anonymous, access_granted, access_role, created_at").order("created_at", { ascending: false }).order("id").range(f, t)),
    fetchAll<{ id: string; gm_id: string }>((f, t) => admin.from("campaigns").select("id, gm_id").is("deleted_at", null).order("id").range(f, t)),
    admin.rpc("usage_by_campaign", { p_since: since }),
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
  for (const c of campaigns.data) {
    ownerOf.set(c.id, c.gm_id);
    runs.set(c.gm_id, (runs.get(c.gm_id) ?? 0) + 1);
  }
  type U = { minutes: number; aiCalls: number; tokens: number; images: number; speakerMinutes: number; roomSessions: number; sessions: number; cost: number };
  const used = new Map<string, U>();
  // totalled per campaign in the database (p169); before p169 (or p147) every account shows nothing used
  type Agg = { campaign_id: string; minutes: number; speaker_minutes: number; room_minutes: number; ai_calls: number; tokens: number; images: number; sessions: number; room_sessions: number };
  for (const r of (usage.error ? [] : (usage.data as Agg[] | null) ?? [])) {
    const who = ownerOf.get(r.campaign_id);
    if (!who) continue;
    const u = used.get(who) ?? { minutes: 0, aiCalls: 0, tokens: 0, images: 0, speakerMinutes: 0, roomSessions: 0, sessions: 0, cost: 0 };
    u.minutes += Number(r.minutes) || 0;
    u.speakerMinutes += Number(r.speaker_minutes) || 0;
    u.aiCalls += Number(r.ai_calls) || 0;
    u.tokens += Number(r.tokens) || 0;
    u.images += Number(r.images) || 0;
    u.sessions += Number(r.sessions) || 0;
    u.roomSessions += Number(r.room_sessions) || 0;
    used.set(who, u);
  }
  for (const u of used.values()) u.cost = estimateCost(u).total;

  const accounts = profiles.data.map((p) => ({
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
