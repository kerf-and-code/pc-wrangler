// Shared recap builder. Gathers a session's context (GM notes, accepted player
// events, GM narration/NPCs, loot, threads, transcript) and produces a
// "previously on" recap. Used by the manual generate route and the auto-draft on
// Mark done. Takes whatever Supabase client the caller has (RLS or admin); it
// only reads, and returns text. Persisting is the caller's job.

const RECAP_MODEL = "claude-sonnet-4-6";

const SHORT_LIMIT = 16000;   // below this, feed the transcript directly
const CHUNK_SIZE = 14000;    // size of each chunk when summarizing a long transcript
const MAX_CHUNKS = 60;        // hard safety ceiling; a 3 hour session is well under this
const REDUCE_THRESHOLD = 24;  // beats spanning more than this many chunks get one reduce pass
// Rows fetched per request. This is NOT a total: fetchAllSegments pages until the
// transcript is exhausted.
//
// It replaces a single .limit(20000) that was written to "pull the whole transcript" and
// silently did not. PostgREST enforces db-max-rows SERVER side, so a client limit can only
// ask for FEWER rows than the cap, never more. This project's cap is 1000, proved by the
// extract routes: they ran with no limit at all and got back exactly 1000 of 3146
// segments. A .limit(20000) against a 1000-row cap returns 1000 and reports success.
//
// The consequence was invisible in the worst way. Recaps were built from the first 1000
// segments, roughly the first hour of a two and a half hour session, and read as a
// slightly thin recap rather than as a bug. Regenerating produced the same abbreviated
// result every time, because the input was the same truncated third.
const SEGMENT_PAGE = 1000;

// TAVERN axis names (player-facing labels). Only used to flavor the model
// context; the recap output never shows axis names.
const AXIS_NAME: Record<string, string> = {
  N: "Voice", T: "Tactics", O: "Arcana", S: "Rapport", E: "Exploration", I: "Nerve",
};

const SYSTEM = `You write short "previously on..." recaps for a tabletop RPG group, addressed to the players.
Rules:
- Ground every statement in the provided notes, events, and transcript beats. Do NOT invent characters, outcomes, locations, or plot beats that are not supported by the input.
- If the input is sparse, write a short recap rather than padding it with invention.
- Engaging, neutral fantasy-narrative voice. Refer to player characters by name.
- 2 to 4 short paragraphs of flowing prose. No headers, no bullet points, no lists.
- Do not address the GM or mention "events," "logs," "transcripts," or the tool. Just tell the story of what happened.`;

const CHUNK_SYSTEM = `You are condensing one slice of a longer tabletop RPG session transcript into terse factual beats.
List what happened in this slice: decisions, actions, discoveries, combat outcomes, loot, NPC interactions, location changes.
Use the character/speaker names exactly as given. Do not invent anything not present in the text.
Output a short plain list of beats, one per line, no preamble and no commentary.`;

const COMPLETE_SYSTEM = `You write a thorough, complete recap of a tabletop RPG session, addressed to the players. Unlike a brief "previously on," this version is meant to leave nothing important out.
Rules:
- Ground every statement in the provided notes, events, and transcript beats. Do NOT invent characters, outcomes, locations, or plot beats that are not supported by the input.
- Walk the session in chronological order. Cover every scene, decision, discovery, combat, negotiation, NPC interaction, piece of loot, and story thread the input supports. Do not skip beats to save space; completeness is the point.
- Name every player character and NPC involved, and attribute actions and choices to whoever made them.
- Engaging fantasy-narrative voice, flowing prose in paragraphs (a new paragraph per scene or beat as the story turns). No headers, no bullet points, no lists.
- If the input genuinely lacks detail on something, do not pad it with invention; simply cover what is supported and move on.
- Do not address the GM or mention "events," "logs," "transcripts," or the tool. Just tell the full story of what happened.`;

type DbLike = { from: (table: string) => any };
type BuildResult = { ok: true; recap: string } | { ok: false; error: string; status: number };
type RecapMode = "brief" | "complete";

async function callClaude(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: RECAP_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error("model error");
  const data = await res.json();
  return (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

// Every transcript segment for these jobs, in order, regardless of the server row cap.
//
// Two details that matter:
//
//   stable ordering  start_ms is not unique, so rows can shuffle between pages and end up
//                    skipped or repeated. The id tiebreak makes the order total. id is
//                    selected purely for that; nothing downstream reads it.
//   partial is worse than none  a failed page throws rather than returning what it
//                    collected. Silently returning a prefix that looks complete is the
//                    exact bug being fixed here, and reintroducing it one level down would
//                    be harder to find than the original.
type SegFetch = { ok: true; segs: any[] } | { ok: false; error: string };

// A range whose start is at or past the end of the result set is not an error in the sense
// that matters here, it just means there are no more rows. PostgREST answers it with 416
// and PGRST103 rather than an empty list, so the loop has to recognise that and stop
// instead of treating it as a failure. It bites exactly when the row count is a multiple of
// the page size, which is the one case where the loop cannot tell it has finished from the
// size of the previous page.
function isRangePastEnd(error: any): boolean {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "").toLowerCase();
  return code === "PGRST103" || msg.includes("range not satisfiable") || msg.includes("out of bounds");
}

async function fetchAllSegments(supabase: DbLike, jobIds: string[]): Promise<SegFetch> {
  const MAX_PAGES = 100; // 100k segments, far beyond any real session
  const out: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * SEGMENT_PAGE;
    const { data, error } = await supabase
      .from("transcript_segments")
      .select("id, text, start_ms, character_id")
      .in("job_id", jobIds)
      .order("start_ms", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + SEGMENT_PAGE - 1);

    if (error) {
      if (page > 0 && isRangePastEnd(error)) return { ok: true, segs: out };
      // RETURNED, not thrown. The previous version threw, which escaped buildRecap's
      // result type entirely and surfaced in the caller's catch-all as "Could not generate
      // recap. Try again." A specific database failure rendered as a generic retry prompt
      // is the exact pattern this project keeps getting bitten by, and it is worse here
      // than elsewhere because the GM's only feedback is that one sentence.
      return {
        ok: false,
        error: `Could not read the transcript (page ${page}, rows ${from}-${from + SEGMENT_PAGE - 1}): ${error.message ?? "unknown error"}`,
      };
    }

    const rows = (data || []) as any[];
    out.push(...rows);
    if (rows.length < SEGMENT_PAGE) return { ok: true, segs: out };
  }
  return { ok: false, error: `Transcript exceeded ${MAX_PAGES} pages, which should not happen.` };
}

export async function buildRecap(supabase: DbLike, sessionId: string, mode: RecapMode = "brief"): Promise<BuildResult> {
  const { data: session, error: sErr } = await supabase
    .from("sessions")
    .select("id, campaign_id, session_number, notes")
    .eq("id", sessionId)
    .single();
  if (sErr || !session) return { ok: false, error: "Session not found.", status: 404 };

  const campaignId = session.campaign_id;
  const [
    { data: campaign },
    { data: characters },
    { data: eventTypes },
    { data: events },
    { data: loot },
    { data: touches },
    { data: jobs },
    { data: gmEvents },
  ] = await Promise.all([
    supabase.from("campaigns").select("name, system").eq("id", campaignId).single(),
    supabase.from("characters").select("id, name, kind").eq("campaign_id", campaignId),
    supabase.from("event_types").select("key, label"),
    supabase.from("events")
      .select("event_type, axis, payload, character_id, created_at")
      .eq("session_id", sessionId).order("created_at", { ascending: true }),
    supabase.from("loot_grants")
      .select("item_name, rarity, character_id")
      .eq("session_id", sessionId),
    supabase.from("arc_touches")
      .select("arc_id, arcs(title)")
      .eq("session_id", sessionId),
    supabase.from("capture_jobs")
      .select("id, error")
      .eq("session_id", sessionId),
    // GM narration: present, minus explicitly rejected, and never table-talk.
    supabase.from("gm_proposed_events")
      .select("kind, summary, npc_name, created_at")
      .eq("session_id", sessionId)
      .neq("status", "rejected")
      .neq("kind", "meta")
      .order("created_at", { ascending: true }),
  ]);

  const nameOf = (id: string | null) =>
    (id && characters?.find((c: any) => c.id === id)?.name) || "the party";
  const speakerOf = (id: string | null) =>
    (id && characters?.find((c: any) => c.id === id)?.name) || "Speaker";
  const typeLabel = (k: string) =>
    eventTypes?.find((t: any) => t.key === k)?.label || k;

  // ---- structured context ----
  const parts: string[] = [];
  parts.push(`Campaign: ${campaign?.name || "Untitled"}${campaign?.system ? ` (${campaign.system})` : ""}`);
  if (session.session_number != null) parts.push(`Session number: ${session.session_number}`);

  if (session.notes && session.notes.trim()) {
    parts.push(`\nGM notes for this session:\n${session.notes.trim()}`);
  }

  if (events && events.length) {
    const lines = events.map((ev: any) => {
      const who = nameOf(ev.character_id);
      const axis = ev.axis ? `[${AXIS_NAME[ev.axis] || ev.axis}] ` : "";
      const note = ev.payload?.note ? ` — ${ev.payload.note}` : "";
      return `- ${axis}${who}: ${typeLabel(ev.event_type)}${note}`;
    });
    parts.push(`\nLogged events (in order):\n${lines.join("\n")}`);
  }

  if (gmEvents && gmEvents.length) {
    const lines = gmEvents.map((g: any) => {
      const npc = g.npc_name ? ` (${g.npc_name})` : "";
      return `- ${g.summary}${npc}`;
    });
    parts.push(`\nGM narration and story beats:\n${lines.join("\n")}`);
  }

  if (loot && loot.length) {
    const lines = loot.map((l: any) =>
      `- ${l.item_name}${l.rarity ? ` (${l.rarity})` : ""} to ${nameOf(l.character_id)}`);
    parts.push(`\nLoot gained:\n${lines.join("\n")}`);
  }

  if (touches && touches.length) {
    const titles = touches
      .map((t: any) => (Array.isArray(t.arcs) ? t.arcs[0]?.title : t.arcs?.title))
      .filter(Boolean);
    if (titles.length) parts.push(`\nStory threads advanced: ${titles.join(", ")}`);
  }

  // ---- transcript context (two-pass for long sessions) ----
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "Recap service is not configured.", status: 500 };

  let hasTranscript = false;
  const jobIds = (jobs || []).filter((j: any) => !j.error).map((j: any) => j.id);
  if (jobIds.length) {
    const fetched = await fetchAllSegments(supabase, jobIds);
    // Surfaced rather than swallowed. A recap silently built without its transcript reads
    // as a thin recap, which is indistinguishable from a quiet session and is how the
    // truncation went unnoticed for weeks.
    if (!fetched.ok) return { ok: false, error: fetched.error, status: 500 };
    const segs = fetched.segs;

    const lines = (segs || [])
      .filter((s: any) => s.text && s.text.trim())
      .map((s: any) => `${speakerOf(s.character_id)}: ${s.text.trim()}`);

    if (lines.length) {
      hasTranscript = true;
      const transcriptText = lines.join("\n");

      let beats = "";
      try {
        if (transcriptText.length <= SHORT_LIMIT) {
          beats = transcriptText;
        } else {
          // Split the WHOLE transcript into chunks. Do not truncate: dropping the
          // tail is exactly what silently lost the back half of long sessions from
          // the recap. Every chunk is summarized; if there are a great many, the
          // beats get one reduce pass so the final context stays bounded without
          // discarding any part of the session.
          const chunks: string[] = [];
          let cur = "";
          for (const ln of lines) {
            if (cur && cur.length + ln.length + 1 > CHUNK_SIZE) { chunks.push(cur); cur = ""; }
            cur += (cur ? "\n" : "") + ln;
          }
          if (cur) chunks.push(cur);

          // MAX_CHUNKS is a runaway ceiling, not a content cap. Only an absurdly long
          // session (6 hours plus) could reach it; if it does, we keep the earliest
          // and latest chunks so both ends of the session survive, rather than the
          // old behavior of keeping only the front.
          let working = chunks;
          if (chunks.length > MAX_CHUNKS) {
            const head = Math.ceil(MAX_CHUNKS / 2);
            const tail = MAX_CHUNKS - head;
            working = [...chunks.slice(0, head), ...chunks.slice(chunks.length - tail)];
          }

          const summaries = await Promise.all(
            working.map((chunk, i) =>
              callClaude(apiKey, CHUNK_SYSTEM, `Part ${i + 1} of ${working.length}:\n\n${chunk}`, 600)),
          );

          // If the session produced a lot of chunks, the concatenated beats can get
          // long. Reduce them once into a tighter set of beats so the final recap
          // call sees the whole arc, still without dropping any stretch of time.
          if (working.length > REDUCE_THRESHOLD) {
            const joined = summaries.join("\n");
            const reduced: string[] = [];
            let acc = "";
            for (const line of joined.split("\n")) {
              if (acc && acc.length + line.length + 1 > CHUNK_SIZE) { reduced.push(acc); acc = ""; }
              acc += (acc ? "\n" : "") + line;
            }
            if (acc) reduced.push(acc);
            const reducedBeats = await Promise.all(
              reduced.map((r, i) =>
                callClaude(apiKey, CHUNK_SYSTEM, `Beats group ${i + 1} of ${reduced.length}:\n\n${r}`, 600)),
            );
            beats = reducedBeats.join("\n");
          } else {
            beats = summaries.join("\n");
          }
        }
      } catch {
        // On a model error, fall back to the raw head of the transcript rather than
        // failing the recap outright. This is a degraded path, not the normal one.
        beats = transcriptText.slice(0, SHORT_LIMIT) + "\n(Partial transcript; summarization was unavailable.)";
      }

      if (beats.trim()) parts.push(`\nFrom the session transcript:\n${beats.trim()}`);
    }
  }

  const hasContent =
    (session.notes && session.notes.trim()) ||
    (events && events.length) ||
    (gmEvents && gmEvents.length) ||
    (loot && loot.length) ||
    hasTranscript;
  if (!hasContent) {
    return { ok: false, error: "Nothing to summarize yet. Add session notes, log a few events, or capture a transcript first.", status: 422 };
  }

  const context = parts.join("\n");

  // Brief is the short player-facing "previously on." Complete walks the whole
  // session and needs far more room. Same model, same context; only the prompt and
  // the length ceiling differ.
  const system = mode === "complete" ? COMPLETE_SYSTEM : SYSTEM;
  const maxTokens = mode === "complete" ? 3000 : 1024;

  let recap = "";
  try {
    recap = await callClaude(apiKey, system, context, maxTokens);
  } catch {
    return { ok: false, error: "The recap model returned an error. Try again.", status: 502 };
  }
  if (!recap) return { ok: false, error: "The recap came back empty. Try again.", status: 502 };

  return { ok: true, recap };
}
