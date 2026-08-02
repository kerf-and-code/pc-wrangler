"use client";

// app/gm/speakers/page.tsx
//
// After an in-person recording is transcribed, this is where the GM says who each voice was.
//
// WHY THIS EXISTS BEFORE THE AUTOMATION
//   The plan is for the app to work this out itself, from an opening round of "I'm playing Bobert".
//   That will fail sometimes: someone arrives late, two people talk over the introduction, the
//   phrase comes out as "I'm on Bobert tonight". Building the manual path first means the feature
//   works on day one, gives the automation something to pre-fill rather than something to be
//   trusted, and provides the ground truth to measure it against later.
//
// WHAT THE GM IS ACTUALLY LOOKING AT
//   Deepgram returns Speaker 0..N per recording. The labels are arbitrary and mean nothing across
//   files. They are ordered here by speaking time, because that is the strongest hint available:
//   the GM is nearly always the largest share, and it separates a player from someone who said
//   four words all night.

import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/page-shell";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS, STONE } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";

type Speaker = { label: number; seconds: number; utterances: number; samples: string[] };
type Character = { id: string; name: string };
type Assignment = { characterId?: string | null; isGm?: boolean };
type RoomTrack = { id: string; campaign_id: string; created_at: string; duration_seconds: number | null };

const mins = (s: number) => (s < 60 ? `${s}s` : `${Math.round(s / 60)} min`);

export default function SpeakersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [tracks, setTracks] = useState<RoomTrack[]>([]);
  const [trackId, setTrackId] = useState("");
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [gmName, setGmName] = useState("the GM");
  const [gmAvailable, setGmAvailable] = useState(true);
  const [map, setMap] = useState<Record<string, Assignment>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: camps } = await supabase.from("campaigns").select("id").eq("gm_id", user.id);
      const ids = ((camps as { id: string }[]) || []).map((c) => c.id);
      if (!ids.length) return;
      const { data } = await supabase
        .from("audio_tracks")
        .select("id, campaign_id, created_at, duration_seconds")
        .in("campaign_id", ids)
        .eq("kind", "room")
        .order("created_at", { ascending: false })
        .limit(20);
      const rows = (data as RoomTrack[]) || [];
      setTracks(rows);
      if (rows.length) setTrackId(rows[0].id);
    })();
  }, [supabase]);

  const load = useCallback(async (id: string) => {
    setLoading(true); setNote(null); setProblems([]);
    try {
      const res = await fetch(`/api/transcribe/speakers?track=${encodeURIComponent(id)}`);
      const out = await res.json();
      if (!res.ok) { setNote(out.error ?? "Could not load that recording."); return; }
      setSpeakers(out.speakers ?? []);
      setCharacters(out.characters ?? []);
      setGmName(out.gmName ?? "the GM");
      setGmAvailable(Boolean(out.gmIdentityId));
      setMap(out.map ?? {});
      if (!out.speakers?.length) {
        setNote(out.totalSegments === 0
          ? "This recording has no transcript yet. Come back once transcription finishes."
          : "The transcript has no speaker labels, which means it was transcribed before diarization was switched on.");
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (trackId) void load(trackId); }, [trackId, load]);

  const assign = (label: number, a: Assignment) =>
    setMap((m) => ({ ...m, [String(label)]: a }));

  const save = useCallback(async () => {
    setSaving(true); setNote(null); setProblems([]);
    try {
      const res = await fetch("/api/transcribe/speakers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId, map }),
      });
      const out = await res.json();
      if (!res.ok) { setNote(out.error ?? "Could not save."); return; }
      setProblems(out.problems ?? []);
      setNote(`Saved. ${out.assigned} line${out.assigned === 1 ? "" : "s"} of transcript attributed.`);
    } finally { setSaving(false); }
  }, [trackId, map]);

  // Two people cannot be the same character, and the GM is one voice. Catching it here is friendlier
  // than letting a save silently overwrite one label's segments with another's.
  const duplicates = (() => {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const [label, a] of Object.entries(map)) {
      const key = a?.isGm ? "gm" : a?.characterId ?? "";
      if (!key) continue;
      if (seen.has(key)) {
        const who = key === "gm" ? gmName : characters.find((c) => c.id === key)?.name ?? "someone";
        dupes.push(`Speaker ${seen.get(key)} and Speaker ${label} are both set to ${who}.`);
      } else seen.set(key, Number(label));
    }
    return dupes;
  })();

  const unassigned = speakers.filter((s) => {
    const a = map[String(s.label)];
    return !a || (!a.isGm && !a.characterId);
  }).length;

  return (
    <PageShell width={760}>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, margin: "4px 0 2px", color: C.text }}>
        Who was speaking
      </h1>
      <p style={{ color: C.muted, fontSize: 14, marginTop: 0, marginBottom: 18, lineHeight: 1.6 }}>
        An in-person recording is one microphone, so the app separates the voices but cannot name
        them. Listen to a line or two and tell it who is who. Everything downstream, from the recap
        to each player&apos;s read, depends on this being right.
      </p>

      <Card>
        <Label>Recording</Label>
        <select value={trackId} onChange={(e) => setTrackId(e.target.value)} style={field}>
          {tracks.length === 0 && <option value="">No in-person recordings yet</option>}
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {new Date(t.created_at).toLocaleString()}
              {t.duration_seconds ? ` \u00B7 ${mins(t.duration_seconds)}` : ""}
            </option>
          ))}
        </select>
      </Card>

      {loading && <Card><p style={body}>Loading the transcript…</p></Card>}

      {!loading && speakers.map((s) => {
        const a = map[String(s.label)] ?? {};
        return (
          <Card key={s.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <Label>Speaker {s.label}</Label>
              <span style={{ fontFamily: SAX.mono, fontSize: 11, color: STONE.inkFaint }}>
                {mins(s.seconds)} \u00B7 {s.utterances} lines
              </span>
            </div>

            {s.samples.length ? (
              <div style={{
                background: "rgba(0,0,0,0.28)", borderRadius: FORGE_RADIUS,
                padding: "10px 12px", marginBottom: 12,
              }}>
                {s.samples.map((t, i) => (
                  <p key={i} style={{ ...body, marginBottom: i === s.samples.length - 1 ? 0 : 8, color: C.text }}>
                    &ldquo;{t}&rdquo;
                  </p>
                ))}
              </div>
            ) : (
              <p style={body}>
                No line from this voice is long enough to quote. It is probably someone who spoke
                very little, or crosstalk the splitter treated as its own voice.
              </p>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select
                value={a.isGm ? "__gm" : a.characterId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  assign(s.label, v === "__gm" ? { isGm: true } : v ? { characterId: v } : {});
                }}
                style={{ ...field, maxWidth: 320 }}
              >
                <option value="">Not assigned</option>
                {gmAvailable && <option value="__gm">{gmName} (narration)</option>}
                {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {!gmAvailable && (
                <span style={{ ...body, marginBottom: 0, fontSize: 12.5 }}>
                  No GM voice is linked on this campaign, so narration cannot be assigned yet.
                </span>
              )}
            </div>
          </Card>
        );
      })}

      {!loading && speakers.length > 0 && (
        <>
          {duplicates.length > 0 && (
            <Card tone="warn">
              <Label>Two voices, one person</Label>
              {duplicates.map((d, i) => <p key={i} style={{ ...body, marginBottom: 4 }}>{d}</p>)}
              <p style={{ ...body, marginBottom: 0 }}>
                That can be right if someone moved seats and the splitter heard them as two voices.
                If it is not, fix it before saving.
              </p>
            </Card>
          )}

          <Card>
            <p style={body}>
              {unassigned === 0
                ? "Every voice is assigned."
                : `${unassigned} voice${unassigned === 1 ? "" : "s"} still unassigned. You can save anyway: unassigned lines stay in the transcript and are simply not attributed to anyone.`}
            </p>
            <button onClick={() => void save()} disabled={saving} style={btn}>
              {saving ? "Saving…" : "Save who is who"}
            </button>
          </Card>
        </>
      )}

      {note && (
        <Card tone={problems.length ? "warn" : undefined}>
          <p style={{ ...body, marginBottom: problems.length ? 8 : 0 }}>{note}</p>
          {problems.map((p, i) => <p key={i} style={{ ...body, marginBottom: 0 }}>{p}</p>)}
        </Card>
      )}
    </PageShell>
  );
}

/* -------------------------------------------------------------------- bits */

function Card({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <section style={{
      background: "linear-gradient(160deg, rgba(52,47,39,0.80) 0%, rgba(38,34,28,0.85) 45%, rgba(22,19,15,0.90) 100%)",
      borderRadius: FORGE_RADIUS, padding: "14px 16px", marginBottom: 14,
      borderLeft: tone === "warn" ? `3px solid ${C.warn}` : undefined,
      boxShadow: "inset 1px 1px 0 rgba(255,235,200,0.10), inset -1px -1px 0 rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.5)",
    }}>{children}</section>
  );
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily: SAX.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
    color: C.muted }}>{children}</div>
);
const body: React.CSSProperties = { color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 10px" };
const field: React.CSSProperties = { width: "100%", padding: "10px 12px", fontSize: 15, fontFamily: SAX.serif };
const btn: React.CSSProperties = {
  background: C.sun, color: C.ink, border: "none", borderRadius: FORGE_RADIUS,
  padding: "10px 20px", fontFamily: SAX.mono, fontSize: 12,
  letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
};
