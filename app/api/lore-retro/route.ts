import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

// The retroactive pass over the sentence-titled lore backlog. Unlike the live triage route, this
// acts on lore ENTRIES that already exist, so the actions and their consequences differ:
//
//   retitle  genuine standalone lore wearing a sentence for a title: give it a real name. Stays.
//   attach   the entry is about an existing entity: fold its text onto that entity, then DELETE it.
//   create   a first mention: make the entity from the entry's text, then DELETE the entry.
//   delete   junk or a duplicate: remove it.
//
// Everything that would delete or rewrite an entry first writes a fresh copy to lore_backup, on top
// of the one-time p42 snapshot, so an action is always reversible from the backup by original id.
//
// Guards: the owner gate (campaigns.gm_id === user.id) is the hard stop that keeps this off another
// GM's campaign (CandleKeep Tuesday), and the route only ever touches an untagged type='lore' entry,
// so a crafted request cannot reach a faction or item, which live in their own tabs. Concrete
// table/column/key access throughout, the shape that builds green under the generated types.

type Kind = "npc" | "location" | "faction";
const KINDS: Kind[] = ["npc", "location", "faction"];
const etOf = (k: Kind): "character" | "entry" => (k === "npc" ? "character" : "entry");

type Entry = {
  id: string;
  campaign_id: string;
  type: string;
  title: string;
  body: string | null;
  visibility: string;
  created_by: string;
  tags: string[] | null;
  is_public: boolean;
  slug: string | null;
  image_url: string | null;
};

// A fresh backup row for one entry, captured at action time. Returns an error message, or null.
async function backupEntry(
  admin: ReturnType<typeof createAdminClient>,
  e: Entry,
  reason: string,
): Promise<string | null> {
  const { error } = await admin.from("lore_backup").insert({
    entry_id: e.id, campaign_id: e.campaign_id, type: e.type, title: e.title, body: e.body,
    visibility: e.visibility, created_by: e.created_by, tags: e.tags, is_public: e.is_public,
    slug: e.slug, image_url: e.image_url, reason,
  });
  return error ? error.message : null;
}

// Append text as its own trailing paragraph, deduped, concretely per entity kind.
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      entryId?: string;
      action?: string;
      title?: string;
      target?: { kind?: string; id?: string };
      name?: string;
      kind?: string;
    };

    const entryId = (body.entryId || "").trim();
    const action = body.action;
    if (!entryId) return NextResponse.json({ error: "Missing entryId." }, { status: 400 });
    if (action !== "retitle" && action !== "attach" && action !== "create" && action !== "delete") {
      return NextResponse.json({ error: "Missing or invalid action." }, { status: 400 });
    }

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const admin = createAdminClient();

    const { data: eRow } = await admin
      .from("entries")
      .select("id, campaign_id, type, title, body, visibility, created_by, tags, is_public, slug, image_url")
      .eq("id", entryId)
      .maybeSingle();
    const entry = eRow as Entry | null;
    if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

    // Owner gate: the signed-in user must own the campaign. This is what keeps the retro pass off
    // CandleKeep Tuesday, which is not this user's gm_id.
    const { data: campRow } = await supa
      .from("campaigns")
      .select("gm_id")
      .eq("id", entry.campaign_id)
      .maybeSingle();
    if ((campRow as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    // Only the sentence backlog: an untagged lore entry. Factions and items are tagged lore and live
    // in their own tabs, so refusing them means the retro pass can never delete one by accident.
    const tags = entry.tags || [];
    if (entry.type !== "lore" || tags.includes("faction") || tags.includes("item")) {
      return NextResponse.json({ error: "That is not a backlog lore entry." }, { status: 400 });
    }

    // The substance to fold or seed with: the body if it has any, else the sentence title, which is
    // the fact itself in these rows.
    const foldText = (entry.body && entry.body.trim()) ? entry.body.trim() : entry.title.trim();

    // ----- retitle: keep the entry, give it a real name -----
    if (action === "retitle") {
      const title = (body.title || "").trim();
      if (!title) return NextResponse.json({ error: "Give the entry a real title." }, { status: 400 });
      const bErr = await backupEntry(admin, entry, "retro-retitle");
      if (bErr) return NextResponse.json({ error: `Backup failed, nothing changed: ${bErr}` }, { status: 500 });
      const { error } = await admin.from("entries").update({ title }).eq("id", entry.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, retitled: true });
    }

    // ----- delete: junk or duplicate -----
    if (action === "delete") {
      const bErr = await backupEntry(admin, entry, "retro-delete");
      if (bErr) return NextResponse.json({ error: `Backup failed, nothing deleted: ${bErr}` }, { status: 500 });
      const { error } = await admin.from("entries").delete().eq("id", entry.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, deleted: true });
    }

    // ----- attach: fold onto an existing entity, then delete the entry -----
    if (action === "attach") {
      const kind = (body.target?.kind || "") as Kind;
      const targetId = (body.target?.id || "").trim();
      if (!KINDS.includes(kind) || !targetId) {
        return NextResponse.json({ error: "Pick something to attach to." }, { status: 400 });
      }
      const et = etOf(kind);
      if ((await campaignOf(admin, et, targetId)) !== entry.campaign_id) {
        return NextResponse.json({ error: "That target is not in this campaign." }, { status: 400 });
      }
      const bErr = await backupEntry(admin, entry, `retro-attach->${kind}`);
      if (bErr) return NextResponse.json({ error: `Backup failed, nothing changed: ${bErr}` }, { status: 500 });
      const appendErr = await appendFact(admin, et, targetId, foldText);
      if (appendErr) return NextResponse.json({ error: `Could not fold the text in: ${appendErr}` }, { status: 500 });
      const { error: delErr } = await admin.from("entries").delete().eq("id", entry.id);
      if (delErr) return NextResponse.json({ error: `Folded, but could not remove the old entry: ${delErr.message}` }, { status: 500 });
      return NextResponse.json({ ok: true, attachedTo: { kind, id: targetId }, deleted: true });
    }

    // ----- create a new entity from the entry, then delete the entry -----  (action === "create")
    const kind = (body.kind || "") as Kind;
    const name = (body.name || "").trim();
    if (!KINDS.includes(kind) || !name) {
      return NextResponse.json({ error: "Give the new entity a name and kind." }, { status: 400 });
    }

    const bErr = await backupEntry(admin, entry, `retro-create->${kind}`);
    if (bErr) return NextResponse.json({ error: `Backup failed, nothing changed: ${bErr}` }, { status: 500 });

    let entityId: string;
    if (kind === "npc") {
      const { data: ex } = await admin
        .from("characters").select("id").eq("campaign_id", entry.campaign_id).eq("kind", "npc").ilike("name", name).maybeSingle();
      if (ex) {
        entityId = (ex as { id: string }).id;
        const appErr = await appendFact(admin, "character", entityId, foldText);
        if (appErr) return NextResponse.json({ error: `Could not fold the text in: ${appErr}` }, { status: 500 });
      } else {
        const { data: cr, error: e } = await admin
          .from("characters")
          .insert({ campaign_id: entry.campaign_id, kind: "npc", name, description: foldText, active: true })
          .select("id").single();
        if (e) return NextResponse.json({ error: `Could not create NPC: ${e.message}` }, { status: 500 });
        entityId = (cr as { id: string }).id;
      }
    } else if (kind === "location") {
      const { data: ex } = await admin
        .from("entries").select("id").eq("campaign_id", entry.campaign_id).eq("type", "location").ilike("title", name).maybeSingle();
      if (ex) {
        entityId = (ex as { id: string }).id;
        const appErr = await appendFact(admin, "entry", entityId, foldText);
        if (appErr) return NextResponse.json({ error: `Could not fold the text in: ${appErr}` }, { status: 500 });
      } else {
        const { data: cr, error: e } = await admin
          .from("entries")
          .insert({ campaign_id: entry.campaign_id, created_by: user.id, type: "location", title: name, body: foldText, visibility: "player" })
          .select("id").single();
        if (e) return NextResponse.json({ error: `Could not create location: ${e.message}` }, { status: 500 });
        entityId = (cr as { id: string }).id;
      }
    } else {
      const { data: ex } = await admin
        .from("entries").select("id").eq("campaign_id", entry.campaign_id).eq("type", "lore").ilike("title", name).maybeSingle();
      if (ex) {
        entityId = (ex as { id: string }).id;
        const appErr = await appendFact(admin, "entry", entityId, foldText);
        if (appErr) return NextResponse.json({ error: `Could not fold the text in: ${appErr}` }, { status: 500 });
      } else {
        const { data: cr, error: e } = await admin
          .from("entries")
          .insert({ campaign_id: entry.campaign_id, created_by: user.id, type: "lore", title: name, body: foldText, visibility: "player", tags: ["faction"] })
          .select("id").single();
        if (e) return NextResponse.json({ error: `Could not create faction: ${e.message}` }, { status: 500 });
        entityId = (cr as { id: string }).id;
      }
    }

    // The entry's text now lives on the entity, so remove the sentence-titled entry.
    const { error: delErr } = await admin.from("entries").delete().eq("id", entry.id);
    if (delErr) return NextResponse.json({ error: `Created the entity, but could not remove the old entry: ${delErr.message}` }, { status: 500 });
    return NextResponse.json({ ok: true, created: { kind, id: entityId }, deleted: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/lore-retro] unhandled failure:", detail, e);
    return NextResponse.json({ error: `Could not run the retro action: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
