"use client";

// app/gm/record/page.tsx
//
// In-person capture. One microphone in the room, recorded in the browser and uploaded when you stop.
//
// WHY IT KEEPS EVERY CHUNK IN IndexedDB
//   A four-hour session at Opus bitrates is roughly 60MB, which sits in memory perfectly well, so
//   this does not need chunked upload and server-side reassembly (which Vercel could not do anyway
//   without ffmpeg). What it does need is to survive the tab. A crash, a closed laptop, an
//   accidental refresh at hour three currently loses the entire night, and unlike the Discord path
//   there is no sidecar holding a copy on disk.
//
//   So every chunk MediaRecorder emits is written to IndexedDB as it arrives. If the page dies, the
//   audio is still on the machine, and on next load this page offers to recover and upload it. The
//   store is only cleared after a successful upload.
//
// ONE SOURCE, DELIBERATELY
//   There is no "every player records their phone" mode here. That is not fusion, it is the Discord
//   model without Discord, and it needs two things this does not have: alignment between devices
//   with no shared clock, and bleed rejection, because every phone in a room hears the whole table
//   and would otherwise produce one full transcript per device attributed a different way. Both are
//   solvable and neither is free, so a second mode waits until it works rather than shipping badly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "@/components/page-shell";
import { createClient } from "@/lib/supabase/client";
import { C, FORGE_RADIUS, STONE } from "@/lib/forge-theme";
import { SAX } from "@/lib/theme";

type Phase = "idle" | "armed" | "recording" | "stopped" | "uploading" | "done" | "error";
type Campaign = { id: string; name: string };
type Session = { id: string; session_number: number | null; ended_at: string | null };

const DB = "six-axes-room-capture";
const STORE = "chunks";

/* ---------------------------------------------------------------- IndexedDB */

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function put(blob: Blob) {
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(blob);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
}
async function all(): Promise<Blob[]> {
  const db = await open();
  const out = await new Promise<Blob[]>((res, rej) => {
    const rq = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    rq.onsuccess = () => res(rq.result as Blob[]);
    rq.onerror = () => rej(rq.error);
  });
  db.close();
  return out;
}
async function clear() {
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}
const extFor = (m: string) => (m.includes("ogg") ? "ogg" : m.includes("mp4") ? "m4a" : "webm");
const clock = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* --------------------------------------------------------------------- page */

export default function RoomRecordPage() {
  const supabase = useMemo(() => createClient(), []);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(0);

  const mrRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mimeRef = useRef("");
  const startedAt = useRef(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("campaigns").select("id, name").eq("gm_id", user.id).order("name");
      setCampaigns((data as Campaign[]) ?? []);
      if (data?.length === 1) setCampaignId(data[0].id);
      const left = await all().catch(() => []);
      if (left.length) setRecovered(left.length);
    })();
  }, [supabase]);

  // Recent sessions, not just the open one. The page used to auto-pick the newest open session and
  // say nothing about it, which is a guess presented as a fact - and a campaign can easily carry
  // several stale open drafts (Emberwatch had two, on sessions 3 and 5, weeks apart). Closed ones
  // are listed too: a GM who wrapped the night and then realised the audio still needs attaching
  // should not have to reopen a session to do it.
  useEffect(() => {
    if (!campaignId) { setSessions([]); setSessionId(""); return; }
    (async () => {
      const { data } = await supabase
        .from("sessions").select("id, session_number, ended_at")
        .eq("campaign_id", campaignId)
        .order("session_number", { ascending: false }).limit(12);
      const rows = (data as Session[]) ?? [];
      setSessions(rows);
      // Default to the newest OPEN session, which is right almost every time, and visibly so.
      const open = rows.find((r) => !r.ended_at);
      setSessionId(open?.id ?? rows[0]?.id ?? "");
    })();
  }, [campaignId, supabase]);

  const session = sessions.find((s) => s.id === sessionId) ?? null;

  // A recording in progress must survive nothing except the tab closing, and the browser will not
  // let us prevent that silently. Warn, so a stray Cmd-W does not end the night.
  useEffect(() => {
    if (phase !== "recording") return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase]);

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 500);
    return () => clearInterval(t);
  }, [phase]);

  const startRecording = useCallback(async () => {
    setError(null);
    if (!consent) { setError("Confirm the table has agreed before starting."); return; }
    if (!campaignId) { setError("Pick a campaign."); return; }

    // Ask the server FIRST, before touching the microphone. If the session is closed or consent was
    // not affirmed, the GM finds out now rather than after running a four-hour session.
    let signed: { path: string; token: string };
    try {
      const res = await fetch("/api/record/room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start", campaignId, sessionId,
          consentAffirmed: true, ext: extFor(pickMime()),
        }),
      });
      const out = await res.json();
      if (!res.ok) { setError(out.error ?? "Could not start."); return; }
      signed = out;
    } catch { setError("Could not reach the server. Check your connection and try again."); return; }

    (window as unknown as { __sixAxesUpload?: unknown }).__sixAxesUpload = signed;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      streamRef.current = stream;

      // A live level meter, because the single worst outcome here is recording four hours of
      // silence from the wrong input and finding out afterwards.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        if (!audioCtxRef.current) return;
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 90));
        requestAnimationFrame(tick);
      };
      tick();

      await clear();
      const mime = pickMime();
      mimeRef.current = mime;
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data && e.data.size) void put(e.data); };
      mr.start(15000);   // flush to IndexedDB every 15s
      mrRef.current = mr;
      startedAt.current = Date.now();
      setElapsed(0);
      setPhase("recording");
    } catch {
      setError("Could not open the microphone. Check the browser has permission.");
    }
  }, [campaignId, consent, sessionId]);

  const stopRecording = useCallback(() => {
    mrRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setLevel(0);
    setPhase("stopped");
  }, []);

  const upload = useCallback(async () => {
    setPhase("uploading");
    setError(null);
    try {
      const parts = await all();
      if (!parts.length) { setError("There is nothing recorded to upload."); setPhase("error"); return; }
      const blob = new Blob(parts, { type: mimeRef.current || "audio/webm" });

      const signed = (window as unknown as { __sixAxesUpload?: { path: string; token: string } }).__sixAxesUpload;
      if (!signed) { setError("Lost the upload token. Reload and use Recover."); setPhase("error"); return; }

      const { error: upErr } = await supabase.storage
        .from("session-audio").uploadToSignedUrl(signed.path, signed.token, blob);
      if (upErr) { setError(`Upload failed: ${upErr.message}`); setPhase("error"); return; }

      const res = await fetch("/api/record/room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finish", campaignId, path: signed.path, durationSeconds: elapsed,
        }),
      });
      const out = await res.json();
      if (!res.ok) { setError(out.error ?? "Could not register the recording."); setPhase("error"); return; }

      await clear();
      setRecovered(0);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setPhase("error");
    }
  }, [campaignId, elapsed, supabase]);

  const busy = phase === "recording" || phase === "uploading";

  return (
    <PageShell width={720}>
      <h1 style={{ fontFamily: SAX.serif, fontSize: 30, margin: "4px 0 2px", color: C.text }}>
        Record the room
      </h1>
      <p style={{ color: C.muted, fontSize: 14, marginTop: 0, marginBottom: 18, lineHeight: 1.6 }}>
        For playing in person. One microphone, everyone at the table, uploaded when you stop. Put the
        device somewhere central and leave this tab open.
      </p>

      {recovered > 0 && phase === "idle" && (
        <Card tone="warn">
          <Label>Unfinished recording found</Label>
          <p style={body}>
            {recovered} piece{recovered === 1 ? "" : "s"} of audio from a previous recording are still
            on this device, which means the tab closed before it uploaded. Nothing has been lost.
          </p>
          <button style={btn(true)} onClick={() => void upload()}>Upload it now</button>
          <button style={{ ...btn(false), marginLeft: 8 }}
            onClick={() => { void clear(); setRecovered(0); }}>Discard it</button>
        </Card>
      )}

      <Card>
        <Label>Campaign</Label>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={busy} style={field}>
          <option value="">Pick a campaign</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Card>

      <Card tone={session && session.ended_at ? "warn" : undefined}>
        <Label>Session</Label>
        <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} disabled={busy || !campaignId} style={field}>
          {sessions.length === 0 && <option value="">No sessions on this campaign yet</option>}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              Session {s.session_number ?? "?"}{s.ended_at ? " (closed)" : " (open)"}
            </option>
          ))}
        </select>
        <p style={{ ...body, marginTop: 8, marginBottom: 0 }}>
          {!campaignId ? "Pick a campaign first."
            : !session ? "Open a session on the Session Log before recording."
            : session.ended_at
              ? `Session ${session.session_number ?? ""} is closed. The audio will still attach to it, but nothing else about the session reopens.`
              : `This will record into session ${session.session_number ?? ""}.`}
        </p>
      </Card>

      <Card tone={consent ? undefined : "warn"}>
        <Label>Before you start</Label>
        <p style={body}>
          One microphone records the whole room, so a single track holds everyone&apos;s voice and no
          one person can be excluded from it afterwards. That makes consent all or nothing here:
          everyone at the table agrees, or this does not record.
        </p>
        <p style={{ ...body, marginBottom: 10 }}>
          Say out loud that you are recording. Audio is deleted after 60 days automatically.
        </p>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={consent} disabled={busy}
            onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ color: C.text, fontSize: 14, lineHeight: 1.5 }}>
            Everyone in the room has agreed to be recorded.
          </span>
        </label>
      </Card>

      <Card>
        <Label>{phase === "recording" ? "Recording" : "Ready"}</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <div style={{ fontFamily: SAX.mono, fontSize: 30, color: phase === "recording" ? C.warn : C.muted }}>
            {clock(elapsed)}
          </div>
          <div style={{ flex: 1, height: 10, background: STONE.shadow, borderRadius: FORGE_RADIUS, overflow: "hidden" }}>
            <div style={{
              width: `${Math.round(level * 100)}%`, height: "100%",
              background: level > 0.02 ? C.good : C.warn, transition: "width 0.08s linear",
            }} />
          </div>
        </div>
        <p style={{ ...body, marginTop: 0 }}>
          {phase === "recording" && level <= 0.02
            ? "The meter is not moving. Check the right microphone is selected before you carry on."
            : "The meter should move when someone speaks. If it does not, the wrong input is selected."}
        </p>

        {phase !== "recording" && phase !== "uploading" && phase !== "done" && (
          <button style={btn(true)} disabled={!consent || !campaignId || !sessionId}
            onClick={() => void startRecording()}>Start recording</button>
        )}
        {phase === "recording" && (
          <button style={btn(false)} onClick={stopRecording}>Stop</button>
        )}
        {phase === "stopped" && (
          <button style={{ ...btn(true), marginLeft: 8 }} onClick={() => void upload()}>
            Upload to the session
          </button>
        )}
        {phase === "uploading" && <p style={body}>Uploading. Do not close this tab.</p>}
        {phase === "done" && (
          <p style={{ ...body, color: C.good }}>
            Uploaded. Transcription starts on its own. You will map who is who once it finishes.
          </p>
        )}
      </Card>

      {error && (
        <Card tone="warn">
          <Label>Problem</Label>
          <p style={{ ...body, marginBottom: 0 }}>{error}</p>
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
    color: C.muted, marginBottom: 8 }}>{children}</div>
);
const body: React.CSSProperties = { color: C.muted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 10px" };
const field: React.CSSProperties = { width: "100%", padding: "10px 12px", fontSize: 15, fontFamily: SAX.serif };
const btn = (primary: boolean): React.CSSProperties => ({
  background: primary ? C.sun : "transparent",
  color: primary ? C.ink : C.text,
  border: primary ? "none" : `1px solid ${C.line}`,
  borderRadius: FORGE_RADIUS, padding: "10px 20px",
  fontFamily: SAX.mono, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
  cursor: "pointer",
});
