import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashRollKey, newRollKey, rollKeyRole } from "@/lib/vtt/ingest-keys";

// app/api/vtt/key/route.ts (audit B12, push 7)
//
// Roll keys for the capture extension and the Foundry module (lib/vtt/ingest-keys.ts). Signed in only;
// the campaign is named by its share code, because that is what the table link and the module hold.
//
//   GET    ?share_code=CODE    -> { role: "gm" | "player" | null, campaign_name, has_key, created_at }
//   POST   { share_code }      -> { key, role, campaign_name }   a new key, shown once; the old one retires
//   DELETE { share_code }      -> { ok: true }                   retires this account's key for the campaign
//
// A GM gets a gm key (verifies every character in the campaign, for Foundry); a player gets a player
// key (verifies only their own characters). Someone who is neither gets 403.

const MAX = 64;

function cleanCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s ? s.slice(0, MAX) : null;
}

async function signedIn(): Promise<string | null> {
  const supa = await createClient();
  const { data } = await supa.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}

async function campaignFor(admin: ReturnType<typeof createAdminClient>, code: string) {
  const { data } = await admin.from("campaigns").select("id, name").eq("share_code", code).maybeSingle();
  return data as { id: string; name: string | null } | null;
}

export async function GET(req: NextRequest) {
  const uid = await signedIn();
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const code = cleanCode(req.nextUrl.searchParams.get("share_code"));
  if (!code) return NextResponse.json({ error: "Missing table code." }, { status: 400 });

  const admin = createAdminClient();
  const camp = await campaignFor(admin, code);
  if (!camp) return NextResponse.json({ error: "Unknown table code." }, { status: 404 });
  const role = await rollKeyRole(admin, camp.id, uid);

  const { data: k } = await admin
    .from("vtt_ingest_keys")
    .select("created_at")
    .eq("profile_id", uid)
    .eq("campaign_id", camp.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    role,
    campaign_name: camp.name ?? "your table",
    has_key: !!k,
    created_at: (k as { created_at: string } | null)?.created_at ?? null,
  });
}

export async function POST(req: NextRequest) {
  const uid = await signedIn();
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { share_code?: unknown } = {};
  try { body = await req.json(); } catch { /* checked below */ }
  const code = cleanCode(body.share_code);
  if (!code) return NextResponse.json({ error: "Missing table code." }, { status: 400 });

  const admin = createAdminClient();
  const camp = await campaignFor(admin, code);
  if (!camp) return NextResponse.json({ error: "Unknown table code." }, { status: 404 });
  const role = await rollKeyRole(admin, camp.id, uid);
  if (!role) {
    return NextResponse.json(
      { error: "Only the GM or a player with a character in this campaign can make a roll key." },
      { status: 403 },
    );
  }

  // One live key per account and campaign: retire the old one, then store the new one's hash.
  const now = new Date().toISOString();
  await admin.from("vtt_ingest_keys").update({ revoked_at: now })
    .eq("profile_id", uid).eq("campaign_id", camp.id).is("revoked_at", null);

  const key = newRollKey();
  const { error } = await admin.from("vtt_ingest_keys").insert({
    key_hash: hashRollKey(key), profile_id: uid, campaign_id: camp.id, kind: role,
  });
  if (error) return NextResponse.json({ error: "Could not make a key. Try again." }, { status: 500 });

  return NextResponse.json(
    { key, role, campaign_name: camp.name ?? "your table" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(req: NextRequest) {
  const uid = await signedIn();
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { share_code?: unknown } = {};
  try { body = await req.json(); } catch { /* checked below */ }
  const code = cleanCode(body.share_code);
  if (!code) return NextResponse.json({ error: "Missing table code." }, { status: 400 });

  const admin = createAdminClient();
  const camp = await campaignFor(admin, code);
  if (!camp) return NextResponse.json({ error: "Unknown table code." }, { status: 404 });
  await admin.from("vtt_ingest_keys").update({ revoked_at: new Date().toISOString() })
    .eq("profile_id", uid).eq("campaign_id", camp.id).is("revoked_at", null);
  return NextResponse.json({ ok: true });
}
