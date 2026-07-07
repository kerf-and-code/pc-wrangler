import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Kinds that are born as open threads so the prep sheet can find dangling ones.
const OPEN_THREAD_KINDS = new Set(["framing", "hook", "quest_update"]);

// Short title for an item/lore entry created from a beat's summary.
function deriveTitle(summary: string): string {
  const first = (summary || "").split(/[.!?]/)[0].trim();
  return first.slice(0, 120);
}

// Sensible relation + direction for a link between two created entities.
function relationFor(a: string, b: string): { srcKind: string; relation: string } {
  const key = [a, b].sort().join("+");
  const map: Record<string, { src: string; rel: string }> = {
    "faction+npc": { src: "npc", rel: "member of" },
    "location+npc": { src: "npc", rel: "at" },
    "item+npc": { src: "npc", rel: "carries" },
    "lore+npc": { src: "lore", rel: "concerns" },
    "faction+location": { src: "location", rel: "held by" },
    "item+location": { src: "item", rel: "found at" },
    "location+lore": { src: "lore", rel: "concerns" },
    "faction+item": { src: "item", rel: "tied to" },
    "faction+lore": { src: "lore", rel: "concerns" },
    "item+lore": { src: "lore", rel: "concerns" },
  };
  const m = map[key];
  return m ? { srcKind: m.src, relation: m.rel } : { srcKind: a, relation: "linked" };
}

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
  faction_name: string | null;
  target_character_id: string | null;
  audio_track_id: string | null;
  t_start_seconds: number | null;
  status: string;
};

export async function POST(req: NextRequest) {
  let body: { action?: string; id?: string; summary?: string; kind?: string; createNpc?: boolean; npcName?: string; createLocation?: boolean; locationName?: string; createFaction?: boolean; factionName?: string; createItem?: boolean; createLore?: boolean };
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
    .select("id, campaign_id, session_id, kind, summary, detail, quote, npc_name, location_name, faction_name, target_character_id, audio_track_id, t_start_seconds, status")
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

  // Optional one-click faction: a Codex 'lore' entry tagged 'faction', deduped
  // by title. The same self-filling Codex step for organizations.
  let factionId: string | null = null;
  const factionName = (body.factionName || prop.faction_name || "").trim();
  if (body.createFaction && factionName) {
    const { data: existingFac } = await admin
      .from("entries")
      .select("id")
      .eq("campaign_id", prop.campaign_id)
      .eq("type", "lore")
      .ilike("title", factionName)
      .maybeSingle();
    if (existingFac) {
      factionId = (existingFac as { id: string }).id;
    } else {
      const seed = (prop.detail || prop.summary || "").toString().slice(0, 2000);
      const { data: createdFac, error: fErr } = await admin
        .from("entries")
        .insert({ campaign_id: prop.campaign_id, type: "lore", title: factionName, body: seed || null, visibility: "player", tags: ["faction"] })
        .select("id")
        .single();
      if (fErr) return NextResponse.json({ error: `Could not create faction: ${fErr.message}` }, { status: 500 });
      factionId = (createdFac as { id: string }).id;
    }
  }

  const threadStatus = OPEN_THREAD_KINDS.has(finalKind) ? "open" : "n/a";

  // Optional item / lore entries, titled from the beat's summary (GM can rename).
  let itemId: string | null = null;
  if (body.createItem) {
    const title = deriveTitle(finalSummary);
    if (title) {
      const { data: ex } = await admin.from("entries").select("id").eq("campaign_id", prop.campaign_id).eq("type", "lore").ilike("title", title).maybeSingle();
      if (ex) itemId = (ex as { id: string }).id;
      else {
        const { data: cr, error: e } = await admin.from("entries")
          .insert({ campaign_id: prop.campaign_id, type: "lore", title, body: (prop.detail || prop.summary || "").toString().slice(0, 2000) || null, visibility: "player", tags: ["item"] })
          .select("id").single();
        if (e) return NextResponse.json({ error: `Could not create item: ${e.message}` }, { status: 500 });
        itemId = (cr as { id: string }).id;
      }
    }
  }

  let loreId: string | null = null;
  if (body.createLore) {
    const title = deriveTitle(finalSummary);
    if (title) {
      const { data: ex } = await admin.from("entries").select("id").eq("campaign_id", prop.campaign_id).eq("type", "lore").ilike("title", title).maybeSingle();
      if (ex) loreId = (ex as { id: string }).id;
      else {
        const { data: cr, error: e } = await admin.from("entries")
          .insert({ campaign_id: prop.campaign_id, type: "lore", title, body: (prop.detail || prop.summary || "").toString().slice(0, 2000) || null, visibility: "player" })
          .select("id").single();
        if (e) return NextResponse.json({ error: `Could not create lore: ${e.message}` }, { status: 500 });
        loreId = (cr as { id: string }).id;
      }
    }
  }


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
    faction_name: prop.faction_name,
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

  // Cross-link everything created from this one beat, so search and the
  // Connections panel surface the whole cluster from any single entry point.
  const nodes: { et: "character" | "entry"; id: string; kind: string }[] = [];
  if (npcId) nodes.push({ et: "character", id: npcId, kind: "npc" });
  if (locationId) nodes.push({ et: "entry", id: locationId, kind: "location" });
  if (factionId) nodes.push({ et: "entry", id: factionId, kind: "faction" });
  if (itemId) nodes.push({ et: "entry", id: itemId, kind: "item" });
  if (loreId) nodes.push({ et: "entry", id: loreId, kind: "lore" });

  let linksMade = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const rel = relationFor(a.kind, b.kind);
      const src = rel.srcKind === a.kind ? a : b;
      const tgt = src === a ? b : a;
      const { data: ex } = await admin.from("entity_links").select("id")
        .eq("campaign_id", prop.campaign_id)
        .or(`and(source_id.eq.${src.id},target_id.eq.${tgt.id}),and(source_id.eq.${tgt.id},target_id.eq.${src.id})`)
        .limit(1);
      if (ex && (ex as { id: string }[]).length) continue;
      const { error: lErr } = await admin.from("entity_links").insert({
        campaign_id: prop.campaign_id,
        source_type: src.et, source_id: src.id,
        target_type: tgt.et, target_id: tgt.id,
        relation: rel.relation,
      });
      if (!lErr) linksMade += 1;
    }
  }

  return NextResponse.json({ ok: true, npcId, locationId, factionId, itemId, loreId, linksMade });
}
