import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extract } from "@/lib/backfill/extract";
import type { NormalizedImport } from "@/lib/backfill/types";

export const maxDuration = 60;

// app/api/import/start/route.ts
//
// Backfill, step 1: receive the browser-parsed bundle (the ingest layer runs client-side, so only the
// normalized TEXT reaches the server, never the raw files), extract codex candidates + per-session
// recaps, dedupe against the campaign's existing codex, and stage everything for the GM to review.
// Nothing here touches the live codex; the commit route does that after the GM approves.
//
// Auth + writes mirror app/api/lore-triage: the signed-in user must own the campaign (campaigns.gm_id),
// the owner gate reads through the RLS client, and the staging writes use the service-role admin client.
//
// NOTE: structural candidates (Obsidian/World Anvil) cost no model call, so a structured import is fast.
// A very large PROSE import (a long PDF) makes one model call per note here; if that ever brushes the
// function limit, move prose extraction behind the cursor-advance cron the transcript extractor uses.

type Body = { campaignId?: string; bundle?: NormalizedImport; sessionMode?: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const campaignId = (body.campaignId || "").trim();
    const bundle = body.bundle;
    if (!campaignId || !bundle || !Array.isArray(bundle.notes)) {
      return NextResponse.json({ error: "Missing campaignId or parsed notes." }, { status: 400 });
    }

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    // Owner gate: only the campaign's GM can import into it.
    const { data: campRow } = await supa.from("campaigns").select("gm_id").eq("id", campaignId).maybeSingle();
    if ((campRow as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    const admin = createAdminClient();

    // Open the job first, so a failure mid-extraction still leaves a record the GM can see and retry.
    const { data: jobRow, error: jErr } = await admin
      .from("import_jobs")
      .insert({
        campaign_id: campaignId,
        created_by: user.id,
        status: "extracting",
        source_format: bundle.format,
        session_mode: body.sessionMode ?? null,
        note_count: bundle.notes.length,
        stats: bundle.stats,
        warnings: bundle.warnings ?? [],
      })
      .select("id")
      .single();
    if (jErr || !jobRow) {
      return NextResponse.json({ error: `Could not start import: ${jErr?.message ?? "no job"}` }, { status: 500 });
    }
    const jobId = (jobRow as { id: string }).id;

    // Extract: structural notes map straight through (no model); prose + recaps use the model.
    let candidates, recaps, warnings;
    try {
      const result = await extract(bundle, {}); // default = the same Anthropic call the live extractor uses
      candidates = result.candidates;
      recaps = result.recaps;
      warnings = result.warnings;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await admin.from("import_jobs").update({ status: "error", error: detail.slice(0, 500) }).eq("id", jobId);
      return NextResponse.json({ error: `Extraction failed: ${detail.slice(0, 300)}`, jobId }, { status: 500 });
    }

    // Dedupe against the existing codex by name/title, so the review screen can show "looks like X" and
    // the commit folds instead of duplicating. One read of the campaign's names, matched in memory.
    const [{ data: chData }, { data: enData }] = await Promise.all([
      admin.from("characters").select("id, name, kind").eq("campaign_id", campaignId),
      admin.from("entries").select("id, title, type").eq("campaign_id", campaignId),
    ]);
    const npcByName = new Map(((chData as { id: string; name: string; kind: string }[]) || [])
      .filter((c) => c.kind === "npc").map((c) => [c.name.trim().toLowerCase(), c.id]));
    const locByTitle = new Map(((enData as { id: string; title: string; type: string }[]) || [])
      .filter((e) => e.type === "location").map((e) => [e.title.trim().toLowerCase(), e.id]));
    const loreByTitle = new Map(((enData as { id: string; title: string; type: string }[]) || [])
      .filter((e) => e.type === "lore").map((e) => [e.title.trim().toLowerCase(), e.id]));

    const candRows = candidates.map((c) => {
      const key = c.name.trim().toLowerCase();
      let dedupe_kind: string | null = null;
      let dedupe_id: string | null = null;
      if (c.kind === "npc" && npcByName.has(key)) { dedupe_kind = "character"; dedupe_id = npcByName.get(key)!; }
      else if (c.kind === "location" && locByTitle.has(key)) { dedupe_kind = "entry"; dedupe_id = locByTitle.get(key)!; }
      else if ((c.kind === "faction" || c.kind === "item" || c.kind === "lore") && loreByTitle.has(key)) {
        dedupe_kind = "entry"; dedupe_id = loreByTitle.get(key)!;
      }
      // Structural candidates were authored (name+type from the GM's own notes), so pre-approve them and
      // let prose candidates default to a glance. A dedupe match starts as 'merged' either way.
      const decision = dedupe_id ? "merged" : (c.origin === "structural" ? "approved" : "pending");
      return {
        job_id: jobId, campaign_id: campaignId, kind: c.kind, name: c.name, body: c.body || null,
        links: c.links, confidence: c.confidence, origin: c.origin, source_note: c.sourcePath || null,
        dedupe_kind, dedupe_id, decision,
      };
    });
    if (candRows.length) {
      const { error } = await admin.from("import_candidates").insert(candRows);
      if (error) console.error("[api/import/start] candidates insert:", error.message);
    }

    const sessRows = recaps.map((r) => ({
      job_id: jobId, campaign_id: campaignId, idx: r.index, label: r.label,
      occurred_on: r.date ?? null, recap: r.recap || null, entity_names: r.entityNames, decision: "approved",
    }));
    if (sessRows.length) {
      const { error } = await admin.from("import_sessions").insert(sessRows);
      if (error) console.error("[api/import/start] sessions insert:", error.message);
    }

    await admin.from("import_jobs").update({
      status: "review",
      candidate_count: candRows.length,
      session_count: sessRows.length,
      warnings,
    }).eq("id", jobId);

    return NextResponse.json({
      jobId,
      candidates: candRows.length,
      sessions: sessRows.length,
      warnings,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/import/start] unhandled:", detail);
    return NextResponse.json({ error: `Import failed: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
