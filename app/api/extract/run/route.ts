import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Server-side extraction. Fired by the transcribe callback, and self-chaining, so a
// long session finishes without anyone opening a page.
//
// WHAT WENT WRONG BEFORE
//
// On the 2026-07-19 pilot (155 minutes, 3146 segments) extraction stopped at minute 60.
// Proposals ran 27, 10, 13, 4 across the first four 15-minute buckets and then nothing,
// extract_cursor reached 622 of 1734 player segments, and the job advanced to review as
// though it were complete. The GM reviewed a third of a session believing it was all
// of it.
//
// Two causes, both in this file:
//
//   1. step() returned TRUE on any non-ok response and on any thrown error, and the loop
//      reads true as "this extractor is finished". A single rate-limit or 500 on window
//      25 ended extraction permanently and reported success. Failure and completion were
//      indistinguishable.
//
//   2. Forty-odd windows, each making a model call, runs right at the 300 second wall.
//      When the platform kills the function mid-loop nothing resumes it. The old comment
//      said the Review page's auto-start would cover the remainder, but the job has
//      already been advanced by then, so as far as the system is concerned there is no
//      remainder.
//
// WHAT THIS DOES INSTEAD
//
//   - step() distinguishes done, more, and failed. A failure is retried, and if it keeps
//     failing that extractor stops and is reported as FAILED, never as done.
//   - The loop stops at a self-imposed deadline BELOW the platform limit, so it exits
//     cleanly with an accurate report rather than being killed mid-window.
//   - If work remains, it chains to itself. The cursors are persisted by the extract
//     routes, so each pass resumes where the last one stopped and never re-proposes what
//     the GM has already reviewed.

export const maxDuration = 300;

const MAX_WINDOWS = 80; // safety cap per pass: ~80 windows per extractor

// Stop this far below maxDuration so the loop can finish its window, write its cursor,
// and hand off to the next pass instead of being killed part-way through one.
const TIME_BUDGET_MS = 240_000;

// A window that fails is retried this many times before that extractor is given up on
// for this pass. Transient model errors are the common case and one retry usually clears
// them; a persistent failure should stop rather than spin.
const STEP_ATTEMPTS = 3;

// Chained passes are capped so a genuinely stuck extractor cannot loop forever. Ten
// passes at four minutes each is far more than any real session needs.
const MAX_PASSES = 10;

type StepResult = "done" | "more" | "failed";

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

  const pass = Number(req.nextUrl.searchParams.get("pass") || "0");
  const deadline = Date.now() + TIME_BUDGET_MS;

  // One window. "failed" is a distinct outcome from "done" on purpose: conflating them is
  // what silently truncated a session.
  async function step(path: string): Promise<StepResult> {
    let lastDetail = "";
    for (let attempt = 1; attempt <= STEP_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`${base}${path}?k=${encodeURIComponent(secret)}`, { method: "POST", headers, body });
        if (res.ok) {
          const out = (await res.json().catch(() => ({}))) as { done?: boolean };
          return out.done ? "done" : "more";
        }
        lastDetail = `${res.status}`;
      } catch (e) {
        lastDetail = e instanceof Error ? e.message : "threw";
      }
      if (attempt < STEP_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    console.error("[extract/run] %s failed after %d attempts (job %s): %s",
      path, STEP_ATTEMPTS, jobId, lastDetail);
    return "failed";
  }

  let playerDone = false;
  let gmDone = false;
  let playerFailed = false;
  let gmFailed = false;
  let windows = 0;
  let outOfTime = false;

  for (let i = 0; i < MAX_WINDOWS; i++) {
    if ((playerDone || playerFailed) && (gmDone || gmFailed)) break;
    if (Date.now() > deadline) { outOfTime = true; break; }

    if (!playerDone && !playerFailed) {
      const r = await step("/api/extract");
      if (r === "done") playerDone = true;
      else if (r === "failed") playerFailed = true;
      windows++;
    }
    if (!gmDone && !gmFailed) {
      const r = await step("/api/extract-gm");
      if (r === "done") gmDone = true;
      else if (r === "failed") gmFailed = true;
      windows++;
    }
  }

  // Work remains and it is not because an extractor is broken: hand off to another pass.
  // Cursors are persisted, so the next pass resumes rather than restarting.
  const moreToDo = (!playerDone && !playerFailed) || (!gmDone && !gmFailed);
  let chained = false;
  if (moreToDo && pass + 1 < MAX_PASSES) {
    const next = `${base}/api/extract/run?job=${encodeURIComponent(jobId)}&k=${encodeURIComponent(secret)}&pass=${pass + 1}`;
    void fetch(next, { method: "POST" }).catch(() => {});
    chained = true;
  }

  console.log(
    "[extract/run] job=%s pass=%d windows=%d player=%s gm=%s outOfTime=%s chained=%s",
    jobId, pass, windows,
    playerFailed ? "FAILED" : playerDone ? "done" : "incomplete",
    gmFailed ? "FAILED" : gmDone ? "done" : "incomplete",
    outOfTime, chained,
  );

  return NextResponse.json({
    ok: true,
    jobId,
    pass,
    windows,
    playerDone,
    gmDone,
    playerFailed,
    gmFailed,
    outOfTime,
    chained,
    // complete means both extractors genuinely reached the end of the transcript. Anything
    // else is a partial session, and callers must not treat it as finished.
    complete: playerDone && gmDone,
  });
}
