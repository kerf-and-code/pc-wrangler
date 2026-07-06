import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Version-pinned like the player extractor, stamped on every proposed GM event.
const MODEL = "claude-sonnet-4-6";
const EXTRACTOR_VERSION = "wrangler-gm-extract-v1+claude-sonnet-4-6";
const WINDOW = 60; // GM transcript lines processed per call

type Seg = { id: string; track_id: string | null; start_ms: number | null; end_ms: number | null; text: string };
type Kind = { kind: string; category: string; label: string; feeds: string[] };
type Char = { id: string; name: string; kind: string };
type Proposal = {
  line?: number;
  kind?: string;
  summary?: string;
  detail?: string | null;
  quote?: string | null;
  npc_name?: string | null;
  location_name?: string | null;
  faction_name?: string | null;
  target?: string | null;
  confidence?: number;
};

export async function POST(req: NextRequest) {
  let jobId: string | undefined;
  try { const b = await req.json(); jobId = b?.jobId; } catch { /* missing-jobId guard below */ }
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  const jid: string = jobId;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Server is missing the extraction API key." }, { status: 500 });

  const admin = createAdminClient();

  // Browsers authorize via RLS; a trusted server-side caller (the extraction
  // orchestrator) passes the callback secret and reads the job with admin.
  const k = req.nextUrl.searchParams.get("k");
  const trusted = !!k && k === process.env.TRANSCRIBE_CALLBACK_SECRET;
  const jobSel = "id, campaign_id, session_id, status, extract_cursor, gm_extract_cursor";
  let jobData: unknown = null;
  if (trusted) {
    jobData = (await admin.from("capture_jobs").select(jobSel).eq("id", jid).single()).data;
  } else {
    const supa = await createClient();
    jobData = (await supa.from("capture_jobs").select(jobSel).eq("id", jid).single()).data;
  }
  if (!jobData) return NextResponse.json({ error: "Not found or not permitted" }, { status: 403 });
  const job = jobData as { campaign_id: string; session_id: string; extract_cursor: number | null; gm_extract_cursor: number | null };

  // The GM extractor reads only the narrator's track(s).
  const { data: gmTracks } = await admin
    .from("audio_tracks")
    .select("id")
    .eq("job_id", jid)
    .not("gm_identity_id", "is", null);
  const gmTrackIds = new Set(((gmTracks as { id: string }[]) || []).map((t) => t.id));

  const { data: segData } = await admin
    .from("transcript_segments")
    .select("id, track_id, start_ms, end_ms, text")
    .eq("job_id", jid)
    .order("start_ms", { ascending: true });
  const allSegs = (segData as Seg[]) || [];
  const segments = allSegs.filter((s) => s.track_id !== null && gmTrackIds.has(s.track_id));
  const playerTotal = allSegs.length - segments.length;
  const total = segments.length;
  const cursor: number = job.gm_extract_cursor || 0;

  // The job flips to "review" only when BOTH extractors have finished their
  // portion. Here we track whether the player side is already done.
  const playerCursor: number = job.extract_cursor || 0;
  const playerDone = playerCursor >= playerTotal;

  if (total === 0 || cursor >= total) {
    await admin.from("capture_jobs")
      .update({ gm_extract_cursor: total, status: playerDone ? "review" : "extracting" })
      .eq("id", jid);
    return NextResponse.json({ done: true, processed: total, total, proposed: 0 });
  }

  const [{ data: kindData }, { data: chData }] = await Promise.all([
    admin.from("gm_event_kinds").select("kind, category, label, feeds").order("sort", { ascending: true }),
    admin.from("characters").select("id, name, kind").eq("campaign_id", job.campaign_id).eq("kind", "pc"),
  ]);
  const kinds = (kindData as Kind[]) || [];
  const chars = (chData as Char[]) || [];
  const kindKeys = new Set(kinds.map((k) => k.kind));
  const nameToId: Record<string, string> = {};
  chars.forEach((c) => { nameToId[c.name.trim().toLowerCase()] = c.id; });

  const windowSegs = segments.slice(cursor, cursor + WINDOW);
  const transcriptText = windowSegs.map((s, idx) => `[${cursor + idx}] ${s.text}`).join("\n");
  const catalogText = kinds
    .map((k) => `${k.kind} — ${k.label} (${k.category}; feeds ${k.feeds && k.feeds.length ? k.feeds.join(",") : "none"})`)
    .join("\n");
  const rosterText = chars.length ? chars.map((c) => c.name).join(", ") : "(no player characters on file)";

  const system =
    "You extract a tabletop RPG Game Master's narration events from the GM's own transcript, for a session codex and prep sheet. Every line is the GM speaking: narration, NPC dialogue, rulings, prompts to players. You are precise and conservative: only tag a line when it clearly matches a kind. Prefer precision over recall. Output STRICT JSON only, no prose, no code fences.";

  const prompt = `GM EVENT KINDS (use the kind string exactly):
${catalogText}

PLAYER CHARACTERS (for events aimed at a specific PC, e.g. spotlight/prompt/consequence/acknowledgment):
${rosterText}

TRANSCRIPT WINDOW (each line is "[index] text", all spoken by the GM):
${transcriptText}

TASK: Tag the clear GM events in this window. For each, return an object:
{"line": <the [index] it is based on>, "kind": <one kind from the list>, "summary": <one concise sentence describing the event>, "detail": <fuller text, or null>, "quote": <the GM's actual words if worth preserving verbatim, or null>, "npc_name": <for npc_* kinds, the NPC's name, else null>, "location_name": <a named place if one is introduced or described, else null>, "faction_name": <a named faction, organization, guild, cult, house, or group if one is introduced or referenced, else null>, "target": <for an event aimed at a PC, that PC's name from the list, else null>, "confidence": <0.0-1.0>}
Keep summary tight and factual. Only fill location_name/faction_name when a proper name is actually given. Return a JSON array. Return [] if nothing in this window is clearly a GM event.`;

  let proposals: Proposal[] = [];
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 3000, system, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    const text: string = (data?.content || [])
      .filter((bl: { type?: string }) => bl?.type === "text")
      .map((bl: { text?: string }) => bl.text || "")
      .join("")
      .trim();
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) proposals = parsed as Proposal[];
  } catch {
    // any failure leaves proposals empty; the cursor still advances so we never loop forever
  }

  const rows = proposals
    .filter((p) => p.kind && kindKeys.has(p.kind))
    .map((p) => {
      const lineIdx = typeof p.line === "number" && p.line >= cursor && p.line < cursor + windowSegs.length ? p.line : cursor;
      const seg = segments[lineIdx] || windowSegs[0];
      let targetId: string | null = null;
      const tn = (p.target || "").trim().toLowerCase();
      if (tn && nameToId[tn]) targetId = nameToId[tn];
      const conf = typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.5;
      const summary = (p.summary || "").toString().trim().slice(0, 500) || "(no summary)";
      return {
        campaign_id: job.campaign_id,
        session_id: job.session_id,
        job_id: jid,
        kind: p.kind as string,
        summary,
        detail: p.detail ? p.detail.toString().slice(0, 4000) : null,
        quote: p.quote ? p.quote.toString().slice(0, 2000) : null,
        npc_name: p.npc_name ? p.npc_name.toString().slice(0, 200) : null,
        location_name: p.location_name ? p.location_name.toString().slice(0, 200) : null,
        faction_name: p.faction_name ? p.faction_name.toString().slice(0, 200) : null,
        target_character_id: targetId,
        audio_track_id: seg?.track_id ?? null,
        t_start_seconds: seg && seg.start_ms !== null ? seg.start_ms / 1000 : null,
        confidence: conf,
        status: "proposed",
        extractor_version: EXTRACTOR_VERSION,
      };
    });

  if (rows.length) await admin.from("gm_proposed_events").insert(rows);

  const nextCursor = Math.min(cursor + WINDOW, total);
  const gmDone = nextCursor >= total;
  const status = gmDone && playerDone ? "review" : "extracting";
  await admin.from("capture_jobs").update({ gm_extract_cursor: nextCursor, status }).eq("id", jid);

  return NextResponse.json({ done: gmDone, processed: nextCursor, total, proposed: rows.length });
}
