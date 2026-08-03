import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectSpokenRolls, type RollKind } from "@/lib/spoken-rolls";

// app/api/rolls/spoken/route.ts
//
// Reads a job's transcript and writes the dice rolls people SAID into vtt_events.
//
// WHY IT IS A SEPARATE PASS RATHER THAN PART OF EXTRACTION
//   The event extractor asks Claude what HAPPENED in a scene. This asks a much narrower question
//   with a deterministic answer, and mixing them would put a regex result and a model judgement in
//   the same bucket with the same confidence. Keeping it separate also means it can be re-run
//   cheaply after the speaker map changes, which matters: attribution here comes entirely from the
//   segment, so a roll found before the voices were named would land on nobody.
//
// WHAT IT REFUSES TO ATTRIBUTE
//   - Segments carrying gm_identity_id. A GM saying "that's a 17" is narrating a monster, not
//     making a player roll, and feeding it in would corrupt both Mechanics and the disposition read.
//   - Segments with no character_id at all. On a room recording that means the voice is unmapped,
//     and a roll on nobody's sheet is noise at best.
//   Both are counted and reported rather than silently dropped, because "we found 40 rolls and
//   could only place 6" is the sentence that tells a GM to go finish the speaker map.
//
// EVERYTHING WRITTEN HERE IS MARKED source "spoken" AND fidelity "unverified". Beyond20 readings
// are exact; these are a transcript of someone reading a die out loud, through speech recognition.
// The Mechanics page and the encounter-calibration loop both need to be able to tell them apart,
// and the columns to do it already existed.

export const maxDuration = 120;

// The detector's vocabulary mapped onto the event_type values vtt_events already uses.
const EVENT_TYPE: Record<RollKind, string> = {
  attack: "to-hit",
  damage: "damage",
  save: "saving-throw",
  check: "skill",
  unknown: "other",
};
const ABILITIES = new Set(["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]);

type Seg = {
  id: string;
  character_id: string | null;
  gm_identity_id: string | null;
  start_ms: number | null;
  text: string;
};

export async function POST(req: Request) {
  let jobId = "";
  let dryRun = false;
  try {
    const b = await req.json();
    jobId = b?.jobId ?? "";
    dryRun = b?.dryRun === true;
  } catch { /* guarded below */ }

  if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const admin = createAdminClient();

  const { data: job } = await admin
    .from("capture_jobs")
    .select("id, campaign_id, session_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const { data: camp } = await admin
    .from("campaigns").select("gm_id").eq("id", job.campaign_id).maybeSingle();
  if (!camp || camp.gm_id !== user.id) {
    return NextResponse.json({ error: "Only the GM of this campaign can do that." }, { status: 403 });
  }

  // Paged. An unbounded select is capped at 1000 rows SERVER side by PostgREST and returns a silent
  // prefix, which has already truncated extraction on this project once. A busy session runs to
  // several thousand segments.
  const segments: Seg[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("transcript_segments")
      .select("id, character_id, gm_identity_id, start_ms, text")
      .eq("job_id", jobId)
      .order("start_ms", { ascending: true })
      .order("id", { ascending: true })   // tiebreak, so pages cannot shuffle
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = (data as Seg[]) || [];
    segments.push(...page);
    if (page.length < 1000) break;
  }

  let found = 0;
  let fromGm = 0;
  let unattributed = 0;
  const rows: Record<string, unknown>[] = [];
  const samples: { text: string; total: number | null; kind: string; character_id: string | null }[] = [];

  for (const s of segments) {
    const hits = detectSpokenRolls(s.text || "");
    if (!hits.length) continue;
    found += hits.length;

    if (s.gm_identity_id) { fromGm += hits.length; continue; }
    if (!s.character_id) { unattributed += hits.length; continue; }

    for (const h of hits) {
      const type = h.kind === "check" && h.subject && ABILITIES.has(h.subject)
        ? "ability"
        : EVENT_TYPE[h.kind];

      rows.push({
        campaign_id: job.campaign_id,
        session_id: job.session_id,
        character_id: s.character_id,
        source: "spoken",
        ddb_character_id: null,
        actor_name: null,
        event_type: type,
        name: h.subject ?? null,
        rolls: {
          total: h.total,
          natural: h.natural,
          heard: h.evidence,
          confidence: h.confidence,
        },
        state: null,
        fidelity: "unverified",
        // No wall-clock time on a transcript, so anchor to the offset within the recording. It is
        // what the Mechanics timeline needs and it survives the audio being purged at 60 days.
        rolled_at: null,
      });

      if (samples.length < 12) {
        samples.push({ text: h.evidence, total: h.total, kind: type, character_id: s.character_id });
      }
    }
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true, segments: segments.length, found,
      writable: rows.length, fromGm, unattributed, samples,
    });
  }

  // Re-runnable. Clearing this job's previous spoken rolls first means a GM who fixes the speaker
  // map and runs again gets a corrected set rather than a doubled one. Only rows this pass owns are
  // touched: Beyond20 events for the same session are a different source and are left alone.
  const { error: delErr } = await admin
    .from("vtt_events")
    .delete()
    .eq("session_id", job.session_id)
    .eq("source", "spoken");
  if (delErr) return NextResponse.json({ error: `Could not clear the previous pass: ${delErr.message}` }, { status: 500 });

  if (rows.length) {
    const { error } = await admin.from("vtt_events").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    segments: segments.length,
    found,
    written: rows.length,
    fromGm,
    unattributed,
    note: unattributed > 0
      ? `${unattributed} roll(s) were heard from voices that have not been named yet. Finish the speaker map and run this again to include them.`
      : null,
  });
}
