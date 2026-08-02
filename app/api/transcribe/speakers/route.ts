import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// app/api/transcribe/speakers/route.ts
//
// Reads back the diarization labels on a room recording, and saves the GM's mapping of label to
// person.
//
// WHY SAVING ALSO WRITES ONTO THE SEGMENTS
//   It would be tidier to store the map on the track and let everything downstream join through it.
//   It would also be wrong. Both extractors partition a job BY TRACK - the GM extractor takes
//   segments whose track has a gm_identity_id, the player extractor takes the rest - because with
//   Discord the track IS the identity. A room track has one identity for the whole table, so
//   without segment-level attribution the entire night, narration included, lands in the player
//   extractor and the disposition model ingests the GM's speech as player behaviour.
//
//   So the map is stored on the track (it is the human-readable record of the decision, and the
//   thing the UI re-renders) AND stamped onto each segment (which is what the rest of the pipeline
//   actually reads). The alternative was teaching four downstream consumers about speaker_map.
//
// Saving is idempotent and re-runnable: a GM who realises on Thursday that Speaker 2 was Priya and
// not Sam fixes it and re-saves, and every segment moves.

export const maxDuration = 60;

type SpeakerAssignment = { characterId?: string | null; isGm?: boolean };
type Body = {
  trackId?: string;
  map?: Record<string, SpeakerAssignment>;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const trackId = url.searchParams.get("track") ?? "";

  const gate = await authorize(trackId);
  if ("error" in gate) return gate.error;
  const { admin, track } = gate;

  // One sample per label, plus how much each one talks. Speaking time is the single most useful
  // hint for identification: the GM is almost always the largest share, and it separates a player
  // from someone who said four words all night.
  const { data: segs } = await admin
    .from("transcript_segments")
    .select("speaker, text, start_ms, end_ms")
    .eq("track_id", trackId)
    .not("speaker", "is", null)
    .order("start_ms", { ascending: true })
    .limit(1000);

  const rows = (segs as { speaker: number; text: string; start_ms: number; end_ms: number }[]) || [];
  const byLabel = new Map<number, { samples: string[]; ms: number; count: number }>();
  for (const s of rows) {
    const e = byLabel.get(s.speaker) ?? { samples: [], ms: 0, count: 0 };
    // Prefer samples with some substance. A label whose only sample is "yeah" is unidentifiable,
    // and the opening minutes are exactly where people introduce themselves.
    if (e.samples.length < 4 && (s.text || "").trim().length > 25) e.samples.push(s.text.trim());
    e.ms += Math.max(0, (s.end_ms || 0) - (s.start_ms || 0));
    e.count += 1;
    byLabel.set(s.speaker, e);
  }

  const speakers = [...byLabel.entries()]
    .map(([label, v]) => ({
      label,
      seconds: Math.round(v.ms / 1000),
      utterances: v.count,
      samples: v.samples,
    }))
    .sort((a, b) => b.seconds - a.seconds);

  const { data: chars } = await admin
    .from("characters")
    .select("id, name")
    .eq("campaign_id", track.campaign_id)
    .eq("kind", "pc")
    .order("name");

  const { data: gm } = await admin
    .from("gm_identities")
    .select("id, display_name")
    .eq("campaign_id", track.campaign_id)
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    speakers,
    characters: chars ?? [],
    gmIdentityId: (gm as { id: string } | null)?.id ?? null,
    gmName: (gm as { display_name: string } | null)?.display_name ?? "the GM",
    map: track.speaker_map ?? {},
    totalSegments: rows.length,
  });
}

export async function POST(req: Request) {
  let b: Body = {};
  try { b = await req.json(); } catch { /* guarded below */ }

  const gate = await authorize(b.trackId ?? "");
  if ("error" in gate) return gate.error;
  const { admin, track } = gate;

  const map = b.map ?? {};

  const { data: gm } = await admin
    .from("gm_identities")
    .select("id")
    .eq("campaign_id", track.campaign_id)
    .limit(1)
    .maybeSingle();
  const gmId = (gm as { id: string } | null)?.id ?? null;

  let assigned = 0;
  const problems: string[] = [];

  for (const [label, a] of Object.entries(map)) {
    const n = Number(label);
    if (!Number.isFinite(n)) continue;

    // Every save rewrites BOTH columns for the label, including to null. Without that, changing an
    // assignment would leave the previous one behind: re-pointing Speaker 2 from a character to the
    // GM would set gm_identity_id and silently keep the old character_id, and the segment would
    // then belong to two people.
    const patch: Record<string, string | null> = { character_id: null, gm_identity_id: null };
    if (a?.isGm) {
      if (!gmId) { problems.push(`Speaker ${label} is marked as the GM, but this campaign has no GM voice linked yet.`); continue; }
      patch.gm_identity_id = gmId;
    } else if (a?.characterId) {
      patch.character_id = a.characterId;
    }

    const { error, count } = await admin
      .from("transcript_segments")
      .update(patch, { count: "exact" })
      .eq("track_id", track.id)
      .eq("speaker", n);

    if (error) problems.push(`Speaker ${label}: ${error.message}`);
    else assigned += count ?? 0;
  }

  const { error: tErr } = await admin
    .from("audio_tracks")
    .update({ speaker_map: map })
    .eq("id", track.id);
  if (tErr) problems.push(`Could not save the map itself: ${tErr.message}`);

  return NextResponse.json({ ok: problems.length === 0, assigned, problems });
}

/* ------------------------------------------------------------------ shared */

async function authorize(trackId: string) {
  if (!trackId) {
    return { error: NextResponse.json({ error: "Missing track." }, { status: 400 }) };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: track } = await admin
    .from("audio_tracks")
    .select("id, campaign_id, kind, speaker_map")
    .eq("id", trackId)
    .maybeSingle();

  if (!track) return { error: NextResponse.json({ error: "Recording not found." }, { status: 404 }) };
  if (track.kind !== "room") {
    // A Discord track already knows who is on it. Offering to remap it would imply the attribution
    // is in doubt when it is not.
    return { error: NextResponse.json({ error: "That recording already knows who is speaking." }, { status: 400 }) };
  }

  const { data: camp } = await admin
    .from("campaigns").select("gm_id").eq("id", track.campaign_id).maybeSingle();
  if (!camp || camp.gm_id !== user.id) {
    return { error: NextResponse.json({ error: "Only the GM of this campaign can do that." }, { status: 403 }) };
  }

  return { admin, track: track as { id: string; campaign_id: string; kind: string; speaker_map: Record<string, SpeakerAssignment> | null } };
}
