import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/prep/suggest  { campaignId }
// Query-derived signals (cheap) + one phrasing call. Writes suggested plan items.
const MODEL = "claude-sonnet-4-6";
const STALE_AFTER = 2; // sessions open and untouched to count as stale

export async function POST(req: NextRequest) {
  let body: { campaignId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const campaignId = (body.campaignId || "").trim();
  if (!campaignId) return NextResponse.json({ error: "Missing campaignId" }, { status: 400 });

  const supa = await createClient();
  const { data: claimsData } = await supa.auth.getClaims();
  const uid = claimsData?.claims?.sub as string | undefined;
  if (!uid) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: isGm } = await supa.rpc("is_campaign_gm", { p_campaign: campaignId });
  if (!isGm) return NextResponse.json({ error: "Only the campaign GM can suggest prep." }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Server is missing the extraction API key." }, { status: 500 });

  const admin = createAdminClient();

  // Session numbers, for aging threads and finding the latest session.
  const { data: sessRows } = await admin.from("sessions").select("id, session_number").eq("campaign_id", campaignId);
  const sessions = (sessRows as { id: string; session_number: number | null }[]) || [];
  const numOf = new Map<string, number>();
  sessions.forEach((s) => { if (s.session_number != null) numOf.set(s.id, s.session_number); });
  const maxNum = sessions.reduce((m, s) => Math.max(m, s.session_number ?? 0), 0);
  const latest = sessions.filter((s) => s.session_number === maxNum).map((s) => s.id)[0] || null;

  // Stale open threads: open, and opened 2+ sessions ago.
  const { data: thRows } = await admin
    .from("gm_events")
    .select("id, summary, kind, session_id")
    .eq("campaign_id", campaignId)
    .eq("thread_status", "open")
    .order("created_at", { ascending: true });
  const threads = (thRows as { id: string; summary: string; kind: string; session_id: string | null }[]) || [];
  const stale = threads.filter((t) => {
    const n = t.session_id ? numOf.get(t.session_id) : undefined;
    return n === undefined ? false : (maxNum - n) >= STALE_AFTER;
  }).slice(0, 5);

  // Quiet players: spotlight share below half the even share in the latest session.
  let quiet: string[] = [];
  if (latest) {
    const { data: spot } = await admin.from("v_session_spotlight").select("character_name, share, equal_share").eq("session_id", latest);
    const rows = (spot as { character_name: string | null; share: number | null; equal_share: number | null }[]) || [];
    if (rows.length) {
      const even = rows[0].equal_share || (1 / rows.length);
      quiet = rows.filter((r) => (r.share || 0) < even * 0.5 && r.character_name).map((r) => r.character_name as string);
    }
  }

  if (stale.length === 0 && quiet.length === 0) {
    return NextResponse.json({ ok: true, suggested: 0, reason: "Nothing stale or quiet enough to suggest yet." });
  }

  const staleText = stale.length ? stale.map((t, i) => `${i}. ${t.summary}`).join("\n") : "(none)";
  const quietText = quiet.length ? quiet.join(", ") : "(none)";

  const prompt = `You are helping a tabletop RPG Game Master prep their next session. From these signals, suggest 2-4 concrete scenes or beats that pay off dangling threads and pull spotlight toward quiet players. Be specific and immediately usable at the table.

STALE THREADS (open and neglected, "index. summary"):
${staleText}

QUIET PLAYERS (low spotlight lately): ${quietText}

Return a STRICT JSON array. Each object: {"title": <short scene title, max 8 words>, "note": <one sentence on how to run it>, "kind": <"scene"|"encounter"|"social"|"reveal"|"other">, "thread_ref": <the index of the stale thread it addresses, or null>}. Return [] if nothing is worth suggesting. No prose, no code fences.`;

  let suggestions: { title?: string; note?: string; kind?: string; thread_ref?: number | null }[] = [];
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1200,
        system: "You output STRICT JSON only, no prose, no code fences.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text: string = (data?.content || [])
      .filter((bl: { type?: string }) => bl?.type === "text")
      .map((bl: { text?: string }) => bl.text || "")
      .join("").trim();
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) suggestions = parsed;
  } catch {
    // leave empty; the GM can just try again
  }

  const validKinds = new Set(["scene", "encounter", "social", "reveal", "other"]);
  const { data: posRows } = await admin.from("session_plan_items").select("position").eq("campaign_id", campaignId).order("position", { ascending: false }).limit(1);
  let pos = (((posRows as { position: number }[]) || [])[0]?.position ?? -1) + 1;

  const rows = suggestions
    .filter((s) => s.title && s.title.toString().trim())
    .slice(0, 6)
    .map((s) => {
      const ref = typeof s.thread_ref === "number" && s.thread_ref >= 0 && s.thread_ref < stale.length ? stale[s.thread_ref].id : null;
      return {
        campaign_id: campaignId,
        title: s.title!.toString().trim().slice(0, 200),
        note: s.note ? s.note.toString().slice(0, 1000) : null,
        kind: validKinds.has(s.kind || "") ? s.kind : "scene",
        difficulty: null,
        linked_event_id: ref,
        linked_character_id: null,
        position: pos++,
        done: false,
        source: "suggested",
      };
    });

  if (rows.length) await admin.from("session_plan_items").insert(rows);
  return NextResponse.json({ ok: true, suggested: rows.length });
}
