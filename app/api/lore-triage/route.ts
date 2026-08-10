import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// Triage for a lore beat the fold (change 1) could not place. The surface reads unresolved lore
// gm_events (kind='lore', all three entity FKs null, lore_disposition null); this route is the four
// actions a GM takes on one of them:
//
//   attach   the beat is about an existing entity the GM picks: append the fact to that entity's
//            own body/description and stamp the matching FK. No lore entry. Same operation as the
//            change-1 fold, but the GM chose the target instead of a lone name match.
//   create   the beat is a first mention: make the entity, seed it with the fact, stamp the FK.
//   keep     genuine standalone lore: make a titled lore entry (the GM's title, not a sentence)
//            and file the beat 'kept'.
//   dismiss  table talk: file the beat 'dismissed'.
//
// attach and create resolve by setting an FK, which drops the beat out of the surface query on its
// own, so they leave lore_disposition null. keep and dismiss set no FK, so they carry the outcome in
// lore_disposition. All are one-way: a beat already resolved or disposed is refused, so a
// double-click or a stale surface cannot re-file it.
//
// Concrete table/column/key access throughout (no dynamic .from()/keys), because that is the shape
// change 1 built green under the generated supabase-js types. The append duplicates the change-1
// fold rather than sharing it, to keep this a new file that does not reopen the shipped review
// route. Worth factoring into lib/lore later.

type Kind = "npc" | "location" | "faction";
const KINDS: Kind[] = ["npc", "location", "faction"];
const etOf = (k: Kind): "character" | "entry" => (k === "npc" ? "character" : "entry");

type Event = {
  campaign_id: string;
  kind: string;
  summary: string;
  detail: string | null;
  npc_id: string | null;
  location_id: string | null;
  faction_id: string | null;
  lore_disposition: string | null;
};

// Append a fact as its own trailing paragraph, but never twice: a re-run or a second target reusing
// the same entity must not stack the same sentence. Returns an error message, or null on success.
async function appendFact(
  admin: ReturnType<typeof createAdminClient>,
  et: "character" | "entry",
  id: string,
  fact: string,
): Promise<string | null> {
  const f = (fact || "").trim();
  if (!f) return null;
  if (et === "character") {
    const { data } = await admin.from("characters").select("description").eq("id", id).maybeSingle();
    const cur = ((data as { description: string | null } | null)?.description) || "";
    if (cur.toLowerCase().includes(f.toLowerCase())) return null;
    const next = cur ? `${cur}\n\n${f}` : f;
    const { error } = await admin.from("characters").update({ description: next }).eq("id", id);
    return error ? error.message : null;
  }
  const { data } = await admin.from("entries").select("body").eq("id", id).maybeSingle();
  const cur = ((data as { body: string | null } | null)?.body) || "";
  if (cur.toLowerCase().includes(f.toLowerCase())) return null;
  const next = cur ? `${cur}\n\n${f}` : f;
  const { error } = await admin.from("entries").update({ body: next }).eq("id", id);
  return error ? error.message : null;
}

// The campaign an entity belongs to, read concretely per kind. Null if the entity does not exist.
async function campaignOf(
  admin: ReturnType<typeof createAdminClient>,
  et: "character" | "entry",
  id: string,
): Promise<string | null> {
  if (et === "character") {
    const { data } = await admin.from("characters").select("campaign_id").eq("id", id).maybeSingle();
    return (data as { campaign_id: string } | null)?.campaign_id ?? null;
  }
  const { data } = await admin.from("entries").select("campaign_id").eq("id", id).maybeSingle();
  return (data as { campaign_id: string } | null)?.campaign_id ?? null;
}

// Stamp the one FK that matches the kind, as a concrete object per branch rather than a computed key.
async function stampFk(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  kind: Kind,
  entityId: string,
): Promise<string | null> {
  const patch =
    kind === "npc" ? { npc_id: entityId }
    : kind === "location" ? { location_id: entityId }
    : { faction_id: entityId };
  const { error } = await admin.from("gm_events").update(patch).eq("id", eventId);
  return error ? error.message : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      eventId?: string;
      action?: string;
      target?: { kind?: string; id?: string };
      name?: string;
      kind?: string;
      title?: string;
    };

    const eventId = (body.eventId || "").trim();
    const action = body.action;
    if (!eventId) return NextResponse.json({ error: "Missing eventId." }, { status: 400 });
    if (action !== "attach" && action !== "create" && action !== "keep" && action !== "dismiss") {
      return NextResponse.json({ error: "Missing or invalid action." }, { status: 400 });
    }

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const admin = createAdminClient();

    const { data: evRow } = await admin
      .from("gm_events")
      .select("campaign_id, kind, summary, detail, npc_id, location_id, faction_id, lore_disposition")
      .eq("id", eventId)
      .maybeSingle();
    const ev = evRow as Event | null;
    if (!ev) return NextResponse.json({ error: "Event not found." }, { status: 404 });

    // Owner gate: the signed-in user must own the campaign this beat belongs to. Same check the
    // review route uses, rather than trusting an FK to have been scoped upstream.
    const { data: campRow } = await supa
      .from("campaigns")
      .select("gm_id")
      .eq("id", ev.campaign_id)
      .maybeSingle();
    if ((campRow as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    // Only triage a lore beat that is still in the surface. A resolved or disposed one is done, and
    // refusing it is what makes a double-click or a stale list harmless.
    if (ev.kind !== "lore") {
      return NextResponse.json({ error: "That event is not a lore beat." }, { status: 400 });
    }
    if (ev.npc_id || ev.location_id || ev.faction_id || ev.lore_disposition) {
      return NextResponse.json({ error: "That beat has already been handled." }, { status: 409 });
    }

    const fact = (ev.summary || "").trim();
    // A fresh entity is seeded with the fuller text; appending to an existing one uses the concise
    // summary, the same split the review route makes between a create seed and a later mention.
    const seed = (ev.detail || ev.summary || "").toString().slice(0, 2000) || null;

    // ----- dismiss -----
    if (action === "dismiss") {
      const { error } = await admin.from("gm_events").update({ lore_disposition: "dismissed" }).eq("id", eventId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, disposition: "dismissed" });
    }

    // ----- keep as its own titled lore entry -----
    if (action === "keep") {
      const title = (body.title || "").trim();
      if (!title) return NextResponse.json({ error: "Give the lore entry a title." }, { status: 400 });
      // Dedupe by title like the review route, so keeping twice does not fork the entry.
      const { data: ex } = await admin
        .from("entries")
        .select("id")
        .eq("campaign_id", ev.campaign_id)
        .eq("type", "lore")
        .ilike("title", title)
        .maybeSingle();
      if (!ex) {
        const { error: cErr } = await admin
          .from("entries")
          .insert({ campaign_id: ev.campaign_id, created_by: user.id, type: "lore", title, body: seed, visibility: "player" });
        if (cErr) return NextResponse.json({ error: `Could not create lore entry: ${cErr.message}` }, { status: 500 });
      }
      const { error: dErr } = await admin.from("gm_events").update({ lore_disposition: "kept" }).eq("id", eventId);
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, disposition: "kept" });
    }

    // ----- attach to an existing entity the GM picked -----
    if (action === "attach") {
      const kind = (body.target?.kind || "") as Kind;
      const targetId = (body.target?.id || "").trim();
      if (!KINDS.includes(kind) || !targetId) {
        return NextResponse.json({ error: "Pick something to attach to." }, { status: 400 });
      }
      const et = etOf(kind);
      // The target must be in THIS campaign. Without this a crafted request could fold a fact onto
      // another GM's entity.
      if ((await campaignOf(admin, et, targetId)) !== ev.campaign_id) {
        return NextResponse.json({ error: "That target is not in this campaign." }, { status: 400 });
      }
      const appendErr = await appendFact(admin, et, targetId, fact);
      if (appendErr) return NextResponse.json({ error: `Could not fold the fact in: ${appendErr}` }, { status: 500 });
      const fkErr = await stampFk(admin, eventId, kind, targetId);
      if (fkErr) return NextResponse.json({ error: fkErr }, { status: 500 });
      return NextResponse.json({ ok: true, attachedTo: { kind, id: targetId } });
    }

    // ----- create a new entity and attach -----  (action === "create")
    const kind = (body.kind || "") as Kind;
    const name = (body.name || "").trim();
    if (!KINDS.includes(kind) || !name) {
      return NextResponse.json({ error: "Give the new entity a name and kind." }, { status: 400 });
    }

    let entityId: string;
    let existed = false;
    if (kind === "npc") {
      const { data: ex } = await admin
        .from("characters").select("id").eq("campaign_id", ev.campaign_id).eq("kind", "npc").ilike("name", name).maybeSingle();
      if (ex) { entityId = (ex as { id: string }).id; existed = true; }
      else {
        const { data: cr, error: e } = await admin
          .from("characters")
          .insert({ campaign_id: ev.campaign_id, kind: "npc", name, description: seed, active: true })
          .select("id").single();
        if (e) return NextResponse.json({ error: `Could not create NPC: ${e.message}` }, { status: 500 });
        entityId = (cr as { id: string }).id;
      }
    } else if (kind === "location") {
      const { data: ex } = await admin
        .from("entries").select("id").eq("campaign_id", ev.campaign_id).eq("type", "location").ilike("title", name).maybeSingle();
      if (ex) { entityId = (ex as { id: string }).id; existed = true; }
      else {
        const { data: cr, error: e } = await admin
          .from("entries")
          .insert({ campaign_id: ev.campaign_id, created_by: user.id, type: "location", title: name, body: seed, visibility: "player" })
          .select("id").single();
        if (e) return NextResponse.json({ error: `Could not create location: ${e.message}` }, { status: 500 });
        entityId = (cr as { id: string }).id;
      }
    } else {
      // faction: a lore entry carrying the reserved 'faction' tag. Concrete literal, not a union
      // with location, because supabase-js's insert type rejects the extra 'tags' key off a union.
      const { data: ex } = await admin
        .from("entries").select("id").eq("campaign_id", ev.campaign_id).eq("type", "lore").ilike("title", name).maybeSingle();
      if (ex) { entityId = (ex as { id: string }).id; existed = true; }
      else {
        const { data: cr, error: e } = await admin
          .from("entries")
          .insert({ campaign_id: ev.campaign_id, created_by: user.id, type: "lore", title: name, body: seed, visibility: "player", tags: ["faction"] })
          .select("id").single();
        if (e) return NextResponse.json({ error: `Could not create faction: ${e.message}` }, { status: 500 });
        entityId = (cr as { id: string }).id;
      }
    }

    // A freshly created entity already holds the fact as its seed. Only an existing one needs the
    // fact appended, and appendFact dedupes anyway.
    if (existed) {
      const appendErr = await appendFact(admin, etOf(kind), entityId, fact);
      if (appendErr) return NextResponse.json({ error: `Could not fold the fact in: ${appendErr}` }, { status: 500 });
    }

    const fkErr = await stampFk(admin, eventId, kind, entityId);
    if (fkErr) return NextResponse.json({ error: fkErr }, { status: 500 });
    return NextResponse.json({ ok: true, created: !existed, attachedTo: { kind, id: entityId } });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/lore-triage] unhandled failure:", detail, e);
    return NextResponse.json({ error: `Could not triage: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
