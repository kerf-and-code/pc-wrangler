// lib/tabletop/sound.ts (2026-11-08)
//
// Music and ambient sound at the tabletop (phase 5s, p124). Pure: no React, no network.
//
// What is playing lives in vtt_audio.state, written only by tabletop_set_audio, which stamps the moment
// it saved in SERVER milliseconds (music.at). A browser works out where the music is now from that
// stamp, its own clock and how far its clock is off the server's (measured with tabletop_server_ms), so
// everyone at the table hears the same moment of the track even when their clocks disagree.

export const MAX_AMBIENT = 4;
export const MAX_SOUND_BYTES = 25 * 1024 * 1024;
/** Accepted upload types and the extension each is stored under. */
export const SOUND_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg", "audio/opus": "opus", "audio/mp4": "m4a", "audio/x-m4a": "m4a",
  "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/webm": "webm", "audio/flac": "flac",
};

export type MusicState = {
  soundId: string; name: string; url: string; duration: number | null;
  playing: boolean; offset: number; loop: boolean; volume: number; at: number;
};
export type AmbientLayer = { soundId: string; name: string; url: string; volume: number };
export type AudioState = { music: MusicState | null; ambient: AmbientLayer[] };
/** What the GM sends: sounds by id only (the server fills in names and addresses). */
export type AudioInput = {
  music: { soundId: string; playing: boolean; offset: number; loop: boolean; volume: number } | null;
  ambient: { soundId: string; volume: number }[];
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const vol = (v: unknown, d: number) => Math.max(0, Math.min(1, num(v, d)));

/** A stored state, read defensively (missing, partial or from an older version). */
export function normAudio(raw: unknown): AudioState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const m = o.music && typeof o.music === "object" ? (o.music as Record<string, unknown>) : null;
  const music: MusicState | null = m && str(m.soundId) && /^https:\/\//.test(str(m.url))
    ? {
        soundId: str(m.soundId), name: str(m.name) || "Music", url: str(m.url),
        duration: typeof m.duration === "number" && m.duration > 0 ? m.duration : null,
        playing: m.playing === true, offset: Math.max(0, num(m.offset, 0)), loop: m.loop !== false,
        volume: vol(m.volume, 0.7), at: num(m.at, 0),
      }
    : null;
  const ambient: AmbientLayer[] = (Array.isArray(o.ambient) ? o.ambient : [])
    .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : {}))
    .filter((a) => str(a.soundId) && /^https:\/\//.test(str(a.url)))
    .slice(0, MAX_AMBIENT)
    .map((a) => ({ soundId: str(a.soundId), name: str(a.name) || "Ambience", url: str(a.url), volume: vol(a.volume, 0.5) }));
  return { music, ambient };
}

/**
 * Where the music should be, in seconds, at server time `serverNow` (ms). A paused track sits at its
 * offset. A looping track wraps at its length; a track that does not loop returns null once it has
 * ended. `duration` is the length the browser measured, when known, else the stored one.
 */
export function musicPosition(m: MusicState, serverNow: number, duration?: number | null): number | null {
  if (!m.playing) return m.offset;
  const t = m.offset + Math.max(0, serverNow - m.at) / 1000;
  const d = duration && duration > 0 && Number.isFinite(duration) ? duration : m.duration;
  if (!d) return t;
  if (m.loop) return t % d;
  return t >= d ? null : t;
}

/**
 * How far this browser's clock is behind the server's, in ms (add it to Date.now()). The server's
 * reading is taken to be from the middle of the round trip.
 */
export function clockOffset(sentAt: number, serverMs: number, receivedAt: number): number {
  return serverMs - (sentAt + receivedAt) / 2;
}

/** The state as the GM's next request: the same, by id. */
export function toInput(s: AudioState): AudioInput {
  return {
    music: s.music ? { soundId: s.music.soundId, playing: s.music.playing, offset: s.music.offset, loop: s.music.loop, volume: s.music.volume } : null,
    ambient: s.ambient.map((a) => ({ soundId: a.soundId, volume: a.volume })),
  };
}

/** A friendly default name from a file name: "tavern_night-loop.mp3" becomes "Tavern night loop". */
export function nameFromFile(file: string): string {
  const base = file.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 80) || "Sound";
}

/** 3:07 or 1:02:45. */
export function clock(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "";
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
