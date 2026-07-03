import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// POST /api/campaign/rotate-share  { campaign_id }
// Rotates a campaign's share_code so an old session/table/record link stops
// working. GM-only: verified against the caller's authenticated session, not the
// share code (the whole point is that the share code is now untrusted).

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Ambiguous characters removed (0/O/1/l/I) for links people may read aloud.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function newCode(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

async function authedUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Read-only in this route; no session mutation needed.
        },
      },
    }
  );
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function POST(request: NextRequest) {
  const userId = await authedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in as the GM to rotate the link." }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const campaignId = typeof body?.campaign_id === "string" ? body.campaign_id : null;
  if (!campaignId) {
    return NextResponse.json({ error: "Expected { campaign_id }." }, { status: 400 });
  }

  const sb = serviceClient();

  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, gm_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (campaign.gm_id !== userId) {
    return NextResponse.json({ error: "Only the campaign's GM can rotate its link." }, { status: 403 });
  }

  // Retry a couple of times on the (astronomically unlikely) unique collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newCode();
    const { error } = await sb
      .from("campaigns")
      .update({ share_code: code })
      .eq("id", campaignId);
    if (!error) {
      return NextResponse.json({ share_code: code });
    }
    if (!String(error.message || "").toLowerCase().includes("duplicate")) {
      return NextResponse.json({ error: "Could not rotate the link. Try again." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Could not generate a unique link. Try again." }, { status: 500 });
}
