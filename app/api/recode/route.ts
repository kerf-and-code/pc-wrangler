import { NextResponse } from "next/server";

// POST /api/recode: RETIRED 2026-11-03.
//
// This ran the extractor's own prompt and model a second time over a session and called the result a
// second coder. Two passes of the same model share its biases, so they can agree for the wrong reasons
// and inflate kappa. Reliability now compares the extractor with a PERSON coding a blind, stratified
// sample (app/api/coding-sample, app/gm/reliability/code). Nothing calls this route any more; it answers
// 410 so a stale tab or bookmark gets a clear message instead of a silent AI call.
//
// The recodings table and capture_jobs.recode_cursor are left in place (recodings was never written to
// in production). Drop them only after checking they are unused and empty.

export async function POST() {
  return NextResponse.json(
    { error: "The AI second coding has been retired. Use Draw a coding sample on the Reliability page to have a person code a blind sample instead." },
    { status: 410 },
  );
}
