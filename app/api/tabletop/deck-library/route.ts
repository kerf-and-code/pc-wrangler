import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shuffled } from "@/lib/tabletop/cards";
import {
  MAX_LIBRARY_DECKS, campaignPathFor, cleanLibraryCards, isCampaignPicture, isLibraryPicture, isUuid, libraryPathFor, toLibraryCards,
} from "@/lib/tabletop/deck-library";

// app/api/tabletop/deck-library/route.ts (2026-11-11, push 35)
//
// The GM's deck library (p159 gm_card_decks), across campaigns.
//
//   POST { action: "save", deckId }               saves a deck from a table the caller runs into their
//                                                 library: its name, back, settings and every card,
//                                                 wherever it is now. Pictures are copied to the library.
//   POST { action: "use", libraryId, campaignId } adds a library deck to a table the caller runs, as a
//                                                 new, shuffled deck. Pictures are copied to that campaign.
//   DELETE { libraryId }                          removes a deck from the library, with its pictures.
//
// Reads and writes of decks, cards and the library go through the caller's own session, so the row
// level security that guards them applies (GM of that campaign; owner of that library deck). Only the
// picture copies use the service role, because the table-files bucket is private (p133) and nobody
// touches it directly.

export const maxDuration = 60;

const BUCKET = "table-files";

async function signedIn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Copies pictures in the private bucket, five at a time; the copies made, or why it failed (and then
 *  whatever was copied is removed again). */
async function copyAll(pairs: [string, string][]): Promise<{ ok: true } | { error: string }> {
  const admin = createAdminClient();
  const done: string[] = [];
  let failed: string | null = null, next = 0;
  const worker = async () => {
    while (next < pairs.length && !failed) {
      const [from, to] = pairs[next++];
      const { error } = await admin.storage.from(BUCKET).copy(from, to);
      if (error) failed = error.message; else done.push(to);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  if (failed) {
    if (done.length) await admin.storage.from(BUCKET).remove(done);
    return { error: `A picture did not copy: ${failed}` };
  }
  return { ok: true };
}
async function removeAll(paths: string[]) {
  if (paths.length) await createAdminClient().storage.from(BUCKET).remove(paths);
}

export async function POST(req: Request) {
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; deckId?: string; libraryId?: string; campaignId?: string };

  if (b.action === "save") {
    if (!isUuid(b.deckId)) return NextResponse.json({ error: "Which deck?" }, { status: 400 });
    // row level security: only the GM of the deck's campaign reads it
    const { data: deck } = await supabase.from("vtt_decks")
      .select("id, campaign_id, name, kind, back_color, back_path, players_draw").eq("id", b.deckId).maybeSingle();
    if (!deck) return NextResponse.json({ error: "Only the GM of that table can save its deck." }, { status: 403 });
    const { count, error: ce } = await supabase.from("gm_card_decks").select("id", { count: "exact", head: true });
    if (ce) {
      const missing = /gm_card_decks/.test(ce.message);
      return NextResponse.json({ error: missing ? "The deck library is not set up yet (the p159 migration)." : ce.message }, { status: missing ? 503 : 500 });
    }
    if ((count ?? 0) >= MAX_LIBRARY_DECKS) return NextResponse.json({ error: `Your library holds ${MAX_LIBRARY_DECKS} decks. Remove one first.` }, { status: 400 });
    const { data: rows, error: re } = await supabase.from("vtt_cards").select("name, body, suit, rank, image_path").eq("deck_id", deck.id).order("ord");
    if (re) return NextResponse.json({ error: re.message }, { status: 500 });
    if (!rows?.length) return NextResponse.json({ error: "That deck has no cards." }, { status: 400 });

    const copies = new Map<string, string>();
    for (const r of rows) {
      const p = r.image_path as string | null;
      if (p && !copies.has(p) && isCampaignPicture(deck.campaign_id, p)) { const to = libraryPathFor(user.id, p); if (to) copies.set(p, to); }
    }
    const back = deck.back_path && isCampaignPicture(deck.campaign_id, deck.back_path) ? libraryPathFor(user.id, deck.back_path) : null;
    const pairs: [string, string][] = [...copies.entries(), ...(back && deck.back_path ? [[deck.back_path, back] as [string, string]] : [])];
    const copied = await copyAll(pairs);
    if ("error" in copied) return NextResponse.json({ error: copied.error }, { status: 500 });

    const { data: saved, error: ie } = await supabase.from("gm_card_decks").insert({
      owner: user.id, name: deck.name, kind: deck.kind, back_color: deck.back_color, back_path: back,
      players_draw: deck.players_draw, cards: toLibraryCards(rows as never, copies),
    }).select("id, name").single();
    if (ie || !saved) { await removeAll(pairs.map(([, to]) => to)); return NextResponse.json({ error: ie?.message ?? "Could not save it." }, { status: 500 }); }
    return NextResponse.json({ ok: true, id: saved.id, name: saved.name });
  }

  if (b.action === "use") {
    if (!isUuid(b.libraryId) || !isUuid(b.campaignId)) return NextResponse.json({ error: "Which deck, and which table?" }, { status: 400 });
    const { data: isGm } = await supabase.rpc("is_campaign_gm", { p_campaign: b.campaignId });
    if (isGm !== true) return NextResponse.json({ error: "Only the GM adds decks to this table." }, { status: 403 });
    // row level security: only its owner reads a library deck
    const { data: lib } = await supabase.from("gm_card_decks")
      .select("id, name, kind, back_color, back_path, players_draw, cards").eq("id", b.libraryId).maybeSingle();
    if (!lib) return NextResponse.json({ error: "That deck is not in your library." }, { status: 404 });
    const clean = cleanLibraryCards(lib.cards, user.id);
    if ("error" in clean) return NextResponse.json({ error: clean.error }, { status: 400 });

    const copies = new Map<string, string>();
    for (const c of clean.cards) {
      if (c.image && !copies.has(c.image)) { const to = campaignPathFor(b.campaignId, "cards", c.image); if (to) copies.set(c.image, to); }
    }
    const back = isLibraryPicture(user.id, lib.back_path) ? campaignPathFor(b.campaignId, "decks", lib.back_path) : null;
    const pairs: [string, string][] = [...copies.entries(), ...(back && lib.back_path ? [[lib.back_path, back] as [string, string]] : [])];
    const copied = await copyAll(pairs);
    if ("error" in copied) return NextResponse.json({ error: copied.error }, { status: 500 });
    const undo = () => removeAll(pairs.map(([, to]) => to));

    const { data: deck, error: de } = await supabase.from("vtt_decks").insert({
      campaign_id: b.campaignId, name: lib.name, kind: lib.kind, back_color: lib.back_color, back_path: back, players_draw: lib.players_draw,
    }).select("id").single();
    if (de || !deck) { await undo(); return NextResponse.json({ error: de?.message ?? "Could not make the deck." }, { status: 500 }); }
    // a new deck starts shuffled
    const rows = shuffled(clean.cards).map((c, i) => ({
      deck_id: deck.id, campaign_id: b.campaignId, name: c.name, body: c.body, suit: c.suit, rank: c.rank, ord: i + 1,
      image_path: c.image ? copies.get(c.image) ?? null : null,
    }));
    const { error: ce } = await supabase.from("vtt_cards").insert(rows);
    if (ce) { await supabase.from("vtt_decks").delete().eq("id", deck.id); await undo(); return NextResponse.json({ error: `Could not add the cards: ${ce.message}` }, { status: 500 }); }
    return NextResponse.json({ ok: true, deckId: deck.id, name: lib.name });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function DELETE(req: Request) {
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { libraryId?: string };
  if (!isUuid(b.libraryId)) return NextResponse.json({ error: "Which deck?" }, { status: 400 });
  const { data: lib } = await supabase.from("gm_card_decks").select("id, back_path, cards").eq("id", b.libraryId).maybeSingle();
  if (!lib) return NextResponse.json({ error: "That deck is not in your library." }, { status: 404 });
  const paths = new Set<string>();
  if (isLibraryPicture(user.id, lib.back_path)) paths.add(lib.back_path);
  for (const c of Array.isArray(lib.cards) ? (lib.cards as { image?: unknown }[]) : []) if (isLibraryPicture(user.id, c?.image)) paths.add(c.image);
  const { error } = await supabase.from("gm_card_decks").delete().eq("id", lib.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await removeAll([...paths]);
  return NextResponse.json({ ok: true });
}
