import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planCommit, foldText } from "@/lib/backfill/commit-map";
import type { EntityCandidate } from "@/lib/backfill/extract";

export const maxDuration = 60;

// app/api/import/commit/route.ts
//
// Backfill, step 3: write the GM-approved candidates into the live codex, and the approved sessions onto
// the timeline. Mirrors app/api/lore-triage exactly: NPC -> characters(kind='npc'); location ->
// entries(type='location'); faction/item/lore -> entries(type='lore' [+ tag]); dedupe by ilike name/title;
// fold onto an existing entity without stacking a duplicate paragraph. Imported sessions become
// sessions(status='completed', capture_modality='none') carrying the recap.
//
// Decisions (set by the review UI on import_candidates.decision):
//   approved  create the entity (or fold if one already exists by name)
//   merged    fold onto the specific existing entity the dedupe matched (dedupe_id)
//   rejected / pending  skipped
//
// Owner-gated on campaigns.gm_id; staging reads/writes use the admin client. Idempotent per candidate:
// a committed candidate carries created_id, so a re-run skips it rather than creating a second copy.

type CandRow = {
  id: string; kind: string; name: string; body: string | null;
  decision: string; dedupe_kind: string | null; dedupe_id: string | null; created_id: string | null;
};
type SessRow = { id: string; idx: number; label: string | null; occurred_on: string | null; recap: string | null; decision: string; created_session_id: string | null };

// Append text onto an existing entity's field, deduped, concretely per table (same rule as the lore routes).
async function fold(admin: ReturnType<typeof createAdminClient>, table: "characters" | "entries", field: "description" | "body", id: string, fact: string | null): Promise<string | null> {
  if (table === "characters") {
    const { data } = await admin.from("characters").select("description").eq("id", id).maybeSingle();
    const next = foldText((data as { description: string | null } | null)?.description ?? null, fact);
    if (next === null) return null;
    const { error } = await admin.from("characters").update({ description: next }).eq("id", id);
    return error ? error.message : null;
  }
  const { data } = await admin.from("entries").select("body").eq("id", id).maybeSingle();
  const next = foldText((data as { body: string | null } | null)?.body ?? null, fact);
  if (next === null) return null;
  const { error } = await admin.from("entries").update({ body: next }).eq("id", id);
  return error ? error.message : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { jobId?: string };
    const jobId = (body.jobId || "").trim();
    if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

    const supa = await createClient();
    const { data: auth } = await supa.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    const admin = createAdminClient();

    const { data: jobRow } = await admin
      .from("import_jobs").select("id, campaign_id, status").eq("id", jobId).maybeSingle();
    const job = jobRow as { id: string; campaign_id: string; status: string } | null;
    if (!job) return NextResponse.json({ error: "Import not found." }, { status: 404 });

    // Owner gate through the RLS client, same as lore-triage.
    const { data: campRow } = await supa.from("campaigns").select("gm_id").eq("id", job.campaign_id).maybeSingle();
    if ((campRow as { gm_id: string } | null)?.gm_id !== user.id) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }
    if (job.status === "committed") return NextResponse.json({ error: "This import was already committed." }, { status: 409 });

    await admin.from("import_jobs").update({ status: "committing" }).eq("id", jobId);
    const campaignId = job.campaign_id;

    const { data: candData } = await admin
      .from("import_candidates")
      .select("id, kind, name, body, decision, dedupe_kind, dedupe_id, created_id")
      .eq("job_id", jobId)
      .in("decision", ["approved", "merged"]);
    const cands = (candData as CandRow[]) || [];

    let created = 0, folded = 0, skipped = 0;
    const errors: string[] = [];

    for (const c of cands) {
      if (c.created_id) { skipped++; continue; } // already committed on a prior run
      const cand: EntityCandidate = { kind: c.kind as EntityCandidate["kind"], name: c.name, body: c.body || "", links: [], confidence: 0, origin: "prose" };
      const plan = planCommit(cand, { campaignId, userId: user.id });
      if (plan.table === null) { skipped++; continue; } // e.g. a PC, handled by linking, not creation

      // A 'merged' decision folds onto the matched entity; an 'approved' one creates (or folds if a
      // same-named entity already exists, since one may have been made since staging).
      let targetId: string | null = c.decision === "merged" ? c.dedupe_id : null;

      if (!targetId) {
        if (plan.table === "characters") {
          const { data: ex } = await admin.from("characters")
            .select("id").eq("campaign_id", campaignId).eq("kind", "npc").ilike("name", plan.dedupe.table === "characters" ? plan.dedupe.nameIlike : c.name).maybeSingle();
          targetId = (ex as { id: string } | null)?.id ?? null;
        } else {
          const type = plan.insert.type;
          const { data: ex } = await admin.from("entries")
            .select("id").eq("campaign_id", campaignId).eq("type", type).ilike("title", c.name).maybeSingle();
          targetId = (ex as { id: string } | null)?.id ?? null;
        }
      }

      if (targetId) {
        const err = await fold(admin, plan.table, plan.appendField, targetId, c.body);
        if (err) { errors.push(`${c.name}: ${err}`); continue; }
        await admin.from("import_candidates").update({ created_kind: plan.table === "characters" ? "npc" : (plan as { insert: { type: string } }).insert.type, created_id: targetId, decision: "merged" }).eq("id", c.id);
        folded++;
        continue;
      }

      // Create fresh.
      if (plan.table === "characters") {
        const { data: cr, error } = await admin.from("characters").insert(plan.insert).select("id").single();
        if (error || !cr) { errors.push(`${c.name}: ${error?.message ?? "insert failed"}`); continue; }
        await admin.from("import_candidates").update({ created_kind: "npc", created_id: (cr as { id: string }).id }).eq("id", c.id);
      } else {
        const { data: cr, error } = await admin.from("entries").insert(plan.insert).select("id").single();
        if (error || !cr) { errors.push(`${c.name}: ${error?.message ?? "insert failed"}`); continue; }
        await admin.from("import_candidates").update({ created_kind: plan.insert.type, created_id: (cr as { id: string }).id }).eq("id", c.id);
      }
      created++;
    }

    // --- timeline: approved sessions -> sessions(status='completed') ----------
    const { data: sessData } = await admin
      .from("import_sessions")
      .select("id, idx, label, occurred_on, recap, decision, created_session_id")
      .eq("job_id", jobId).eq("decision", "approved").order("idx", { ascending: true });
    const sessions = (sessData as SessRow[]) || [];

    // Number imported sessions after any existing ones so we never collide on session_number. For a
    // campaign being brought in fresh (no sessions yet) this yields 1..N, the natural numbering.
    const { data: maxRow } = await admin
      .from("sessions").select("session_number").eq("campaign_id", campaignId)
      .order("session_number", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
    const base = (maxRow as { session_number: number | null } | null)?.session_number ?? 0;

    let timeline = 0;
    for (const s of sessions) {
      if (s.created_session_id) continue;
      const startedAt = s.occurred_on ? new Date(s.occurred_on).toISOString() : null;
      const { data: cr, error } = await admin.from("sessions").insert({
        campaign_id: campaignId,
        session_number: base + s.idx,
        status: "completed",
        capture_modality: "none",
        started_at: startedAt,
        ended_at: startedAt,
        recap: s.recap,
        notes: s.label,
      }).select("id").single();
      if (error || !cr) { errors.push(`session ${s.idx}: ${error?.message ?? "insert failed"}`); continue; }
      await admin.from("import_sessions").update({ created_session_id: (cr as { id: string }).id }).eq("id", s.id);
      timeline++;
    }

    await admin.from("import_jobs").update({ status: "committed", error: errors.length ? errors.slice(0, 10).join(" | ").slice(0, 500) : null }).eq("id", jobId);

    return NextResponse.json({ ok: true, created, folded, skipped, timeline, errors: errors.length });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/import/commit] unhandled:", detail);
    return NextResponse.json({ error: `Commit failed: ${detail.slice(0, 300)}` }, { status: 500 });
  }
}
