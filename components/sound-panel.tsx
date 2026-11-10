"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { C } from "@/lib/forge-theme";
import type { createClient } from "@/lib/supabase/client";
import {
  MAX_AMBIENT, MAX_SOUND_BYTES, SOUND_TYPES, clock, musicPosition, nameFromFile, toInput,
  type AudioInput, type AudioState,
} from "@/lib/tabletop/sound";
import { friendlyError, notReady } from "@/lib/friendly-error";

// components/sound-panel.tsx (2026-11-08)
//
// The GM's Sound tab at the tabletop (phase 5s, p124): the campaign's sound library and what the table
// hears. Upload music or ambient loops (app/api/tabletop/sound), play one music track (pause, resume,
// restart, stop, loop, volume) and layer up to four ambient loops, each with its own volume. Every
// change goes through tabletop_set_audio via `save`, and every browser at the table follows it
// (components/table-sound.tsx). Players set their own volume there; this is the GM's mix.

type Sound = { id: string; name: string; kind: "music" | "ambient"; url: string; duration: number | null; bytes: number | null };

/** The length of an audio file, read by the browser before upload (null if it cannot tell in time). */
function measure(file: File): Promise<number | null> {
  return new Promise((res) => {
    const url = URL.createObjectURL(file), a = new Audio();
    const done = (v: number | null) => { URL.revokeObjectURL(url); res(v); };
    const t = window.setTimeout(() => done(null), 5000);
    a.preload = "metadata";
    a.onloadedmetadata = () => { window.clearTimeout(t); done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null); };
    a.onerror = () => { window.clearTimeout(t); done(null); };
    a.src = url;
  });
}

export default function SoundPanel({ campaignId, supabase, audio, serverNow, save, missing }: {
  campaignId: string;
  supabase: ReturnType<typeof createClient>;
  audio: AudioState;
  serverNow: () => number;
  save: (next: AudioInput) => Promise<string | null>;
  missing: boolean;
}) {
  const [sounds, setSounds] = useState<Sound[] | null>(null);
  const [kind, setKind] = useState<"music" | "ambient">("music");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const volTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("vtt_sounds").select("id, name, kind, url, duration, bytes").eq("campaign_id", campaignId).order("kind").order("name");
    if (error) { setErr(/vtt_sounds/.test(error.message) ? notReady("Sound", "p124") : friendlyError(error)); setSounds([]); return; }
    setSounds((data ?? []) as Sound[]);
  }, [supabase, campaignId]);
  useEffect(() => { void load(); }, [load]);

  // the playing time ticks on screen
  useEffect(() => {
    if (!audio.music?.playing) return;
    const t = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, [audio.music?.playing]);

  const apply = async (next: AudioInput) => {
    setErr(null);
    const e = await save(next);
    if (e) setErr(e);
  };
  const cur = toInput(audio);
  const m = audio.music;
  const pos = m ? musicPosition(m, serverNow(), m.duration) : null;

  const playMusic = (s: Sound) => void apply({ ...cur, music: { soundId: s.id, playing: true, offset: 0, loop: true, volume: cur.music?.volume ?? 0.7 } });
  const toggleLayer = (s: Sound) => {
    const on = cur.ambient.some((a) => a.soundId === s.id);
    if (!on && cur.ambient.length >= MAX_AMBIENT) { setErr(`Up to ${MAX_AMBIENT} ambient loops play at once. Turn one off first.`); return; }
    void apply({ ...cur, ambient: on ? cur.ambient.filter((a) => a.soundId !== s.id) : [...cur.ambient, { soundId: s.id, volume: 0.5 }] });
  };
  // volume sliders save after the hand stops moving
  const later = (next: AudioInput) => {
    if (volTimer.current) window.clearTimeout(volTimer.current);
    volTimer.current = window.setTimeout(() => void apply(next), 350);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    for (const f of Array.from(files).slice(0, 10)) {
      if (!SOUND_TYPES[f.type]) { setErr(`${f.name}: use an MP3, OGG, Opus, M4A, AAC, WAV, WebM or FLAC file.`); continue; }
      if (f.size > MAX_SOUND_BYTES) { setErr(`${f.name} is over 25 MB.`); continue; }
      setBusy(`Uploading ${f.name}...`);
      const fd = new FormData();
      fd.append("campaignId", campaignId); fd.append("file", f); fd.append("kind", kind); fd.append("name", nameFromFile(f.name));
      const d = await measure(f); if (d) fd.append("duration", String(d));
      const res = await fetch("/api/tabletop/sound", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setErr(j.error || `Upload failed (${res.status}).`);
    }
    setBusy(null);
    void load();
  };

  const remove = async (s: Sound) => {
    setBusy(`Removing ${s.name}...`); setErr(null);
    const res = await fetch("/api/tabletop/sound", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, soundId: s.id }) });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(null); setConfirmDel(null);
    if (!res.ok) { setErr(j.error || `Could not remove it (${res.status}).`); return; }
    void load();
  };

  const small: React.CSSProperties = { padding: "4px 9px", background: "transparent", color: C.text, border: `1px solid ${C.line}`, borderRadius: 7, fontSize: 12, cursor: "pointer" };
  const on = (x: boolean): React.CSSProperties => ({ ...small, color: x ? C.sun : C.text, borderColor: x ? C.sun : C.line });
  const head: React.CSSProperties = { fontWeight: 600, fontSize: 13, margin: "16px 0 6px" };

  if (missing) return <div style={{ flex: 1, padding: 12, color: C.muted, fontSize: 12.5 }}>Sound is not available yet.</div>;

  const list = (k: "music" | "ambient") => (sounds ?? []).filter((s) => s.kind === k);
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Now playing</div>
      {!m && !audio.ambient.length && <p style={{ color: C.muted, fontSize: 12.5, margin: "6px 0 0" }}>Nothing. Play a track or add an ambient loop below; everyone at the table hears it, each at their own volume.</p>}
      {m && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", marginTop: 6 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
            <span style={{ flex: 1, fontSize: 13 }}>{m.name}</span>
            <span style={{ fontSize: 11.5, color: C.muted }}>{pos === null ? "ended" : `${clock(pos)}${m.duration ? ` / ${clock(m.duration)}` : ""}`}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
            {m.playing && pos !== null
              ? <button type="button" style={small} onClick={() => void apply({ ...cur, music: { ...cur.music!, playing: false, offset: pos } })}>Pause</button>
              : <button type="button" style={small} onClick={() => void apply({ ...cur, music: { ...cur.music!, playing: true, offset: pos ?? 0 } })}>{pos === null ? "Play again" : "Resume"}</button>}
            <button type="button" style={small} onClick={() => void apply({ ...cur, music: { ...cur.music!, playing: true, offset: 0 } })}>Restart</button>
            <button type="button" style={small} onClick={() => void apply({ ...cur, music: null })}>Stop</button>
            <button type="button" aria-pressed={m.loop} style={on(m.loop)} onClick={() => void apply({ ...cur, music: { ...cur.music!, loop: !m.loop, offset: pos ?? 0 } })}>Loop</button>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.muted, marginTop: 6 }}>
            Volume
            <input type="range" min={0} max={100} defaultValue={Math.round(m.volume * 100)} key={`${m.soundId}-v`} style={{ flex: 1 }}
              onChange={(e) => later({ ...cur, music: { ...cur.music!, volume: Number(e.target.value) / 100, offset: musicPosition(m, serverNow(), m.duration) ?? 0 } })} />
          </label>
        </div>
      )}
      {audio.ambient.map((a) => (
        <div key={a.soundId} style={{ display: "flex", gap: 8, alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
          <span style={{ flex: 1, fontSize: 12.5 }}>{a.name} <span style={{ color: C.muted, fontSize: 11 }}>loop</span></span>
          <input type="range" min={0} max={100} defaultValue={Math.round(a.volume * 100)} aria-label={`Volume of ${a.name}`} style={{ width: 90 }}
            onChange={(e) => later({ ...cur, ambient: cur.ambient.map((x) => (x.soundId === a.soundId ? { ...x, volume: Number(e.target.value) / 100 } : x)) })} />
          <button type="button" style={small} onClick={() => void apply({ ...cur, ambient: cur.ambient.filter((x) => x.soundId !== a.soundId) })}>Off</button>
        </div>
      ))}

      <div style={head}>Add sounds</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <div role="group" aria-label="Kind of sound" style={{ display: "flex", gap: 4 }}>
          <button type="button" aria-pressed={kind === "music"} style={on(kind === "music")} onClick={() => setKind("music")}>Music</button>
          <button type="button" aria-pressed={kind === "ambient"} style={on(kind === "ambient")} onClick={() => setKind("ambient")}>Ambient loop</button>
        </div>
        <button type="button" style={{ ...small, background: C.sun, color: "#1b1712", border: "none", fontWeight: 600 }} disabled={!!busy} onClick={() => fileRef.current?.click()}>Upload</button>
        <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
      </div>
      <p style={{ color: C.muted, fontSize: 11.5, margin: "6px 0 0" }}>MP3 or OGG keeps files small (25 MB each at most). Use music you have the right to play; it is stored with this campaign.</p>
      {busy && <p role="status" style={{ fontSize: 12, color: C.muted, margin: "6px 0 0" }}>{busy}</p>}

      {(["music", "ambient"] as const).map((k) => (
        <div key={k}>
          <div style={head}>{k === "music" ? "Music" : "Ambient loops"}</div>
          {sounds === null && <p role="status" style={{ color: C.muted, fontSize: 12.5 }}>Loading…</p>}
          {sounds !== null && list(k).length === 0 && <p style={{ color: C.muted, fontSize: 12.5, margin: 0 }}>{k === "music" ? "No music yet." : "No ambient loops yet (rain, a crowd, a crackling fire)."}</p>}
          <div style={{ display: "grid", gap: 5 }}>
            {list(k).map((s) => {
              const playing = k === "music" ? m?.soundId === s.id : cur.ambient.some((a) => a.soundId === s.id);
              return (
                <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center", border: `1px solid ${playing ? C.sun : C.line}`, borderRadius: 8, padding: "5px 8px" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.name}>
                    {s.name} <span style={{ color: C.muted, fontSize: 11 }}>{clock(s.duration)}</span>
                  </span>
                  {k === "music"
                    ? <button type="button" style={on(playing)} disabled={playing} onClick={() => playMusic(s)} aria-label={`Play ${s.name}`}>{playing ? "Playing" : "Play"}</button>
                    : <button type="button" style={on(playing)} aria-pressed={playing} onClick={() => toggleLayer(s)} aria-label={`${playing ? "Turn off" : "Turn on"} ${s.name}`}>{playing ? "On" : "Off"}</button>}
                  {confirmDel === s.id
                    ? <button type="button" style={{ ...small, background: C.warn, color: "#1b1712", border: "none" }} onClick={() => void remove(s)}>Delete for good</button>
                    : <button type="button" style={{ ...small, color: C.warn }} onClick={() => setConfirmDel(s.id)} aria-label={`Delete ${s.name}`}>Delete</button>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {err && <p role="alert" style={{ color: C.warn, fontSize: 12, marginTop: 10 }}>{err}</p>}
    </div>
  );
}
