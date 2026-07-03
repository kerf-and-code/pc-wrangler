import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/vtt/ingest
// Receives normalized table events (Beyond20 now; Foundry/Owlbear later) from a
// Table Tap page and writes them to vtt_events. Auth model: the campaign share
// code, same trust posture as the /record consent page. Requires an open session.

const EVENT_TYPES = new Set([
  "to-hit",
  "damage",
  "saving-throw",
  "skill",
  "ability",
  "initiative",
  "death-save",
  "hp-update",
  "conditions",
  "combat",
  "custom",
  "other",
]);

const SOURCES = new Set(["beyond20", "foundry", "owlbear"]);
const MAX_EVENTS_PER_BATCH = 50;
const MAX_JSON_CHARS = 16000;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function cleanJson(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  try {
    const s = JSON.stringify(v);
    if (s.length > MAX_JSON_CHARS) return null;
    return v as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanTimestamp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function GET() {
  return NextResponse.json({ ok: true, expects: "POST { share_code, events: [...] }" });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const shareCode = cleanString(body?.share_code, 64)?.toLowerCase() ?? null;
  const events = Array.isArray(body?.events) ? body.events : null;
  if (!shareCode || !events || events.length === 0) {
    return NextResponse.json(
      { error: "Expected { share_code, events: [...] } with at least one event." },
      { status: 400 }
    );
  }
  if (events.length > MAX_EVENTS_PER_BATCH) {
    return NextResponse.json(
      { error: `Batch too large. Send at most ${MAX_EVENTS_PER_BATCH} events per request.` },
      { status: 400 }
    );
  }

  const sb = serviceClient();

  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, name")
    .eq("share_code", shareCode)
    .single();
  if (!campaign) {
    return NextResponse.json({ error: "Unknown share code." }, { status: 404 });
  }

  const { data: session } = await sb
    .from("sessions")
    .select("id, session_number")
    .eq("campaign_id", campaign.id)
    .is("ended_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) {
    return NextResponse.json(
      { error: "No open session. Start a session in the app, then send events." },
      { status: 409 }
    );
  }

  // Resolve DDB character ids -> Six Axes characters in one query.
  const ddbIds = Array.from(
    new Set(
      events
        .map((e: any) => cleanString(e?.ddb_character_id, 64))
        .filter((v: string | null): v is string => v !== null)
    )
  );
  const charMap = new Map<string, string>();
  if (ddbIds.length > 0) {
    const { data: chars } = await sb
      .from("characters")
      .select("id, ddb_character_id")
      .eq("campaign_id", campaign.id)
      .in("ddb_character_id", ddbIds);
    for (const c of chars ?? []) {
      if (c.ddb_character_id) charMap.set(c.ddb_character_id, c.id);
    }
  }

  const rows = [];
  let skipped = 0;
  for (const e of events) {
    const eventType = cleanString(e?.event_type, 32);
    if (!eventType || !EVENT_TYPES.has(eventType)) {
      skipped += 1;
      continue;
    }
    const source = cleanString(e?.source, 32);
    const ddbId = cleanString(e?.ddb_character_id, 64);
    const fidelity = e?.fidelity === "canonical" ? "canonical" : "unverified";
    rows.push({
      campaign_id: campaign.id,
      session_id: session.id,
      character_id: ddbId ? charMap.get(ddbId) ?? null : null,
      source: source && SOURCES.has(source) ? source : "beyond20",
      ddb_character_id: ddbId,
      actor_name: cleanString(e?.actor_name, 200),
      event_type: eventType,
      name: cleanString(e?.name, 200),
      rolls: cleanJson(e?.rolls),
      state: cleanJson(e?.state),
      fidelity,
      rolled_at: cleanTimestamp(e?.rolled_at),
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No valid events in batch.", skipped },
      { status: 400 }
    );
  }

  const { error } = await sb.from("vtt_events").insert(rows);
  if (error) {
    return NextResponse.json({ error: "Insert failed. Try again." }, { status: 500 });
  }

  return NextResponse.json({
    inserted: rows.length,
    skipped,
    session_id: session.id,
    unmatched_ddb_ids: ddbIds.filter((id) => !charMap.has(id)),
  });
}
