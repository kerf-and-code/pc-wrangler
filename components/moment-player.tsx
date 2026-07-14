"use client";

import React, { useEffect, useRef, useState } from "react";
import { SAX } from "@/lib/theme";

type Cached = { url: string; exp: number };

// One audio element per hook instance. play(rowId, trackId, tStart) signs the
// track's URL (cached per track for the session), points the element at it with
// a media-fragment start time, and plays. Calling play on the active row toggles
// it off. The signed URL is server-minted, so nothing here needs storage access.
//
// RETENTION. Session audio is deleted 60 days after recording. When that has
// happened, /api/audio-url answers 410 with { purged: true }. That is the policy
// working, not a failure, so it is NOT surfaced as an error: the track is
// remembered as purged, the button for that moment goes quiet and reads "expired",
// and no further requests are made for it. The transcript and the extracted events
// are unaffected; only the recording is gone.
export function useMomentPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cache = useRef<Map<string, Cached>>(new Map());
  const purged = useRef<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped whenever a track is newly discovered to be purged, so callers re-render
  // and the affected buttons pick up their expired state.
  const [, setPurgedTick] = useState(0);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const isPurged = (trackId: string | null): boolean => !!trackId && purged.current.has(trackId);

  async function urlFor(trackId: string): Promise<string | null> {
    const c = cache.current.get(trackId);
    if (c && c.exp > Date.now() + 30000) return c.url;

    const res = await fetch("/api/audio-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId }),
    });
    const out = (await res.json().catch(() => ({}))) as
      { url?: string; ttl?: number; error?: string; purged?: boolean };

    // 410 Gone: deleted under the retention policy. Remember it so we never ask
    // again, and let the button say so plainly instead of raising an error.
    if (res.status === 410 || out.purged) {
      purged.current.add(trackId);
      setPurgedTick((n) => n + 1);
      return null;
    }

    if (!res.ok || !out.url) { setError(out.error || "Could not load audio."); return null; }

    const ttl = Number(out.ttl || 7200);
    cache.current.set(trackId, { url: out.url, exp: Date.now() + ttl * 1000 });
    return out.url;
  }

  async function play(rowId: string, trackId: string | null, tStart: number | null) {
    setError(null);
    if (!audioRef.current) {
      const a = new Audio();
      a.onended = () => setActiveId(null);
      audioRef.current = a;
    }
    const audio = audioRef.current;
    if (activeId === rowId) { audio.pause(); setActiveId(null); return; }
    if (!trackId) { setError("No audio linked to this moment."); return; }
    if (isPurged(trackId)) return; // already known gone; the button is inert

    setLoadingId(rowId);
    const url = await urlFor(trackId);
    setLoadingId(null);
    if (!url) return;

    const start = Math.max(0, Math.floor(tStart ?? 0));
    audio.src = `${url}#t=${start}`;
    try {
      await audio.play();
      setActiveId(rowId);
    } catch {
      setError("Playback was blocked. Tap play again.");
    }
  }

  return { play, activeId, loadingId, error, isPurged };
}

const clock = (t: number | null): string => {
  if (t === null || t === undefined) return "";
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function MomentButton({
  active, loading, tStart, onClick, expired = false,
}: {
  active: boolean;
  loading: boolean;
  tStart: number | null;
  onClick: () => void;
  // True once the audio behind this moment has been deleted under the 60-day
  // retention policy. Optional, so existing call sites keep working unchanged.
  expired?: boolean;
}) {
  const label = clock(tStart);

  if (expired) {
    return (
      <span
        title="The recording was deleted under the 60-day retention policy. The transcript and the extracted events are still here."
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "transparent", color: SAX.muted, opacity: 0.6,
          border: `1px dashed ${SAX.line}`,
          borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 700,
          fontFamily: SAX.mono, letterSpacing: "0.04em", cursor: "default",
        }}
      >
        <span style={{ fontSize: 10 }}>{"\u2014"}</span>
        {label ? `expired ${label}` : "expired"}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: active ? SAX.brass : "transparent",
        color: active ? SAX.inkDeep : SAX.muted,
        border: `1px solid ${active ? SAX.brass : SAX.line}`,
        borderRadius: 999, padding: "4px 11px", fontSize: 11.5, fontWeight: 700,
        fontFamily: SAX.mono, cursor: loading ? "default" : "pointer", letterSpacing: "0.04em",
      }}
    >
      <span style={{ fontSize: 10 }}>{loading ? "\u2026" : active ? "\u25A0" : "\u25B6"}</span>
      {loading ? "loading" : active ? "stop" : `play${label ? " " + label : ""}`}
    </button>
  );
}
