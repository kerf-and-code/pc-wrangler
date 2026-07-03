"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PageShell from "@/components/page-shell";
import TableTap from "@/components/table-tap";
import { SAX } from "@/lib/theme";

const C = {
  bg: SAX.ink, surface: SAX.slateBg, surface2: "rgba(11,7,18,0.6)", line: SAX.line,
  text: SAX.text, muted: SAX.muted, sun: SAX.sun, sunSoft: "#FFD75E", plum: SAX.plum, warn: SAX.warn, good: SAX.good,
};

type RosterEntry = { character_id: string; name: string };
type Phase = "idle" | "recording" | "recorded" | "uploading" | "uploaded";

type WakeNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtMB = (b: number): string => `${(b / 1048576).toFixed(1)} MB`;
const extFor = (mime: string): string => (mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of candidates) { if (MediaRecorder.isTypeSupported(m)) return m; }
  return "";
}

export default function RecordPage() {
  const supabase = useMemo(() => createClient(), []);
  const [share, setShare] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "invalid">("loading");
  const [campaignName, setCampaignName] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<boolean>(false);
  const [sessionNumber, setSessionNumber] = useState<number | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [charId, setCharId] = useState<string>("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState<number>(0);
  const [bytes, setBytes] = useState<number>(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consented, setConsented] = useState<boolean>(false);

  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<string>("");
  const startTsRef = useRef<number>(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const code = new URLSearchParams(window.location.search).get("share");
      if (!code) { if (active) setStatus("invalid"); return; }
      if (active) setShare(code);
      try {
        const saved = window.localStorage.getItem("wrangler_record_character");
        if (saved && active) setCharId(saved);
      } catch (e) { /* no storage */ }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { const { error: e } = await supabase.auth.signInAnonymously(); if (e) { if (active) setStatus("invalid"); return; } }

      const [{ data: ctx }, { data: rost }] = await Promise.all([
        supabase.rpc("record_context", { code }),
        supabase.rpc("roster_for_share", { code }),
      ]);
      if (!active) return;
      if (!ctx || !ctx.length) { setStatus("invalid"); return; }
      setCampaignName(ctx[0].campaign_name);
      setOpenSession(Boolean(ctx[0].open));
      setSessionNumber(ctx[0].session_number ?? null);
      setRoster((rost as RosterEntry[]) || []);

      // if this player owns a character (claimed via their invite link), select it
      const { data: mine } = await supabase.rpc("my_character", { p_share: code });
      const owned = Array.isArray(mine) ? mine[0] : mine;
      if (active && owned?.character_id) {
        setCharId(owned.character_id);
        try { window.localStorage.setItem("wrangler_record_character", owned.character_id); } catch (e) { /* no storage */ }
      }

      setStatus("ready");
    })();
    return () => { active = false; };
  }, [supabase]);

  async function acquireWake() {
    try {
      const navw = navigator as WakeNavigator;
      if (navw.wakeLock) wakeRef.current = await navw.wakeLock.request("screen");
    } catch (e) { /* wake lock optional */ }
  }
  async function releaseWake() {
    try { await wakeRef.current?.release(); } catch (e) { /* ignore */ }
    wakeRef.current = null;
  }
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && phase === "recording" && !wakeRef.current) acquireWake(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [phase]);

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    releaseWake();
  }
  useEffect(() => () => cleanupStream(), []);

  async function startRecording() {
    setError(null);
    if (!charId) { setError("Pick your character first."); return; }
    if (!consented) { setError("Check the consent box before recording."); return; }
    if (share) {
      const { error: cErr } = await supabase.rpc("record_consent_for_share", {
        code: share,
        p_session_number: openSession ? sessionNumber : null,
        p_character_id: charId,
        p_consented: true,
        p_method: "in_app_checkbox",
      });
      if (cErr) { setError("Could not record your consent. Try again."); return; }
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError("Microphone access was blocked. Allow it in your browser and try again.");
      return;
    }
    streamRef.current = stream;
    const mime = pickMime();
    mimeRef.current = mime;
    chunksRef.current = [];
    setBytes(0); setBlob(null);
    const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mr.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size) {
        chunksRef.current.push(e.data);
        setBytes(chunksRef.current.reduce((s, b) => s + b.size, 0));
      }
    };
    mr.onstop = () => {
      const out = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      setBlob(out);
      setPhase("recorded");
      cleanupStream();
    };
    mrRef.current = mr;
    mr.start(5000);
    startTsRef.current = Date.now();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((Date.now() - startTsRef.current) / 1000), 500);
    setPhase("recording");
    acquireWake();
  }

  function stopRecording() {
    try { mrRef.current?.stop(); } catch (e) { /* ignore */ }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function uploadRecording() {
    if (!blob || !share || !charId) return;
    setError(null);
    setPhase("uploading");
    const ext = extFor(mimeRef.current || "audio/webm");
    try {
      const startRes = await fetch("/api/record/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ share, characterId: charId, ext }) });
      const startOut = await startRes.json().catch(() => ({}));
      if (!startRes.ok) { setError(startOut.error || "Upload could not start. Your file is saved below."); setPhase("recorded"); return; }

      const { error: upErr } = await supabase.storage.from("session-audio").uploadToSignedUrl(startOut.path, startOut.token, blob);
      if (upErr) { setError("Upload failed. Your file is saved below, you can download and send it instead."); setPhase("recorded"); return; }

      const finRes = await fetch("/api/record/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ share, characterId: charId, path: startOut.path, durationSeconds: elapsed }) });
      const finOut = await finRes.json().catch(() => ({}));
      if (!finRes.ok) { setError(finOut.error || "Saved to storage but could not register. Tell your GM."); setPhase("recorded"); return; }

      setPhase("uploaded");
    } catch (e) {
      setError("Something went wrong. Your file is saved below.");
      setPhase("recorded");
    }
  }

  function downloadRecording() {
    if (!blob) return;
    const ext = extFor(mimeRef.current || "audio/webm");
    const name = roster.find((r) => r.character_id === charId)?.name || "session";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `six-axes-${name.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function reset() { setBlob(null); setBytes(0); setElapsed(0); setPhase("idle"); setError(null); }

  function chooseChar(id: string) {
    setCharId(id);
    try { window.localStorage.setItem("wrangler_record_character", id); } catch (e) { /* no storage */ }
  }

  const card = { width: "100%", maxWidth: 480, margin: "0 auto", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "28px 26px" } as const;
  const bigBtn = (bg: string, fg: string) => ({ width: "100%", background: bg, color: fg, border: "none", borderRadius: 12, padding: "15px 18px", fontSize: 16, fontWeight: 700, cursor: "pointer" } as const);

  return (
    <PageShell width={920}>
        <div style={card}>
          <div style={{ textAlign: "center", fontFamily: "'Iowan Old Style', Georgia, serif", fontSize: 25, fontWeight: 700 }}>Record your side</div>
          <div style={{ textAlign: "center", fontFamily: "ui-monospace, monospace", fontSize: 11, letterSpacing: "0.22em", color: C.muted, marginTop: 6 }}>
            {campaignName ? campaignName.toUpperCase() : "SIX AXES"}
          </div>
          <div style={{ height: 3, borderRadius: 3, background: `linear-gradient(90deg, ${C.sun}, ${C.plum})`, margin: "18px 0 22px" }} />

          {status === "loading" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14 }}>Loading…</p>}
          {status === "invalid" && <p style={{ textAlign: "center", color: C.muted, fontSize: 14, lineHeight: 1.6 }}>This link looks broken. Ask your GM for the campaign link.</p>}

          {status === "ready" && (
            <>
              <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
                This records only your microphone, as a backup track for your GM. Best with headphones on a call so it captures just your voice.
              </p>

              <label style={{ fontSize: 12, color: C.muted, fontFamily: "ui-monospace, monospace", letterSpacing: "0.1em" }}>YOUR CHARACTER</label>
              <select value={charId} onChange={(e) => chooseChar(e.target.value)} disabled={phase === "recording" || phase === "uploading"}
                style={{ display: "block", width: "100%", marginTop: 6, marginBottom: 16, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 12px", fontSize: 15 }}>
                <option value="">Pick your character…</option>
                {roster.map((r) => (<option key={r.character_id} value={r.character_id}>{r.name}</option>))}
              </select>

              <div style={{ fontSize: 12.5, marginBottom: 18, color: openSession ? C.good : C.muted }}>
                {openSession
                  ? `Session ${sessionNumber ?? ""} is open for recording. Your track uploads straight to your GM.`
                  : "No session is open right now. You can still record and keep the file to send your GM later."}
              </div>

              {phase === "idle" && (
                <>
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 14, cursor: "pointer" }}>
                    <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} />
                    <span>I agree to have my voice recorded for this session. It is processed to help my GM with recaps and table analytics, and I can ask my GM to delete it. <a href="/ai-recording" target="_blank" rel="noreferrer" style={{ color: C.sun }}>Details</a>.</span>
                  </label>
                  <button type="button" onClick={startRecording} disabled={!consented || !charId}
                    style={{ ...bigBtn(C.warn, SAX.inkDeep), opacity: (!consented || !charId) ? 0.5 : 1, cursor: (!consented || !charId) ? "default" : "pointer" }}>● Start recording</button>
                </>
              )}

              {phase === "recording" && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 12, background: C.warn, animation: "wpulse 1.1s ease-in-out infinite" }} />
                    <span style={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmt(elapsed)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>{fmtMB(bytes)} recorded</div>
                  <div style={{ background: "rgba(224,122,95,0.12)", border: `1px solid ${C.warn}`, borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: C.sunSoft, marginBottom: 16, lineHeight: 1.5 }}>
                    Keep this tab open and your screen awake. Backgrounding the tab can pause recording.
                  </div>
                  <button type="button" onClick={stopRecording} style={bigBtn(C.sun, SAX.inkDeep)}>■ Stop and save</button>
                  <style>{"@keyframes wpulse{0%,100%{opacity:1}50%{opacity:0.25}}"}</style>
                </div>
              )}

              {(phase === "recorded" || phase === "uploaded") && (
                <div>
                  <div style={{ textAlign: "center", marginBottom: 16 }}>
                    {phase === "uploaded" ? (
                      <div style={{ fontSize: 16, fontWeight: 700, color: C.good }}>Sent to your GM ✓</div>
                    ) : (
                      <div style={{ fontSize: 15, fontWeight: 600 }}>Recorded {fmt(elapsed)} · {fmtMB(bytes)}</div>
                    )}
                  </div>
                  {phase === "recorded" && openSession && (
                    <button type="button" onClick={uploadRecording} style={{ ...bigBtn(C.good, SAX.inkDeep), marginBottom: 10 }}>Upload to GM</button>
                  )}
                  <button type="button" onClick={downloadRecording} style={{ ...bigBtn("transparent", C.text), border: `1px solid ${C.line}`, marginBottom: 10 }}>Download backup</button>
                  <button type="button" onClick={reset} style={{ ...bigBtn("transparent", C.muted), border: "none", padding: "8px" }}>Record again</button>
                </div>
              )}

              {phase === "uploading" && (
                <div style={{ textAlign: "center", padding: "10px 0", color: C.muted, fontSize: 15 }}>Uploading your track…</div>
              )}

              {error && <p style={{ color: C.warn, fontSize: 13, textAlign: "center", marginTop: 16, lineHeight: 1.5 }}>{error}</p>}
            </>
          )}
        </div>

        {status === "ready" && share && (
          <div style={{ marginTop: 18 }}>
            <TableTap shareCode={share} />
          </div>
        )}
    </PageShell>
  );
}
