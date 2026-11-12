import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { emptyProof, proofFromKeys, proofFromSession } from "@/lib/vtt/ingest-keys";
import { normName, routeByName, type NamedCharacter, type NameLink } from "@/lib/vtt/name-route";
import { pushIdTime } from "@/lib/vtt/push-id";
import { createHash } from "node:crypto";

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
//
// WHO SENT IT (audit B12, push 7). A share code only proves the sender has the table link, which every
// player has. So a roll is stored as "canonical" only when the request PROVES its sender can vouch for
// that character: a player roll key (lib/vtt/ingest-keys.ts) or signed-in session covering a character
// the sender owns, or a GM roll key or GM session for that campaign. Everything else still lands, so an
// older extension keeps working, but as "unverified", whatever the client claims. A key alone also
// counts as holding that campaign's code.
//
// ROLL20 (push 38, p160). The extension reads rolls from the Roll20 chat, source "roll20". Such a roll
// has no D&D Beyond id, so it is routed by the name it was rolled under (lib/vtt/name-route.ts) to a
// player character of that name in a live campaign. Every player with the extension sees every roll in
// that chat, so each carries its Roll20 message id as `external_id` and a second copy is ignored
// (unique per campaign, source and id). When the copy that arrives later is the one its sender can vouch
// for, the stored row is upgraded to canonical.
//
// PUSH 44 (audit round 2):
//   B5   That upgrade now also replaces what the row says (dice, total, name, character, time) with the
//        vouched copy. Before, a forged first copy kept its forged dice and only gained the badge.
//   B11, T10  A Roll20 roll's time is read from its message id (lib/vtt/push-id.ts), not from the
//        sender. A roll made before the session started (more than two minutes before), or claiming a
//        time in the future, is not stored in the session; old chat that Roll20 shows late cannot land as
//        tonight's rolls.
//   T9, B14, G12  Name routing follows the GM's choices (vtt_name_links, p167), sends nowhere when two
//        player characters share a name, and never hands an NPC's name to a player character. Names that
//        went nowhere are returned as unmatched_names.

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

const SOURCES = new Set(["beyond20", "foundry", "owlbear", "roll20"]);
const MAX_EVENTS_PER_BATCH = 50;
const MAX_CODES = 20;
const MAX_KEYS = 20;
const MAX_JSON_CHARS = 16000;
// Push 42 (audit round 2, T11): at most this many events per campaign in any minute. A busy table rolls
// a few dozen times a minute; this only stops a stuck retry loop or a script from burying the session.
const MAX_EVENTS_PER_CAMPAIGN_MINUTE = 300;

/** A stable id for an event its sender gave none (Beyond20, Foundry): the same roll sent twice (a retried
 *  batch) gets the same id, so the unique index from p160 stores it once. Only when the roll carries its
 *  own time, so two genuinely separate rolls are never folded together. Prefixed so it cannot meet a
 *  Roll20 message id. */
function derivedEventId(r: { source: string; actor_name: string | null; event_type: string; name: string | null; rolled_at: string | null; rolls: unknown; character_id: string | null; ddb_character_id: string | null }): string | null {
  if (!r.rolled_at) return null;
  const h = createHash("sha256")
    .update(JSON.stringify([r.source, r.actor_name, r.event_type, r.name, r.rolled_at, r.rolls ?? null, r.character_id, r.ddb_character_id]))
    .digest("hex");
  return `h:${h.slice(0, 40)}`;
}

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


// ---------------------------------------------------------------------------- CORS
//
// The Foundry module is a WEB PAGE, so its fetch is cross-origin: a browser at
// http://localhost:30000 calling https://www.six-axes.com. Without these headers the browser
// refuses the request before it is ever sent, and the module reports a network failure that looks
// like the server being down.
//
// The Chrome extension never needed this. Extensions bypass CORS through host_permissions, which
// is why this endpoint has served Beyond20 happily for months without a single CORS header.
//
// WHY "*" IS THE RIGHT VALUE HERE, RATHER THAN A LAZY ONE
//   CORS does not protect an endpoint; it protects a user's AMBIENT CREDENTIALS from being used by
//   a page they did not intend. This endpoint reads no cookies and no session - it authenticates
//   entirely on a share code carried in the body - so there is nothing ambient for another origin
//   to borrow. Anyone who has the code can already post from anywhere, and anyone who does not
//   gains nothing from being allowed to try.
//
//   Restricting the origin would also be futile in practice: every self-hosted Foundry is a
//   different origin (localhost:30000, a LAN address, someone's own domain), so a list could never
//   be complete and would fail for exactly the people it was meant to serve.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Only roll keys in the body authenticate a cross-origin sender; a session counts only on a
  // same-origin request (see the session check in POST).
  "Access-Control-Max-Age": "86400",
};

/** Preflight. A POST carrying Content-Type: application/json always triggers one. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json({ ok: true, expects: "POST { share_codes: [...], keys?: [...], events: [...] }" }, { headers: CORS });
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: CORS });
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

  const keys: string[] = Array.isArray(body?.keys)
    ? Array.from(new Set((body.keys as unknown[]).filter((k): k is string => typeof k === "string").map((k) => k.trim()))).slice(0, MAX_KEYS)
    : [];

  const events = Array.isArray(body?.events) ? body.events : null;
  if ((codes.length === 0 && keys.length === 0) || !events || events.length === 0) {
    return NextResponse.json(
      { error: "Expected { share_codes: [...], events: [...] } with at least one code and one event." },
      { status: 400, headers: CORS }
    );
  }
  if (events.length > MAX_EVENTS_PER_BATCH) {
    return NextResponse.json(
      { error: `Batch too large. Send at most ${MAX_EVENTS_PER_BATCH} events per request.` },
      { status: 400, headers: CORS }
    );
  }

  const sb = serviceClient();

  // Roll keys first: they prove who is sending, and each also counts as holding its campaign.
  const proof = emptyProof();
  await proofFromKeys(sb, keys, proof);

  // Resolve the held codes (and key campaigns) to campaigns.
  const campaignsById = new Map<string, { id: string }>();
  if (codes.length > 0) {
    const { data: camps } = await sb.from("campaigns").select("id").in("share_code", codes);
    for (const c of (camps ?? []) as { id: string }[]) campaignsById.set(c.id, c);
  }
  for (const id of proof.keyCampaigns) campaignsById.set(id, { id });
  if (campaignsById.size === 0) {
    return NextResponse.json({ error: "No campaign matched the codes provided." }, { status: 404, headers: CORS });
  }
  const campaignIds = Array.from(campaignsById.keys());

  // A signed-in sender on the site itself (Table Tap) proves the same way as a key. Only a request the
  // browser marks as same-origin counts, so another site cannot make a signed-in GM's browser post
  // rolls that borrow their session (the auth cookie is also SameSite=Lax).
  const origin = request.headers.get("origin");
  const sameOrigin = request.headers.get("sec-fetch-site") === "same-origin"
    || (origin !== null && origin === request.nextUrl.origin);
  if (sameOrigin) {
    try {
      const session = await createSessionClient();
      const { data: claimsData } = await session.auth.getClaims();
      const uid = claimsData?.claims?.sub as string | undefined;
      if (uid) await proofFromSession(sb, uid, campaignIds, proof);
    } catch {
      // no session: the share code (and any key) decides
    }
  }

  // Find the open session for each held campaign. Only campaigns with a live
  // session are eligible routing targets.
  // Audit B3 (2026-11-09): only sessions actually underway (started, not ended). A scheduled future
  // session also has no ended_at, and could win as the "live" one.
  const { data: openSessions } = await sb
    .from("sessions")
    .select("id, campaign_id, started_at, created_at")
    .in("campaign_id", campaignIds)
    .not("started_at", "is", null)
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
      { status: 409, headers: CORS }
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

  // push 38: rolls with no DDB id (Roll20) are routed by name to a player character in a live campaign.
  // Push 44: every character (an NPC's name blocks a player character) and the GM's links for the name.
  let named: NamedCharacter[] = [];
  let links: NameLink[] = [];
  const liveTs = new Map(Array.from(liveByCampaign.entries()).map(([id, v]) => [id, v.ts]));
  if ((events as { ddb_character_id?: unknown; actor_name?: unknown }[]).some((e) => !cleanString(e?.ddb_character_id, 64) && cleanString(e?.actor_name, 200))) {
    const [{ data: cs }, { data: ls, error: lerr }] = await Promise.all([
      sb.from("characters").select("id, name, campaign_id, kind").in("campaign_id", liveCampaignIds),
      sb.from("vtt_name_links").select("campaign_id, name_norm, character_id").in("campaign_id", liveCampaignIds).eq("source", "roll20"),
    ]);
    named = ((cs ?? []) as { id: string; name: string; campaign_id: string; kind: string | null }[])
      .map((c) => ({ id: c.id, name: c.name, campaignId: c.campaign_id, kind: c.kind }));
    // before p167 the table is missing: route by name alone, as before
    if (!lerr) links = ((ls ?? []) as { campaign_id: string; name_norm: string; character_id: string | null }[])
      .map((l) => ({ campaignId: l.campaign_id, nameNorm: l.name_norm, characterId: l.character_id }));
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

  const proven = (campaignId: string, characterId: string | null) =>
    proof.gmCampaigns.has(campaignId) || (characterId !== null && proof.ownCharacters.has(characterId));

  const rows = [];
  let verified = 0;
  let skipped = 0;
  let stale = 0;
  const unmatched = new Set<string>();
  const unmatchedNames = new Set<string>();
  const nowMs = Date.now();
  for (const e of events) {
    const eventType = cleanString(e?.event_type, 32);
    if (!eventType || !EVENT_TYPES.has(eventType)) {
      skipped += 1;
      continue;
    }
    const ddbId = cleanString(e?.ddb_character_id, 64);

    let campaignId: string | null = null;
    let characterId: string | null = null;

    const byName = !ddbId ? routeByName(e?.actor_name, named, liveTs, links) : null;
    const routed = ddbId ? routeFor(ddbId) : byName ? { campaignId: byName.campaignId, characterId: byName.id } : null;
    if (routed) {
      campaignId = routed.campaignId;
      characterId = routed.characterId;
    } else {
      // Not linked in any live campaign. If exactly one campaign is live we can still
      // land it there unattributed (and report it for linking). If several are live,
      // the campaign is genuinely unknown, so skip it rather than guess.
      if (ddbId) unmatched.add(ddbId);
      else if (normName(e?.actor_name)) unmatchedNames.add(String(e.actor_name).slice(0, 200));
      if (soleLive) {
        campaignId = soleLive;
        characterId = null;
      } else {
        skipped += 1;
        continue;
      }
    }

    const source = cleanString(e?.source, 32);
    const externalId = cleanString(e?.external_id, 100);
    let rolledAt = cleanTimestamp(e?.rolled_at);
    // Push 44 (B11, T10): a Roll20 roll's time is the one in its message id, and it must fall inside
    // this session (two minutes' grace before the start) and not in the future.
    if (source === "roll20") {
      const idMs = pushIdTime(externalId);
      if (idMs !== null) rolledAt = new Date(idMs).toISOString();
      const t = rolledAt ? new Date(rolledAt).getTime() : nowMs;
      const startMs = liveByCampaign.get(campaignId!)!.ts;
      if (t < startMs - 2 * 60 * 1000 || t > nowMs + 5 * 60 * 1000) {
        stale += 1;
        continue;
      }
    }
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
      // Canonical only when the client says so AND this request proved it may vouch for the character.
      fidelity: e?.fidelity === "canonical" && proven(campaignId!, characterId) ? "canonical" : "unverified",
      rolled_at: rolledAt,
      external_id: externalId,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: stale && !skipped ? "Those rolls were made before this session started." : "No valid events could be routed.", skipped, stale, unmatched_ddb_ids: Array.from(unmatched), unmatched_names: Array.from(unmatchedNames) },
      { status: 400, headers: CORS }
    );
  }

  for (const r of rows) if (r.fidelity === "canonical") verified += 1;

  // Push 42 (T11): every event with its own time gets an id, so a retried batch is not stored twice.
  for (const r of rows) {
    if (!r.external_id) r.external_id = derivedEventId(r as Parameters<typeof derivedEventId>[0]);
  }

  // Push 42 (T11): a per-campaign ceiling per minute, counted from what is already stored.
  const since = new Date(Date.now() - 60 * 1000).toISOString();
  const perCampaign = new Map<string, number>();
  for (const r of rows) perCampaign.set(r.campaign_id!, (perCampaign.get(r.campaign_id!) ?? 0) + 1);
  for (const [cid, n] of perCampaign) {
    const { count } = await sb.from("vtt_events").select("id", { count: "exact", head: true })
      .eq("campaign_id", cid).gte("received_at", since);
    if ((count ?? 0) + n > MAX_EVENTS_PER_CAMPAIGN_MINUTE) {
      return NextResponse.json({ error: "Too many rolls in the last minute for this table. Wait a minute and roll again." }, { status: 429, headers: CORS });
    }
  }

  // Rows with no external id insert as before. Rows with one (Roll20) skip a copy already stored; a
  // copy its sender can vouch for upgrades a stored unverified one.
  const plain = rows.filter((r) => !r.external_id);
  const keyed = rows.filter((r) => r.external_id);
  let inserted = 0;
  if (plain.length) {
    const { error } = await sb.from("vtt_events").insert(plain);
    if (error) return NextResponse.json({ error: "Insert failed. Try again." }, { status: 500, headers: CORS });
    inserted += plain.length;
  }
  if (keyed.length) {
    const { data: fresh, error } = await sb.from("vtt_events")
      .upsert(keyed, { onConflict: "campaign_id,source,external_id", ignoreDuplicates: true }).select("id");
    if (error) {
      const missing = /external_id/.test(error.message);
      return NextResponse.json({ error: missing ? "Roll20 capture is not set up on the server yet (p160)." : "Insert failed. Try again." }, { status: 500, headers: CORS });
    }
    inserted += (fresh ?? []).length;
    // Only a Roll20 message id can arrive twice from two different senders; a derived id (h:) cannot.
    // Push 44 (B5): the vouched copy replaces everything the stored copy says, not just its badge, so a
    // forged first copy cannot keep forged dice under a verified mark.
    for (const r of keyed.filter((x) => x.fidelity === "canonical" && !x.external_id!.startsWith("h:"))) {
      await sb.from("vtt_events").update({
        fidelity: "canonical", character_id: r.character_id, actor_name: r.actor_name, event_type: r.event_type,
        name: r.name, rolls: r.rolls, state: r.state, rolled_at: r.rolled_at, session_id: r.session_id,
      })
        .eq("campaign_id", r.campaign_id!).eq("source", r.source).eq("external_id", r.external_id!).eq("fidelity", "unverified");
    }
  }

  return NextResponse.json({
    inserted,
    duplicates: rows.length - inserted,
    verified,
    skipped,
    stale,
    live_campaigns: liveCampaignIds.length,
    unmatched_ddb_ids: Array.from(unmatched),
    unmatched_names: Array.from(unmatchedNames),
  }, { headers: CORS });
}
