"use client";

import React, { useEffect, useRef, useState } from "react";
import { SAX } from "@/lib/theme";

type Cached = { url: string; exp: number };

// One audio element per hook instance. play(rowId, trackId, tStart) signs the
// track's URL (cached per track for the session), points the element at it with
// a media-fragment start time, and plays. Calling play on the active row toggles
// it off. The signed URL is server-minted, so nothing here needs storage access.
export function useMomentPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cache = useRef<Map<string, Cached>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  async function urlFor(trackId: string): Promise<string | null> {
    const c = cache.current.get(trackId);
    if (c && c.exp > Date.now() + 30000) return c.url;
    const res = await fetch("/api/audio-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId }),
    });
    const out = (await res.json().catch(() => ({}))) as { url?: string; ttl?: number; error?: string };
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

  return { play, activeId, loadingId, error };
}

const clock = (t: number | null): string => {
  if (t === null || t === undefined) return "";
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function MomentButton({
  active, loading, tStart, onClick,
}: { active: boolean; loading: boolean; tStart: number | null; onClick: () => void }) {
  const label = clock(tStart);
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
