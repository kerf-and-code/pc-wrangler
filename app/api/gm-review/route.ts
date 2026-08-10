import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Kinds that are born as open threads so the prep sheet can find dangling ones.
const OPEN_THREAD_KINDS = new Set(["framing", "hook", "quest_update"]);

// Role nouns the extractor reports in the npc_name slot as if they were characters.
// Left unchecked they become permanent campaign NPCs: "Innkeeper" with 10 mentions,
// "Merchant" with 7, plus Enemy, Orc and brigand, all sitting in the roster and in the
// /retire dropdown forever. They are roles, not people.
//
// This blocks AUTOMATIC creation only. A GM who genuinely wants an NPC called Innkeeper
// can still tick the box, because an explicit true always wins below.
const GENERIC_NAMES = new Set([
  "npc", "enemy", "enemies", "guard", "guards", "bandit", "bandits", "brigand", "brigands",
  "merchant", "innkeeper", "barkeep", "bartender", "shopkeeper", "orc", "orcs", "goblin",
  "goblins", "soldier", "soldiers", "villager", "villagers", "commoner", "priest", "guard captain",
  "stranger", "man", "woman", "boy", "girl", "child", "someone", "unknown", "narrator", "gm", "dm",
]);

// A name has to appear at least this many times in the campaign before it is created
// automatically. The 2026-07-22 backfill preview showed why this works: every mangled
// transcription had exactly ONE mention while the real name had six or more.
// "Candlefeet" 1 against "Candlekeep" 6. "Ashmole" 1 against "The Ashmoor" 6. Mention
// count separates them without any fuzzy matching at all.
//
// A genuinely new entity mentioned once still reaches the Codex the moment it is
// mentioned a second time, or immediately if the GM ticks the box.
const AUTO_CREATE_MIN_MENTIONS = 2;

// Short title for an item entry created from a beat's summary. Lore no longer uses this: a beat has
// no name, so a title cut from its summary is a whole sentence wearing a title, which is exactly the
// 100+ sentence-titled lore rows this change stops producing. See the fold logic below.
function deriveTitle(summary: string): string {
  const first = (summary || "").split(/[.!?]/)[0].trim();
  return first.slice(0, 120);
}

// A campaign entity a lore fact can fold onto: an NPC (a character) or a location/faction (an entry).
type FoldTarget = { et: "character" | "entry"; kind: "npc" | "location" | "faction"; id: string };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word, case-insensitive presence test. A name under 4 chars, or one on the GENERIC_NAMES
// stoplist, is not distinctive enough to hang a fact on and is skipped: the same guard the
// auto-create path already trusts, so "Guard" or "Man" cannot match a whole campaign.
function nameInText(name: string, text: string): boolean {
  const n = (name || "").trim();
  if (n.length < 4) return false;
  if (GENERIC_NAMES.has(n.toLowerCase())) return false;
  return new RegExp(`\\b${escapeRegex(n)}\\b`, "i").test(text);
}

// The distinct existing entities a beat's TEXT names. This is the whole fold decision: exactly one
// match is a confident home and the fact folds into it; zero or several is not, and the beat is left
// for the GM to route. It reads the campaign's real NPCs, places and factions rather than the beat's
// structured name slots, because a lore beat carries no npc_name (the extractor fills that only for
// npc_* kinds) - the subject of a lore fact lives in its prose, not a field.
async function resolveFoldTargets(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string,
  text: string,
): Promise<FoldTarget[]> {
  const [{ data: npcs }, { data: entries }] = await Promise.all([
    admin.from("characters").select("id, name").eq("campaign_id", campaignId).eq("kind", "npc"),
    admin.from("entries").select("id, type, title, tags").eq("campaign_id", campaignId).in("type", ["location", "lore"]),
  ]);
  const out: FoldTarget[] = [];
  for (const c of ((npcs as { id: string; name: string }[]) || [])) {
    if (nameInText(c.name, text)) out.push({ et: "character", kind: "npc", id: c.id });
  }
  for (const e of ((entries as { id: string; type: string; title: string; tags: string[] | null }[]) || [])) {
    if (e.type === "location" && nameInText(e.title, text)) out.push({ et: "entry", kind: "location", id: e.id });
    else if (e.type === "lore" && (e.tags || []).includes("faction") && nameInText(e.title, text)) out.push({ et: "entry", kind: "faction", id: e.id });
  }
  return out;
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

// Should this entity be created? THREE-STATE on purpose.
//
//   true       the GM ticked the box. Always create, no filtering. Their call.
//   false      the GM unticked it. Never create.
//   undefined  nobody said. Decide from the data.
//
// The undefined case is what makes bulk accept work. It sends no flags, so before this it
// created nothing at all: 26 mentions of "The Ashen Circle" across two sessions produced
// no Codex entry because the only path that creates entities was the per-row button.
// Now an unspecified flag means "use judgement" rather than "no".
async function decideCreate(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string,
  column: "npc_name" | "location_name" | "faction_name",
  name: string,
  explicit: boolean | undefined,
): Promise<boolean> {
  if (explicit === true) return true;
  if (explicit === false) return false;
  if (!name) return false;
  if (GENERIC_NAMES.has(name.trim().toLowerCase())) return false;

  // head:true returns a count and no rows, so this is not subject to the 1000-row cap
  // that truncated extraction and the recap earlier this month.
  const { count, error } = await admin
    .from("gm_proposed_events")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .ilike(column, name.trim());

  // On a failed count, do not create. A missing Codex entry is recoverable by the
  // backfill; a wrong one has to be found and merged by hand.
  if (error) return false;
  return (count || 0) >= AUTO_CREATE_MIN_MENTIONS;
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
  // The beat's own text. Whoever this proposal is ABOUT gets it, and that is decided once here
  // rather than independently by each create block below.
  const seed = (prop.detail || prop.summary || "").toString().slice(0, 2000);

  const npcName = (body.npcName || prop.npc_name || "").trim();
  if (await decideCreate(admin, prop.campaign_id, "npc_name", npcName, body.createNpc)) {
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
        // Seeded, which it never was: 109 NPCs across every campaign had been created with an
        // empty description while the SAME beat text was written onto the location instead. A beat
        // that names a person and a place is almost always describing the person - "a broad
        // half-orc in a patched hauberk" ended up as the body of The Toll-Bridge - so the NPC takes
        // the seed and the place, below, does not.
        .insert({ campaign_id: prop.campaign_id, kind: "npc", name: npcName, description: seed || null, active: true })
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
  if (await decideCreate(admin, prop.campaign_id, "location_name", locationName, body.createLocation)) {
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
      // Only seeded when this beat did NOT also mint an NPC. When it did, the text is describing
      // the person, and putting it here produced locations that read as character sheets. An empty
      // place is honest and the GM can fill it in; a mislabelled one is worse than blank, and it
      // is what a public codex would publish.
      const locSeed = npcId ? "" : seed;
      const { data: createdLoc, error: lErr } = await admin
        .from("entries")
        .insert({ campaign_id: prop.campaign_id, created_by: user.id, type: "location", title: locationName, body: locSeed || null, visibility: "player" })
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
  if (await decideCreate(admin, prop.campaign_id, "faction_name", factionName, body.createFaction)) {
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
      const { data: createdFac, error: fErr } = await admin
        .from("entries")
        .insert({ campaign_id: prop.campaign_id, created_by: user.id, type: "lore", title: factionName, body: seed || null, visibility: "player", tags: ["faction"] })
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
          .insert({ campaign_id: prop.campaign_id, created_by: user.id, type: "lore", title, body: (prop.detail || prop.summary || "").toString().slice(0, 2000) || null, visibility: "player", tags: ["item"] })
          .select("id").single();
        if (e) return NextResponse.json({ error: `Could not create item: ${e.message}` }, { status: 500 });
        itemId = (cr as { id: string }).id;
      }
    }
  }

  // loreId stays null now: lore no longer mints its own entry. It is kept as a node below only so
  // the cross-link loop and the JSON response need no edit, and it is simply never set.
  const loreId: string | null = null;

  // FOLD instead of mint. A beat that names exactly one existing entity has the fact appended to
  // that entity's own page (an NPC's description, a place or faction's body), which is the same
  // field public_codex already renders, so it shows on the wiki and both codices with no page
  // change. A beat that names none or several mints nothing here: forcing a home would be a wrong
  // attach that looks correct, so the approved gm_event is left for the proposals surface to route.
  if (body.createLore) {
    const scanText = `${finalSummary}\n${prop.detail || ""}\n${prop.quote || ""}`;
    const scanned = await resolveFoldTargets(admin, prop.campaign_id, scanText);

    // Entities already resolved through the structured name slots above (the npc/location/faction
    // blocks) count as named too, so a beat that stands up a place AND is about a person is two
    // entities and does not auto-fold. Merge by id.
    const byId = new Map<string, FoldTarget>();
    for (const t of scanned) byId.set(t.id, t);
    if (npcId) byId.set(npcId, { et: "character", kind: "npc", id: npcId });
    if (locationId) byId.set(locationId, { et: "entry", kind: "location", id: locationId });
    if (factionId) byId.set(factionId, { et: "entry", kind: "faction", id: factionId });

    if (byId.size === 1) {
      const t = Array.from(byId.values())[0];
      const fact = finalSummary.trim();
      if (fact) {
        if (t.et === "character") {
          const { data: cur } = await admin.from("characters").select("description").eq("id", t.id).maybeSingle();
          const curBody = ((cur as { description: string | null } | null)?.description) || "";
          // Never twice: a re-approval or the retro pass must fold the same fact without stacking it.
          if (!curBody.toLowerCase().includes(fact.toLowerCase())) {
            const next = curBody ? `${curBody}\n\n${fact}` : fact;
            const { error: e } = await admin.from("characters").update({ description: next }).eq("id", t.id);
            if (e) return NextResponse.json({ error: `Could not fold the fact into the NPC: ${e.message}` }, { status: 500 });
          }
        } else {
          const { data: cur } = await admin.from("entries").select("body").eq("id", t.id).maybeSingle();
          const curBody = ((cur as { body: string | null } | null)?.body) || "";
          if (!curBody.toLowerCase().includes(fact.toLowerCase())) {
            const next = curBody ? `${curBody}\n\n${fact}` : fact;
            const { error: e } = await admin.from("entries").update({ body: next }).eq("id", t.id);
            if (e) return NextResponse.json({ error: `Could not fold the fact into the entry: ${e.message}` }, { status: 500 });
          }
        }
      }
      // Carry the id onto the beat through the matching FK, so the attach survives a later body edit
      // and the gm_event records what the fact was about even after the text is trimmed.
      if (t.kind === "npc") npcId = t.id;
      else if (t.kind === "location") locationId = t.id;
      else if (t.kind === "faction") factionId = t.id;
    }
    // byId.size === 0 or > 1: mint nothing. The gm_event below still records the beat.
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
    // The name strings stay alongside the ids on purpose. They are what the entity was
    // called at the moment it was said, they survive a Codex rename, and they are what
    // makes the backfill re-runnable against rows created before p8-entity-fks.
    location_id: locationId,
    location_name: prop.location_name,
    faction_id: factionId,
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
    .update({
      status: "approved",
      kind: finalKind,
      summary: finalSummary,
      npc_id: npcId,
      location_id: locationId,
      faction_id: factionId,
    })
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
