// lib/usage.ts (push 16, audit T22 and F11)
//
// Records what each paid call used, one row in usage_events (p147) per call: AI tokens, image
// renders. Transcription minutes are recorded by a database trigger when a track is marked done, so
// they are not written here. Record only for now (no caps); the rows are what a future price and a
// per-campaign limit will stand on, which is why they start now.
//
// Server only (service role). Never throws and never delays the caller by more than the insert:
// metering must not break the thing it meters.

import { createAdminClient } from "@/lib/supabase/admin";

export type Usage = {
  kind: "ai" | "image";
  provider: "anthropic" | "google";
  model?: string | null;
  route: string;
  campaignId?: string | null;
  sessionId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  images?: number | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** Token counts from an Anthropic Messages API response body. */
export function anthropicTokens(body: unknown): { inputTokens: number | null; outputTokens: number | null } {
  const u = (body as { usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null)?.usage;
  return { inputTokens: num(u?.input_tokens), outputTokens: num(u?.output_tokens) };
}

/** Token counts from a Gemini generateContent response body. */
export function geminiTokens(body: unknown): { inputTokens: number | null; outputTokens: number | null } {
  const u = (body as { usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown } } | null)?.usageMetadata;
  return { inputTokens: num(u?.promptTokenCount), outputTokens: num(u?.candidatesTokenCount) };
}

export async function recordUsage(u: Usage): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("usage_events").insert({
      kind: u.kind,
      provider: u.provider,
      model: u.model ?? null,
      route: u.route,
      campaign_id: u.campaignId ?? null,
      session_id: u.sessionId ?? null,
      input_tokens: u.inputTokens ?? null,
      output_tokens: u.outputTokens ?? null,
      images: u.images ?? null,
    });
    if (error) console.warn("[usage] not recorded:", error.message);
  } catch (e) {
    console.warn("[usage] not recorded:", e instanceof Error ? e.message : e);
  }
}
