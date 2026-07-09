import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Version-pinned per the methods plan: prompt revision + model, stamped on
// every proposed and accepted event so coding can be compared across versions.
const MODEL = "claude-sonnet-4-6";
const EXTRACTOR_VERSION = "wrangler-extract-v1+claude-sonnet-4-6";
const WINDOW = 60; // merged transcript lines processed per call

const AXIS_LEGEND = `N = The Character (narrative & immersion)
T = The Encounter (tactical play)
O = The System (optimization & rules mastery)
S = The Table (social & group cohesion)
E = The World (exploration & discovery)
I = Presence (engagement, attention, investment)`;

type Seg = { id: string; track_id: string | null; character_id: string | null; start_ms: number | null; end_ms: number | null; text: string };
type Etype = { key: string; label: string; category: string; default_axis: string | null; default_frame: string | null; default_target: string | null };
type Char = { id: string; name: string; kind: string };
type Proposal = { line?: number; character?: string | null; event_type?: string; axis?: string | null; frame?: string | null; target?: string | null; confidence?: number; rationale?: string };

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

  // GM narration lives on the narrator's track(s) and is handled by the GM
  // extractor. The player extractor excludes those segments so GM speech never
  // lands as a null-attributed player event.
  const { data: gmTracks } = await admin
    .from("audio_tracks")
    .select("id")
    .eq("job_id", jid)
    .not("gm_identity_id", "is", null);
  const gmTrackIds = new Set(((gmTracks as { id: string }[]) || []).map((t) => t.id));

  // Per-session opt-out: exclude opted-out characters' segments from extraction
  // (defense in depth; primary exclusion is upstream at transcription).
  const { data: outs } = await admin
    .from("recording_consents")
    .select("character_id")
    .eq("session_id", job.session_id)
    .eq("consented", false);
  const optedOut = new Set(
    ((outs as { character_id: string | null }[]) || [])
      .map((o) => o.character_id)
      .filter((v): v is string => v !== null)
  );

  const { data: segData } = await admin
    .from("transcript_segments")
    .select("id, track_id, character_id, start_ms, end_ms, text")
    .eq("job_id", jid)
    .order("start_ms", { ascending: true });
  const allSegs = (segData as Seg[]) || [];
  // GM segments (for the gm-done accounting) vs the player segments we extract.
  const nonGm = allSegs.filter((s) => !(s.track_id !== null && gmTrackIds.has(s.track_id)));
  const gmTotal = allSegs.length - nonGm.length;
  const segments = nonGm.filter((s) => !(s.character_id && optedOut.has(s.character_id)));
  const total = segments.length;
  const cursor: number = job.extract_cursor || 0;

  // The job flips to "review" only when BOTH extractors have finished their
  // portion; the GM side is done when its cursor has caught its segment count.
  const gmCursor: number = job.gm_extract_cursor || 0;
  const gmDone = gmCursor >= gmTotal;

  if (total === 0 || cursor >= total) {
    await admin.from("capture_jobs")
      .update({ extract_cursor: total, status: gmDone ? "review" : "extracting" })
      .eq("id", jid);
    return NextResponse.json({ done: true, processed: total, total, proposed: 0 });
  }

  const [{ data: etData }, { data: chData }] = await Promise.all([
    admin.from("event_types").select("key, label, category, default_axis, default_frame, default_target"),
    admin.from("characters").select("id, name, kind").eq("campaign_id", job.campaign_id),
  ]);
  const etypes = (etData as Etype[]) || [];
  const chars = (chData as Char[]) || [];
  const etypeKeys = new Set(etypes.map((e) => e.key));
  const etypeByKey: Record<string, Etype> = {};
  etypes.forEach((e) => { etypeByKey[e.key] = e; });
  const nameToId: Record<string, string> = {};
  chars.forEach((c) => { nameToId[c.name.trim().toLowerCase()] = c.id; });
  const nameOf = (id: string | null): string => chars.find((c) => c.id === id)?.name || "GM/Narrator";

  const windowSegs = segments.slice(cursor, cursor + WINDOW);
  const transcriptText = windowSegs.map((s, idx) => `[${cursor + idx}] ${nameOf(s.character_id)}: ${s.text}`).join("\n");
  const catalogText = etypes.map((e) => `${e.key} — ${e.label} (${e.category}; default axis ${e.default_axis ?? "none"}, frame ${e.default_frame ?? "none"}, target ${e.default_target ?? "none"})`).join("\n");
  const rosterText = chars.length ? chars.map((c) => `${c.name} (${c.kind})`).join(", ") : "(no roster on file)";

  const system = "You extract tabletop RPG play events from a session transcript for spotlight-equity analytics. You are precise and conservative: only propose an event when the line clearly supports it. Prefer precision over recall. Output STRICT JSON only, no prose, no code fences.";

  const prompt = `SIX AXES:
${AXIS_LEGEND}

EVENT TYPES (use the key exactly):
${catalogText}

ROSTER (attribute responses to the speaking PC; GM-narrated opportunities have character=null):
${rosterText}

FRAMES: ic (in-character) or ooc (out-of-character). TARGETS: fiction, player, or system.

TRANSCRIPT WINDOW (each line is "[index] Speaker: text"):
${transcriptText}

TASK: Propose the clear play events in this window. For each, return an object:
{"line": <the [index] it is based on>, "character": <PC name from roster, or null for GM/narrator>, "event_type": <one key from the list>, "axis": <N|T|O|S|E|I or null>, "frame": <ic|ooc or null>, "target": <fiction|player|system or null>, "confidence": <0.0-1.0>, "rationale": <one short sentence>}
If axis/frame/target are unclear, use null and the system applies the event type's defaults.
Return a JSON array. Return [] if nothing in this window is clearly an event.`;

  let proposals: Proposal[] = [];
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: prompt }] }),
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
    .filter((p) => p.event_type && etypeKeys.has(p.event_type))
    .map((p) => {
      const et = etypeByKey[p.event_type as string];
      const lineIdx = typeof p.line === "number" && p.line >= cursor && p.line < cursor + windowSegs.length ? p.line : cursor;
      const seg = segments[lineIdx] || windowSegs[0];
      let characterId: string | null = null;
      const nm = (p.character || "").trim().toLowerCase();
      if (nm && nameToId[nm]) characterId = nameToId[nm];
      else if (nm && !["gm", "dm", "narrator", "gm/narrator"].includes(nm)) characterId = seg?.character_id ?? null;
      const axis = p.axis && ["N", "T", "O", "S", "E", "I"].includes(p.axis) ? p.axis : et.default_axis;
      const frame = p.frame && ["ic", "ooc"].includes(p.frame) ? p.frame : et.default_frame;
      const target = p.target && ["fiction", "player", "system"].includes(p.target) ? p.target : et.default_target;
      const conf = typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.5;
      return {
        job_id: jid, campaign_id: job.campaign_id, session_id: job.session_id,
        character_id: characterId, event_type: p.event_type, axis, frame, target,
        confidence: conf, segment_id: seg?.id ?? null, extractor_version: EXTRACTOR_VERSION,
        rationale: (p.rationale || "").toString().slice(0, 500), status: "proposed",
      };
    });

  if (rows.length) await admin.from("proposed_events").insert(rows);

  const nextCursor = Math.min(cursor + WINDOW, total);
  const playerDone = nextCursor >= total;
  const status = playerDone && gmDone ? "review" : "extracting";
  await admin.from("capture_jobs").update({ extract_cursor: nextCursor, status }).eq("id", jid);

  return NextResponse.json({ done: playerDone, processed: nextCursor, total, proposed: rows.length });
}
