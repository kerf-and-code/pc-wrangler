import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Kinds that are born as open threads so the prep sheet can find dangling ones.
const OPEN_THREAD_KINDS = new Set(["framing", "hook", "quest_update"]);

type Proposed = {
  id: string;
  campaign_id: string;
  session_id: string;
  kind: string;
  summary: string;
  detail: string | null;
  quote: string | null;
  npc_name: string | null;
  location_name: string | null;
  target_character_id: string | null;
  audio_track_id: string | null;
  t_start_seconds: number | null;
  status: string;
};

export async function POST(req: NextRequest) {
  let body: { action?: string; id?: string; summary?: string; kind?: string; createNpc?: boolean; npcName?: string; createLocation?: boolean; locationName?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const action = body.action;
  const id = (body.id || "").trim();
  if (!id || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "Missing or invalid action/id." }, { status: 400 });
  }

  const supa = await createClient();
  const { data: auth } = await supa.auth.getUser();
  const user = auth?.user;
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();

  const { data: propRow } = await admin
    .from("gm_proposed_events")
    .select("id, campaign_id, session_id, kind, summary, detail, quote, npc_name, location_name, target_character_id, audio_track_id, t_start_seconds, status")
    .eq("id", id)
    .maybeSingle();
  const prop = propRow as Proposed | null;
  if (!prop) return NextResponse.json({ error: "Proposed event not found." }, { status: 404 });

  // Owner gate: the signed-in user must own the campaign this row belongs to.
  const { data: camp } = await supa
    .from("campaigns")
    .select("gm_id")
    .eq("id", prop.campaign_id)
    .maybeSingle();
  if ((camp as { gm_id: string } | null)?.gm_id !== user.id) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  if (prop.status !== "proposed") {
    return NextResponse.json({ error: `This event was already ${prop.status}.` }, { status: 409 });
  }

  if (action === "reject") {
    const { error } = await admin.from("gm_proposed_events").update({ status: "rejected" }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ----- approve (with the GM's optional edits to summary/kind) -----
  const finalKind = (body.kind || prop.kind).trim();
  const finalSummary = (body.summary ?? "").trim() || prop.summary;

  // Validate the kind against the controlled vocabulary.
  const { data: kindRow } = await admin.from("gm_event_kinds").select("kind").eq("kind", finalKind).maybeSingle();
  if (!kindRow) return NextResponse.json({ error: `Unknown kind "${finalKind}".` }, { status: 400 });

  // Optional one-click NPC: resolve an existing npc character by name (case
  // insensitive) or create one, then link it. This is the Codex-fills-itself step.
  let npcId: string | null = null;
  const npcName = (body.npcName || prop.npc_name || "").trim();
  if (body.createNpc && npcName) {
    const { data: existing } = await admin
      .from("characters")
      .select("id")
      .eq("campaign_id", prop.campaign_id)
      .eq("kind", "npc")
      .ilike("name", npcName)
      .maybeSingle();
    if (existing) {
      npcId = (existing as { id: string }).id;
    } else {
      const { data: created, error: cErr } = await admin
        .from("characters")
        .insert({ campaign_id: prop.campaign_id, kind: "npc", name: npcName, active: true })
        .select("id")
        .single();
      if (cErr) return NextResponse.json({ error: `Could not create NPC: ${cErr.message}` }, { status: 500 });
      npcId = (created as { id: string }).id;
    }
  }

  // Optional one-click place: the same "Codex fills itself" step for locations.
  // gm_events have no location FK, so this stands up a Codex entry (type
  // 'location'), deduped by title, seeded with the beat's detail.
  let locationId: string | null = null;
  const locationName = (body.locationName || prop.location_name || "").trim();
  if (body.createLocation && locationName) {
    const { data: existingLoc } = await admin
      .from("entries")
      .select("id")
      .eq("campaign_id", prop.campaign_id)
      .eq("type", "location")
      .ilike("title", locationName)
      .maybeSingle();
    if (existingLoc) {
      locationId = (existingLoc as { id: string }).id;
    } else {
      const seed = (prop.detail || prop.summary || "").toString().slice(0, 2000);
      const { data: createdLoc, error: lErr } = await admin
        .from("entries")
        .insert({ campaign_id: prop.campaign_id, type: "location", title: locationName, body: seed || null, visibility: "player" })
        .select("id")
        .single();
      if (lErr) return NextResponse.json({ error: `Could not create place: ${lErr.message}` }, { status: 500 });
      locationId = (createdLoc as { id: string }).id;
    }
  }

  const threadStatus = OPEN_THREAD_KINDS.has(finalKind) ? "open" : "n/a";

  const { error: insErr } = await admin.from("gm_events").insert({
    campaign_id: prop.campaign_id,
    session_id: prop.session_id,
    kind: finalKind,
    summary: finalSummary,
    detail: prop.detail,
    quote: prop.quote,
    npc_id: npcId,
    npc_name: npcName || prop.npc_name,
    location_name: prop.location_name,
    target_character_id: prop.target_character_id,
    thread_status: threadStatus,
    audio_track_id: prop.audio_track_id,
    t_start_seconds: prop.t_start_seconds,
    proposed_from: prop.id,
  });
  if (insErr) return NextResponse.json({ error: `Could not save the event: ${insErr.message}` }, { status: 500 });

  const { error: upErr } = await admin
    .from("gm_proposed_events")
    .update({ status: "approved", kind: finalKind, summary: finalSummary, npc_id: npcId })
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, npcId, locationId });
}
