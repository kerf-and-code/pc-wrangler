"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { C } from "@/lib/forge-theme";
import type { createClient } from "@/lib/supabase/client";
import { clockOffset, musicPosition, normAudio, type AudioInput, type AudioState } from "@/lib/tabletop/sound";

// components/table-sound.tsx (2026-11-08)
//
// Music and ambient sound at the tabletop (phase 5s, p124).
//
//   useTableAudio  one live subscription to what is playing (vtt_audio), the server-clock offset, and the
//                  GM's save (tabletop_set_audio). The tabletop calls it once and hands the result to the
//                  player below and to the GM's Sound tab (components/sound-panel.tsx).
//   TableSound     the player every browser at the table runs: one music track kept on the same moment
//                  as everyone else's (re-aligned when it drifts more than 0.75 s), up to four ambient
//                  loops, and a small control with this person's own volume and mute (kept in this
//                  browser only). Browsers refuse to start sound before the person has clicked on the
//                  page; when that happens the control offers a button to turn the sound on.

type Supa = ReturnType<typeof createClient>;
const EMPTY: AudioState = { music: null, ambient: [] };
const PREF_KEY = "sixaxes.tableSound";

export function useTableAudio(campaignId: string, supabase: Supa) {
  const [audio, setAudio] = useState<AudioState>(EMPTY);
  const [missing, setMissing] = useState(false);
  const offset = useRef(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await supabase.from("vtt_audio").select("state").eq("campaign_id", campaignId).maybeSingle();
      if (!live) return;
      if (error) { if (/vtt_audio/.test(error.message)) setMissing(true); return; }
      setAudio(normAudio((data as { state?: unknown } | null)?.state));
    })();
    const ch = supabase.channel(`tabletop-sound:${campaignId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "vtt_audio", filter: `campaign_id=eq.${campaignId}` }, (p) => {
        const row = p.new as { state?: unknown } | null;
        setAudio(row && "state" in row ? normAudio(row.state) : EMPTY);
      })
      .subscribe();
    return () => { live = false; void supabase.removeChannel(ch); };
  }, [campaignId, supabase]);

  // how far this browser's clock is off the server's, measured now and every five minutes
  useEffect(() => {
    const measure = async () => {
      const t0 = Date.now();
      const { data, error } = await supabase.rpc("tabletop_server_ms");
      const t1 = Date.now();
      if (!error && typeof data === "number" && t1 - t0 < 3000) offset.current = clockOffset(t0, data, t1);
    };
    void measure();
    const timer = window.setInterval(() => void measure(), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [supabase]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  /** The GM's change: returns an error message, or null when saved. */
  const save = useCallback(async (next: AudioInput): Promise<string | null> => {
    const { data, error } = await supabase.rpc("tabletop_set_audio", { p_campaign: campaignId, p_state: next });
    if (error) return /only the GM/.test(error.message) ? "Only the GM controls the sound." : error.message;
    setAudio(normAudio(data));
    return null;
  }, [supabase, campaignId]);

  return { audio, serverNow, save, missing };
}

function readPrefs(): { volume: number; muted: boolean } {
  try {
    const o = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? "{}") as { volume?: unknown; muted?: unknown };
    return { volume: typeof o.volume === "number" ? Math.max(0, Math.min(1, o.volume)) : 0.8, muted: o.muted === true };
  } catch { return { volume: 0.8, muted: false }; }
}

export default function TableSound({ audio, serverNow }: { audio: AudioState; serverNow: () => number }) {
  const musicEl = useRef<HTMLAudioElement | null>(null);
  const layers = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [blocked, setBlocked] = useState(false);
  const [prefs, setPrefs] = useState<{ volume: number; muted: boolean }>({ volume: 0.8, muted: false });
  useEffect(() => { setPrefs(readPrefs()); }, []);
  const changePrefs = (p: { volume: number; muted: boolean }) => {
    setPrefs(p);
    try { window.localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private window: this session only */ }
  };
  const gain = prefs.muted ? 0 : prefs.volume;

  const tryPlay = useCallback((el: HTMLAudioElement) => {
    el.play().then(() => setBlocked(false)).catch((e: unknown) => { if ((e as { name?: string })?.name === "NotAllowedError") setBlocked(true); });
  }, []);

  // the music: same track, same moment, as everyone else
  const m = audio.music;
  useEffect(() => {
    if (!musicEl.current) { musicEl.current = new Audio(); musicEl.current.preload = "auto"; }
    const el = musicEl.current;
    if (!m) { el.pause(); if (el.dataset.url) { el.removeAttribute("src"); delete el.dataset.url; el.load(); } return; }
    if (el.dataset.url !== m.url) { el.src = m.url; el.dataset.url = m.url; }
    el.loop = m.loop;
    el.volume = Math.max(0, Math.min(1, m.volume * gain));
    const place = () => {
      const pos = musicPosition(m, serverNow(), el.duration);
      if (pos === null) { el.pause(); return; }
      if (Math.abs(el.currentTime - pos) > 0.75) { try { el.currentTime = pos; } catch { /* not seekable yet */ } }
      if (m.playing) { if (el.paused) tryPlay(el); } else if (!el.paused) el.pause();
    };
    if (el.readyState >= 1) place(); else el.addEventListener("loadedmetadata", place, { once: true });
    const timer = m.playing ? window.setInterval(place, 4000) : 0;
    return () => { el.removeEventListener("loadedmetadata", place); if (timer) window.clearInterval(timer); };
  }, [m, gain, serverNow, tryPlay]);

  // the ambient layers: each loops on its own
  const ambient = audio.ambient;
  useEffect(() => {
    const keep = new Set(ambient.map((a) => a.soundId));
    for (const [id, el] of layers.current) if (!keep.has(id)) { el.pause(); el.removeAttribute("src"); el.load(); layers.current.delete(id); }
    for (const a of ambient) {
      let el = layers.current.get(a.soundId);
      if (!el) { el = new Audio(); el.preload = "auto"; el.loop = true; el.src = a.url; layers.current.set(a.soundId, el); }
      el.volume = Math.max(0, Math.min(1, a.volume * gain));
      if (el.paused) tryPlay(el);
    }
  }, [ambient, gain, tryPlay]);

  // leaving the table stops everything
  useEffect(() => {
    const all = layers.current;
    return () => {
      musicEl.current?.pause();
      for (const el of all.values()) el.pause();
      all.clear();
    };
  }, []);

  const turnOn = () => {
    const el = musicEl.current, mm = audio.music;
    if (el && mm?.playing) {
      // join at the moment everyone else is at, not where this browser stalled
      const pos = musicPosition(mm, serverNow(), el.duration);
      if (pos !== null) { try { el.currentTime = pos; } catch { /* not seekable yet: the drift check will catch up */ } }
      tryPlay(el);
    }
    for (const el of layers.current.values()) tryPlay(el);
  };

  if (!audio.music && !audio.ambient.length) return null;
  const what = [audio.music ? `${audio.music.name}${audio.music.playing ? "" : " (paused)"}` : null, ...audio.ambient.map((a) => a.name)].filter(Boolean).join(" + ");
  return (
    <div role="group" aria-label="Table sound"
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "rgba(21,18,15,0.88)", border: `1px solid ${C.line}`, borderRadius: 999, color: C.text, fontSize: 12, maxWidth: "min(460px, 92vw)" }}>
      {blocked ? (
        <button type="button" onClick={turnOn} style={{ background: C.sun, color: "#1b1712", border: "none", borderRadius: 999, padding: "4px 10px", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
          Turn on the table&apos;s sound
        </button>
      ) : (
        <span title={what} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: "1 1 auto" }}>
          <span style={{ color: C.muted }}>Sound: </span>{what}
        </span>
      )}
      <input type="range" min={0} max={100} value={Math.round(prefs.volume * 100)} aria-label="Your volume for the table's sound"
        onChange={(e) => changePrefs({ volume: Number(e.target.value) / 100, muted: false })} style={{ width: 80, flex: "0 0 auto" }} />
      <button type="button" aria-pressed={prefs.muted} onClick={() => changePrefs({ ...prefs, muted: !prefs.muted })}
        style={{ background: "transparent", color: prefs.muted ? C.sun : C.text, border: `1px solid ${prefs.muted ? C.sun : C.line}`, borderRadius: 999, padding: "2px 9px", fontSize: 12, cursor: "pointer", flex: "0 0 auto" }}>
        {prefs.muted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}
