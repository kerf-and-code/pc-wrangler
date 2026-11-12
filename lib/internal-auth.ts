// lib/internal-auth.ts (2026-11-12, push 42: audit round 2, T5)
//
// Two kinds of server-to-server trust used to share ONE secret, sent in the URL:
//   1. the transcription providers (Deepgram, Replicate) call us back when a track is done, at
//      /api/transcribe/callback?track=...&k=<TRANSCRIBE_CALLBACK_SECRET>
//   2. our own routes chain the extraction (/api/extract/run, /api/extract, /api/extract-gm, the
//      advance-jobs cron) with the same ?k=.
// So the secret sat in two outside companies' dashboards and webhook logs, and anyone who read it could
// both forge transcripts and drive paid extraction for any job. It also could not be rotated without
// stranding every transcription in flight.
//
// Now:
//   * A provider callback URL carries a signature for THAT track only, with an expiry:
//     ?track=<id>&exp=<unix seconds>&sig=<HMAC-SHA256(TRANSCRIBE_CALLBACK_SECRET, "<id>.<exp>")>.
//     The secret itself never leaves the server.
//   * Our own chain sends INTERNAL_JOB_SECRET in a header (x-six-axes-internal), never in a URL. Until
//     INTERNAL_JOB_SECRET is set, TRANSCRIBE_CALLBACK_SECRET stands in, so the deploy does not depend on
//     a new variable; set it in Vercel to separate the two.
//   * For a short changeover (LEGACY_UNTIL), the old ?k= form is still accepted, so a transcription or
//     an extraction chain already in flight when this deploys still lands. After that date it is refused.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Until this moment the old ?k=<secret> form is still accepted on every route. */
export const LEGACY_UNTIL = Date.parse("2026-11-15T00:00:00Z");
/** How long a provider callback URL stays valid. Long room recordings can take hours to transcribe. */
export const CALLBACK_TTL_SECONDS = 48 * 3600;
export const INTERNAL_HEADER = "x-six-axes-internal";

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function callbackSecret(): string | null {
  return process.env.TRANSCRIBE_CALLBACK_SECRET || null;
}

/** The secret our own routes use to call each other. */
export function internalSecret(): string | null {
  return process.env.INTERNAL_JOB_SECRET || process.env.TRANSCRIBE_CALLBACK_SECRET || null;
}

/** Headers for a call from one of our routes to another. Empty when nothing is configured. */
export function internalHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const s = internalSecret();
  return s ? { ...extra, [INTERNAL_HEADER]: s } : { ...extra };
}

function legacyOk(k: string | null, now: number): boolean {
  const old = callbackSecret();
  return !!k && !!old && now < LEGACY_UNTIL && same(k, old);
}

/** Whether a request comes from one of our own routes (header), or the old ?k= form during changeover. */
export function isInternal(req: { headers: Headers; nextUrl: URL }, now = Date.now()): boolean {
  const s = internalSecret();
  const h = req.headers.get(INTERNAL_HEADER);
  if (s && h && same(h, s)) return true;
  return legacyOk(req.nextUrl.searchParams.get("k"), now);
}

export function signTrack(trackId: string, exp: number, secret = callbackSecret()): string | null {
  if (!secret) return null;
  return createHmac("sha256", secret).update(`${trackId}.${exp}`).digest("base64url");
}

/** The query string for a provider callback about one track: track, expiry and signature. */
export function trackCallbackQuery(trackId: string, now = Date.now()): string | null {
  const exp = Math.floor(now / 1000) + CALLBACK_TTL_SECONDS;
  const sig = signTrack(trackId, exp);
  if (!sig) return null;
  return `track=${encodeURIComponent(trackId)}&exp=${exp}&sig=${sig}`;
}

/** Whether a provider callback URL was signed by us for this track and has not expired. */
export function verifyTrackCallback(params: URLSearchParams, now = Date.now()): { ok: boolean; trackId: string | null } {
  const trackId = params.get("track");
  if (!trackId) return { ok: false, trackId: null };
  const exp = Number(params.get("exp"));
  const sig = params.get("sig");
  if (sig && Number.isFinite(exp) && exp * 1000 > now) {
    const want = signTrack(trackId, exp);
    if (want && same(sig, want)) return { ok: true, trackId };
  }
  return { ok: legacyOk(params.get("k"), now), trackId };
}
