import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/vtt/ingest
// Receives normalized table events (Beyond20 now; Foundry/Owlbear later) from the
// browser extension or a Table Tap page and writes them to vtt_events.
//
// Auth model: campaign share codes, same trust posture as the /record consent page.
// The extension now holds a SET of codes (one per table the player set up) and sends
// them all, so switching tables never needs re-entry. Each roll is routed by its DDB
// character to whichever of the held campaigns is LIVE (has an open session) and has
// that character linked. The live session is the disambiguator; if a DDB character is
// somehow linked in two campaigns that are both live at once, the most recently
// started session wins. A single legacy share_code still works.

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
const MAX_CODES = 20;
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
  return NextResponse.json({ ok: true, expects: "POST { share_codes: [...], events: [...] }" });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Accept plural share_codes (extension) or a single legacy share_code.
  let codes: string[] = [];
  if (Array.isArray(body?.share_codes)) {
    codes = body.share_codes
      .map((c: unknown) => cleanString(c, 64)?.toLowerCase())
      .filter((v: string | null | undefined): v is string => !!v);
  } else {
    const one = cleanString(body?.share_code, 64)?.toLowerCase();
    if (one) codes = [one];
  }
  codes = Array.from(new Set(codes)).slice(0, MAX_CODES);

  const events = Array.isArray(body?.events) ? body.events : null;
  if (codes.length === 0 || !events || events.length === 0) {
    return NextResponse.json(
      { error: "Expected { share_codes: [...], events: [...] } with at least one code and one event." },
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

  // Resolve the held codes to campaigns.
  const { data: camps } = await sb
    .from("campaigns")
    .select("id, name, share_code")
    .in("share_code", codes);
  const campaigns = camps ?? [];
  if (campaigns.length === 0) {
    return NextResponse.json({ error: "No campaign matched the codes provided." }, { status: 404 });
  }
  const campaignIds = campaigns.map((c: any) => c.id);

  // Find the open session for each held campaign. Only campaigns with a live
  // session are eligible routing targets.
  const { data: openSessions } = await sb
    .from("sessions")
    .select("id, campaign_id, started_at, created_at")
    .in("campaign_id", campaignIds)
    .is("ended_at", null);

  // campaign_id -> { session_id, ts } keeping the most-recently-started open session.
  const liveByCampaign = new Map<string, { sessionId: string; ts: number }>();
  for (const s of openSessions ?? []) {
    const ts = new Date((s as any).started_at || (s as any).created_at || 0).getTime();
    const cur = liveByCampaign.get((s as any).campaign_id);
    if (!cur || ts > cur.ts) liveByCampaign.set((s as any).campaign_id, { sessionId: (s as any).id, ts });
  }
  const liveCampaignIds = Array.from(liveByCampaign.keys());
  if (liveCampaignIds.length === 0) {
    return NextResponse.json(
      { error: "No open session in any of your campaigns. Start a session in the app, then send events." },
      { status: 409 }
    );
  }
  const soleLive = liveCampaignIds.length === 1 ? liveCampaignIds[0] : null;

  // Resolve DDB character ids to linked characters, scoped to LIVE campaigns only.
  const ddbIds: string[] = Array.from(
    new Set(
      events
        .map((e: any) => cleanString(e?.ddb_character_id, 64))
        .filter((v: string | null): v is string => v !== null)
    )
  );
  // ddb_character_id -> list of { campaignId, characterId } across live campaigns.
  const linkByDdb = new Map<string, { campaignId: string; characterId: string }[]>();
  if (ddbIds.length > 0) {
    const { data: chars } = await sb
      .from("characters")
      .select("id, ddb_character_id, campaign_id")
      .in("campaign_id", liveCampaignIds)
      .in("ddb_character_id", ddbIds);
    for (const c of chars ?? []) {
      if (!(c as any).ddb_character_id) continue;
      const arr = linkByDdb.get((c as any).ddb_character_id) ?? [];
      arr.push({ campaignId: (c as any).campaign_id, characterId: (c as any).id });
      linkByDdb.set((c as any).ddb_character_id, arr);
    }
  }

  // Pick the live campaign for a matched DDB id: most-recently-started session wins.
  function routeFor(ddbId: string): { campaignId: string; characterId: string } | null {
    const matches = linkByDdb.get(ddbId);
    if (!matches || matches.length === 0) return null;
    let best = matches[0];
    let bestTs = liveByCampaign.get(best.campaignId)!.ts;
    for (const m of matches) {
      const ts = liveByCampaign.get(m.campaignId)!.ts;
      if (ts > bestTs) { best = m; bestTs = ts; }
    }
    return best;
  }

  const rows = [];
  let skipped = 0;
  const unmatched = new Set<string>();
  for (const e of events) {
    const eventType = cleanString(e?.event_type, 32);
    if (!eventType || !EVENT_TYPES.has(eventType)) {
      skipped += 1;
      continue;
    }
    const ddbId = cleanString(e?.ddb_character_id, 64);

    let campaignId: string | null = null;
    let characterId: string | null = null;

    const routed = ddbId ? routeFor(ddbId) : null;
    if (routed) {
      campaignId = routed.campaignId;
      characterId = routed.characterId;
    } else {
      // Not linked in any live campaign. If exactly one campaign is live we can still
      // land it there unattributed (and report it for linking). If several are live,
      // the campaign is genuinely unknown, so skip it rather than guess.
      if (ddbId) unmatched.add(ddbId);
      if (soleLive) {
        campaignId = soleLive;
        characterId = null;
      } else {
        skipped += 1;
        continue;
      }
    }

    const source = cleanString(e?.source, 32);
    rows.push({
      campaign_id: campaignId,
      session_id: liveByCampaign.get(campaignId!)!.sessionId,
      character_id: characterId,
      source: source && SOURCES.has(source) ? source : "beyond20",
      ddb_character_id: ddbId,
      actor_name: cleanString(e?.actor_name, 200),
      event_type: eventType,
      name: cleanString(e?.name, 200),
      rolls: cleanJson(e?.rolls),
      state: cleanJson(e?.state),
      fidelity: e?.fidelity === "canonical" ? "canonical" : "unverified",
      rolled_at: cleanTimestamp(e?.rolled_at),
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No valid events could be routed.", skipped, unmatched_ddb_ids: Array.from(unmatched) },
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
    live_campaigns: liveCampaignIds.length,
    unmatched_ddb_ids: Array.from(unmatched),
  });
}
