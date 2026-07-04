import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Server-side extraction kick. Fired best-effort by the transcribe callback so a
// job's events are ready before the GM opens Review. It walks the same windowed
// extractors the Review page uses, one window each per loop, until both finish.
// If this is killed (huge session, cold platform), the Review page's auto-start
// finishes the job, so this is a head start, never the only path.

export const maxDuration = 300;

const MAX_WINDOWS = 80; // safety cap: ~80 windows per extractor

export async function POST(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job");
  const k = req.nextUrl.searchParams.get("k");
  if (!jobId || k !== process.env.TRANSCRIBE_CALLBACK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: job } = await admin.from("capture_jobs").select("id, status").eq("id", jobId).single();
  if (!job) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  if ((job as { status: string }).status !== "extracting") {
    return NextResponse.json({ ok: true, status: (job as { status: string }).status });
  }

  const base = process.env.TRANSCRIBE_CALLBACK_BASE || req.nextUrl.origin;
  const secret = process.env.TRANSCRIBE_CALLBACK_SECRET as string;
  const body = JSON.stringify({ jobId });
  const headers = { "Content-Type": "application/json" };

  async function step(path: string): Promise<boolean> {
    try {
      const res = await fetch(`${base}${path}?k=${encodeURIComponent(secret)}`, { method: "POST", headers, body });
      const out = (await res.json().catch(() => ({}))) as { done?: boolean };
      // On a non-ok response, treat this extractor as finished to avoid a hot
      // loop; the real job status is governed by the extract routes' cursor
      // checks, and the client auto-start covers any remainder.
      return res.ok ? Boolean(out.done) : true;
    } catch {
      return true;
    }
  }

  let playerDone = false;
  let gmDone = false;
  for (let i = 0; i < MAX_WINDOWS && !(playerDone && gmDone); i++) {
    if (!playerDone) playerDone = await step("/api/extract");
    if (!gmDone) gmDone = await step("/api/extract-gm");
  }

  return NextResponse.json({ ok: true, playerDone, gmDone });
}
