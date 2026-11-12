// lib/costing.ts (2026-11-12, push 46)
//
// The per-session cost numbers settled in the Six Axes costing model ("Per-Session Cost and Tier
// Margins", September 2026: online sessions on Groq Whisper with silence-trim, in-person rooms on
// Replicate WhisperX). One place for them, so the usage panel and /admin estimate cost the same way and
// a change of rate is one edit. These are ESTIMATES at the model's rates, not bills: the providers'
// invoices are the truth.
//
// How a month is costed (the model's section 3):
//   per-speaker transcription  minutes recorded x the share kept after silence-trim x Groq's per-minute
//                              rate (the trim keeps about 13%, from the A/B on real tracks)
//   in-person room             a flat Replicate WhisperX cost per session that had a room track
//   recaps and extraction      a flat LLM cost per transcribed session
//   storage, compute, egress   a flat cost per transcribed session
// AI calls outside a transcribed session (imports, painted maps, Ask the campaign) are not in the
// per-session numbers; image generation is on a fixed plan in the model's overhead.

export const COSTING = {
  source: "the September 2026 costing model",
  groqPerMinute: 0.000667,          // whisper-large-v3-turbo, about $0.04 an hour
  keptAfterTrim: 0.13,              // share of raw per-speaker audio billed after silence-trim
  replicatePerRoomSession: 0.2,     // Replicate WhisperX, one room mic, per session
  llmPerSession: 0.35,              // Sonnet final pass plus a cheap chunk pass
  overheadPerSession: 0.1,          // Supabase, Fly sidecar, signed-URL egress
  deepgramPaygPerMinute: 0.0048,    // the old engine, for comparison only
  stripePct: 0.029,
  stripeFlat: 0.3,
  tiers: [
    { name: "Six Sessions", price: 10.99, sessions: 6 },
    { name: "Twelve Sessions", price: 17.99, sessions: 12 },
    { name: "Two Dozen", price: 29.99, sessions: 24 },
  ],
} as const;

export type UsageTotals = { speakerMinutes: number; roomSessions: number; sessions: number };
export type CostEstimate = { transcription: number; room: number; ai: number; overhead: number; total: number; perSession: number | null };

/** The estimated cost of a stretch of usage at the settled rates (see the top of this file). */
export function estimateCost(u: UsageTotals): CostEstimate {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const sessions = Math.round(n(u.sessions));
  const transcription = n(u.speakerMinutes) * COSTING.keptAfterTrim * COSTING.groqPerMinute;
  const room = Math.round(n(u.roomSessions)) * COSTING.replicatePerRoomSession;
  const ai = sessions * COSTING.llmPerSession;
  const overhead = sessions * COSTING.overheadPerSession;
  const total = transcription + room + ai + overhead;
  return { transcription, room, ai, overhead, total, perSession: sessions ? total / sessions : null };
}

/** "$0.47", or "under $0.01" for a cost that would round to nothing. */
export function dollars(v: number): string {
  if (v > 0 && v < 0.005) return "under $0.01";
  return `$${v.toFixed(2)}`;
}
