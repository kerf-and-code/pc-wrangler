import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Second independent coding pass for reliability. Same prompt and model as the
// production extractor (test-retest), tagged distinctly. Writes to recodings,
// never to proposed_events, so review and precision stats are unaffected.
const MODEL = "claude-sonnet-4-6";
const RECODE_VERSION = "wrangler-extract-v1+claude-sonnet-4-6+recode";
const WINDOW = 60;

const AXIS_LEGEND = `N = The Character (narrative & immersion)
T = The Encounter (tactical play)
O = The System (optimization & rules mastery)
S = The Table (social & group cohesion)
E = The World (exploration & discovery)
I = Presence (engagement, attention, investment)`;

type Seg = { id: string; character_id: string | null; start_ms: number | null; end_ms: number | null; text: string };
type Etype = { key: string; label: string; category: string; default_axis: string | null; default_frame: string | null; default_target: string | null };
type Char = { id: string; name: string; kind: string };
type Proposal = { line?: number; character?: string | null; event_type?: string; axis?: string | null; confidence?: number };

// PostgREST enforces db-max-rows SERVER side, so an unbounded select returns a PREFIX of
// the rows and every count taken from it is wrong. This project's cap is 1000, proved by
// the extract routes: they ran with no limit and got exactly 1000 of 3146 segments, then
// correctly reported themselves finished against that truncated total.
//
// recode has the same cursor-against-total shape, so it had the same failure: recode_cursor
// would reach a total of 1000 and declare the job done with two thirds of the session never
// recoded, and nothing anywhere would report a problem.
//
// The select list is a literal on purpose. supabase-js infers the row type from it, and a
// dynamic string degrades to GenericStringError[], which will not cast to Seg[].
async function fetchAllSegments(
  admin: ReturnType<typeof createAdminClient>,
  jid: string,
): Promise<Seg[]> {
  const PAGE = 1000;
  const MAX_PAGES = 100;
  const out: Seg[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await admin
      .from("transcript_segments")
      .select("id, character_id, start_ms, end_ms, text")
      .eq("job_id", jid)
      // start_ms is not unique, so without the id tiebreak rows can shuffle between pages
      // and end up skipped or repeated.
      .order("start_ms", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      // Fail loud. Returning what was collected so far would be a prefix that looks
      // complete, which is the exact bug this function exists to remove.
      throw new Error(`transcript_segments page ${page} failed: ${error.message}`);
    }
    const rows = (data as Seg[]) || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error(`transcript_segments exceeded ${MAX_PAGES} pages for job ${jid}`);
}

export async function POST(req: NextRequest) {
  let jobId: string | undefined;
  try { const b = await req.json(); jobId = b?.jobId; } catch { /* guard below */ }
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  const jid: string = jobId;

  const supa = await createClient();
  const { data: job } = await supa
    .from("capture_jobs")
    .select("id, campaign_id, session_id, recode_cursor")
    .eq("id", jid)
    .single();
  if (!job) return NextResponse.json({ error: "Not found or not permitted" }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Server is missing the extraction API key." }, { status: 500 });

  const admin = createAdminClient();

  const segments = await fetchAllSegments(admin, jid);
  const total = segments.length;
  const cursor: number = job.recode_cursor || 0;

  if (total === 0 || cursor >= total) {
    return NextResponse.json({ done: true, processed: total, total, coded: 0 });
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
    // failure leaves this window empty; cursor still advances
  }

  const rows = proposals
    .filter((p) => p.event_type && etypeKeys.has(p.event_type))
    .map((p) => {
      const et = etypeByKey[p.event_type as string];
      const lineIdx = typeof p.line === "number" && p.line >= cursor && p.line < cursor + windowSegs.length ? p.line : cursor;
      const seg = segments[lineIdx] || windowSegs[0];
      const axis = p.axis && ["N", "T", "O", "S", "E", "I"].includes(p.axis) ? p.axis : et.default_axis;
      const conf = typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.5;
      return {
        job_id: jid, campaign_id: job.campaign_id, segment_id: seg?.id ?? null,
        coder_version: RECODE_VERSION, event_type: p.event_type, axis, confidence: conf,
      };
    });

  if (rows.length) await admin.from("recodings").insert(rows);

  const nextCursor = Math.min(cursor + WINDOW, total);
  await admin.from("capture_jobs").update({ recode_cursor: nextCursor }).eq("id", jid);

  return NextResponse.json({ done: nextCursor >= total, processed: nextCursor, total, coded: rows.length });
}
